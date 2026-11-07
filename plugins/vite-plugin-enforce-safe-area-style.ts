import path from 'node:path';
import postcss, { type AtRule, type Declaration, type Node, type Rule } from 'postcss';
import type { Plugin } from 'vite';

function normalizeModuleId(id: string): string {
  const queryIndex = id.indexOf('?');
  return queryIndex >= 0 ? id.slice(0, queryIndex) : id;
}

function normalizeCssValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMediaParams(params: string): string {
  return params.trim().replace(/\s+/g, ' ').toLowerCase();
}

function targetsSafeArea(selector: string): boolean {
  return /#safe-area\b/i.test(selector);
}

function getRuleContext(rule: Rule): 'base' | 'tall' | 'unsupported' {
  const parent = rule.parent;
  if (!parent || parent.type === 'root') {
    return 'base';
  }

  if (parent.type !== 'atrule') {
    return 'unsupported';
  }

  const atRule = parent as AtRule;
  if (atRule.name !== 'media') {
    return 'unsupported';
  }

  if (normalizeMediaParams(atRule.params) === '(min-height: 660px)') {
    return 'tall';
  }

  return 'unsupported';
}

function getDeclarations(rule: Rule): Declaration[] {
  return rule.nodes?.filter((node): node is Declaration => node.type === 'decl') ?? [];
}

function getLineCol(node: Node) {
  return {
    line: node.source?.start?.line ?? 1,
    column: node.source?.start?.column ?? 1,
  };
}

type SafeAreaViolation = {
  line: number;
  column: number;
  message: string;
};

const REQUIRED_SAFE_AREA_STYLES = [
  '#safe-area {',
  '  padding-top: 0;',
  '}',
  '',
  '@media (min-height: 660px) {',
  '  #safe-area {',
  '    padding-top: 88px;',
  '  }',
  '}',
].join('\n');

function getOriginalStyleMessage(): string {
  return `#safe-area 的样式只能写成脚手架原始版本：\n${REQUIRED_SAFE_AREA_STYLES}`;
}

function validateSafeAreaRule(rule: Rule): SafeAreaViolation[] {
  const violations: SafeAreaViolation[] = [];
  const context = getRuleContext(rule);
  const declarations = getDeclarations(rule);
  const selectorLoc = getLineCol(rule);

  if (context === 'unsupported') {
    violations.push({
      ...selectorLoc,
      message: getOriginalStyleMessage(),
    });
    return violations;
  }

  if (declarations.length !== 1) {
    violations.push({
      ...selectorLoc,
      message: getOriginalStyleMessage(),
    });
    return violations;
  }

  const [declaration] = declarations;
  const expectedValue = context === 'base' ? '0' : '88px';
  const declarationLoc = getLineCol(declaration);

  if (declaration.prop.trim().toLowerCase() !== 'padding-top') {
    violations.push({
      ...declarationLoc,
      message: getOriginalStyleMessage(),
    });
  }

  if (normalizeCssValue(declaration.value) !== expectedValue) {
    violations.push({
      ...declarationLoc,
      message: getOriginalStyleMessage(),
    });
  }

  return violations;
}

function findSafeAreaStyleViolations(code: string): SafeAreaViolation[] {
  const root = postcss.parse(code);
  const violations: SafeAreaViolation[] = [];
  let hasBaseRule = false;
  let hasTallRule = false;

  root.walkRules((rule) => {
    const selectors = rule.selectors?.map((selector) => selector.trim()) ?? [];
    if (!selectors.length || !selectors.some(targetsSafeArea)) {
      return;
    }

    if (selectors.length !== 1 || selectors[0] !== '#safe-area') {
      violations.push({
        ...getLineCol(rule),
        message: getOriginalStyleMessage(),
      });
      return;
    }

    const context = getRuleContext(rule);
    if (context === 'base') {
      hasBaseRule = true;
    } else if (context === 'tall') {
      hasTallRule = true;
    }

    violations.push(...validateSafeAreaRule(rule));
  });

  if (!hasBaseRule) {
    violations.push({
      line: 1,
      column: 1,
      message: getOriginalStyleMessage(),
    });
  }

  if (!hasTallRule) {
    violations.push({
      line: 1,
      column: 1,
      message: getOriginalStyleMessage(),
    });
  }

  return violations;
}

export function enforceSafeAreaStylePlugin(): Plugin {
  let indexCssPath = '';

  return {
    name: 'enforce-safe-area-style',
    enforce: 'pre',
    apply: 'build',

    configResolved(config) {
      indexCssPath = path.resolve(config.root, 'src/index.css');
    },

    transform(code, id) {
      const normalizedId = normalizeModuleId(id);
      if (!indexCssPath) return null;
      if (path.resolve(normalizedId) !== indexCssPath) return null;

      const errors = findSafeAreaStyleViolations(code);
      if (!errors.length) return null;

      const first = errors[0];
      const details = errors.map((error, index) => {
        return `  ${index + 1}. ${error.message}\n     位置: ${error.line}:${error.column}`;
      }).join('\n');

      this.error({
        id: normalizedId,
        message:
          `[enforce-safe-area-style] 构建失败: 发现 ${errors.length} 处 safe-area 样式违规\n` +
          `文件: ${normalizedId}\n\n` +
          `错误:\n${details}\n\n` +
          `提示: #safe-area 的样式只能写成脚手架原始版本。\n\n${REQUIRED_SAFE_AREA_STYLES}`,
        loc: {
          file: normalizedId,
          line: first.line,
          column: first.column,
        },
      });

      return null;
    },
  };
}
