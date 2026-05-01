/** Định dạng VND. */
export function formatCurrency(amount: number): string {
  if (amount === 0) return 'Miễn phí';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** "08:00 — 12:00, 25/04/2026" hoặc cross-day fallback. */
export function formatDateRange(startISO: string, endISO: string): string {
  try {
    const s = new Date(startISO);
    const e = new Date(endISO);
    const sameDay =
      s.getFullYear() === e.getFullYear() &&
      s.getMonth() === e.getMonth() &&
      s.getDate() === e.getDate();
    const dateFmt = new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const timeFmt = new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    if (sameDay) {
      return `${timeFmt.format(s)} — ${timeFmt.format(e)} · ${dateFmt.format(s)}`;
    }
    return `${dateFmt.format(s)} ${timeFmt.format(s)} → ${dateFmt.format(e)} ${timeFmt.format(e)}`;
  } catch {
    return `${startISO} — ${endISO}`;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
