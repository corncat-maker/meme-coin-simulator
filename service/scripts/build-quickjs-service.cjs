const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const serviceRoot = path.resolve(__dirname, '..');
const distRoot = path.join(serviceRoot, 'dist');
const controllerPath = path.join(serviceRoot, 'app', 'controller', 'service.ts');
const openapiSpecPath = path.resolve(serviceRoot, '..', 'openapi', 'spec.json');

const moduleFileMap = new Map([
  ['./app/controller/service', controllerPath],
  ['@server', path.join(serviceRoot, 'runtime', 'sdk', 'server.ts')],
  ['@server/response', path.join(serviceRoot, 'runtime', 'sdk', 'response.ts')],
  ['@server/types', path.join(serviceRoot, 'runtime', 'sdk', 'types.ts')],
]);

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function loadJson(filePath) {
  return JSON.parse(readUtf8(filePath));
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function ensureSupportedControllerImports() {
  const sourceText = readUtf8(controllerPath);
  const sourceFile = ts.createSourceFile(controllerPath, sourceText, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const unsupportedImports = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }
    const imported = node.moduleSpecifier.text;
    if (!moduleFileMap.has(imported)) {
      unsupportedImports.push(imported);
    }
  });

  if (unsupportedImports.length > 0) {
    throw new Error(
      `Unsupported service controller imports: ${unsupportedImports.join(', ')}. ` +
        'Current QuickJS builder only supports @server, @server/response and @server/types.',
    );
  }
}

function collectExportedActions() {
  const sourceText = readUtf8(controllerPath);
  const sourceFile = ts.createSourceFile(controllerPath, sourceText, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const actions = new Set();

  function hasExportModifier(node) {
    return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  }

  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      actions.add(node.name.text);
      return;
    }

    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      node.declarationList.declarations.forEach((declaration) => {
        if (ts.isIdentifier(declaration.name)) {
          actions.add(declaration.name.text);
        }
      });
    }
  });

  return Array.from(actions).sort();
}

function buildDispatchManifest(spec, actions) {
  const dispatch = {};
  const actionSet = new Set(actions);
  const paths = spec.paths && typeof spec.paths === 'object' ? spec.paths : {};

  Object.entries(paths).forEach(([routePath, operations]) => {
    if (!operations || typeof operations !== 'object') {
      return;
    }

    Object.entries(operations).forEach(([method, operation]) => {
      if (!operation || typeof operation !== 'object') {
        return;
      }

      const operationId = typeof operation.operationId === 'string' ? operation.operationId.trim() : '';
      if (!operationId) {
        return;
      }
      if (!actionSet.has(operationId)) {
        throw new Error(`OpenAPI operationId "${operationId}" does not have a matching exported controller action in service/app/controller/service.ts`);
      }

      dispatch[operationId] = {
        action: operationId,
        operationId,
        method: method.toUpperCase(),
        path: routePath,
      };
    });
  });

  return dispatch;
}

function transpileToCommonJs(filePath) {
  const sourceText = readUtf8(filePath);
  return ts
    .transpileModule(sourceText, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        strict: false,
      },
      fileName: filePath,
    })
    .outputText.trim();
}

function buildBundleSource() {
  const parts = [
    "import * as std from 'std';",
    '',
    'const __modules = Object.create(null);',
    'const __cache = Object.create(null);',
    '',
    'function __writeMessage(message) {',
    "  std.out.puts(JSON.stringify(message) + '\\n');",
    '  std.out.flush();',
    '}',
    '',
    'function __readMessage() {',
    '  const line = std.in.getline();',
    '  if (line === null) {',
    "    throw new Error('stdin closed while waiting for message');",
    '  }',
    '  return JSON.parse(line);',
    '}',
    '',
    'function __define(id, factory) {',
    '  __modules[id] = factory;',
    '}',
    '',
    'function __require(id) {',
    '  if (__cache[id]) {',
    '    return __cache[id].exports;',
    '  }',
    '  const factory = __modules[id];',
    '  if (!factory) {',
    "    throw new Error('unknown bundled module: ' + id);",
    '  }',
    '  const module = { exports: {} };',
    '  __cache[id] = module;',
    '  factory(module, module.exports, __require);',
    '  return module.exports;',
    '}',
    '',
    'globalThis.__quickjsHostCall = function(method, params) {',
    "  const callId = 'host-' + Date.now() + '-' + Math.random().toString(16).slice(2);",
    "  __writeMessage({ type: 'host_call', id: callId, method, params: params || {} });",
    '  const response = __readMessage();',
    "  if (response.type !== 'host_result') {",
    "    throw new Error('unexpected host response type: ' + String(response.type));",
    '  }',
    '  if (response.id !== callId) {',
    "    throw new Error('unexpected host response id: ' + String(response.id));",
    '  }',
    '  if (!response.ok) {',
    "    throw new Error(String(response.error || 'host call failed'));",
    '  }',
    '  return response.result;',
    '};',
  ];

  for (const [moduleId, filePath] of moduleFileMap.entries()) {
    parts.push('');
    parts.push(`__define(${JSON.stringify(moduleId)}, function(module, exports, require) {`);
    parts.push(transpileToCommonJs(filePath));
    parts.push('});');
  }

  parts.push('');
  parts.push("const controller = __require('./app/controller/service');");
  parts.push('');
  parts.push('function __resolveHandler(action) {');
  parts.push('  const handler = controller[action];');
  parts.push("  if (typeof handler !== 'function') {");
  parts.push("    throw new Error('unsupported action: ' + action);");
  parts.push('  }');
  parts.push('  return handler;');
  parts.push('}');
  parts.push('');
  parts.push('async function __main() {');
  parts.push("  __writeMessage({ type: 'ready', protocol: 'stdin_stdout_ndjson' });");
  parts.push('  try {');
  parts.push('    const message = __readMessage();');
  parts.push("    if (message.type !== 'run') {");
  parts.push("      throw new Error('unsupported message type: ' + String(message.type));");
  parts.push('    }');
  parts.push(
    "    const action = (typeof message.action === 'string' && message.action) || (typeof message.operationId === 'string' && message.operationId) || '';",
  );
  parts.push('    if (!action) {');
  parts.push("      throw new Error('missing action');");
  parts.push('    }');
  parts.push('    const handler = __resolveHandler(action);');
  parts.push('    const result = await handler(message.input || {});');
  parts.push("    __writeMessage({ type: 'run_result', ok: true, id: message.id || null, result });");
  parts.push('  } catch (error) {');
  parts.push("    __writeMessage({ type: 'run_result', ok: false, error: String(error) });");
  parts.push('    std.exit(1);');
  parts.push('  }');
  parts.push('}');
  parts.push('');
  parts.push('void __main();');

  return parts.join('\n');
}

function main() {
  ensureSupportedControllerImports();

  if (!fs.existsSync(openapiSpecPath)) {
    throw new Error(`OpenAPI spec not found: ${openapiSpecPath}`);
  }

  const spec = loadJson(openapiSpecPath);
  const actions = collectExportedActions();
  if (actions.length === 0) {
    throw new Error('No exported controller actions found in service/app/controller/service.ts');
  }

  const dispatch = buildDispatchManifest(spec, actions);
  const bundleSource = buildBundleSource();
  const specText = JSON.stringify(spec, null, 2);

  fs.rmSync(distRoot, { recursive: true, force: true });
  fs.mkdirSync(distRoot, { recursive: true });

  writeUtf8(path.join(distRoot, 'controller.bundle.mjs'), bundleSource);
  writeUtf8(
    path.join(distRoot, 'controller.manifest.json'),
    JSON.stringify(
      {
        artifactId: process.env.ARTIFACT_ID ?? null,
        artifactVersion: process.env.ARTIFACT_VERSION ?? null,
        controller: 'service',
        bundle: 'controller.bundle.mjs',
        spec: 'spec.json',
        exports: actions,
        dispatch,
      },
      null,
      2,
    ),
  );
  writeUtf8(
    path.join(distRoot, 'capability.manifest.json'),
    JSON.stringify(
      {
        methods: [
          'runtime.getRequestContext',
          'storage.getItem',
          'storage.setItem',
          'storage.removeItem',
          'storage.clear',
          'oss.readText',
          'oss.writeText',
          'oss.delete',
          'oss.list',
          'db.query',
          'db.execute',
          'system.echo',
        ],
      },
      null,
      2,
    ),
  );
  writeUtf8(path.join(distRoot, 'spec.json'), specText);
  writeUtf8(
    path.join(distRoot, 'meta.json'),
    JSON.stringify(
      {
        artifactId: process.env.ARTIFACT_ID ?? null,
        artifactVersion: process.env.ARTIFACT_VERSION ?? null,
        buildTime: new Date().toISOString(),
        buildSource: 'asap-react-scaffold/service',
        builderVersion: 'quickjs-service-build-v1',
        runtimeTarget: 'quickjs-one-shot',
        bundleSha256: sha256(bundleSource),
        specSha256: sha256(specText),
      },
      null,
      2,
    ),
  );

  console.log('QuickJS service runtime artifact generated in', distRoot);
}

main();
