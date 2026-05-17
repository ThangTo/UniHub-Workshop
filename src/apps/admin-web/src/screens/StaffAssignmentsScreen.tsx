import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, apiError } from '../lib/api';
import type { AdminUser, StaffAssignment, WorkshopSummary } from '../lib/types';
import { fromLocalInput, toLocalInput, formatDateTime } from '../lib/format';

export function StaffAssignmentsScreen() {
  const [items, setItems] = useState<StaffAssignment[] | null>(null);
  const [staffOptions, setStaffOptions] = useState<AdminUser[]>([]);
  const [workshopOptions, setWorkshopOptions] = useState<WorkshopSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
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

  async function loadOptions() {
    setLoadingOptions(true);
    try {
      const [users, workshops] = await Promise.all([
        api.get<{ items: AdminUser[] }>('/staff-assignments/staff-options'),
        api.get<{ items: WorkshopSummary[] } | WorkshopSummary[]>('/workshops/admin/list?limit=100'),
      ]);
      setStaffOptions(
        users.data.items
          .filter((user) => user.isActive && user.roles.includes('CHECKIN_STAFF'))
          .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      );

      const workshopList = Array.isArray(workshops.data) ? workshops.data : workshops.data.items;
      setWorkshopOptions(workshopList);
      setOptionsError(null);
    } catch (e) {
      setOptionsError(apiError(e, 'Không tải được danh sách nhân viên hoặc workshop.'));
    } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => {
    void load();
    void loadOptions();
  }, []);

  async function onDelete(assignment: StaffAssignment) {
    if (!confirm('Xóa phân công này?')) return;
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
          <h1 className="text-2xl font-bold text-slate-900">Phân công nhân viên check-in</h1>
          <p className="text-sm text-slate-500">
            Chọn nhân viên, workshop và thời gian trực để cấp quyền quét QR.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Phân công mới
        </button>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {optionsError && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          {optionsError}
        </div>
      )}

      {showForm && (
        <AssignmentForm
          loadingOptions={loadingOptions}
          staffOptions={staffOptions}
          workshopOptions={workshopOptions}
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
                <th>Nhân viên</th>
                <th>Workshop</th>
                <th>Bắt đầu</th>
                <th>Kết thúc</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((assignment) => (
                <tr key={`${assignment.staffId}:${assignment.workshopId}`}>
                  <td>
                    <div className="font-medium text-slate-900">
                      {assignment.staff?.fullName ?? assignment.staffId.slice(0, 8)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {assignment.staff?.email ?? assignment.staffId}
                    </div>
                  </td>
                  <td className="text-xs text-slate-500">
                    {assignment.workshop?.title ?? assignment.workshopId}
                  </td>
                  <td className="text-xs">{formatDateTime(assignment.startsAt)}</td>
                  <td className="text-xs">{formatDateTime(assignment.endsAt)}</td>
                  <td>
                    <button
                      className="btn-ghost text-xs text-red-600"
                      onClick={() => onDelete(assignment)}
                    >
                      Xóa
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

function AssignmentForm({
  loadingOptions,
  staffOptions,
  workshopOptions,
  onClose,
  onSaved,
}: {
  loadingOptions: boolean;
  staffOptions: AdminUser[];
  workshopOptions: WorkshopSummary[];
  onClose(): void;
  onSaved(): void;
}) {
  const [staffId, setStaffId] = useState('');
  const [workshopId, setWorkshopId] = useState('');
  const [startsAt, setStartsAt] = useState(toLocalInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedWorkshop = useMemo(
    () => workshopOptions.find((workshop) => workshop.id === workshopId),
    [workshopId, workshopOptions],
  );

  useEffect(() => {
    if (!staffId && staffOptions.length > 0) {
      setStaffId(staffOptions[0].id);
    }
  }, [staffId, staffOptions]);

  useEffect(() => {
    if (!workshopId && workshopOptions.length > 0) {
      setWorkshopId(workshopOptions[0].id);
    }
  }, [workshopId, workshopOptions]);

  useEffect(() => {
    if (!selectedWorkshop) {
      return;
    }
    setStartsAt(toLocalInput(selectedWorkshop.startAt));
    setEndsAt(toLocalInput(selectedWorkshop.endAt));
  }, [selectedWorkshop]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedWorkshop) return;

    setSaving(true);
    setError(null);
    try {
      await api.post('/staff-assignments', {
        staffId,
        workshopId,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
      });
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Lưu phân công thất bại.'));
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
          <label className="label">Nhân viên check-in</label>
          <select
            className="input"
            required
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            disabled={loadingOptions || staffOptions.length === 0}
          >
            {staffOptions.length === 0 ? (
              <option value="">Không có nhân viên check-in</option>
            ) : (
              staffOptions.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.fullName} - {staff.email}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label className="label">Workshop</label>
          <select
            className="input"
            required
            value={workshopId}
            onChange={(e) => setWorkshopId(e.target.value)}
            disabled={loadingOptions || workshopOptions.length === 0}
          >
            {workshopOptions.length === 0 ? (
              <option value="">Không có workshop</option>
            ) : (
              workshopOptions.map((workshop) => (
                <option key={workshop.id} value={workshop.id}>
                  {workshop.title} - {formatDateTime(workshop.startAt)}
                </option>
              ))
            )}
          </select>
          {selectedWorkshop && (
            <p className="mt-1 text-xs text-slate-500">
              {selectedWorkshop.status} - {formatDateTime(selectedWorkshop.startAt)} đến{' '}
              {formatDateTime(selectedWorkshop.endAt)}
            </p>
          )}
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
            Hủy
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || loadingOptions || !staffId || !workshopId}
          >
            {saving ? 'Đang lưu...' : 'Tạo phân công'}
          </button>
        </div>
      </form>
    </div>
  );
}
