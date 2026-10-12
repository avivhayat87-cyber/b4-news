// Hebrew labels for everything the CMS shows.
import { CATEGORIES, type DraftColor, type DraftStatus, type Placement, type SocialPlatform, type SourceStatus } from '@b4/shared';

export const categoryName = (slug: string | null | undefined) => CATEGORIES.find((c) => c.slug === slug)?.name ?? 'ללא קטגוריה';

export const DRAFT_STATUS: Record<DraftStatus, { label: string; tone: Tone }> = {
  queued_ai: { label: 'ממתין ל-AI', tone: 'info' },
  ai_processing: { label: 'ה-AI כותב', tone: 'info' },
  ai_failed: { label: 'ה-AI נכשל', tone: 'danger' },
  editing: { label: 'בעריכה', tone: 'warn' },
  text_final: { label: 'טקסט סופי', tone: 'ok' },
  ready: { label: 'מוכן', tone: 'ok' },
  skipped: { label: 'לא לפרסום', tone: 'muted' },
  published: { label: 'פורסם', tone: 'ink' },
};

export const SOURCE_STATUS: Record<SourceStatus, { label: string; tone: Tone }> = {
  pending_dev: { label: 'ממתין למפתח', tone: 'warn' },
  in_development: { label: 'בפיתוח', tone: 'info' },
  active: { label: 'פעיל', tone: 'ok' },
  paused: { label: 'מושהה', tone: 'muted' },
  broken: { label: 'תקול', tone: 'danger' },
  archived: { label: 'בארכיון', tone: 'muted' },
};

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'בתור', tone: 'info' },
  running: { label: 'רץ עכשיו', tone: 'info' },
  succeeded: { label: 'הושלם', tone: 'ok' },
  partial: { label: 'הושלם חלקית', tone: 'warn' },
  failed: { label: 'נכשל', tone: 'danger' },
  cancelled: { label: 'בוטל', tone: 'muted' },
};

export const MAGAZINE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'טיוטה', tone: 'muted' },
  editing: { label: 'בעריכה', tone: 'warn' },
  ready: { label: 'מוכן', tone: 'ok' },
  publishing: { label: 'מתפרסם', tone: 'info' },
  published: { label: 'פורסם', tone: 'ink' },
  partially_failed: { label: 'פורסם חלקית', tone: 'danger' },
  archived: { label: 'בארכיון', tone: 'muted' },
};

export const PLACEMENT: Record<Placement, string> = { main: 'כתבה ראשית', trending: 'חדשות חמות', none: 'קטגוריה בלבד' };

export const COLOR: Record<DraftColor, string> = {
  red: 'אדום',
  orange: 'כתום',
  yellow: 'צהוב',
  green: 'ירוק',
  blue: 'כחול',
  purple: 'סגול',
  gray: 'אפור',
};

export const PLATFORM: Record<SocialPlatform, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
  telegram: 'טלגרם',
  whatsapp: 'וואטסאפ',
  x: 'X',
  tiktok: 'טיקטוק',
};

export const ROLE: Record<string, string> = { admin: 'מנהל/ת', editor: 'עורך/ת', developer: 'מפתח/ת', viewer: 'צפייה בלבד' };

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'ink';

const dateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatTime = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '—');

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return formatDateTime(iso);
}
