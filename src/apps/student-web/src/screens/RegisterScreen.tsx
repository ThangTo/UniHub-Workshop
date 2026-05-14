import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiError } from '../lib/api';

export function RegisterScreen() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    studentCode: '',
    fullName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(form);
      navigate('/workshops', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Đăng ký thất bại.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="card w-full max-w-md p-10 backdrop-blur-xl border-white/60">
        <div className="mb-10 text-center">
          <h1 className="mb-3 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">
            Đăng ký sinh viên
          </h1>
          <p className="text-sm font-medium text-slate-500">
            Cần MSSV hợp lệ để xác minh với nhà trường.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-1.5">
            <Field label="MSSV" required>
              <input
                type="text"
                required
                className="input text-base py-3"
                autoComplete="off"
                value={form.studentCode}
                onChange={(e) => update('studentCode', e.target.value)}
                placeholder="VD: 21120001"
              />
            </Field>
            <p className="mt-1 text-xs text-slate-400">
              Demo: thử MSSV chưa liên kết (21120004, 21120005)
            </p>
          </div>
          <Field label="Họ và tên" required>
            <input
              type="text"
              required
              className="input text-base py-3"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              placeholder="Nguyễn Văn A"
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              required
              className="input text-base py-3"
              autoComplete="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="sinhvien@student.hcmus.edu.vn"
            />
          </Field>
          <Field label="Mật khẩu (≥ 8 ký tự)" required>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input text-base py-3"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50/50 p-4 text-sm font-medium text-red-600 backdrop-blur-sm">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full py-3.5 text-base" disabled={submitting}>
            {submitting ? 'Đang xử lý…' : 'Tạo tài khoản'}
          </button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-slate-200/60 text-center">
          <p className="text-sm font-medium text-slate-600">
            Đã có tài khoản?{' '}
            <Link to="/login" className="text-brand-600 hover:text-brand-500 hover:underline transition-colors">
              Đăng nhập ngay
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-slate-700 tracking-wide">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
