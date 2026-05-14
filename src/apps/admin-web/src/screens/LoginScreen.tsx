import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiError } from '../lib/api';

export function LoginScreen() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/workshops';
    navigate(from, { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/workshops';
      navigate(from, { replace: true });
    } catch (err) {
      setError(apiError(err, 'Đăng nhập thất bại.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="card w-full max-w-md p-10 backdrop-blur-xl border-white/60">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center justify-center rounded-2xl bg-brand-50/50 p-4 shadow-inner ring-1 ring-brand-100">
            <svg className="h-10 w-10 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-slate-900">
            UniHub Admin
          </h1>
          <p className="text-sm font-medium text-slate-500">
            Hệ thống quản trị dành cho <span className="text-brand-600">Ban tổ chức</span>
          </p>
        </div>
        
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700 tracking-wide">Email quản trị</label>
            <input
              type="email"
              required
              autoComplete="email"
              className="input text-base py-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@unihub.local"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700 tracking-wide">Mật khẩu</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="input text-base py-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          
          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50/50 p-4 text-sm font-medium text-red-600 backdrop-blur-sm">
              {error}
            </div>
          )}
          
          <button type="submit" className="btn-primary w-full py-3.5 text-base" disabled={submitting}>
            {submitting ? 'Đang xác thực…' : 'Đăng nhập hệ thống'}
          </button>
        </form>
      </div>
    </div>
  );
}
