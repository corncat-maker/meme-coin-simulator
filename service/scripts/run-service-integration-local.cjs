const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const serviceRoot = path.resolve(__dirname, '..');
const distRoot = path.join(serviceRoot, 'dist');
const runtimeRoot =
  process.env.SERVICE_TEST_RUNTIME_ROOT || process.env.ASAP_SERVICE_RUNTIME_ROOT || '/tmp/asap-service-runtime';

function randomHex(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function randomDigits(length) {
  let digits = '';
  while (digits.length < length) {
    digits += String(crypto.randomBytes(1)[0] % 10);
  }
  return digits.slice(0, length);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: serviceRoot,
    stdio: 'inherit',
    env: options.env || process.env,
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function copyRuntimeDist(stageDir) {
  if (!fs.existsSync(distRoot)) {
    throw new Error(`service dist does not exist: ${distRoot}`);
  }

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const entry of fs.readdirSync(distRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    fs.copyFileSync(path.join(distRoot, entry.name), path.join(stageDir, entry.name));
  }
}

function main() {
  const traceId = process.env.SERVICE_TEST_TRACE_ID || `it_trace_${randomHex(12)}`;
  const artifactId = process.env.SERVICE_TEST_ARTIFACT_ID || `flashapp-7e57${randomHex(12)}`;
  const artifactVersion = process.env.SERVICE_TEST_ARTIFACT_VERSION || `local-${Date.now()}`;
  const uid = process.env.SERVICE_TEST_UID || `20880000${randomDigits(8)}`;
  const baseUrl = process.env.SERVICE_TEST_BASE_URL || 'http://127.0.0.1:8081';
  const stageDir = path.join(runtimeRoot, 'artifacts', artifactId, artifactVersion, 'service');

  const testEnv = {
    ...process.env,
    ARTIFACT_ID: artifactId,
    ARTIFACT_VERSION: artifactVersion,
    PLATFORM_ID: `${artifactId}-${artifactVersion}`,
    SERVICE_TEST_BASE_URL: baseUrl,
    SERVICE_TEST_ARTIFACT_ID: artifactId,
    SERVICE_TEST_ARTIFACT_VERSION: artifactVersion,
    SERVICE_TEST_UID: uid,
    SERVICE_TEST_TRACE_ID: traceId,
    ASAP_SERVICE_RUNTIME_ROOT: runtimeRoot,
  };

  console.log('[service-integration:local] build service runtime');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { env: testEnv });

  copyRuntimeDist(stageDir);

  console.log('[service-integration:local] staged runtime artifact');
  console.log(`  runtimeRoot=${runtimeRoot}`);
  console.log(`  stageDir=${stageDir}`);
  console.log(`  baseUrl=${baseUrl}`);
  console.log(`  artifactId=${artifactId}`);
  console.log(`  artifactVersion=${artifactVersion}`);
  console.log(`  uid=${uid}`);
  console.log(`  traceId=${traceId}`);

  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:service-integration'], { env: testEnv });
}

main();
