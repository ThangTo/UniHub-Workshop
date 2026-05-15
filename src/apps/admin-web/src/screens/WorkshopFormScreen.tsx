import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiError } from '../lib/api';
import type { CreateWorkshopInput, WorkshopSummary } from '../lib/types';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { formatTimeDraft, isValidTime24h, normalizeTimeOnBlur } from '../lib/timeInput';

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
      .get<WorkshopSummary>(`/workshops/admin/${id}`)
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
    setError(null);
    const timeError = validateSchedule(form.startAt, form.endAt);
    if (timeError) {
      setError(timeError);
      return;
    }
    setSubmitting(true);
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
            <DateTimeField
              label="Bắt đầu"
              value={form.startAt}
              onChange={(value) => update('startAt', value)}
            />
            <DateTimeField
              label="Kết thúc"
              value={form.endAt}
              onChange={(value) => update('endAt', value)}
            />
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

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const { date, time } = splitLocalDateTime(value);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
        <input
          type="date"
          className="input"
          required
          value={date}
          onChange={(e) => onChange(joinLocalDateTime(e.target.value, time))}
        />
        <input
          type="text"
          className="input font-mono tabular-nums"
          required
          inputMode="numeric"
          maxLength={5}
          placeholder="22:00"
          aria-label={`${label} - giờ 24h`}
          value={time}
          onChange={(e) => onChange(joinLocalDateTime(date, formatTimeDraft(e.target.value)))}
          onBlur={(e) => onChange(joinLocalDateTime(date, normalizeTimeOnBlur(e.target.value)))}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">Giờ 24h, ví dụ 09:30 hoặc 22:00.</p>
    </div>
  );
}

function splitLocalDateTime(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time: time.slice(0, 5) };
}

function joinLocalDateTime(date: string, time: string): string {
  if (!date && !time) return '';
  return `${date}T${time}`;
}

function isCompleteLocalDateTime(value: string): boolean {
  const { date, time } = splitLocalDateTime(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return isValidTime24h(time);
}

function validateSchedule(startAt: string, endAt: string): string | null {
  if (!isCompleteLocalDateTime(startAt) || !isCompleteLocalDateTime(endAt)) {
    return 'Vui lòng nhập đầy đủ ngày và giờ theo định dạng 24h HH:mm.';
  }
  if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    return 'Thời gian kết thúc phải sau thời gian bắt đầu.';
  }
  return null;
}
