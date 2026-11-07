import { getServiceIntegrationContext, uniqueName } from './fixtures';

export { uniqueName };

export type ServiceRequestInput = {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  allowErrorStatus?: boolean;
};

export type ServiceTestResponse<T = unknown> = {
  status: number;
  headers: Record<string, string>;
  body: T;
  rawBody: string;
};

type RemoteSkillEnvelope = {
  success?: boolean;
  code?: string;
  message?: string;
  data?: unknown;
};

type TransportResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export class ServiceIntegrationError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ServiceIntegrationError';
  }
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value == null ? '' : String(value)]),
  );
}

function parseJsonIfPossible(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return text;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function parseRemoteSkillData(data: unknown): TransportResponse {
  if (typeof data === 'string') {
    return JSON.parse(data) as TransportResponse;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as TransportResponse;
  }
  throw new ServiceIntegrationError('remote_skill returned invalid data payload', { data });
}

function parseTransportBody<T>(body: unknown, headers: Record<string, string>): { parsedBody: T; rawBody: string } {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  const contentType = headers['content-type'] || '';
  const parsedBody = contentType.toLowerCase().includes('json') ? parseJsonIfPossible(rawBody) : rawBody;
  return {
    parsedBody: parsedBody as T,
    rawBody,
  };
}

function buildUrl(baseUrl: string) {
  return `${baseUrl}/api/remote_skill`;
}

function summarizeBody(rawBody: string) {
  const compact = rawBody.replace(/\s+/g, ' ').trim();
  if (compact.length <= 500) {
    return compact;
  }
  return `${compact.slice(0, 500)}...`;
}

export async function serviceRequest<T = unknown>(input: ServiceRequestInput): Promise<ServiceTestResponse<T>> {
  const context = getServiceIntegrationContext();
  const method = input.method.toUpperCase();
  const headers = {
    ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(input.headers || {}),
  };

  const payload = {
    artifactId: context.artifactId,
    artifactVersion: context.artifactVersion,
    request: {
      method,
      path: input.path,
      query: input.query || {},
      headers,
      body: input.body,
    },
  };

  const response = await fetch(buildUrl(context.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      alipay_uid: context.uid,
      params: {
        action: 'lingguang.service.request',
        source: 'service-integration-test',
        payload: JSON.stringify(payload),
        extInfo: {
          traceId: context.traceId,
        },
      },
    }),
  });

  let envelope: RemoteSkillEnvelope;
  try {
    envelope = (await response.json()) as RemoteSkillEnvelope;
  } catch (error) {
    throw new ServiceIntegrationError('remote_skill response is not valid JSON', {
      method,
      path: input.path,
      status: response.status,
      error: String(error),
    });
  }

  if (!response.ok || envelope.success === false || (envelope.code && envelope.code !== '0')) {
    throw new ServiceIntegrationError(envelope.message || `remote_skill request failed with status ${response.status}`, {
      method,
      path: input.path,
      httpStatus: response.status,
      envelope,
    });
  }

  const transport = parseRemoteSkillData(envelope.data);
  const transportStatus = Number(transport.status || 200);
  const transportHeaders = normalizeHeaders(transport.headers);
  const { parsedBody, rawBody } = parseTransportBody<T>(transport.body, transportHeaders);

  if (!input.allowErrorStatus && transportStatus >= 400) {
    throw new ServiceIntegrationError(
      `service request failed: ${method} ${input.path} -> ${transportStatus}: ${summarizeBody(rawBody)}`,
      {
        method,
        path: input.path,
        status: transportStatus,
        headers: transportHeaders,
        body: rawBody,
      },
    );
  }

  return {
    status: transportStatus,
    headers: transportHeaders,
    body: parsedBody,
    rawBody,
  };
}
