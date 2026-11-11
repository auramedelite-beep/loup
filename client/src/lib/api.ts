export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const TOKEN_KEY = 'lgdz.token';
const RECONNECT_KEY = 'lgdz.reconnect';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export interface StoredReconnect {
  roomId: string;
  roomCode: string;
  token: string;
}

export function getReconnect(): StoredReconnect | null {
  try {
    const raw = localStorage.getItem(RECONNECT_KEY);
    return raw ? (JSON.parse(raw) as StoredReconnect) : null;
  } catch {
    return null;
  }
}

export function setReconnect(value: StoredReconnect | null): void {
  try {
    if (value) localStorage.setItem(RECONNECT_KEY, JSON.stringify(value));
    else localStorage.removeItem(RECONNECT_KEY);
  } catch {
    /* ignore */
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  auth?: boolean;
};

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (auth) {
    const token = getToken();
    if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `http_${response.status}`;
    throw new ApiError(response.status, code, (payload as { details?: unknown } | null)?.details);
  }

  return payload as T;
}

export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error && error.message) return error.message;
  return 'unknown_error';
}
