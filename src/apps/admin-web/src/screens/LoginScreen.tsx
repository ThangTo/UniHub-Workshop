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
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-100 via-slate-50 to-white px-4 py-12">
      <div className="card w-full max-w-md p-8">
        <div className="mb-1 flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">UniHub Admin</h1>
          <span className="badge bg-brand-50 text-brand-700">Quản trị</span>
        </div>
        <p className="mb-6 text-sm text-slate-500">
          Đăng nhập với tài khoản <code className="text-xs">ORGANIZER</code> hoặc{' '}
          <code className="text-xs">SYS_ADMIN</code>.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Mật khẩu</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}
