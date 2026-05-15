export function formatTimeDraft(input: string): string {
  const clean = input.replace(/[^\d:]/g, '');
  if (clean.includes(':')) {
    const [hours = '', minutes = ''] = clean.split(':');
    return `${hours.slice(0, 2)}:${minutes.slice(0, 2)}`;
  }

  const digits = clean.slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function normalizeTimeOnBlur(input: string): string {
  const clean = input.trim();
  if (!clean) return '';

  if (clean.includes(':')) {
    const [rawHours = '', rawMinutes = ''] = clean.split(':');
    const hours = rawHours.replace(/\D/g, '');
    const minutes = rawMinutes.replace(/\D/g, '');
    if (!hours) return '';
    return `${hours.padStart(2, '0').slice(-2)}:${(minutes || '0').padStart(2, '0').slice(0, 2)}`;
  }

  const digits = clean.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 2) return `${digits.padStart(2, '0')}:00`;
  if (digits.length === 3) return `0${digits[0]}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

export function isValidTime24h(time: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}
