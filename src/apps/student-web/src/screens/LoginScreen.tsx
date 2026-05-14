import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
          <h1 className="mb-3 text-4xl font-extrabold tracking-tight bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">
            UniHub Workshop
          </h1>
          <p className="text-sm font-medium text-slate-500">
            Chào mừng trở lại! Đăng nhập để tiếp tục.
          </p>
        </div>
        
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700 tracking-wide">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              className="input text-base py-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sinhvien@student.hcmus.edu.vn"
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
            {submitting ? 'Đang xác thực…' : 'Đăng nhập'}
          </button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-slate-200/60 text-center">
          <p className="text-sm font-medium text-slate-600">
            Chưa có tài khoản?{' '}
            <Link to="/register" className="text-brand-600 hover:text-brand-500 hover:underline transition-colors">
              Đăng ký ngay
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
