import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

/**
 * Axios singleton:
 *   - Base URL: VITE_API_BASE_URL (default `/api` → Vite proxy → backend :3000).
 *   - Đính `Authorization: Bearer <accessToken>` từ localStorage.
 *   - Khi 401: thử refresh 1 lần (race-safe) rồi retry request gốc.
 *   - Lỗi response chuẩn hoá `{code, message}`.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

const ACCESS_KEY = 'unihub.accessToken';
const REFRESH_KEY = 'unihub.refreshToken';

export const tokenStore = {
  getAccess(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  getRefresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use((cfg) => {
  const access = tokenStore.getAccess();
  if (access && cfg.headers) {
    cfg.headers.Authorization = `Bearer ${access}`;
  }
  return cfg;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) throw new Error('no_refresh_token');
  const r = await axios.post<{ accessToken: string; refreshToken: string }>(
    `${BASE_URL}/auth/refresh`,
    { refreshToken },
  );
  tokenStore.set(r.data.accessToken, r.data.refreshToken);
  return r.data.accessToken;
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (
      err.response?.status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes('/auth/')
    ) {
      original._retry = true;
      try {
        const newToken = await (refreshPromise ?? (refreshPromise = refreshAccessToken()));
        refreshPromise = null;
        if (original.headers) {
          original.headers.Authorization = `Bearer ${newToken}`;
        }
        return api.request(original);
      } catch (refreshErr) {
        refreshPromise = null;
        tokenStore.clear();
        // Force soft redirect — caller route guard cũng sẽ đẩy về /login
        window.dispatchEvent(new CustomEvent('unihub:auth-expired'));
        throw refreshErr;
      }
    }
    return Promise.reject(err);
  },
);

/** Trả message thân thiện cho UI từ AxiosError. */
export function apiError(e: unknown, fallback = 'Có lỗi xảy ra. Thử lại nhé.'): string {
  const axErr = e as AxiosError<{ message?: string; code?: string }>;
  return (
    axErr.response?.data?.message ??
    axErr.message ??
    (typeof e === 'string' ? e : null) ??
    fallback
  );
}

/** Random UUID-ish string cho Idempotency-Key header. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID(): string }).randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
