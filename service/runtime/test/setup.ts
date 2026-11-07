import { beforeAll } from 'vitest';

import { getMissingServiceIntegrationEnv, getServiceIntegrationContext } from './fixtures';

beforeAll(() => {
  const missing = getMissingServiceIntegrationEnv();
  if (missing.length > 0) {
    throw new Error(`Missing service integration environment variable(s): ${missing.join(', ')}`);
  }

  const context = getServiceIntegrationContext();
  if (!/^20880000\d{8}$/.test(context.uid)) {
    throw new Error('SERVICE_TEST_UID must match 20880000 + 8 random digits');
  }

  if (!/^flashapp-7e57[0-9a-f]{12}$/.test(context.artifactId)) {
    throw new Error('SERVICE_TEST_ARTIFACT_ID must match flashapp-7e57 + 12 lowercase hex characters');
  }
});
