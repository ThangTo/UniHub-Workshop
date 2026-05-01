import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiError } from '../lib/api';
import type { WorkshopListItem } from '../lib/types';
import { formatCurrency, formatDateRange } from '../lib/format';
import clsx from 'clsx';

export function WorkshopsScreen() {
  const [items, setItems] = useState<WorkshopListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.get<{ items: WorkshopListItem[] } | WorkshopListItem[]>('/workshops');
        const list = Array.isArray(r.data) ? r.data : r.data.items;
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(apiError(e, 'Không tải được danh sách workshop.'));
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
          <h1 className="text-2xl font-bold text-slate-900">Workshop sắp diễn ra</h1>
          <p className="text-sm text-slate-500">
            Đặt chỗ sớm — số ghế giới hạn, FCFS theo thời gian xác nhận thanh toán.
          </p>
        </div>
      </div>

      {error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {!items && !error && <div className="text-slate-500">Đang tải…</div>}

      {items && items.length === 0 && (
        <div className="card p-6 text-center text-slate-500">Chưa có workshop nào.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((w) => (
          <Link
            key={w.id}
            to={`/workshops/${w.id}`}
            className="card flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="line-clamp-2 text-base font-semibold text-slate-900">{w.title}</h2>
              <SeatsBadge seatsLeft={w.seatsLeft} capacity={w.capacity} />
            </div>
            <p className="mt-2 text-sm text-slate-600">{formatDateRange(w.startAt, w.endAt)}</p>
            {(w.speakerName || w.roomName) && (
              <p className="mt-1 text-xs text-slate-500">
                {w.speakerName ? `🎤 ${w.speakerName}` : null}
                {w.speakerName && w.roomName ? ' · ' : ''}
                {w.roomName ? `📍 ${w.roomName}` : null}
              </p>
            )}
            <div className="mt-4 flex items-center justify-between">
              <span className="text-base font-semibold text-brand-700">
                {formatCurrency(w.feeAmount)}
              </span>
              <span className="badge bg-slate-100 text-slate-700">{w.status}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SeatsBadge({ seatsLeft, capacity }: { seatsLeft: number; capacity: number }) {
  const ratio = capacity > 0 ? seatsLeft / capacity : 0;
  return (
    <span
      className={clsx(
        'badge whitespace-nowrap',
        seatsLeft === 0
          ? 'bg-red-100 text-red-700'
          : ratio < 0.2
            ? 'bg-amber-100 text-amber-700'
            : 'bg-emerald-100 text-emerald-700',
      )}
    >
      {seatsLeft === 0 ? 'Hết ghế' : `Còn ${seatsLeft}/${capacity}`}
    </span>
  );
}
