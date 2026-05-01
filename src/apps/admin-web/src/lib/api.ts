import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';
const ACCESS_KEY = 'unihub.admin.accessToken';
const REFRESH_KEY = 'unihub.admin.refreshToken';

export const tokenStore = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 20000 });

api.interceptors.request.use((cfg) => {
  const access = tokenStore.getAccess();
  if (access && cfg.headers) cfg.headers.Authorization = `Bearer ${access}`;
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
        const token = await (refreshPromise ?? (refreshPromise = refreshAccessToken()));
        refreshPromise = null;
        if (original.headers) original.headers.Authorization = `Bearer ${token}`;
        return api.request(original);
      } catch (refreshErr) {
        refreshPromise = null;
        tokenStore.clear();
        window.dispatchEvent(new CustomEvent('unihub-admin:auth-expired'));
        throw refreshErr;
      }
    }
    return Promise.reject(err);
  },
);

export function apiError(e: unknown, fallback = 'Có lỗi xảy ra.'): string {
  const ax = e as AxiosError<{ message?: string }>;
  return ax.response?.data?.message ?? ax.message ?? fallback;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID(): string }).randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
