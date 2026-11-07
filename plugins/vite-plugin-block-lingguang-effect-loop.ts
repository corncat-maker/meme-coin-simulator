import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import ts from 'typescript';
import type { Plugin } from 'vite';

type StateBinding = {
  stateName: string;
  setterName: string;
};

type CallbackInfo = {
  name: string;
  start: number;
  dependencyStates: Set<string>;
  mutatedStates: Set<string>;
  lingguangApiNames: Set<string>;
};

type EffectInfo = {
  start: number;
  dependencyCallbacks: Set<string>;
  calledCallbacks: Set<string>;
};

type LingguangLoopViolation = {
  start: number;
  message: string;
};

type FileViolation = LingguangLoopViolation & {
  filePath: string;
};

const BLOCKED_LINGGUANG_NAMESPACES = new Set(['db', 'ai']);

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

function getHookName(expression: ts.Expression): string | null {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) {
    return target.name.text;
  }
  return null;
}

function isHookCall(node: ts.CallExpression, hookName: string): boolean {
  return getHookName(node.expression) === hookName;
}

function getMemberChainName(expression: ts.Expression): string | null {
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
  return parts.join('.');
}

function getBlockedLingguangApiName(node: ts.CallExpression): string | null {
  const memberName = getMemberChainName(node.expression);
  if (!memberName) return null;

  const parts = memberName.split('.');
  const rootName = parts[0];
  if (rootName === 'window' || rootName === 'globalThis' || rootName === 'self') {
    parts.shift();
  }

  if (parts.length < 3 || parts[0] !== 'lingguang') {
    return null;
  }

  const namespaceName = parts[1];
  if (!BLOCKED_LINGGUANG_NAMESPACES.has(namespaceName)) {
    return null;
  }

  return parts.join('.');
}

function getDependencyIdentifiers(node: ts.Expression | undefined): Set<string> {
  const names = new Set<string>();
  if (!node) return names;

  const target = unwrapExpression(node);
  if (!ts.isArrayLiteralExpression(target)) return names;

  for (const element of target.elements) {
    const dependency = unwrapExpression(element);
    if (ts.isIdentifier(dependency)) {
      names.add(dependency.text);
    }
  }

  return names;
}

function collectStateBindings(sourceFile: ts.SourceFile): StateBinding[] {
  const bindings: StateBinding[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isHookCall(node.initializer, 'useState')
    ) {
      const stateElement = node.name.elements[0];
      const setterElement = node.name.elements[1];
      if (
        stateElement &&
        setterElement &&
        ts.isBindingElement(stateElement) &&
        ts.isBindingElement(setterElement) &&
        ts.isIdentifier(stateElement.name) &&
        ts.isIdentifier(setterElement.name)
      ) {
        bindings.push({
          stateName: stateElement.name.text,
          setterName: setterElement.name.text,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return bindings;
}

function inspectFunctionBody(
  node: ts.Node,
  setterToState: Map<string, string>,
  callbackNames?: Set<string>,
) {
  const mutatedStates = new Set<string>();
  const calledCallbacks = new Set<string>();
  const lingguangApiNames = new Set<string>();

  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child)) {
      const expression = unwrapExpression(child.expression);
      if (ts.isIdentifier(expression)) {
        const stateName = setterToState.get(expression.text);
        if (stateName) {
          mutatedStates.add(stateName);
        }
        if (callbackNames?.has(expression.text)) {
          calledCallbacks.add(expression.text);
        }
      }

      const lingguangApiName = getBlockedLingguangApiName(child);
      if (lingguangApiName) {
        lingguangApiNames.add(lingguangApiName);
      }
    }

    ts.forEachChild(child, visit);
  };

  visit(node);
  return { mutatedStates, calledCallbacks, lingguangApiNames };
}

function collectCallbacks(
  sourceFile: ts.SourceFile,
  stateNames: Set<string>,
  setterToState: Map<string, string>,
): Map<string, CallbackInfo> {
  const callbacks = new Map<string, CallbackInfo>();

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isHookCall(node.initializer, 'useCallback')
    ) {
      const dependencies = getDependencyIdentifiers(node.initializer.arguments[1]);
      const dependencyStates = new Set<string>();
      for (const dependency of dependencies) {
        if (stateNames.has(dependency)) {
          dependencyStates.add(dependency);
        }
      }

      const callbackBody = node.initializer.arguments[0];
      const { mutatedStates, lingguangApiNames } = callbackBody
        ? inspectFunctionBody(callbackBody, setterToState)
        : { mutatedStates: new Set<string>(), lingguangApiNames: new Set<string>() };

      callbacks.set(node.name.text, {
        name: node.name.text,
        start: node.getStart(sourceFile),
        dependencyStates,
        mutatedStates,
        lingguangApiNames,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return callbacks;
}

function collectEffects(
  sourceFile: ts.SourceFile,
  callbackNames: Set<string>,
  setterToState: Map<string, string>,
): EffectInfo[] {
  const effects: EffectInfo[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isHookCall(node, 'useEffect')) {
      const dependencies = getDependencyIdentifiers(node.arguments[1]);
      const dependencyCallbacks = new Set<string>();
      for (const dependency of dependencies) {
        if (callbackNames.has(dependency)) {
          dependencyCallbacks.add(dependency);
        }
      }

      const effectBody = node.arguments[0];
      const { calledCallbacks } = effectBody
        ? inspectFunctionBody(effectBody, setterToState, callbackNames)
        : { calledCallbacks: new Set<string>() };

      effects.push({
        start: node.getStart(sourceFile),
        dependencyCallbacks,
        calledCallbacks,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return effects;
}

function intersect(left: Set<string>, right: Set<string>): string[] {
  const values: string[] = [];
  for (const item of left) {
    if (right.has(item)) {
      values.push(item);
    }
  }
  return values;
}

function findLingguangEffectLoopViolations(code: string): LingguangLoopViolation[] {
  const sourceFile = ts.createSourceFile('module.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stateBindings = collectStateBindings(sourceFile);
  const stateNames = new Set(stateBindings.map((binding) => binding.stateName));
  const setterToState = new Map(stateBindings.map((binding) => [binding.setterName, binding.stateName]));
  const callbacks = collectCallbacks(sourceFile, stateNames, setterToState);
  const callbackNames = new Set(callbacks.keys());
  const effects = collectEffects(sourceFile, callbackNames, setterToState);
  const violations: LingguangLoopViolation[] = [];

  for (const callback of callbacks.values()) {
    if (!callback.lingguangApiNames.size) continue;

    const stateLoopNames = intersect(callback.dependencyStates, callback.mutatedStates);
    if (!stateLoopNames.length) continue;

    for (const effect of effects) {
      if (!effect.dependencyCallbacks.has(callback.name) || !effect.calledCallbacks.has(callback.name)) {
        continue;
      }

      violations.push({
        start: callback.start,
        message:
          `Potential repeated Lingguang API call: useCallback "${callback.name}" depends on and mutates ` +
          `state "${stateLoopNames.join(', ')}", calls ${Array.from(callback.lingguangApiNames).join(', ')}, and is called by a ` +
          'useEffect that also depends on that callback.',
      });
    }
  }

  return violations;
}

export function blockLingguangEffectLoopPlugin(): Plugin {
  let srcRoot = '';

  return {
    name: 'block-lingguang-effect-loop',
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
        ignore: ['**/*.d.ts'],
      });

      const errors: FileViolation[] = [];

      for (const filePath of sourceFiles) {
        const code = await fs.readFile(filePath, 'utf8');
        const fileErrors = findLingguangEffectLoopViolations(code).map((error) => ({
          ...error,
          filePath,
        }));
        errors.push(...fileErrors);
      }

      if (!errors.length) return;

      const first = errors[0];
      const firstCode = await fs.readFile(first.filePath, 'utf8');
      const loc = computeLineCol(firstCode, first.start);
      const details = await Promise.all(
        errors.map(async (error, index) => {
          const fileCode = await fs.readFile(error.filePath, 'utf8');
          const itemLoc = computeLineCol(fileCode, error.start);
          return `  ${index + 1}. ${error.message}\n     File: ${error.filePath}\n     Location: ${itemLoc.line}:${itemLoc.column}`;
        }),
      );

      this.error({
        message:
          `[block-lingguang-effect-loop] Build failed: found ${errors.length} potential repeated Lingguang API call loop(s).\n` +
          `Errors:\n${details.join('\n')}\n\n` +
          'Hint: keep Lingguang API-loading callbacks stable, or avoid depending on state that the same callback mutates.',
        loc: {
          file: first.filePath,
          line: loc.line,
          column: loc.column,
        },
      });
    },
  };
}
