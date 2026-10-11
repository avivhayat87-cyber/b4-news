const TZ = 'Asia/Jerusalem';

const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const todayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

/** "09:40" for today, "8 באוקטובר 2026" for earlier days. */
export function formatPublished(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return dayKeyFmt.format(date) === dayKeyFmt.format(now) ? timeFmt.format(date) : dateFmt.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${dateFmt.format(date)} · ${timeFmt.format(date)}`;
}

export function formatToday(now = new Date()): string {
  return todayFmt.format(now);
}
