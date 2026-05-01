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
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4 py-12">
      <div className="card w-full max-w-md p-8">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">Đăng ký sinh viên</h1>
        <p className="mb-6 text-sm text-slate-500">
          Cần MSSV hợp lệ để xác minh — hệ thống sẽ kiểm tra với dữ liệu nhà trường.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="MSSV" required>
            <input
              type="text"
              required
              className="input"
              autoComplete="off"
              value={form.studentCode}
              onChange={(e) => update('studentCode', e.target.value)}
              placeholder="21120001"
            />
          </Field>
          <p className="-mt-2 text-xs text-slate-500">
            Demo: dùng một MSSV chưa liên kết như <code>21120004</code>, <code>21120005</code>,
            <code>21120006</code>. MSSV ngoài bảng <code>students</code> sẽ bị từ chối đúng spec.
          </p>
          <Field label="Họ và tên" required>
            <input
              type="text"
              required
              className="input"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              required
              className="input"
              autoComplete="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </Field>
          <Field label="Mật khẩu (≥ 8 ký tự)" required>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
            />
          </Field>
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Đang xử lý…' : 'Tạo tài khoản'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-600">
          Đã có tài khoản?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Đăng nhập
          </Link>
        </p>
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
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
