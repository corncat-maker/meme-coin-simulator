type HostCall = (method: string, params?: unknown) => unknown;

function getHostCall(): HostCall {
  const hostCall = (globalThis as typeof globalThis & { __quickjsHostCall?: HostCall }).__quickjsHostCall;
  if (typeof hostCall !== 'function') {
    throw new Error('QuickJS host runtime is not installed');
  }
  return hostCall;
}

export const host = {
  call<T = unknown>(method: string, params?: unknown): T {
    return getHostCall()(method, params) as T;
  },
};

export const runtime = {
  getRequestContext<T = unknown>(): T {
    return host.call<T>('runtime.getRequestContext', {});
  },
};

export const storage = {
  getItem<T = unknown>(params: { key: string }): T | null {
    return host.call<T | null>('storage.getItem', params);
  },
  setItem<T = boolean>(params: { key: string; value: unknown }): T {
    return host.call<T>('storage.setItem', params);
  },
  removeItem<T = boolean>(params: { key: string }): T {
    return host.call<T>('storage.removeItem', params);
  },
  clear<T = boolean>(): T {
    return host.call<T>('storage.clear', {});
  },
};

export type OSSListEntry = {
  key: string;
  name: string;
  size: number;
  modifiedAt: number;
  etag?: string;
};

export const oss = {
  readText(params: { key: string }): string | null {
    return host.call<string | null>('oss.readText', params);
  },
  writeText(params: { key: string; text: string; contentType?: string }): {
    key: string;
    size: number;
    etag?: string;
  } {
    return host.call<{ key: string; size: number; etag?: string }>('oss.writeText', params);
  },
  delete(params: { key: string }): boolean {
    return host.call<boolean>('oss.delete', params);
  },
  list(params: { prefix?: string; limit?: number } = {}): OSSListEntry[] {
    return host.call<OSSListEntry[]>('oss.list', params);
  },
  readJson<T = unknown>(params: { key: string }): T | null {
    const text = oss.readText(params);
    return text ? (JSON.parse(text) as T) : null;
  },
  writeJson(params: { key: string; value: unknown }): {
    key: string;
    size: number;
    etag?: string;
  } {
    return oss.writeText({
      key: params.key,
      text: JSON.stringify(params.value, null, 2),
      contentType: 'application/json; charset=utf-8',
    });
  },
};

export type DBRow = Record<string, unknown>;

export type DBQueryResult = {
  success: boolean;
  data?: DBRow[];
  message?: string;
};

export type DBExecuteResult = {
  success: boolean;
  data?: { rowsAffected: number };
  message?: string;
};

export const db = {
  query<T = DBRow>(params: { sql: string; binds?: unknown[] }): DBQueryResult {
    return host.call<DBQueryResult>('db.query', params);
  },
  execute(params: { sql: string; binds?: unknown[] }): DBExecuteResult {
    return host.call<DBExecuteResult>('db.execute', params);
  },
};

export type WebSearchPOI = {
  name?: string;
  address?: string;
};

export type WebSearchLocation = {
  longitude?: number;
  latitude?: number;
  province?: string;
  city?: string;
  district?: string;
  pois?: WebSearchPOI[];
  nearbyPoi?: WebSearchPOI;
};

function normalizeWebSearchLocation(location?: WebSearchLocation | null): Record<string, unknown> | undefined {
  if (!location || typeof location !== 'object') {
    return undefined;
  }

  const firstPoi = Array.isArray(location.pois) ? location.pois.find((poi) => poi && typeof poi === 'object' && (poi.name || poi.address)) : undefined;
  const nearbyPoi = location.nearbyPoi ?? firstPoi;

  const normalized: Record<string, unknown> = {};
  if (typeof location.longitude === 'number') {
    normalized.longitude = location.longitude;
  }
  if (typeof location.latitude === 'number') {
    normalized.latitude = location.latitude;
  }
  if (typeof location.province === 'string') {
    normalized.province = location.province;
  }
  if (typeof location.city === 'string') {
    normalized.city = location.city;
  }
  if (typeof location.district === 'string') {
    normalized.district = location.district;
  }
  if (nearbyPoi && typeof nearbyPoi === 'object') {
    normalized.nearbyPoi = {
      name: typeof nearbyPoi.name === 'string' ? nearbyPoi.name : '',
      address: typeof nearbyPoi.address === 'string' ? nearbyPoi.address : '',
    };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export const webSearch = {
  fetch<T = unknown>(params: { query: string; schema: Record<string, unknown>; location?: WebSearchLocation | null }): T | null {
    const payload: Record<string, unknown> = {
      query: params.query,
      schema: params.schema,
    };
    const userLocation = normalizeWebSearchLocation(params.location);
    if (userLocation) {
      payload.userLocation = userLocation;
    }
    return host.call<T | null>('webSearch.fetch', payload);
  },
};
