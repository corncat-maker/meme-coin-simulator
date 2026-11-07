import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import ts from 'typescript';
import type { Plugin } from 'vite';

type AiInputViolation = {
  start: number;
  end: number;
  message: string;
  codeSnippet?: string;
};

type FileViolation = AiInputViolation & {
  filePath: string;
};

type AnalysisContext = {
  aiAliases: Set<string>;
  functionBodies: Map<string, ts.Node>;
  setterToState: Map<string, string>;
  sourceFile: ts.SourceFile;
};

type AiCallOccurrence = {
  start: number;
  end: number;
  apiName: string;
  codeSnippet: string;
};

const JSX_INPUT_EVENT_ATTRIBUTES = new Set(['onChange', 'onInput']);
const JSX_HIGH_FREQUENCY_EVENT_ATTRIBUTES = new Set(['onScroll', 'onMouseMove', 'onPointerMove', 'onTouchMove']);
const BLOCKED_JSX_EVENT_ATTRIBUTES = new Set([
  ...JSX_INPUT_EVENT_ATTRIBUTES,
  ...JSX_HIGH_FREQUENCY_EVENT_ATTRIBUTES,
]);
const BLOCKED_DOM_EVENTS = new Set(['input', 'change', 'scroll', 'mousemove', 'pointermove', 'touchmove']);
const EFFECT_SCHEDULED_CALLBACKS = new Set([
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'requestIdleCallback',
  'queueMicrotask',
  'debounce',
  'throttle',
]);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
const IGNORED_SOURCE_GLOBS = ['**/*.d.ts'];

function computeLineCol(code: string, index: number) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < code.length; i++) {
    if (code.charCodeAt(i) === 10) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, column: col };
}

function getCodeSnippet(code: string, start: number, end: number): string {
  const snippet = code.slice(start, end).trim();
  if (snippet.length > 100) {
    return `${snippet.slice(0, 97)}...`;
  }
  return snippet;
}

function addViolation(violations: Map<string, AiInputViolation>, item: AiInputViolation) {
  const key = `${item.start}:${item.end}:${item.message}`;
  const existing = violations.get(key);
  if (!existing || item.end > existing.end) {
    violations.set(key, item);
  }
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getPropertyName(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function getStaticStringValue(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function getMemberChain(expression: ts.Expression): string[] | null {
  const parts: string[] = [];
  let current = unwrapExpression(expression);

  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isPropertyAccessChain(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isElementAccessChain(current)
  ) {
    const propertyName =
      ts.isPropertyAccessExpression(current) || ts.isPropertyAccessChain(current)
        ? current.name.text
        : getPropertyName(current.argumentExpression);
    if (!propertyName) return null;

    parts.unshift(propertyName);
    current = unwrapExpression(current.expression);
  }

  if (!ts.isIdentifier(current)) return null;
  parts.unshift(current.text);
  return parts;
}

function normalizeGlobalMemberChain(chain: string[]): string[] {
  if (chain.length > 1 && GLOBAL_OBJECTS.has(chain[0])) {
    return chain.slice(1);
  }
  return chain;
}

function getAiApiNameFromReference(expression: ts.Expression, aiAliases: Set<string>): string | null {
  const target = unwrapExpression(expression);

  if (ts.isIdentifier(target)) {
    if (target.text === 'callLLM' || aiAliases.has(target.text)) {
      return target.text === 'callLLM' ? 'callLLM' : `AI API alias ${target.text}`;
    }
    return null;
  }

  const chain = getMemberChain(target);
  if (!chain) return null;

  const normalizedChain = normalizeGlobalMemberChain(chain);

  if (normalizedChain.length === 1 && normalizedChain[0] === 'callLLM') {
    return 'callLLM';
  }

  if (
    normalizedChain.length === 3 &&
    normalizedChain[0] === 'lingguang' &&
    normalizedChain[1] === 'ai' &&
    normalizedChain[2] === 'chat'
  ) {
    return 'lingguang.ai.chat';
  }

  return null;
}

function isUseStateCall(node: ts.Expression): boolean {
  const target = unwrapExpression(node);

  if (ts.isIdentifier(target)) {
    return target.text === 'useState';
  }

  const chain = getMemberChain(target);
  return Boolean(chain && chain.length === 2 && chain[0] === 'React' && chain[1] === 'useState');
}

function isUseEffectCall(node: ts.Expression): boolean {
  const target = unwrapExpression(node);

  if (ts.isIdentifier(target)) {
    return target.text === 'useEffect';
  }

  const chain = getMemberChain(target);
  return Boolean(chain && chain.length === 2 && chain[0] === 'React' && chain[1] === 'useEffect');
}

function getBindingIdentifierName(node: ts.BindingName | undefined): string | null {
  return node && ts.isIdentifier(node) ? node.text : null;
}

function collectUseStateSetters(sourceFile: ts.SourceFile): Map<string, string> {
  const setterToState = new Map<string, string>();

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isUseStateCall(node.initializer.expression)
    ) {
      const [stateBinding, setterBinding] = node.name.elements;
      const stateName = ts.isBindingElement(stateBinding) ? getBindingIdentifierName(stateBinding.name) : null;
      const setterName = ts.isBindingElement(setterBinding) ? getBindingIdentifierName(setterBinding.name) : null;

      if (stateName && setterName) {
        setterToState.set(setterName, stateName);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return setterToState;
}

function collectFunctionBodies(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const functionBodies = new Map<string, ts.Node>();

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functionBodies.set(node.name.text, node.body);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functionBodies.set(node.name.text, node.initializer.body);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functionBodies;
}

function collectAiAliases(sourceFile: ts.SourceFile): Set<string> {
  const aiAliases = new Set<string>();

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      getAiApiNameFromReference(node.initializer, aiAliases)
    ) {
      aiAliases.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return aiAliases;
}

function findAiCallsInNode(
  node: ts.Node,
  code: string,
  context: AnalysisContext,
  expandedFunctions = new Set<string>(),
): AiCallOccurrence[] {
  const calls: AiCallOccurrence[] = [];

  if (ts.isIdentifier(node)) {
    const referencedBody = context.functionBodies.get(node.text);
    if (referencedBody && !expandedFunctions.has(node.text)) {
      const nextExpandedFunctions = new Set(expandedFunctions);
      nextExpandedFunctions.add(node.text);
      return findAiCallsInNode(referencedBody, code, context, nextExpandedFunctions);
    }
  }

  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      const apiName = getAiApiNameFromReference(current.expression, context.aiAliases);
      if (apiName) {
        const start = current.getStart(context.sourceFile);
        const end = current.getEnd();
        calls.push({
          start,
          end,
          apiName,
          codeSnippet: getCodeSnippet(code, start, end),
        });
      }

      const callee = unwrapExpression(current.expression);
      if (ts.isIdentifier(callee)) {
        const referencedBody = context.functionBodies.get(callee.text);
        if (referencedBody && !expandedFunctions.has(callee.text)) {
          const nextExpandedFunctions = new Set(expandedFunctions);
          nextExpandedFunctions.add(callee.text);
          calls.push(...findAiCallsInNode(referencedBody, code, context, nextExpandedFunctions));
        }
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return calls;
}

function getCalleeLastName(expression: ts.Expression): string | null {
  const target = unwrapExpression(expression);

  if (ts.isIdentifier(target)) {
    return target.text;
  }

  const chain = getMemberChain(target);
  return chain ? chain[chain.length - 1] : null;
}

function isFunctionLikeExpression(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function getExecutableBody(node: ts.Node): ts.Node {
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  ) {
    return node.body ?? node;
  }

  return node;
}

function findAiCallsTriggeredByEffect(
  node: ts.Node,
  code: string,
  context: AnalysisContext,
  expandedFunctions = new Set<string>(),
): AiCallOccurrence[] {
  if (ts.isIdentifier(node)) {
    const referencedBody = context.functionBodies.get(node.text);
    if (referencedBody && !expandedFunctions.has(node.text)) {
      const nextExpandedFunctions = new Set(expandedFunctions);
      nextExpandedFunctions.add(node.text);
      return findAiCallsTriggeredByEffect(referencedBody, code, context, nextExpandedFunctions);
    }
  }

  const root = getExecutableBody(node);
  const calls: AiCallOccurrence[] = [];

  const scanScheduledCallback = (callback: ts.Expression | undefined) => {
    if (!callback) return;
    const target = unwrapExpression(callback);

    if (isFunctionLikeExpression(target) || ts.isIdentifier(target)) {
      calls.push(...findAiCallsTriggeredByEffect(target, code, context, expandedFunctions));
    }
  };

  const visit = (current: ts.Node) => {
    if (current !== root && isFunctionLikeExpression(current)) {
      return;
    }

    if (current !== root && ts.isFunctionDeclaration(current)) {
      return;
    }

    if (ts.isCallExpression(current)) {
      const apiName = getAiApiNameFromReference(current.expression, context.aiAliases);
      if (apiName) {
        const start = current.getStart(context.sourceFile);
        const end = current.getEnd();
        calls.push({
          start,
          end,
          apiName,
          codeSnippet: getCodeSnippet(code, start, end),
        });
      }

      const callee = unwrapExpression(current.expression);
      if (isFunctionLikeExpression(callee)) {
        calls.push(...findAiCallsTriggeredByEffect(callee, code, context, expandedFunctions));
      }

      if (ts.isIdentifier(callee)) {
        const referencedBody = context.functionBodies.get(callee.text);
        if (referencedBody && !expandedFunctions.has(callee.text)) {
          const nextExpandedFunctions = new Set(expandedFunctions);
          nextExpandedFunctions.add(callee.text);
          calls.push(...findAiCallsTriggeredByEffect(referencedBody, code, context, nextExpandedFunctions));
        }
      }

      const calleeLastName = getCalleeLastName(current.expression);
      if (calleeLastName && EFFECT_SCHEDULED_CALLBACKS.has(calleeLastName)) {
        scanScheduledCallback(current.arguments[0]);
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(root);
  return calls;
}

function findStateSettersInNode(
  node: ts.Node,
  context: AnalysisContext,
  expandedFunctions = new Set<string>(),
): Set<string> {
  const states = new Set<string>();

  if (ts.isIdentifier(node)) {
    const referencedBody = context.functionBodies.get(node.text);
    if (referencedBody && !expandedFunctions.has(node.text)) {
      const nextExpandedFunctions = new Set(expandedFunctions);
      nextExpandedFunctions.add(node.text);
      return findStateSettersInNode(referencedBody, context, nextExpandedFunctions);
    }
  }

  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      const callee = unwrapExpression(current.expression);

      if (ts.isIdentifier(callee)) {
        const stateName = context.setterToState.get(callee.text);
        if (stateName) {
          states.add(stateName);
        }

        const referencedBody = context.functionBodies.get(callee.text);
        if (referencedBody && !expandedFunctions.has(callee.text)) {
          const nextExpandedFunctions = new Set(expandedFunctions);
          nextExpandedFunctions.add(callee.text);
          for (const nestedStateName of findStateSettersInNode(referencedBody, context, nextExpandedFunctions)) {
            states.add(nestedStateName);
          }
        }
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return states;
}

function getJsxAttributeExpression(attribute: ts.JsxAttribute): ts.Expression | null {
  const initializer = attribute.initializer;
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) {
    return null;
  }
  return initializer.expression;
}

function getHookCallbackNode(expression: ts.Expression | undefined): ts.Node | null {
  if (!expression) return null;
  const target = unwrapExpression(expression);

  if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) {
    return target.body;
  }

  if (ts.isIdentifier(target)) {
    return target;
  }

  return target;
}

function collectDependencyIdentifiers(node: ts.Expression | undefined): Set<string> {
  const identifiers = new Set<string>();
  if (!node || !ts.isArrayLiteralExpression(node)) {
    return identifiers;
  }

  for (const element of node.elements) {
    const target = unwrapExpression(element);
    if (ts.isIdentifier(target)) {
      identifiers.add(target.text);
    }
  }

  return identifiers;
}

function getStaticEventName(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  const target = unwrapExpression(node);
  return getStaticStringValue(target);
}

function isAddEventListenerCall(node: ts.CallExpression): boolean {
  const callee = unwrapExpression(node.expression);
  const chain = getMemberChain(callee);
  return Boolean(chain && chain[chain.length - 1] === 'addEventListener');
}

function findAiInputTriggerViolations(code: string): AiInputViolation[] {
  const sourceFile = ts.createSourceFile('module.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const context: AnalysisContext = {
    aiAliases: collectAiAliases(sourceFile),
    functionBodies: collectFunctionBodies(sourceFile),
    setterToState: collectUseStateSetters(sourceFile),
    sourceFile,
  };
  const inputBackedStates = new Set<string>();
  const violations = new Map<string, AiInputViolation>();

  const collectInputBackedStates = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && JSX_INPUT_EVENT_ATTRIBUTES.has(node.name.text)) {
      const expression = getJsxAttributeExpression(node);
      if (expression) {
        for (const stateName of findStateSettersInNode(expression, context)) {
          inputBackedStates.add(stateName);
        }
      }
    }

    ts.forEachChild(node, collectInputBackedStates);
  };

  collectInputBackedStates(sourceFile);

  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && BLOCKED_JSX_EVENT_ATTRIBUTES.has(node.name.text)) {
      const expression = getJsxAttributeExpression(node);
      if (expression) {
        for (const call of findAiCallsInNode(expression, code, context)) {
          addViolation(violations, {
            start: call.start,
            end: call.end,
            message:
              `禁止在 ${node.name.text} 输入/高频事件中调用 ${call.apiName}。` +
              'AI 调用必须由按钮点击、提交或 Enter 等明确发送意图触发。',
            codeSnippet: call.codeSnippet,
          });
        }
      }
    }

    if (ts.isCallExpression(node) && isAddEventListenerCall(node)) {
      const eventName = getStaticEventName(node.arguments[0]);
      const handler = getHookCallbackNode(node.arguments[1]);

      if (eventName && handler && BLOCKED_DOM_EVENTS.has(eventName)) {
        for (const call of findAiCallsInNode(handler, code, context)) {
          addViolation(violations, {
            start: call.start,
            end: call.end,
            message:
              `禁止在 addEventListener('${eventName}') 输入/高频事件中调用 ${call.apiName}。` +
              'AI 调用必须由按钮点击、提交或 Enter 等明确发送意图触发。',
            codeSnippet: call.codeSnippet,
          });
        }
      }
    }

    if (ts.isCallExpression(node) && isUseEffectCall(node.expression)) {
      const callback = getHookCallbackNode(node.arguments[0]);
      const deps = collectDependencyIdentifiers(node.arguments[1]);
      const depNames = Array.from(deps);
      const matchedInputStates = depNames.filter((dep) => inputBackedStates.has(dep));

      if (callback && matchedInputStates.length > 0 && matchedInputStates.length === depNames.length) {
        for (const call of findAiCallsTriggeredByEffect(callback, code, context)) {
          addViolation(violations, {
            start: call.start,
            end: call.end,
            message:
              `禁止在 useEffect 监听输入状态 (${matchedInputStates.join(', ')}) 时调用 ${call.apiName}。` +
              '即使用 setTimeout/debounce 包裹，也仍然是输入变化触发；请改为按钮 onClick 或 Enter onKeyDown。',
            codeSnippet: call.codeSnippet,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return Array.from(violations.values()).sort((a, b) => a.start - b.start);
}

export function blockAiInputTriggersPlugin(): Plugin {
  let srcRoot = '';

  return {
    name: 'block-ai-input-triggers',
    enforce: 'pre',
    apply: 'build',

    configResolved(config) {
      srcRoot = path.resolve(config.root, 'src');
    },

    async buildStart() {
      if (!srcRoot) return;

      const sourceFiles = await fg(['**/*.{js,jsx,ts,tsx}'], {
        cwd: srcRoot,
        absolute: true,
        onlyFiles: true,
        ignore: IGNORED_SOURCE_GLOBS,
      });

      const errors: FileViolation[] = [];

      for (const filePath of sourceFiles) {
        const code = await fs.readFile(filePath, 'utf8');
        const fileErrors = findAiInputTriggerViolations(code).map((error) => ({
          ...error,
          filePath,
        }));
        errors.push(...fileErrors);
      }

      if (!errors.length) return;

      const first = errors[0];
      const firstCode = await fs.readFile(first.filePath, 'utf8');
      const loc = computeLineCol(firstCode, first.start);
      const details = await Promise.all(errors.map(async (error, index) => {
        const fileCode = await fs.readFile(error.filePath, 'utf8');
        const itemLoc = computeLineCol(fileCode, error.start);
        return `  ${index + 1}. ${error.message}\n     文件: ${error.filePath}\n     位置: ${itemLoc.line}:${itemLoc.column}${error.codeSnippet ? `\n     代码: ${error.codeSnippet}` : ''}`;
      }));

      this.error({
        message:
          `[block-ai-input-triggers] 构建失败: 发现 ${errors.length} 处禁止的 AI 输入触发调用\n` +
          `错误:\n${details.join('\n')}\n\n` +
          '提示: AI 调用成本高且可能造成输入过程中的频繁请求，请只在用户明确发送意图后调用。',
        loc: {
          file: first.filePath,
          line: loc.line,
          column: loc.column,
        },
      });
    },
  };
}
