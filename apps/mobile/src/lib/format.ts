const TZ = 'Asia/Jerusalem';

function safeFormat(opts: Intl.DateTimeFormatOptions, date: Date): string {
  try {
    return new Intl.DateTimeFormat('he-IL', { ...opts, timeZone: TZ }).format(date);
  } catch {
    return new Intl.DateTimeFormat('he-IL', opts).format(date);
  }
}

/** "09:40" today, "8 באוקטובר" earlier. */
export function formatPublished(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameDay = safeFormat({ year: 'numeric', month: 'numeric', day: 'numeric' }, date) === safeFormat({ year: 'numeric', month: 'numeric', day: 'numeric' }, now);
  return sameDay
    ? safeFormat({ hour: '2-digit', minute: '2-digit', hour12: false }, date)
    : safeFormat({ day: 'numeric', month: 'long' }, date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${safeFormat({ day: 'numeric', month: 'long', year: 'numeric' }, date)} · ${safeFormat({ hour: '2-digit', minute: '2-digit', hour12: false }, date)}`;
}

export function relativeTime(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
  if (abs < 60) return 'עכשיו';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}
