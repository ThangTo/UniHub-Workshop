import { FormEvent, useEffect, useState } from 'react';
import { api, apiError } from '../lib/api';
import type { StaffAssignment } from '../lib/types';
import { fromLocalInput, toLocalInput, formatDateTime } from '../lib/format';

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
    } catch (e) {
      setError(apiError(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onDelete(id: string) {
    if (!confirm('Xoá phân công này?')) return;
    try {
      await api.delete(`/staff-assignments/${id}`);
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
            Mỗi shift gán staff cho 1 phòng cụ thể trong khoảng thời gian. Check-in batch sẽ
            kiểm tra nếu workshop không thuộc phòng này → cảnh báo wrong_room.
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

      {!items && !error && <div className="text-slate-500">Đang tải…</div>}
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
                <th>Workshop (optional)</th>
                <th>Bắt đầu</th>
                <th>Kết thúc</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="font-medium text-slate-900">{a.staffName ?? a.staffId.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{a.staffId}</div>
                  </td>
                  <td>{a.roomName ?? a.roomId}</td>
                  <td className="text-xs text-slate-500">{a.workshopTitle ?? a.workshopId ?? '—'}</td>
                  <td className="text-xs">{formatDateTime(a.startsAt)}</td>
                  <td className="text-xs">{formatDateTime(a.endsAt)}</td>
                  <td>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => onDelete(a.id)}>
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
  const [staffId, setStaffId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [workshopId, setWorkshopId] = useState('');
  const [startsAt, setStartsAt] = useState(toLocalInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/staff-assignments', {
        staffId,
        roomId,
        workshopId: workshopId || null,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
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
        <div>
          <label className="label">Staff ID (uuid)</label>
          <input className="input" required value={staffId} onChange={(e) => setStaffId(e.target.value)} />
        </div>
        <div>
          <label className="label">Room ID (uuid)</label>
          <input className="input" required value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Workshop ID (optional)</label>
          <input className="input" value={workshopId} onChange={(e) => setWorkshopId(e.target.value)} />
        </div>
        <div>
          <label className="label">Bắt đầu</label>
          <input
            type="datetime-local"
            required
            className="input"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Kết thúc</label>
          <input
            type="datetime-local"
            required
            className="input"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
        {error && (
          <div className="md:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="md:col-span-2 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" className="btn-outline" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Đang lưu…' : 'Tạo'}
          </button>
        </div>
      </form>
    </div>
  );
}
