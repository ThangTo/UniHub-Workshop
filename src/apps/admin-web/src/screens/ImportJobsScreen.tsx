import { useEffect, useState } from 'react';
import { api, apiError } from '../lib/api';
import type { ImportJob, ImportJobStatus } from '../lib/types';
import { formatDateTime } from '../lib/format';
import clsx from 'clsx';

const STATUS_FILTERS: (ImportJobStatus | 'ALL')[] = ['ALL', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'];

export function ImportJobsScreen() {
  const [items, setItems] = useState<ImportJob[] | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [selected, setSelected] = useState<ImportJob | null>(null);

  async function load() {
    try {
      const url = filter === 'ALL' ? '/admin/import-jobs?limit=100' : `/admin/import-jobs?status=${filter}&limit=100`;
      const r = await api.get<{ items: ImportJob[] } | ImportJob[]>(url);
      setItems(Array.isArray(r.data) ? r.data : r.data.items);
    } catch (e) {
      setError(apiError(e));
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [filter]);

  async function trigger() {
    setTriggering(true);
    try {
      await api.post('/admin/csv-sync/run');
      setTimeout(load, 1500);
    } catch (e) {
      alert(apiError(e));
    } finally {
      setTriggering(false);
    }
  }

  async function openDetail(job: ImportJob) {
    try {
      const r = await api.get<ImportJob>(`/admin/import-jobs/${job.id}`);
      setSelected(r.data);
    } catch (e) {
      alert(apiError(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">CSV import jobs</h1>
          <p className="text-sm text-slate-500">
            Theo dõi các lần đồng bộ sinh viên từ thư mục <code>csv-drop/</code>. Cron tự chạy
            mỗi đêm; nút bên phải để trigger thủ công.
          </p>
        </div>
        <button className="btn-primary" disabled={triggering} onClick={trigger}>
          {triggering ? 'Đang trigger…' : 'Chạy đồng bộ ngay'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={clsx(
              'btn',
              filter === s ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100',
            )}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {!items && !error && <div className="text-slate-500">Đang tải…</div>}
      {items && items.length === 0 && (
        <div className="card p-8 text-center text-slate-500">Chưa có job nào với filter này.</div>
      )}
      {items && items.length > 0 && (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Started</th>
                <th>Finished</th>
                <th className="text-right">Total</th>
                <th className="text-right">Inserted</th>
                <th className="text-right">Updated</th>
                <th className="text-right">Failed</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id} className="hover:bg-slate-50">
                  <td>
                    <div className="font-medium text-slate-900">{j.fileName}</div>
                    <div className="text-xs text-slate-500">sha {j.fileSha256.slice(0, 12)}…</div>
                  </td>
                  <td className="text-xs">{formatDateTime(j.startedAt)}</td>
                  <td className="text-xs">{formatDateTime(j.finishedAt)}</td>
                  <td className="text-right">{j.totalRows ?? '—'}</td>
                  <td className="text-right text-emerald-700">{j.insertedRows ?? '—'}</td>
                  <td className="text-right text-sky-700">{j.updatedRows ?? '—'}</td>
                  <td
                    className={clsx(
                      'text-right',
                      (j.failedRows ?? 0) > 0 ? 'text-red-600' : 'text-slate-500',
                    )}
                  >
                    {j.failedRows ?? '—'}
                  </td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td>
                    <button className="btn-ghost text-xs" onClick={() => openDetail(j)}>
                      Chi tiết
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ErrorLogModal job={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatusBadge({ status }: { status: ImportJobStatus }) {
  const map = {
    RUNNING: 'bg-amber-100 text-amber-700',
    SUCCESS: 'bg-emerald-100 text-emerald-800',
    PARTIAL: 'bg-sky-100 text-sky-800',
    FAILED: 'bg-red-100 text-red-700',
  } as const;
  return <span className={clsx('badge', map[status])}>{status}</span>;
}

function ErrorLogModal({ job, onClose }: { job: ImportJob; onClose(): void }) {
  return (
    <div
      role="dialog"
      className="fixed inset-0 z-30 flex items-start justify-center bg-slate-900/40 p-6 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-3xl max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{job.fileName}</h2>
            <div className="text-xs text-slate-500">
              {formatDateTime(job.startedAt)} → {formatDateTime(job.finishedAt)} · {job.status}
            </div>
          </div>
          <button className="btn-ghost text-xs" onClick={onClose}>
            Đóng
          </button>
        </div>
        {job.errorLog?.reason && (
          <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <strong>{job.errorLog.reason}</strong>
          </div>
        )}
        {job.errorLog?.failedRows && job.errorLog.failedRows.length > 0 ? (
          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-20">Line</th>
                  <th>Reason</th>
                  <th>Raw</th>
                </tr>
              </thead>
              <tbody>
                {job.errorLog.failedRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.line}</td>
                    <td>
                      <code className="text-xs">{r.reason}</code>
                    </td>
                    <td className="font-mono text-xs text-slate-600">{r.raw ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Không có dòng nào lỗi.</p>
        )}
      </div>
    </div>
  );
}
