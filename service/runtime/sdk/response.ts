export type ServiceResponseInit = {
  status?: number;
  headers?: Record<string, string>;
};

export type QuickJSServiceResponse = {
  __serviceResponse: true;
  status: number;
  headers: Record<string, string>;
  body: string;
};

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return headers ? { ...headers } : {};
}

export function json(data: unknown, init: ServiceResponseInit = {}): QuickJSServiceResponse {
  const headers = normalizeHeaders(init.headers);
  if (!headers['content-type']) {
    headers['content-type'] = 'application/json;charset=UTF-8';
  }
  return {
    __serviceResponse: true,
    status: init.status ?? 200,
    headers,
    body: JSON.stringify(data),
  };
}

export function text(value: string, init: ServiceResponseInit = {}): QuickJSServiceResponse {
  const headers = normalizeHeaders(init.headers);
  if (!headers['content-type']) {
    headers['content-type'] = 'text/plain;charset=UTF-8';
  }
  return {
    __serviceResponse: true,
    status: init.status ?? 200,
    headers,
    body: value,
  };
}

export function html(value: string, init: ServiceResponseInit = {}): QuickJSServiceResponse {
  const headers = normalizeHeaders(init.headers);
  if (!headers['content-type']) {
    headers['content-type'] = 'text/html;charset=UTF-8';
  }
  return {
    __serviceResponse: true,
    status: init.status ?? 200,
    headers,
    body: value,
  };
}
