import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, tokenStore } from '../lib/api';
import type { AuthUser, LoginResponse, RoleName } from '../lib/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  hasRole(role: RoleName): boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ALLOWED_ROLES: RoleName[] = ['ORGANIZER', 'SYS_ADMIN'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (!tokenStore.getAccess()) {
        setLoading(false);
        return;
      }
      try {
        const r = await api.get<AuthUser>('/auth/me');
        if (!cancelled) {
          if (r.data.roles.some((r0) => ALLOWED_ROLES.includes(r0))) {
            setUser(r.data);
          } else {
            tokenStore.clear();
          }
        }
      } catch {
        tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener('unihub-admin:auth-expired', onExpired);
    return () => window.removeEventListener('unihub-admin:auth-expired', onExpired);
  }, [navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      hasRole: (role) => !!user && user.roles.includes(role),
      async login(email, password) {
        const r = await api.post<LoginResponse>('/auth/login', { email, password });
        tokenStore.set(r.data.accessToken, r.data.refreshToken);
        const me = await api.get<AuthUser>('/auth/me');
        if (!me.data.roles.some((rl) => ALLOWED_ROLES.includes(rl))) {
          tokenStore.clear();
          throw new Error('Tài khoản không có quyền truy cập admin.');
        }
        setUser(me.data);
      },
      async logout() {
        try {
          await api.post('/auth/logout');
        } catch {
          /* noop */
        }
        tokenStore.clear();
        setUser(null);
        navigate('/login', { replace: true });
      },
    }),
    [user, loading, navigate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
