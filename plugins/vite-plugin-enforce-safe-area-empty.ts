import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

function normalizeModuleId(id: string): string {
  const queryIndex = id.indexOf('?');
  return queryIndex >= 0 ? id.slice(0, queryIndex) : id;
}

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

type SafeAreaViolation = {
  start: number;
  message: string;
};

function getJsxTagName(node: ts.JsxOpeningLikeElement): string | null {
  if (ts.isIdentifier(node.tagName)) {
    return node.tagName.text;
  }

  return null;
}

function getJsxAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | undefined {
  return attributes.properties.find((property): property is ts.JsxAttribute => {
    return ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name;
  });
}

function getStaticStringValue(initializer: ts.JsxAttributeValue | undefined): string | null {
  if (!initializer) {
    return null;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (!ts.isJsxExpression(initializer) || !initializer.expression) {
    return null;
  }

  if (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression)) {
    return initializer.expression.text;
  }

  return null;
}

function isSafeAreaElement(node: ts.JsxOpeningLikeElement): boolean {
  if (getJsxTagName(node) !== 'div') {
    return false;
  }

  const idAttribute = getJsxAttribute(node.attributes, 'id');
  if (!idAttribute) {
    return false;
  }

  return getStaticStringValue(idAttribute.initializer) === 'safe-area';
}

function isIgnorableSafeAreaChild(node: ts.JsxChild): boolean {
  if (ts.isJsxText(node)) {
    return node.getText().trim().length === 0;
  }

  if (ts.isJsxExpression(node)) {
    return !node.expression;
  }

  return false;
}

function getNodeStart(node: ts.Node, sourceFile: ts.SourceFile): number {
  return node.getStart(sourceFile);
}

function findSafeAreaViolations(code: string): SafeAreaViolation[] {
  const sourceFile = ts.createSourceFile('App.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: SafeAreaViolation[] = [];
  let safeAreaCount = 0;

  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node)) {
      if (isSafeAreaElement(node)) {
        safeAreaCount++;

        if (getJsxAttribute(node.attributes, 'dangerouslySetInnerHTML')) {
          violations.push({
            start: getNodeStart(node, sourceFile),
            message: '<div id="safe-area"> 是系统保留节点，不能设置 dangerouslySetInnerHTML。',
          });
        }
      }

      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isJsxElement(node) && isSafeAreaElement(node.openingElement)) {
      safeAreaCount++;

      if (getJsxAttribute(node.openingElement.attributes, 'dangerouslySetInnerHTML')) {
        violations.push({
          start: getNodeStart(node.openingElement, sourceFile),
          message: '<div id="safe-area"> 是系统保留节点，不能设置 dangerouslySetInnerHTML。',
        });
      }

      const invalidChild = node.children.find((child) => !isIgnorableSafeAreaChild(child));
      if (invalidChild) {
        violations.push({
          start: getNodeStart(invalidChild, sourceFile),
          message: '<div id="safe-area"> 是系统保留节点，内部必须保持为空，不能放任何 HTML/组件内容。',
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (safeAreaCount === 0) {
    violations.push({
      start: 0,
      message: 'src/App.tsx 中必须保留一个 <div id="safe-area"></div> 空节点，位置不限。',
    });
  }

  return violations;
}

export function enforceSafeAreaEmptyPlugin(): Plugin {
  let appTsxPath = '';

  return {
    name: 'enforce-safe-area-empty',
    enforce: 'pre',
    apply: 'build',

    configResolved(config) {
      appTsxPath = path.resolve(config.root, 'src/App.tsx');
    },

    transform(code, id) {
      const normalizedId = normalizeModuleId(id);
      if (!appTsxPath) return null;
      if (path.resolve(normalizedId) !== appTsxPath) return null;

      const errors = findSafeAreaViolations(code);

      if (!errors.length) return null;

      const first = errors[0];
      const loc = computeLineCol(code, first.start);
      const details = errors.map((error, idx) => {
        const itemLoc = computeLineCol(code, error.start);
        return `  ${idx + 1}. ${error.message}\n     位置: ${itemLoc.line}:${itemLoc.column}`;
      }).join('\n');

      this.error({
        id: normalizedId,
        message:
          `[enforce-safe-area-empty] 构建失败: 发现 ${errors.length} 处 safe-area 违规使用\n` +
          `文件: ${normalizedId}\n\n` +
          `错误:\n${details}\n\n` +
          '提示: 保留 <div id="safe-area"></div> 空节点，其他内容请放在外层容器。',
        loc,
      });

      return null;
    },
  };
}
