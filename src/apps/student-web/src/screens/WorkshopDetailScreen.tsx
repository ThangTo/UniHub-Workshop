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
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load(showSpinner = false) {
      if (showSpinner) setW(null);
      try {
        const r = await api.get<WorkshopDetail>(`/workshops/${id}`);
        if (cancelled) return;
        setW(r.data);
        // Polling summary nếu PENDING — backoff 3s.
        if (r.data.summaryStatus === 'PENDING') {
          timer = setTimeout(() => void load(false), 3000);
        }
      } catch (e) {
        if (!cancelled) setError(apiError(e, 'Không tải được workshop.'));
      }
    }
    void load(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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

        <SummaryCard w={w} />
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

function SummaryCard({ w }: { w: WorkshopDetail }) {
  const status = w.summaryStatus;
  return (
    <div className="card p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Tóm tắt AI</h2>
        <SummaryBadge status={status} />
      </div>
      {status === 'NONE' && (
        <p className="text-sm text-slate-500">
          Ban tổ chức chưa cung cấp tóm tắt cho workshop này.
        </p>
      )}
      {status === 'PENDING' && (
        <p className="text-sm text-slate-500">
          Đang sinh tóm tắt từ tài liệu PDF — sẽ tự động cập nhật sau vài giây.
        </p>
      )}
      {status === 'FAILED' && (
        <p className="text-sm text-red-600">
          Sinh tóm tắt thất bại — ban tổ chức cần thử lại.
        </p>
      )}
      {status === 'READY' && (
        <div className="space-y-4">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{w.summary}</p>
          {w.highlights && w.highlights.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">Điểm nổi bật</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {w.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryBadge({ status }: { status: WorkshopDetail['summaryStatus'] }) {
  const map = {
    NONE: ['bg-slate-100 text-slate-600', 'Chưa có'],
    PENDING: ['bg-amber-100 text-amber-700', 'Đang xử lý'],
    READY: ['bg-emerald-100 text-emerald-700', 'Đã sẵn'],
    FAILED: ['bg-red-100 text-red-700', 'Lỗi'],
  } as const;
  const [cls, label] = map[status] ?? map.NONE;
  return <span className={`badge ${cls}`}>{label}</span>;
}
