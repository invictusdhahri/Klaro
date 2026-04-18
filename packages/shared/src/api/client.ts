/**
 * Lightweight typed fetch client. Works in Next.js (server + client),
 * Node.js, and any modern runtime. Designed to be subclassed/wrapped
 * for auth headers, retries, etc.
 */

export interface ApiClientOptions {
  baseUrl: string;
  /** Async function returning an access token (e.g. Supabase JWT). */
  getAccessToken?: () => Promise<string | null> | string | null;
  /** Default fetch options applied to every request. */
  defaultInit?: RequestInit;
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getAccessToken: ApiClientOptions['getAccessToken'];
  private readonly defaultInit: RequestInit;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getAccessToken = options.getAccessToken;
    this.defaultInit = options.defaultInit ?? {};
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const { body, query, headers, ...rest } = options;

    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const finalHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...(this.defaultInit.headers as Record<string, string> | undefined),
      ...(headers as Record<string, string> | undefined),
    };

    if (body !== undefined && !(body instanceof FormData)) {
      finalHeaders['Content-Type'] = 'application/json';
    }

    const token = await this.getAccessToken?.();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }

    const init: RequestInit = {
      ...this.defaultInit,
      ...rest,
      headers: finalHeaders,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    };

    const res = await fetch(url.toString(), init);

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const message =
        (parsed as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
      throw new ApiError(message, res.status, parsed);
    }

    return parsed as T;
  }

  get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
