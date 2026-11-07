const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { runControllerSourcePolicyCheck } = require('./controller-source-policy.cjs');

const serviceRoot = path.resolve(__dirname, '..');
const distRoot = path.join(serviceRoot, 'dist');
const manifestPath = path.join(distRoot, 'controller.manifest.json');
const specPath = path.join(distRoot, 'spec.json');
const controllerPath = path.join(serviceRoot, 'app', 'controller', 'service.ts');
const tsconfigPath = path.join(serviceRoot, 'tsconfig.json');

const moduleFileMap = new Map([
  ['./app/controller/service', controllerPath],
  ['@server', path.join(serviceRoot, 'runtime', 'sdk', 'server.ts')],
  ['@server/response', path.join(serviceRoot, 'runtime', 'sdk', 'response.ts')],
  ['@server/types', path.join(serviceRoot, 'runtime', 'sdk', 'types.ts')],
]);

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function loadJson(filePath) {
  return JSON.parse(readUtf8(filePath));
}

function flattenDiagnosticMessage(messageText) {
  if (typeof messageText === 'string') {
    return messageText;
  }
  let message = '';
  let current = messageText;
  while (current) {
    message += (message ? ' ' : '') + current.messageText;
    current = current.next;
  }
  return message;
}

function runTypeCheck() {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return [ts.formatDiagnostic(configFile.error, formatDiagnosticHost())];
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, serviceRoot, undefined, tsconfigPath);
  const diagnostics = [...parsedConfig.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsedConfig.fileNames, parsedConfig.options))].filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  return diagnostics.map((diagnostic) => {
    const message = flattenDiagnosticMessage(diagnostic.messageText);
    if (!diagnostic.file || typeof diagnostic.start !== 'number') {
      return message;
    }
    const relativePath = path.relative(serviceRoot, diagnostic.file.fileName) || diagnostic.file.fileName;
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${relativePath}:${position.line + 1}:${position.character + 1} - ${message}`;
  });
}

function formatDiagnosticHost() {
  return {
    getCanonicalFileName(fileName) {
      return fileName;
    },
    getCurrentDirectory() {
      return serviceRoot;
    },
    getNewLine() {
      return '\n';
    },
  };
}

function looksLikeJson(text) {
  if (typeof text !== 'string') {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  const normalized = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (value != null) {
      normalized[String(key).toLowerCase()] = String(value);
    }
  });
  return normalized;
}

function normalizeTransportResponse(result) {
  if (result && typeof result === 'object' && result.__serviceResponse === true) {
    const headers = normalizeHeaders(result.headers);
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    return {
      status: Number(result.status || 200),
      headers,
      body,
    };
  }

  if (typeof result === 'string') {
    return {
      status: 200,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: result,
    };
  }

  return {
    status: 200,
    headers: { 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(result),
  };
}

function baseContentType(contentType) {
  if (typeof contentType !== 'string') {
    return '';
  }
  return contentType.split(';')[0].trim().toLowerCase();
}

function resolveLocalRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`Unsupported schema ref: ${String(ref)}`);
  }
  const segments = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`Schema ref not found: ${ref}`);
    }
    current = current[segment];
  }
  return current;
}

function unwrapSchema(schema, root, seen = new Set()) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) {
      throw new Error(`Circular schema ref: ${schema.$ref}`);
    }
    seen.add(schema.$ref);
    return unwrapSchema(resolveLocalRef(root, schema.$ref), root, seen);
  }
  return schema;
}

function mergeObjectSchemas(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }
  const merged = { ...target };
  if (source.properties && typeof source.properties === 'object') {
    merged.properties = { ...(merged.properties || {}), ...source.properties };
  }
  if (Array.isArray(source.required)) {
    merged.required = Array.from(new Set([...(merged.required || []), ...source.required]));
  }
  return merged;
}

function materializeSchema(schema, root) {
  const resolved = unwrapSchema(schema, root);
  if (!resolved || typeof resolved !== 'object') {
    return resolved;
  }

  if (Array.isArray(resolved.allOf)) {
    return resolved.allOf.reduce(
      (accumulator, item) => {
        return mergeObjectSchemas(accumulator, materializeSchema(item, root));
      },
      { ...resolved, allOf: undefined },
    );
  }

  return resolved;
}

function inferSchemaType(schema) {
  if (!schema || typeof schema !== 'object') {
    return null;
  }
  if (typeof schema.type === 'string') {
    return schema.type;
  }
  if (schema.properties && typeof schema.properties === 'object') {
    return 'object';
  }
  if (schema.items) {
    return 'array';
  }
  return null;
}

function createSampleFromSchema(schema, root, fieldName = 'value') {
  const resolved = materializeSchema(schema, root);
  if (!resolved || typeof resolved !== 'object') {
    return `${fieldName}-sample`;
  }

  if (resolved.example !== undefined) {
    return resolved.example;
  }
  if (resolved.default !== undefined) {
    return resolved.default;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }
  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    return createSampleFromSchema(resolved.oneOf[0], root, fieldName);
  }
  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    return createSampleFromSchema(resolved.anyOf[0], root, fieldName);
  }

  const schemaType = inferSchemaType(resolved);
  if (schemaType === 'object') {
    const result = {};
    const propertyEntries = Object.entries(resolved.properties || {});
    const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
    for (const [propertyName, propertySchema] of propertyEntries) {
      if (required.size > 0 && !required.has(propertyName)) {
        continue;
      }
      result[propertyName] = createSampleFromSchema(propertySchema, root, propertyName);
    }
    if (propertyEntries.length === 0) {
      return {};
    }
    return result;
  }
  if (schemaType === 'array') {
    return [createSampleFromSchema(resolved.items || {}, root, fieldName)];
  }
  if (schemaType === 'integer') {
    return 1;
  }
  if (schemaType === 'number') {
    return 1.5;
  }
  if (schemaType === 'boolean') {
    return true;
  }
  if (schemaType === 'null') {
    return null;
  }
  return `${fieldName}-sample`;
}

function coerceQueryValue(schema, root, fieldName) {
  const sample = createSampleFromSchema(schema, root, fieldName);
  if (sample == null) {
    return '';
  }
  if (typeof sample === 'string') {
    return sample;
  }
  return String(sample);
}

function findJsonRequestBodySchema(operation, root) {
  const requestBody = operation && typeof operation === 'object' ? operation.requestBody : null;
  if (!requestBody || typeof requestBody !== 'object') {
    return null;
  }
  const resolvedRequestBody = unwrapSchema(requestBody, root);
  const content = resolvedRequestBody && typeof resolvedRequestBody === 'object' ? resolvedRequestBody.content : null;
  if (!content || typeof content !== 'object') {
    return null;
  }

  const jsonEntry =
    content['application/json'] ||
    Object.entries(content).find(([contentType]) => baseContentType(contentType) === 'application/json')?.[1] ||
    Object.values(content)[0];
  if (!jsonEntry || typeof jsonEntry !== 'object') {
    return null;
  }
  return jsonEntry.schema || null;
}

function listBodyPropertyNames(schema, root) {
  const resolved = materializeSchema(schema, root);
  if (!resolved || typeof resolved !== 'object') {
    return [];
  }
  if (resolved.properties && typeof resolved.properties === 'object') {
    return Object.keys(resolved.properties);
  }
  return [];
}

function listQueryParameters(operation, root) {
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
  return parameters.filter((parameter) => {
    const candidate = resolveParameter(parameter, root);
    return candidate && candidate.in === 'query';
  });
}

function listPathParameters(operation, root) {
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
  return parameters.filter((parameter) => {
    const candidate = resolveParameter(parameter, root);
    return candidate && candidate.in === 'path';
  });
}

function resolveParameter(parameter, root) {
  if (!parameter || typeof parameter !== 'object') {
    return null;
  }
  return unwrapSchema(parameter, root);
}

function buildProbeInput(route, operation, root) {
  const query = {};
  const params = {};
  const body = {};
  const bodySchema = findJsonRequestBodySchema(operation, root);
  const bodyPropertyNames = listBodyPropertyNames(bodySchema, root);
  const queryParameters = listQueryParameters(operation, root);
  const pathParameters = listPathParameters(operation, root);
  const allNames = new Set([
    ...bodyPropertyNames,
    ...queryParameters.map((parameter) => String(parameter.name)),
    ...pathParameters.map((parameter) => String(parameter.name)),
  ]);

  for (const name of allNames) {
    query[name] = `__QUERY_${name}__`;
    body[name] = `__BODY_${name}__`;
  }
  for (const parameter of pathParameters) {
    params[String(parameter.name)] = `__PARAM_${parameter.name}__`;
  }

  const actualPath = buildActualPath(route.path, params);
  return createControllerInput(route, {
    path: actualPath,
    params,
    query,
    body: Object.keys(body).length > 0 ? body : null,
  });
}

function buildValidationInput(route, operation, root) {
  const query = {};
  const params = {};
  const bodySchema = findJsonRequestBodySchema(operation, root);
  const queryParameters = listQueryParameters(operation, root);
  const pathParameters = listPathParameters(operation, root);

  for (const parameter of queryParameters) {
    query[String(parameter.name)] = coerceQueryValue(parameter.schema || {}, root, String(parameter.name));
  }
  for (const parameter of pathParameters) {
    params[String(parameter.name)] = coerceQueryValue(parameter.schema || { type: 'string' }, root, String(parameter.name));
  }

  const body = bodySchema ? createSampleFromSchema(bodySchema, root, 'body') : null;
  const actualPath = buildActualPath(route.path, params);
  return createControllerInput(route, {
    path: actualPath,
    params,
    query,
    body,
  });
}

function buildActualPath(pathTemplate, params) {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, name) => {
    const value = params[name];
    return encodeURIComponent(value == null ? '' : String(value));
  });
}

function createControllerInput(route, request) {
  const headers = {};
  let rawBody = null;
  let body = request.body ?? null;
  if (body !== null && body !== undefined) {
    headers['content-type'] = 'application/json;charset=UTF-8';
    rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  } else {
    body = null;
  }

  return {
    action: route.action,
    operationId: route.operationId,
    params: request.params || {},
    query: request.query || {},
    body,
    rawBody,
    headers,
    request: {
      method: route.method,
      path: request.path,
      query: request.query || {},
      headers,
      body,
      rawBody,
    },
  };
}

function validateSchema(value, schema, root, pathLabel = '$') {
  const resolved = materializeSchema(schema, root);
  if (!resolved || typeof resolved !== 'object') {
    return [];
  }

  if (resolved.nullable === true && value === null) {
    return [];
  }

  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const branches = resolved.oneOf.map((candidate) => validateSchema(value, candidate, root, pathLabel));
    return branches.some((errors) => errors.length === 0) ? [] : branches[0];
  }
  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    const branches = resolved.anyOf.map((candidate) => validateSchema(value, candidate, root, pathLabel));
    return branches.some((errors) => errors.length === 0) ? [] : branches[0];
  }

  const errors = [];
  if (resolved.const !== undefined && value !== resolved.const) {
    errors.push(`${pathLabel} should equal ${JSON.stringify(resolved.const)}`);
    return errors;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0 && !resolved.enum.includes(value)) {
    errors.push(`${pathLabel} should be one of ${resolved.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return errors;
  }

  const schemaType = inferSchemaType(resolved);
  if (!schemaType) {
    return errors;
  }

  if (schemaType === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${pathLabel} should be object`);
      return errors;
    }

    const required = Array.isArray(resolved.required) ? resolved.required : [];
    for (const name of required) {
      if (!(name in value)) {
        errors.push(`${pathLabel}.${name} is required`);
      }
    }

    const properties = resolved.properties && typeof resolved.properties === 'object' ? resolved.properties : {};
    Object.entries(properties).forEach(([propertyName, propertySchema]) => {
      if (propertyName in value) {
        errors.push(...validateSchema(value[propertyName], propertySchema, root, `${pathLabel}.${propertyName}`));
      }
    });

    if (resolved.additionalProperties === false) {
      Object.keys(value).forEach((propertyName) => {
        if (!(propertyName in properties)) {
          errors.push(`${pathLabel}.${propertyName} is not allowed`);
        }
      });
    } else if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      Object.keys(value).forEach((propertyName) => {
        if (!(propertyName in properties)) {
          errors.push(...validateSchema(value[propertyName], resolved.additionalProperties, root, `${pathLabel}.${propertyName}`));
        }
      });
    }
    return errors;
  }

  if (schemaType === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${pathLabel} should be array`);
      return errors;
    }
    if (typeof resolved.minItems === 'number' && value.length < resolved.minItems) {
      errors.push(`${pathLabel} should contain at least ${resolved.minItems} item(s)`);
    }
    if (typeof resolved.maxItems === 'number' && value.length > resolved.maxItems) {
      errors.push(`${pathLabel} should contain at most ${resolved.maxItems} item(s)`);
    }
    value.forEach((item, index) => {
      errors.push(...validateSchema(item, resolved.items || {}, root, `${pathLabel}[${index}]`));
    });
    return errors;
  }

  if (schemaType === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${pathLabel} should be string`);
      return errors;
    }
    if (typeof resolved.minLength === 'number' && value.length < resolved.minLength) {
      errors.push(`${pathLabel} should have minLength ${resolved.minLength}`);
    }
    if (typeof resolved.maxLength === 'number' && value.length > resolved.maxLength) {
      errors.push(`${pathLabel} should have maxLength ${resolved.maxLength}`);
    }
    if (typeof resolved.pattern === 'string' && !new RegExp(resolved.pattern).test(value)) {
      errors.push(`${pathLabel} should match pattern ${resolved.pattern}`);
    }
    return errors;
  }

  if (schemaType === 'integer') {
    if (!Number.isInteger(value)) {
      errors.push(`${pathLabel} should be integer`);
    }
    return errors;
  }

  if (schemaType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${pathLabel} should be number`);
    }
    return errors;
  }

  if (schemaType === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${pathLabel} should be boolean`);
    }
    return errors;
  }

  if (schemaType === 'null') {
    if (value !== null) {
      errors.push(`${pathLabel} should be null`);
    }
  }

  return errors;
}

function createHostHarness() {
  const storage = new Map();
  const calls = [];

  function hostCall(method, params) {
    const safeParams = params && typeof params === 'object' ? params : {};
    calls.push({ method, params: safeParams });

    switch (method) {
      case 'runtime.getRequestContext':
        return {
          artifactId: 'service-smoke',
          artifactVersion: 'local',
          userId: 'service-smoke-user',
          traceId: 'service-smoke-trace',
        };
      case 'storage.getItem':
        return storage.has(String(safeParams.key)) ? storage.get(String(safeParams.key)) : null;
      case 'storage.setItem':
        storage.set(String(safeParams.key), safeParams.value);
        return true;
      case 'storage.removeItem':
        storage.delete(String(safeParams.key));
        return true;
      case 'storage.clear':
        storage.clear();
        return true;
      case 'oss.readText':
        return null;
      case 'oss.writeText':
        return {
          key: String(safeParams.key || ''),
          size: typeof safeParams.text === 'string' ? Buffer.byteLength(safeParams.text, 'utf-8') : 0,
        };
      case 'oss.delete':
        return true;
      case 'oss.list':
        return [];
      case 'db.query':
        return { success: true, data: [] };
      case 'db.execute':
        return { success: true, data: { rowsAffected: 1 } };
      case 'system.echo':
        return safeParams;
      default:
        throw new Error(`Unsupported fake host method: ${method}`);
    }
  }

  return {
    install() {
      globalThis.__quickjsHostCall = hostCall;
    },
    resetCalls() {
      calls.length = 0;
    },
    snapshotCalls() {
      return calls.map((call) => ({ method: call.method, params: call.params }));
    },
  };
}

function createModuleLoader() {
  const cache = new Map();

  function loadModule(moduleId) {
    if (cache.has(moduleId)) {
      return cache.get(moduleId).exports;
    }
    const filePath = moduleFileMap.get(moduleId);
    if (!filePath) {
      throw new Error(`Unsupported service module import: ${moduleId}`);
    }

    const module = { exports: {} };
    cache.set(moduleId, module);
    const source = readUtf8(filePath);
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        strict: false,
      },
      fileName: filePath,
    }).outputText;
    const factory = new Function('module', 'exports', 'require', transpiled);
    factory(module, module.exports, loadModule);
    return module.exports;
  }

  return {
    loadController() {
      return loadModule('./app/controller/service');
    },
  };
}

function collectRoutes(manifest, spec) {
  const routes = [];
  const dispatch = manifest && typeof manifest === 'object' ? manifest.dispatch : null;

  if (dispatch && typeof dispatch === 'object') {
    Object.entries(dispatch).forEach(([operationId, item]) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      routes.push({
        operationId,
        action: String(item.action || operationId),
        method: String(item.method || 'GET').toUpperCase(),
        path: String(item.path || ''),
      });
    });
    return routes;
  }

  const paths = spec && typeof spec === 'object' ? spec.paths : null;
  if (!paths || typeof paths !== 'object') {
    return routes;
  }
  Object.entries(paths).forEach(([routePath, operations]) => {
    if (!operations || typeof operations !== 'object') {
      return;
    }
    Object.entries(operations).forEach(([method, operation]) => {
      if (!operation || typeof operation !== 'object' || typeof operation.operationId !== 'string') {
        return;
      }
      routes.push({
        operationId: operation.operationId,
        action: operation.operationId,
        method: String(method).toUpperCase(),
        path: routePath,
      });
    });
  });
  return routes;
}

function buildOperationMap(spec) {
  const map = new Map();
  const paths = spec && typeof spec === 'object' ? spec.paths : null;
  if (!paths || typeof paths !== 'object') {
    return map;
  }

  Object.entries(paths).forEach(([routePath, operations]) => {
    if (!operations || typeof operations !== 'object') {
      return;
    }
    Object.entries(operations).forEach(([method, operation]) => {
      if (!operation || typeof operation !== 'object' || typeof operation.operationId !== 'string') {
        return;
      }
      map.set(operation.operationId, {
        method: String(method).toUpperCase(),
        path: routePath,
        operation,
      });
    });
  });
  return map;
}

function inspectSourceMismatch(route, operation, transportResponse, hostCalls, root) {
  const findings = [];
  const observed = `${transportResponse.body}\n${JSON.stringify(hostCalls)}`;
  const bodySchema = findJsonRequestBodySchema(operation, root);
  const bodyPropertyNames = listBodyPropertyNames(bodySchema, root);
  const queryParameterNames = listQueryParameters(operation, root).map((parameter) => String(parameter.name));
  const pathParameterNames = listPathParameters(operation, root).map((parameter) => String(parameter.name));

  const probes = [
    ...bodyPropertyNames.map((name) => ({ name, expected: 'BODY', others: ['QUERY', 'PARAM'] })),
    ...queryParameterNames.map((name) => ({ name, expected: 'QUERY', others: ['BODY', 'PARAM'] })),
    ...pathParameterNames.map((name) => ({ name, expected: 'PARAM', others: ['BODY', 'QUERY'] })),
  ];

  probes.forEach((probe) => {
    const expectedToken = `__${probe.expected}_${probe.name}__`;
    const otherTokens = probe.others.map((source) => `__${source}_${probe.name}__`);
    if (observed.includes(expectedToken)) {
      return;
    }
    const mismatchedToken = otherTokens.find((token) => observed.includes(token));
    if (!mismatchedToken) {
      return;
    }
    const observedSource = mismatchedToken.match(/^__([A-Z]+)_/)?.[1]?.toLowerCase() || mismatchedToken;
    findings.push(`${route.operationId}: field "${probe.name}" expected ${probe.expected.toLowerCase()} source, ` + `but observed ${observedSource} source`);
  });

  return findings;
}

function validateResponse(route, operation, transportResponse, root) {
  const findings = [];
  const statusKey = String(transportResponse.status);
  const responses = operation && typeof operation === 'object' ? operation.responses : null;
  const responseSpec = responses && typeof responses === 'object' ? unwrapSchema(responses[statusKey] || responses.default, root) : null;

  if (!responseSpec || typeof responseSpec !== 'object') {
    findings.push(`${route.operationId}: response status ${transportResponse.status} is not declared in spec`);
    return findings;
  }

  const content = responseSpec.content && typeof responseSpec.content === 'object' ? responseSpec.content : null;
  if (!content) {
    return findings;
  }

  const actualContentType = baseContentType(transportResponse.headers['content-type']);
  let matchedContentType = null;
  for (const candidate of Object.keys(content)) {
    if (baseContentType(candidate) === actualContentType) {
      matchedContentType = candidate;
      break;
    }
  }
  if (!matchedContentType) {
    findings.push(`${route.operationId}: response content-type ${transportResponse.headers['content-type'] || '<empty>'} does not match spec`);
    return findings;
  }

  const schema = content[matchedContentType] && typeof content[matchedContentType] === 'object' ? content[matchedContentType].schema : null;
  if (!schema) {
    return findings;
  }

  let parsedBody = transportResponse.body;
  if (actualContentType === 'application/json') {
    if (!looksLikeJson(transportResponse.body)) {
      findings.push(`${route.operationId}: response body is not valid JSON`);
      return findings;
    }
    parsedBody = JSON.parse(transportResponse.body);
  }

  const errors = validateSchema(parsedBody, schema, root, '$');
  errors.forEach((error) => findings.push(`${route.operationId}: ${error}`));
  return findings;
}

async function run() {
  const typecheckFindings = runTypeCheck();
  if (typecheckFindings.length > 0) {
    console.error('QuickJS service contract smoke test failed:');
    typecheckFindings.forEach((finding) => {
      console.error(`- typecheck: ${finding}`);
    });
    process.exitCode = 1;
    return;
  }

  const sourcePolicyFindings = runControllerSourcePolicyCheck({
    controllerPath,
    serviceRoot,
    readFile: readUtf8,
  });
  if (sourcePolicyFindings.length > 0) {
    console.error('QuickJS service contract smoke test failed:');
    sourcePolicyFindings.forEach((finding) => {
      console.error(`- source policy: ${finding}`);
    });
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(manifestPath) || !fs.existsSync(specPath)) {
    throw new Error('QuickJS service build artifacts are missing. Run `npm run build` in service/ first.');
  }

  const manifest = loadJson(manifestPath);
  const spec = loadJson(specPath);
  const operationMap = buildOperationMap(spec);
  const routes = collectRoutes(manifest, spec);
  const findings = [];

  const loader = createModuleLoader();
  const harness = createHostHarness();
  harness.install();
  const controller = loader.loadController();
  const exportedActions = new Set(Object.keys(controller).filter((key) => typeof controller[key] === 'function'));

  routes.forEach((route) => {
    if (!route.path) {
      findings.push(`${route.operationId}: route path is missing from manifest`);
    }
    if (!exportedActions.has(route.action)) {
      findings.push(`${route.operationId}: controller action "${route.action}" is not exported`);
    }
    const operationEntry = operationMap.get(route.operationId);
    if (!operationEntry) {
      findings.push(`${route.operationId}: operationId not found in spec.json`);
      return;
    }
    if (operationEntry.method !== route.method || operationEntry.path !== route.path) {
      findings.push(`${route.operationId}: manifest route ${route.method} ${route.path} does not match spec ${operationEntry.method} ${operationEntry.path}`);
    }
  });

  for (const route of routes) {
    const operationEntry = operationMap.get(route.operationId);
    if (!operationEntry || !exportedActions.has(route.action)) {
      continue;
    }

    const action = controller[route.action];

    harness.resetCalls();
    let probeResponse;
    try {
      const probeResult = await action(buildProbeInput(route, operationEntry.operation, spec));
      probeResponse = normalizeTransportResponse(probeResult);
    } catch (error) {
      findings.push(`${route.operationId}: probe execution failed: ${String(error)}`);
      continue;
    }
    findings.push(...inspectSourceMismatch(route, operationEntry.operation, probeResponse, harness.snapshotCalls(), spec));

    harness.resetCalls();
    try {
      const validationResult = await action(buildValidationInput(route, operationEntry.operation, spec));
      const transportResponse = normalizeTransportResponse(validationResult);
      findings.push(...validateResponse(route, operationEntry.operation, transportResponse, spec));
    } catch (error) {
      findings.push(`${route.operationId}: validation execution failed: ${String(error)}`);
    }
  }

  if (findings.length > 0) {
    console.error('QuickJS service contract smoke test failed:');
    findings.forEach((finding) => {
      console.error(`- ${finding}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log(`QuickJS service contract smoke test passed (${routes.length} operation(s))`);
}

run().catch((error) => {
  console.error(`QuickJS service contract smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
