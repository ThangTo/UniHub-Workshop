import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, apiError, newIdempotencyKey } from '../lib/api';
import type { WorkshopDetail } from '../lib/types';
import { formatCurrency, formatDateRange } from '../lib/format';

export function WorkshopDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [w, setW] = useState<WorkshopDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerErr, setRegisterErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load(showSpinner = false) {
      if (showSpinner) setW(null);
      try {
        const r = await api.get<WorkshopDetail>(`/workshops/${id}`);
        if (cancelled) return;
        setW(r.data);
      } catch (e) {
        if (!cancelled) setError(apiError(e, 'Không tải được workshop.'));
      }
    }
    void load(true);
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function onRegister() {
    if (!w) return;
    setRegistering(true);
    setRegisterErr(null);
    try {
      const r = await api.post<{ registrationId: string; status: string; paymentRequired: boolean }>(
        '/registrations',
        { workshopId: w.id },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      // Sau khi tạo đăng ký, chuyển qua trang my registrations để student thấy QR / payment link.
      navigate('/me/registrations', {
        replace: false,
        state: { highlightId: r.data.registrationId },
      });
    } catch (e) {
      setRegisterErr(apiError(e, 'Đăng ký thất bại — có thể đã hết ghế.'));
    } finally {
      setRegistering(false);
    }
  }

  if (error)
    return (
      <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <Link to="/workshops" className="ml-2 underline">
          ← Quay lại danh sách
        </Link>
      </div>
    );
  if (!w) return <div className="text-slate-500">Đang tải…</div>;

  const seatsLeft = w.seatsLeft;
  const isFull = seatsLeft <= 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card p-6">
          <Link to="/workshops" className="text-sm text-brand-600 hover:underline">
            ← Tất cả workshop
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{w.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{formatDateRange(w.startAt, w.endAt)}</p>
          {(w.speakerName || w.roomName) && (
            <p className="mt-1 text-sm text-slate-500">
              {w.speakerName ? `🎤 ${w.speakerName}` : null}
              {w.speakerName && w.roomName ? ' · ' : ''}
              {w.roomName ? `📍 ${w.roomName}` : null}
            </p>
          )}
          <div className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {w.description}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card sticky top-4 p-6">
          <div className="text-xs uppercase tracking-wider text-slate-500">Phí tham gia</div>
          <div className="mt-1 text-2xl font-bold text-brand-700">{formatCurrency(w.feeAmount)}</div>
          <div className="mt-4 text-sm text-slate-600">
            <span className="font-medium">{seatsLeft}</span> / {w.capacity} ghế còn lại
          </div>
          <button
            className="btn-primary mt-4 w-full"
            disabled={registering || isFull || w.status !== 'PUBLISHED'}
            onClick={onRegister}
          >
            {registering
              ? 'Đang đăng ký…'
              : isFull
                ? 'Hết ghế'
                : w.status !== 'PUBLISHED'
                  ? 'Workshop chưa mở đăng ký'
                  : 'Đăng ký ngay'}
          </button>
          {registerErr && (
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {registerErr}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
