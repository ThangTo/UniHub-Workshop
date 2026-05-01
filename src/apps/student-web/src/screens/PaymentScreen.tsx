import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiError } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/format';

interface PaymentDetail {
  id: string;
  registrationId: string;
  amount: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  gatewayTxnId?: string | null;
  createdAt: string;
  finalizedAt?: string | null;
}

/**
 * Trang Payment chỉ phục vụ deep-link sau khi gateway redirect về.
 * Backend tự xử lý webhook → cập nhật registration status.
 * Trang này poll /payments/:id để show kết quả.
 */
export function PaymentScreen() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const r = await api.get<PaymentDetail>(`/payments/${id}`);
        if (cancelled) return;
        setPayment(r.data);
        if (r.data.status === 'PENDING') {
          timer = setTimeout(load, 3000);
        }
      } catch (e) {
        if (!cancelled) setError(apiError(e, 'Không tải được trạng thái thanh toán.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (error)
    return (
      <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <Link to="/me/registrations" className="ml-2 underline">
          ← Đăng ký của tôi
        </Link>
      </div>
    );
  if (!payment) return <div className="text-slate-500">Đang tải…</div>;

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-6">
        <h1 className="text-xl font-bold text-slate-900">Thanh toán #{payment.id.slice(0, 8)}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-slate-500">Số tiền</dt>
          <dd className="font-semibold text-slate-900">{formatCurrency(payment.amount)}</dd>
          <dt className="text-slate-500">Trạng thái</dt>
          <dd>
            <StatusPill status={payment.status} />
          </dd>
          <dt className="text-slate-500">Tạo lúc</dt>
          <dd>{formatDateTime(payment.createdAt)}</dd>
          {payment.finalizedAt && (
            <>
              <dt className="text-slate-500">Hoàn tất</dt>
              <dd>{formatDateTime(payment.finalizedAt)}</dd>
            </>
          )}
          {payment.gatewayTxnId && (
            <>
              <dt className="text-slate-500">Mã giao dịch</dt>
              <dd className="break-all font-mono text-xs text-slate-700">
                {payment.gatewayTxnId}
              </dd>
            </>
          )}
        </dl>
        <div className="mt-6">
          <Link to="/me/registrations" className="btn-primary w-full">
            Về đăng ký của tôi
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: PaymentDetail['status'] }) {
  const map = {
    PENDING: ['bg-amber-100 text-amber-800', 'Đang xử lý'],
    SUCCEEDED: ['bg-emerald-100 text-emerald-800', 'Thành công'],
    FAILED: ['bg-red-100 text-red-700', 'Thất bại'],
    REFUNDED: ['bg-slate-200 text-slate-700', 'Đã hoàn'],
  } as const;
  const [cls, label] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
