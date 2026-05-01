import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiError } from '../lib/api';
import type { WorkshopSummary } from '../lib/types';
import { formatCurrency, formatDateTime } from '../lib/format';
import clsx from 'clsx';

export function WorkshopDetailAdminScreen() {
  const { id } = useParams<{ id: string }>();
  const [w, setW] = useState<WorkshopSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const r = await api.get<WorkshopSummary>(`/workshops/${id}`);
        if (cancelled) return;
        setW(r.data);
        if (r.data.summaryStatus === 'PENDING') {
          timer = setTimeout(load, 3000);
        }
      } catch (e) {
        if (!cancelled) setError(apiError(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  async function publish() {
    if (!id) return;
    setBusy('publish');
    try {
      await api.post(`/workshops/${id}/publish`);
      const r = await api.get<WorkshopSummary>(`/workshops/${id}`);
      setW(r.data);
    } catch (e) {
      alert(apiError(e, 'Publish thất bại.'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelWorkshop() {
    if (!id) return;
    const reason = prompt('Lý do huỷ?') || '';
    if (!reason) return;
    setBusy('cancel');
    try {
      await api.post(`/workshops/${id}/cancel`, { reason });
      const r = await api.get<WorkshopSummary>(`/workshops/${id}`);
      setW(r.data);
    } catch (e) {
      alert(apiError(e, 'Huỷ thất bại.'));
    } finally {
      setBusy(null);
    }
  }

  async function uploadPdf(file: File) {
    if (!id) return;
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/workshops/${id}/pdf`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Refresh — trạng thái sẽ thành PENDING (cache miss) hoặc READY (cache hit)
      const r = await api.get<WorkshopSummary>(`/workshops/${id}`);
      setW(r.data);
    } catch (e) {
      alert(apiError(e, 'Upload PDF thất bại.'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function retrySummary() {
    if (!id) return;
    setBusy('retry');
    try {
      await api.post(`/workshops/${id}/summary/retry`);
      const r = await api.get<WorkshopSummary>(`/workshops/${id}`);
      setW(r.data);
    } catch (e) {
      alert(apiError(e, 'Retry thất bại.'));
    } finally {
      setBusy(null);
    }
  }

  if (error)
    return (
      <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <Link to="/workshops" className="ml-2 underline">
          ← Tất cả workshops
        </Link>
      </div>
    );
  if (!w) return <div className="text-slate-500">Đang tải…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/workshops" className="text-sm text-brand-600 hover:underline">
            ← Tất cả workshops
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{w.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatDateTime(w.startAt)} → {formatDateTime(w.endAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/workshops/${w.id}/edit`} className="btn-outline">
            Chỉnh sửa
          </Link>
          {w.status === 'DRAFT' && (
            <button className="btn-primary" disabled={busy === 'publish'} onClick={publish}>
              {busy === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
          )}
          {(w.status === 'PUBLISHED' || w.status === 'DRAFT') && (
            <button className="btn-danger" disabled={busy === 'cancel'} onClick={cancelWorkshop}>
              Huỷ
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-5">
            <h2 className="mb-2 text-base font-semibold">Mô tả</h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {w.description}
            </p>
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">AI Summary</h2>
              <span
                className={clsx(
                  'badge',
                  w.summaryStatus === 'READY' && 'bg-emerald-100 text-emerald-800',
                  w.summaryStatus === 'PENDING' && 'bg-amber-100 text-amber-700',
                  w.summaryStatus === 'FAILED' && 'bg-red-100 text-red-700',
                  w.summaryStatus === 'NONE' && 'bg-slate-100 text-slate-600',
                )}
              >
                {w.summaryStatus}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                disabled={busy === 'upload'}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadPdf(f);
                }}
                className="text-sm"
              />
              {w.summaryStatus === 'FAILED' && (
                <button
                  className="btn-outline"
                  disabled={busy === 'retry'}
                  onClick={retrySummary}
                >
                  Retry
                </button>
              )}
            </div>
            {w.summaryStatus === 'READY' && (
              <div className="mt-4 space-y-3">
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {w.summary}
                </p>
                {w.highlights && w.highlights.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {w.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {w.summaryStatus === 'PENDING' && (
              <p className="mt-3 text-xs text-slate-500">
                Worker đang xử lý PDF — auto-refresh mỗi 3 giây.
              </p>
            )}
          </div>
        </div>

        <aside className="space-y-3">
          <Stat label="Phí" value={formatCurrency(w.feeAmount)} />
          <Stat
            label="Ghế còn lại"
            value={`${w.seatsLeft} / ${w.capacity}`}
            sub={`${Math.round(((w.capacity - w.seatsLeft) / Math.max(w.capacity, 1)) * 100)}% đầy`}
          />
          <Stat label="Status" value={w.status} />
          <Stat label="Speaker" value={w.speakerName ?? '—'} />
          <Stat label="Phòng" value={w.roomName ?? '—'} />
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
