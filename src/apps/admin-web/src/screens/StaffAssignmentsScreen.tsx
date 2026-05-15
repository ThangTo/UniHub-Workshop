import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, apiError } from '../lib/api';
import type { StaffAssignment, StaffAssignmentOptions } from '../lib/types';
import { fromLocalInput, formatDateTime } from '../lib/format';
import { formatTimeDraft, normalizeTimeOnBlur } from '../lib/timeInput';
import {
  AssignmentDraft,
  buildAssignmentDraftFromWorkshop,
  joinLocalDateTime,
  splitLocalDateTime,
  validateAssignmentDraft,
} from '../lib/staffAssignmentForm';

export function StaffAssignmentsScreen() {
  const [items, setItems] = useState<StaffAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const r = await api.get<StaffAssignment[] | { items: StaffAssignment[] }>(
        '/staff-assignments',
      );
      setItems(Array.isArray(r.data) ? r.data : r.data.items);
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onDelete(assignment: StaffAssignment) {
    if (!confirm('Xoá phân công này?')) return;
    try {
      const params = new URLSearchParams({
        staffId: assignment.staffId,
        workshopId: assignment.workshopId,
      });
      await api.delete(`/staff-assignments?${params.toString()}`);
      void load();
    } catch (e) {
      alert(apiError(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Phân công CHECKIN_STAFF</h1>
          <p className="text-sm text-slate-500">
            Gán staff trực check-in theo workshop, phòng và khung giờ ca trực.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Phân công mới
        </button>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {showForm && (
        <AssignmentForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}

      {!items && !error && <div className="text-slate-500">Đang tải...</div>}
      {items && items.length === 0 && (
        <div className="card p-8 text-center text-slate-500">Chưa có phân công nào.</div>
      )}
      {items && items.length > 0 && (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Phòng</th>
                <th>Workshop</th>
                <th>Bắt đầu</th>
                <th>Kết thúc</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={`${a.staffId}:${a.workshopId}`}>
                  <td>
                    <div className="font-medium text-slate-900">
                      {a.staff?.fullName ?? a.staffId.slice(0, 8)}
                    </div>
                    <div className="text-xs text-slate-500">{a.staff?.email ?? a.staffId}</div>
                  </td>
                  <td>{a.room ? `${a.room.code} - ${a.room.name}` : a.roomId || '—'}</td>
                  <td className="text-xs text-slate-500">{a.workshop?.title ?? a.workshopId ?? '—'}</td>
                  <td className="text-xs">{formatDateTime(a.startsAt)}</td>
                  <td className="text-xs">{formatDateTime(a.endsAt)}</td>
                  <td>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => onDelete(a)}>
                      Xoá
                    </button>
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

function AssignmentForm({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const [options, setOptions] = useState<StaffAssignmentOptions | null>(null);
  const [form, setForm] = useState<AssignmentDraft>({
    staffId: '',
    roomId: '',
    workshopId: '',
    startsAt: '',
    endsAt: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<StaffAssignmentOptions>('/staff-assignments/options')
      .then((r) => {
        if (cancelled) return;
        setOptions(r.data);
        setError(null);
      })
      .catch((err) => !cancelled && setError(apiError(err, 'Không tải được dữ liệu phân công.')))
      .finally(() => !cancelled && setLoadingOptions(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedWorkshop = useMemo(
    () => options?.workshops.find((w) => w.id === form.workshopId) ?? null,
    [form.workshopId, options?.workshops],
  );

  function update<K extends keyof AssignmentDraft>(key: K, value: AssignmentDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectWorkshop(workshopId: string) {
    const workshop = options?.workshops.find((w) => w.id === workshopId);
    setForm((current) => ({
      ...current,
      ...(workshop
        ? buildAssignmentDraftFromWorkshop(workshop)
        : { workshopId, roomId: '', startsAt: '', endsAt: '' }),
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validateAssignmentDraft(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      await api.post('/staff-assignments', {
        staffId: form.staffId,
        roomId: form.roomId,
        workshopId: form.workshopId,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
      });
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Lưu thất bại.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Phân công mới</h2>
        <button className="btn-ghost text-xs" onClick={onClose}>
          Đóng
        </button>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
        {loadingOptions && (
          <div className="md:col-span-2 text-sm text-slate-500">Đang tải danh sách staff, phòng và workshop...</div>
        )}
        <SearchableSelect
          label="Staff check-in"
          value={form.staffId}
          disabled={loadingOptions}
          placeholder="Chọn staff"
          options={(options?.staff ?? []).map((staff) => ({
            value: staff.id,
            label: `${staff.fullName} — ${staff.email}`,
          }))}
          onChange={(value) => update('staffId', value)}
        />
        <SearchableSelect
          label="Phòng"
          value={form.roomId}
          disabled={loadingOptions}
          placeholder="Chọn phòng"
          options={(options?.rooms ?? []).map((room) => ({
            value: room.id,
            label: `${room.code} — ${room.name} (${room.capacity} chỗ)`,
          }))}
          onChange={(value) => update('roomId', value)}
        />
        <div className="md:col-span-2">
          <SearchableSelect
            label="Workshop"
            value={form.workshopId}
            disabled={loadingOptions}
            placeholder="Chọn workshop"
            options={(options?.workshops ?? []).map((workshop) => ({
              value: workshop.id,
              label: `${workshop.title} — ${formatDateTime(workshop.startAt)}${workshop.roomName ? ` — ${workshop.roomName}` : ''}`,
            }))}
            onChange={selectWorkshop}
          />
          {selectedWorkshop?.roomId && (
            <p className="mt-1 text-xs text-slate-500">
              Đã tự chọn phòng theo workshop. Có thể đổi phòng nếu lịch trực thực tế khác.
            </p>
          )}
        </div>
        <DateTimeField
          label="Bắt đầu ca trực"
          value={form.startsAt}
          onChange={(value) => update('startsAt', value)}
        />
        <DateTimeField
          label="Kết thúc ca trực"
          value={form.endsAt}
          onChange={(value) => update('endsAt', value)}
        />
        {error && (
          <div className="md:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="md:col-span-2 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" className="btn-outline" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" className="btn-primary" disabled={saving || loadingOptions}>
            {saving ? 'Đang lưu...' : 'Tạo'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SearchableSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [query, setQuery] = useState('');
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input mb-2"
        value={query}
        disabled={disabled}
        placeholder="Tìm theo tên, email hoặc mã"
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        className="input"
        required
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {filteredOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
