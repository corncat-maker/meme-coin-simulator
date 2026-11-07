const path = require('path');
const ts = require('typescript');

function formatSourcePosition(sourceFile, position) {
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  return `${location.line + 1}:${location.character + 1}`;
}

function isGlobalConsoleObject(node) {
  if (ts.isIdentifier(node) && node.text === 'console') {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'console' &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'globalThis' || node.expression.text === 'window')
  );
}

function isConsolePropertyAccess(node) {
  return ts.isPropertyAccessExpression(node) && isGlobalConsoleObject(node.expression);
}

function isConsoleElementAccess(node) {
  return ts.isElementAccessExpression(node) && isGlobalConsoleObject(node.expression);
}

function getConsoleAccessName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text || '*';
  }
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) {
      return argument.text || '*';
    }
  }
  return '*';
}

function collectConsoleUsageFindings(sourceFile, options = {}) {
  const relativePath = options.relativePath || path.basename(sourceFile.fileName);
  const findings = [];

  function visit(node) {
    if (isConsolePropertyAccess(node) || isConsoleElementAccess(node)) {
      const methodName = getConsoleAccessName(node);
      findings.push(
        `${relativePath}:${formatSourcePosition(sourceFile, node.getStart(sourceFile))} - ` +
          `console.${methodName} is not allowed in QuickJS service controller. ` +
          'stdout is reserved for the QuickJS runtime protocol; remove console.* logging.',
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function runControllerSourcePolicyCheck(options) {
  const controllerPath = options.controllerPath;
  const serviceRoot = options.serviceRoot || path.dirname(controllerPath);
  const sourceText = options.readFile(controllerPath);
  const sourceFile = ts.createSourceFile(controllerPath, sourceText, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const relativePath = path.relative(serviceRoot, controllerPath) || controllerPath;

  return collectConsoleUsageFindings(sourceFile, { relativePath });
}

module.exports = {
  runControllerSourcePolicyCheck,
};
