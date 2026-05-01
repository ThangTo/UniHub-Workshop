import { useEffect, useState } from 'react';
import { api, apiError } from '../lib/api';
import type { AdminRegistration } from '../lib/types';
import { formatCurrency, formatDateTime } from '../lib/format';
import clsx from 'clsx';

export function RegistrationsScreen() {
  const [items, setItems] = useState<AdminRegistration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function load() {
    try {
      // Backend chưa có endpoint admin chuyên cho registrations across workshops;
      // ta dùng /admin/registrations nếu có, hoặc rơi về /workshops/:id/registrations
      // (bỏ qua filter workshop ở UI khởi điểm này).
      const r = await api.get<AdminRegistration[]>('/admin/registrations');
      setItems(r.data);
    } catch (e) {
      // Nếu endpoint không tồn tại → hiển thị placeholder thân thiện thay vì lỗi cứng.
      const ax = e as { response?: { status?: number } };
      if (ax.response?.status === 404) {
        setItems([]);
      } else {
        setError(apiError(e));
      }
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = items?.filter(
    (r) =>
      !filter ||
      r.workshopTitle?.toLowerCase().includes(filter.toLowerCase()) ||
      r.studentName?.toLowerCase().includes(filter.toLowerCase()) ||
      r.studentCode?.includes(filter),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Đăng ký</h1>
          <p className="text-sm text-slate-500">
            Tổng quan đăng ký theo workshop, kèm trạng thái thanh toán & check-in.
          </p>
        </div>
        <input
          className="input max-w-xs"
          placeholder="Tìm theo MSSV, tên SV, workshop…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {!items && !error && <div className="text-slate-500">Đang tải…</div>}
      {items && items.length === 0 && (
        <div className="card p-8 text-center text-slate-500">
          Chưa có dữ liệu đăng ký, hoặc endpoint <code>/admin/registrations</code> chưa được
          backend cung cấp. Hãy mở từng workshop để xem danh sách.
        </div>
      )}
      {filtered && filtered.length > 0 && (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Sinh viên</th>
                <th>Workshop</th>
                <th>Phí</th>
                <th>Đăng ký lúc</th>
                <th>Status</th>
                <th>Check-in</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td>
                    <div className="font-medium text-slate-900">{r.studentName ?? '—'}</div>
                    <div className="text-xs text-slate-500">{r.studentCode ?? r.studentId}</div>
                  </td>
                  <td>{r.workshopTitle ?? r.workshopId}</td>
                  <td>{formatCurrency(r.feeAmount)}</td>
                  <td className="text-xs">{formatDateTime(r.createdAt)}</td>
                  <td>
                    <RegStatusBadge status={r.status} />
                  </td>
                  <td>
                    {r.checkedIn ? (
                      <span className="badge bg-emerald-100 text-emerald-800">
                        ✓ {r.checkedInAt ? formatDateTime(r.checkedInAt) : 'Đã check'}
                      </span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-600">Chưa</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RegStatusBadge({ status }: { status: AdminRegistration['status'] }) {
  const map = {
    PENDING_PAYMENT: 'bg-amber-100 text-amber-800',
    CONFIRMED: 'bg-emerald-100 text-emerald-800',
    CANCELLED: 'bg-slate-200 text-slate-600',
    EXPIRED: 'bg-slate-200 text-slate-600',
    WAITLIST: 'bg-sky-100 text-sky-800',
  } as const;
  return <span className={clsx('badge', map[status])}>{status}</span>;
}
