import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, apiError, newIdempotencyKey } from '../lib/api';
import type { MyRegistration, PaymentInitResponse, RegistrationStatus } from '../lib/types';
import { formatCurrency, formatDateRange, formatDateTime } from '../lib/format';
import clsx from 'clsx';

export function MyRegistrationsScreen() {
  const location = useLocation();
  const highlightId = (location.state as { highlightId?: string } | null)?.highlightId;
  const [items, setItems] = useState<MyRegistration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reloadRegistrations() {
    const r = await api.get<MyRegistration[]>('/me/registrations');
    setItems(r.data);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.get<MyRegistration[]>('/me/registrations');
        if (!cancelled) setItems(r.data);
      } catch (e) {
        if (!cancelled) setError(apiError(e, 'Không tải được danh sách đăng ký.'));
      }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  async function onPay(reg: MyRegistration) {
    try {
      const r = await api.post<PaymentInitResponse>(
        '/payments',
        { registrationId: reg.id },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      if (r.data.redirectUrl) {
        window.location.href = r.data.redirectUrl;
        return;
      }
      if (r.data.status === 'success') {
        await reloadRegistrations();
        alert('Thanh toán thành công. QR check-in đã sẵn sàng.');
        return;
      }
      if (r.data.paymentId) {
        await reloadRegistrations();
        window.location.href = `/payments/${r.data.paymentId}`;
      }
    } catch (e) {
      alert(apiError(e, 'Khởi tạo thanh toán thất bại.'));
    }
  }

  async function onCancel(reg: MyRegistration) {
    if (!confirm(`Huỷ đăng ký "${reg.workshopTitle}"?`)) return;
    try {
      await api.delete(`/registrations/${reg.id}`);
      setItems((arr) =>
        arr ? arr.map((r) => (r.id === reg.id ? { ...r, status: 'CANCELLED' as const } : r)) : arr,
      );
    } catch (e) {
      alert(apiError(e, 'Huỷ thất bại.'));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Đăng ký của tôi</h1>
        <p className="text-sm text-slate-500">
          QR sẽ hiển thị sau khi đăng ký được xác nhận (paid hoặc free).
        </p>
      </div>

      {error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!items && !error && <div className="text-slate-500">Đang tải…</div>}
      {items?.length === 0 && (
        <div className="card p-6 text-center text-slate-500">
          Bạn chưa đăng ký workshop nào.{' '}
          <Link to="/workshops" className="text-brand-600 underline">
            Khám phá ngay
          </Link>
          .
        </div>
      )}

      <div className="space-y-4">
        {items?.map((r) => (
          <RegistrationCard
            key={r.id}
            reg={r}
            highlight={r.id === highlightId}
            onPay={() => onPay(r)}
            onCancel={() => onCancel(r)}
          />
        ))}
      </div>
    </div>
  );
}

function RegistrationCard({
  reg,
  highlight,
  onPay,
  onCancel,
}: {
  reg: MyRegistration;
  highlight?: boolean;
  onPay(): void;
  onCancel(): void;
}) {
  const isPending = reg.status === 'PENDING_PAYMENT';
  const isConfirmed = reg.status === 'CONFIRMED';
  const isWaitlist = reg.status === 'WAITLIST';

  return (
    <div
      className={clsx(
        'card p-5 transition',
        highlight && 'ring-2 ring-brand-400 ring-offset-2',
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/workshops/${reg.workshopId}`}
              className="text-base font-semibold text-slate-900 hover:underline"
            >
              {reg.workshopTitle}
            </Link>
            <StatusBadge status={reg.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">{formatDateRange(reg.startAt, reg.endAt)}</p>
          <p className="mt-1 text-sm text-slate-500">
            Phí: <span className="font-medium">{formatCurrency(reg.feeAmount)}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          {isPending && (
            <button className="btn-primary" onClick={onPay}>
              Thanh toán
            </button>
          )}
          {(isPending || isConfirmed || isWaitlist) && (
            <button className="btn-outline text-red-600" onClick={onCancel}>
              Huỷ đăng ký
            </button>
          )}
        </div>
      </div>

      {isConfirmed && reg.qrToken && <QrPanel token={reg.qrToken} />}
    </div>
  );
}

function StatusBadge({ status }: { status: RegistrationStatus }) {
  const map: Record<RegistrationStatus, [string, string]> = {
    PENDING_PAYMENT: ['bg-amber-100 text-amber-800', 'Chờ thanh toán'],
    CONFIRMED: ['bg-emerald-100 text-emerald-800', 'Đã xác nhận'],
    CANCELLED: ['bg-slate-200 text-slate-600', 'Đã huỷ'],
    EXPIRED: ['bg-slate-200 text-slate-600', 'Hết hạn'],
    WAITLIST: ['bg-sky-100 text-sky-800', 'Danh sách chờ'],
  };
  const [cls, label] = map[status] ?? map.CANCELLED;
  return <span className={`badge ${cls}`}>{label}</span>;
}

function QrPanel({ token }: { token: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState('Copy token');

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function copyToken() {
    await navigator.clipboard.writeText(token);
    setCopyLabel('Copied');
    window.setTimeout(() => setCopyLabel('Copy token'), 1500);
  }

  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          QR Token (xuất trình tại cửa)
        </span>
        <span className="text-xs text-slate-500">Cập nhật: {formatDateTime(new Date().toISOString())}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-[240px_minmax(0,1fr)] sm:items-center">
        <div className="flex h-60 w-60 items-center justify-center rounded bg-white p-3 shadow-sm">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR check-in" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-slate-500">Đang tạo QR...</span>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-sm text-slate-600">
            Xuất trình mã này cho nhân viên check-in tại cửa workshop.
          </p>
          <code className="block max-h-24 overflow-auto break-all rounded bg-white p-2 text-xs text-slate-700">
            {token}
          </code>
          <button type="button" className="btn-outline" onClick={copyToken}>
            {copyLabel}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Mã được ký bằng RS256, có hạn từ 1 giờ trước khi workshop bắt đầu đến 1 giờ sau khi kết
        thúc. Mở app mobile để hiển thị QR scan-friendly.
      </p>
    </div>
  );
}
