import { randomBytes } from 'node:crypto';

export type ServiceIntegrationContext = {
  baseUrl: string;
  artifactId: string;
  artifactVersion: string;
  uid: string;
  traceId: string;
};

const REQUIRED_ENV_KEYS = ['SERVICE_TEST_BASE_URL', 'SERVICE_TEST_ARTIFACT_ID', 'SERVICE_TEST_ARTIFACT_VERSION', 'SERVICE_TEST_UID'] as const;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getMissingServiceIntegrationEnv(): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => !process.env[key]?.trim());
}

export function getServiceIntegrationContext(): ServiceIntegrationContext {
  const missing = getMissingServiceIntegrationEnv();
  if (missing.length > 0) {
    throw new Error(`Missing service integration environment variable(s): ${missing.join(', ')}`);
  }

  return {
    baseUrl: trimTrailingSlash(process.env.SERVICE_TEST_BASE_URL as string),
    artifactId: process.env.SERVICE_TEST_ARTIFACT_ID as string,
    artifactVersion: process.env.SERVICE_TEST_ARTIFACT_VERSION as string,
    uid: process.env.SERVICE_TEST_UID as string,
    traceId: process.env.SERVICE_TEST_TRACE_ID?.trim() || `it_trace_${randomHex(12)}`,
  };
}

export function randomHex(length: number) {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export function randomDigits(length: number) {
  let digits = '';
  while (digits.length < length) {
    digits += String(randomBytes(1)[0] % 10);
  }
  return digits.slice(0, length);
}

export function createTestUid() {
  return `20880000${randomDigits(8)}`;
}

export function createTestArtifactId() {
  return `flashapp-7e57${randomHex(12)}`;
}

export function uniqueName(prefix = 'case') {
  const context = getServiceIntegrationContext();
  return `${prefix}-${context.traceId}-${randomHex(6)}`;
}
