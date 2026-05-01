import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, tokenStore } from '../lib/api';
import type { AuthUser, LoginResponse } from '../lib/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: {
    email: string;
    password: string;
    fullName: string;
    studentCode: string;
  }): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Hydrate user trên reload nếu có accessToken.
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (!tokenStore.getAccess()) {
        setLoading(false);
        return;
      }
      try {
        const r = await api.get<AuthUser>('/auth/me');
        if (!cancelled) setUser(r.data);
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

  // Listen cho event từ axios khi refresh fail.
  useEffect(() => {
    function onExpired() {
      setUser(null);
      navigate('/login', {
        replace: true,
        state: { from: location.pathname },
      });
    }
    window.addEventListener('unihub:auth-expired', onExpired);
    return () => window.removeEventListener('unihub:auth-expired', onExpired);
  }, [navigate, location.pathname]);

  async function loginAndHydrate(email: string, password: string) {
    const r = await api.post<LoginResponse>('/auth/login', { email, password });
    tokenStore.set(r.data.accessToken, r.data.refreshToken);
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me.data);
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(email, password) {
        await loginAndHydrate(email, password);
      },
      async register(input) {
        await api.post('/auth/register', input);
        // Không auto-login — backend yêu cầu login riêng để cấp token + audit.
        await loginAndHydrate(input.email, input.password);
      },
      async logout() {
        try {
          await api.post('/auth/logout');
        } catch {
          /* ignore — vẫn clear local */
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
