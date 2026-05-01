import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiError } from '../lib/api';
import type { CreateWorkshopInput, WorkshopSummary } from '../lib/types';
import { fromLocalInput, toLocalInput } from '../lib/format';

export function WorkshopFormScreen({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState<CreateWorkshopInput>({
    title: '',
    description: '',
    startAt: '',
    endAt: '',
    capacity: 40,
    feeAmount: 0,
    speakerId: null,
    roomId: null,
  });
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(mode === 'edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    let cancelled = false;
    api
      .get<WorkshopSummary>(`/workshops/${id}`)
      .then((r) => {
        if (cancelled) return;
        setForm({
          title: r.data.title,
          description: r.data.description,
          startAt: toLocalInput(r.data.startAt),
          endAt: toLocalInput(r.data.endAt),
          capacity: r.data.capacity,
          feeAmount: r.data.feeAmount,
          speakerId: r.data.speakerId ?? null,
          roomId: r.data.roomId ?? null,
        });
        setVersion(r.data.version ?? null);
      })
      .catch((e) => !cancelled && setError(apiError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, mode]);

  function update<K extends keyof CreateWorkshopInput>(key: K, val: CreateWorkshopInput[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        ...form,
        startAt: fromLocalInput(form.startAt),
        endAt: fromLocalInput(form.endAt),
        speakerId: form.speakerId || null,
        roomId: form.roomId || null,
      };
      if (mode === 'create') {
        const r = await api.post<{ id: string }>('/workshops', payload);
        navigate(`/workshops/${r.data.id}`, { replace: true });
      } else if (id) {
        await api.patch(`/workshops/${id}`, payload, {
          headers: version != null ? { 'If-Match': String(version) } : {},
        });
        navigate(`/workshops/${id}`, { replace: true });
      }
    } catch (err) {
      setError(apiError(err, 'Lưu thất bại.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-slate-500">Đang tải…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/workshops" className="text-sm text-brand-600 hover:underline">
        ← Tất cả workshops
      </Link>
      <div className="card p-6">
        <h1 className="mb-4 text-xl font-bold text-slate-900">
          {mode === 'create' ? 'Tạo workshop mới' : 'Chỉnh sửa workshop'}
        </h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Tiêu đề</label>
            <input
              className="input"
              required
              maxLength={255}
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Mô tả</label>
            <textarea
              className="input min-h-32"
              rows={5}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Bắt đầu</label>
              <input
                type="datetime-local"
                className="input"
                required
                value={form.startAt}
                onChange={(e) => update('startAt', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Kết thúc</label>
              <input
                type="datetime-local"
                className="input"
                required
                value={form.endAt}
                onChange={(e) => update('endAt', e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Sức chứa</label>
              <input
                type="number"
                min={1}
                max={1000}
                className="input"
                required
                value={form.capacity}
                onChange={(e) => update('capacity', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Phí (VND)</label>
              <input
                type="number"
                min={0}
                step={1000}
                className="input"
                value={form.feeAmount}
                onChange={(e) => update('feeAmount', Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Speaker ID</label>
              <input
                className="input"
                placeholder="(uuid, optional)"
                value={form.speakerId ?? ''}
                onChange={(e) => update('speakerId', e.target.value || null)}
              />
            </div>
            <div>
              <label className="label">Room ID</label>
              <input
                className="input"
                placeholder="(uuid, optional)"
                value={form.roomId ?? ''}
                onChange={(e) => update('roomId', e.target.value || null)}
              />
            </div>
          </div>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <Link to="/workshops" className="btn-outline">
              Huỷ
            </Link>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Đang lưu…' : mode === 'create' ? 'Tạo' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
