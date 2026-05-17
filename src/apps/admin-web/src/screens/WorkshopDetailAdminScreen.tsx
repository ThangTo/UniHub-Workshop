import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiError } from '../lib/api';
import type { CreateWorkshopInput, RoomOption, SpeakerOption, WorkshopFormOptions, WorkshopSummary } from '../lib/types';
import { formatCurrency, formatDateTime, fromLocalInput, toLocalInput } from '../lib/format';
import clsx from 'clsx';

const WORKSHOP_EDIT_FORM_ID = 'workshop-edit-form';

const emptyForm: CreateWorkshopInput = {
  title: '',
  description: '',
  startAt: '',
  endAt: '',
  capacity: 40,
  feeAmount: 0,
  speakerId: null,
  roomId: null,
};

export function WorkshopDetailAdminScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [w, setW] = useState<WorkshopSummary | null>(null);
  const [form, setForm] = useState<CreateWorkshopInput>(emptyForm);
  const [version, setVersion] = useState<number | null>(null);
  const [speakerOptions, setSpeakerOptions] = useState<SpeakerOption[]>([]);
  const [roomOptions, setRoomOptions] = useState<RoomOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function applyWorkshop(workshop: WorkshopSummary) {
    setW(workshop);
    setVersion(workshop.version ?? null);
    setForm({
      title: workshop.title,
      description: workshop.description,
      startAt: toLocalInput(workshop.startAt),
      endAt: toLocalInput(workshop.endAt),
      capacity: workshop.capacity,
      feeAmount: workshop.feeAmount,
      speakerId: workshop.speakerId ?? null,
      roomId: workshop.roomId ?? null,
    });
  }

  async function refreshWorkshop() {
    if (!id) return;
    const r = await api.get<WorkshopSummary>(`/workshops/admin/${id}`);
    applyWorkshop(r.data);
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const r = await api.get<WorkshopSummary>(`/workshops/admin/${id}`);
        if (cancelled) return;
        applyWorkshop(r.data);
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

  useEffect(() => {
    let cancelled = false;
    api
      .get<WorkshopFormOptions>('/workshop-form-options')
      .then((r) => {
        if (cancelled) return;
        setSpeakerOptions(r.data.speakers);
        setRoomOptions(r.data.rooms);
        setOptionsError(null);
      })
      .catch((e) => !cancelled && setOptionsError(apiError(e, 'Không tải được danh sách speaker/phòng.')));
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof CreateWorkshopInput>(key: K, val: CreateWorkshopInput[K]) {
    setSaveMessage(null);
    setForm((current) => ({ ...current, [key]: val }));
  }

  async function saveWorkshop(e: FormEvent) {
    e.preventDefault();
    if (!id) return;

    setBusy('save');
    setFormError(null);
    setSaveMessage(null);
    try {
      await api.patch(
        `/workshops/${id}`,
        {
          ...form,
          startAt: fromLocalInput(form.startAt),
          endAt: fromLocalInput(form.endAt),
          speakerId: form.speakerId || null,
          roomId: form.roomId || null,
        },
        {
          headers: version != null ? { 'If-Match': String(version) } : {},
        },
      );
      await refreshWorkshop();
      setSaveMessage('Đã lưu thay đổi workshop thành công.');
    } catch (err) {
      setFormError(apiError(err, 'Lưu thay đổi thất bại.'));
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!id) return;
    setBusy('publish');
    try {
      await api.post(`/workshops/${id}/publish`);
      await refreshWorkshop();
    } catch (e) {
      alert(apiError(e, 'Publish thất bại.'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelWorkshop() {
    if (!id) return;
    const reason = prompt('Lý do hủy?') || '';
    if (!reason) return;
    setBusy('cancel');
    try {
      await api.post(`/workshops/${id}/cancel`, { reason });
      await refreshWorkshop();
    } catch (e) {
      alert(apiError(e, 'Hủy thất bại.'));
    } finally {
      setBusy(null);
    }
  }

  async function deleteWorkshop() {
    if (!id || !w) return;
    const ok = confirm(
      `Xóa vĩnh viễn workshop "${w.title}"?\n\nTất cả đăng ký, thanh toán, check-in và phân công staff liên quan cũng sẽ bị xóa. Thao tác này không thể hoàn tác.`,
    );
    if (!ok) return;

    setBusy('delete');
    try {
      await api.delete(`/workshops/${id}`);
      navigate('/workshops', { replace: true });
    } catch (e) {
      alert(apiError(e, 'Xóa workshop thất bại.'));
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
      await refreshWorkshop();
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
      await refreshWorkshop();
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
  if (!w) return <div className="text-slate-500">Đang tải...</div>;

  const selectedSpeakerMissing =
    !!form.speakerId && !speakerOptions.some((speaker) => speaker.id === form.speakerId);
  const selectedRoomMissing =
    !!form.roomId && !roomOptions.some((room) => room.id === form.roomId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
          {w.status === 'DRAFT' && (
            <button className="btn-primary" disabled={busy === 'publish'} onClick={publish}>
              {busy === 'publish' ? 'Đang publish...' : 'Publish'}
            </button>
          )}
          {(w.status === 'PUBLISHED' || w.status === 'DRAFT') && (
            <button className="btn-outline" disabled={busy === 'cancel'} onClick={cancelWorkshop}>
              {busy === 'cancel' ? 'Đang hủy...' : 'Hủy workshop'}
            </button>
          )}
          <button
            type="submit"
            form={WORKSHOP_EDIT_FORM_ID}
            className="btn-primary"
            disabled={busy === 'save'}
          >
            {busy === 'save' ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
          <button className="btn-danger" disabled={busy === 'delete'} onClick={deleteWorkshop}>
            {busy === 'delete' ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <div className="card p-6">
            <h2 className="mb-4 text-base font-semibold">Thông tin workshop</h2>
            <form id={WORKSHOP_EDIT_FORM_ID} onSubmit={saveWorkshop} className="space-y-4">
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
                  <label className="label">Diễn giả</label>
                  <select
                    className="input"
                    value={form.speakerId ?? ''}
                    onChange={(e) => update('speakerId', e.target.value || null)}
                  >
                    <option value="">Chưa chọn diễn giả</option>
                    {selectedSpeakerMissing && (
                      <option value={form.speakerId ?? ''}>
                        {w.speakerName ?? 'Diễn giả hiện tại'}
                      </option>
                    )}
                    {speakerOptions.map((speaker) => (
                      <option key={speaker.id} value={speaker.id}>
                        {speaker.name}
                        {speaker.title ? ` - ${speaker.title}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Phòng</label>
                  <select
                    className="input"
                    value={form.roomId ?? ''}
                    onChange={(e) => update('roomId', e.target.value || null)}
                  >
                    <option value="">Chưa chọn phòng</option>
                    {selectedRoomMissing && (
                      <option value={form.roomId ?? ''}>{w.roomName ?? 'Phòng hiện tại'}</option>
                    )}
                    {roomOptions.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.code} - {room.name} ({room.capacity} chỗ)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {formError && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}
              {optionsError && (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {optionsError}
                </div>
              )}
              {saveMessage && (
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                  {saveMessage}
                </div>
              )}
            </form>
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
                <button className="btn-outline" disabled={busy === 'retry'} onClick={retrySummary}>
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
                Worker đang xử lý PDF, trang sẽ tự cập nhật mỗi 3 giây.
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
