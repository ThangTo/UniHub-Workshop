import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiError } from '../lib/api';
import type { WorkshopSummary } from '../lib/types';
import { formatCurrency, formatDateTime } from '../lib/format';
import clsx from 'clsx';

export function WorkshopsAdminScreen() {
  const [items, setItems] = useState<WorkshopSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.get<{ items: WorkshopSummary[] } | WorkshopSummary[]>(
          '/workshops/admin/list',
        );
        const list = Array.isArray(r.data) ? r.data : r.data.items;
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(apiError(e, 'Không tải được workshop.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workshops</h1>
          <p className="text-sm text-slate-500">
            Tạo, chỉnh sửa, publish workshop và upload PDF cho AI summary.
          </p>
        </div>
        <Link to="/workshops/new" className="btn-primary">
          + Tạo workshop
        </Link>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {!items && !error && <div className="text-slate-500">Đang tải…</div>}

      {items && items.length > 0 && (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Thời gian</th>
                <th className="text-right">Phí</th>
                <th className="text-right">Ghế</th>
                <th>Status</th>
                <th>Summary</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td>
                    <Link to={`/workshops/${w.id}`} className="font-medium text-slate-900 hover:underline">
                      {w.title}
                    </Link>
                    <div className="text-xs text-slate-500">{w.speakerName ?? '—'} · {w.roomName ?? '—'}</div>
                  </td>
                  <td className="text-xs text-slate-600">
                    {formatDateTime(w.startAt)}
                    <br />→ {formatDateTime(w.endAt)}
                  </td>
                  <td className="text-right">{formatCurrency(w.feeAmount)}</td>
                  <td className="text-right">
                    {w.seatsLeft}/{w.capacity}
                  </td>
                  <td>
                    <StatusBadge status={w.status} />
                  </td>
                  <td>
                    <SummaryBadge status={w.summaryStatus} />
                  </td>
                  <td>
                    <Link to={`/workshops/${w.id}/edit`} className="btn-ghost text-xs">
                      Chỉnh sửa
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items && items.length === 0 && (
        <div className="card p-8 text-center text-slate-500">
          Chưa có workshop nào.{' '}
          <Link to="/workshops/new" className="text-brand-600 underline">
            Tạo workshop đầu tiên
          </Link>
          .
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: WorkshopSummary['status'] }) {
  const map = {
    DRAFT: 'bg-slate-100 text-slate-700',
    PUBLISHED: 'bg-emerald-100 text-emerald-800',
    CANCELLED: 'bg-red-100 text-red-700',
    ENDED: 'bg-sky-100 text-sky-800',
    COMPLETED: 'bg-sky-100 text-sky-800',
  } as const;
  return <span className={clsx('badge', map[status])}>{status}</span>;
}

function SummaryBadge({ status }: { status: WorkshopSummary['summaryStatus'] }) {
  const map = {
    NONE: ['bg-slate-100 text-slate-600', 'Chưa có'],
    PENDING: ['bg-amber-100 text-amber-700', 'Đang xử lý'],
    READY: ['bg-emerald-100 text-emerald-700', 'Đã sẵn'],
    FAILED: ['bg-red-100 text-red-700', 'Lỗi'],
  } as const;
  const [cls, label] = map[status] ?? map.NONE;
  return <span className={clsx('badge', cls)}>{label}</span>;
}
