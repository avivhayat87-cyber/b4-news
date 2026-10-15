'use client';
// What is free and what is taken. Every place sells a few rotation positions (a place of 4 sells
// quarters), and the ads in it take turns. The board shows each place, day by day: how many
// positions are taken and by whom, and what waits for approval. The campaign form asks the same
// question for its own places, dates, sections and devices. The counting is in @b4/shared, the
// same code the server checks with before a campaign runs.
import {
  AD_ROTATE_SECONDS,
  AD_SLOTS,
  APP_AD_SLOTS,
  type AdAvailabilityDto,
  type AdBooking,
  type AdSettings,
  type AdSlot,
  MAX_AD_POSITIONS,
  addDays,
  bookingDays,
  dayRanges,
  occupancy,
  placeFit,
} from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { admin } from '@/lib/api';
import { AD_ROTATE, AD_SLOT, AD_STATUS, adShare } from '@/lib/labels';
import { Badge, Button, Card, ErrorBox, Loading, cx, inputClass } from '../ui';

export const useAvailability = () => useQuery({ queryKey: ['ads', 'availability'], queryFn: () => admin.get<AdAvailabilityDto>('/ads/availability') });

const isApp = (slot: AdSlot) => (APP_AD_SLOTS as readonly AdSlot[]).includes(slot);
const WEEK = 7;
const shortDay = (day: string) => `${Number(day.slice(8))}.${Number(day.slice(5, 7))}`;
const weekday = (day: string) => new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** A cell's look: free, partly taken, full. */
function tone(booked: number, positions: number) {
  if (booked === 0) return 'bg-white text-muted ring-line';
  if (booked < positions) return 'bg-warn-soft text-warn ring-warn/30';
  return 'bg-brand-soft text-brand-deep ring-brand/40';
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function OccupancyBoard() {
  const query = useAvailability();
  const [week, setWeek] = useState(0);
  const [picked, setPicked] = useState<{ slot: AdSlot; day: string } | null>(null);
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const { today, places, bookings } = query.data;
  const days = Array.from({ length: WEEK }, (_, i) => addDays(today, week * WEEK + i));
  const size = (slot: AdSlot) => places.find((p) => p.slot === slot)?.positions ?? 1;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        כל מקום מחולק למשבצות שמתחלפות ביניהן (ההגדרה בלשונית &quot;הגדרות&quot;). כל קמפיין קונה כמה משבצות: במקום של 4, משבצת אחת היא רבע מהחשיפות. משבצת שלא נמכרה מציגה את הבאנר &quot;פרסמו אצלנו&quot;. קמפיין לא יאושר אם אין לו מקום. לוחצים על יום כדי לראות מי שם.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={week === 0} onClick={() => setWeek(week - 1)}>
          → שבוע קודם
        </Button>
        <Button size="sm" variant="ghost" disabled={week === 0} onClick={() => setWeek(0)}>
          היום
        </Button>
        <Button size="sm" onClick={() => setWeek(week + 1)}>
          שבוע הבא ←
        </Button>
        <span className="text-sm font-bold">
          {shortDay(days[0]!)}–{shortDay(days[WEEK - 1]!)}
        </span>
        <span className="mr-auto flex flex-wrap items-center gap-2 text-xs text-muted">
          <Legend className={tone(0, 4)} text="פנוי" />
          <Legend className={tone(1, 4)} text="חלקית" />
          <Legend className={tone(4, 4)} text="מלא" />
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-info" /> ממתין לאישור
          </span>
        </span>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-7 gap-1 px-3 text-center text-[11px] text-muted" aria-hidden>
          {days.map((d) => (
            <span key={d} className={cx(d === today && 'font-bold text-ink')}>
              {weekday(d)}
              <span className="block">{shortDay(d)}</span>
            </span>
          ))}
        </div>
        {AD_SLOTS.map((slot) => {
          const place = places.find((p) => p.slot === slot)!;
          return (
            <section key={slot} className="rounded-lg bg-white p-3 ring-1 ring-line" aria-label={AD_SLOT[slot].name}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="font-bold">{AD_SLOT[slot].name}</h3>
                <span className="text-xs text-muted">
                  {place.positions} משבצות · {isApp(slot) ? 'אחת בכל צפייה' : AD_ROTATE[place.rotateSeconds]}
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const o = occupancy(bookings, slot, day, place.positions);
                  const on = picked?.slot === slot && picked.day === day;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setPicked(on ? null : { slot, day })}
                      aria-pressed={on}
                      aria-label={`${AD_SLOT[slot].name}, ${shortDay(day)}: תפוסות ${o.booked} מתוך ${place.positions}${o.waiting ? `, ${o.waiting} ממתינות לאישור` : ''}`}
                      className={cx('relative h-10 rounded text-xs font-bold ring-1 transition', tone(o.booked, place.positions), on && 'ring-2 ring-ink')}
                    >
                      {o.booked >= place.positions ? 'מלא' : `${o.booked}/${place.positions}`}
                      {o.waiting > 0 && <span className="absolute left-1 top-1 size-2 rounded-full bg-info" />}
                    </button>
                  );
                })}
              </div>
              {picked?.slot === slot && <DayDetail bookings={bookings} slot={slot} day={picked.day} positions={size(slot)} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cx('size-3 rounded-sm ring-1', className)} />
      {text}
    </span>
  );
}

/** Who holds a place on a day: each campaign, its share, its sections, and what is still free. */
function DayDetail({ bookings, slot, day, positions }: { bookings: AdBooking[]; slot: AdSlot; day: string; positions: number }) {
  const o = occupancy(bookings, slot, day, positions);
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-stone p-3 text-sm">
      <p className="font-bold">
        {shortDay(day)}: {o.booked >= positions ? 'המקום מלא' : `פנויות ${o.free} מתוך ${positions} משבצות`}
        {o.campaigns.some((c) => c.categories.length) && <span className="block text-xs font-normal text-muted">הספירה לפי המדור והמכשיר הכי מלאים. קמפיין של מדור תופס רק במדור שלו.</span>}
      </p>
      {o.campaigns.length === 0 ? (
        <p className="text-muted">אין כאן קמפיינים ביום הזה. המקום מציג את &quot;פרסמו אצלנו&quot;.</p>
      ) : (
        <ul className="space-y-1.5">
          {o.campaigns.map((c) => (
            <li key={c.campaignId} className="flex flex-wrap items-center gap-2">
              <Link href={`/ads/${c.campaignId}`} className="font-bold hover:underline">
                {c.name}
              </Link>
              <span className="text-ink-2">{c.advertiserName}</span>
              <Badge tone={AD_STATUS[c.status].tone}>{AD_STATUS[c.status].label}</Badge>
              <span className="text-xs text-muted">
                {adShare(c.share, positions)} · {c.categories.length ? `במדורים: ${c.categories.length}` : 'בכל האתר'} · {c.to ? `עד ${shortDay(c.to)}` : 'בלי תאריך סיום'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Each place's rotation (in the ad settings)
// ---------------------------------------------------------------------------

export function PlacesRotation({ s, setS }: { s: AdSettings; setS: (s: AdSettings) => void }) {
  const set = (slot: AdSlot, next: Partial<AdSettings['places'][AdSlot]>) => setS({ ...s, places: { ...s.places, [slot]: { ...s.places[slot], ...next } } });
  return (
    <Card title="רוטציה: כמה מפרסמים בכל מקום">
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          כמו באתרי החדשות הגדולים: מקום פרסום אחד מתחלק בין כמה מפרסמים, והמודעות מתחלפות בו. כל מקום מחולק למשבצות, וכל קמפיין קונה כמה מהן (למשל רבע או חצי מהחשיפות, או את כל השטח). משבצת שלא נמכרה מציגה את &quot;פרסמו אצלנו&quot;. המודעה מתחלפת רק כשהיא על המסך, נעצרת כשהגולש מצביע עליה, ולא זזה בכלל אצל מי שביקש פחות תנועה. באפליקציה מוצגת מודעה אחת בכל צפייה.
        </p>
        <ul className="space-y-2">
          {AD_SLOTS.map((slot) => (
            <li key={slot} className="flex flex-wrap items-center gap-3 rounded-lg bg-stone p-3">
              <span className="min-w-40 flex-1">
                <span className="block font-bold">{AD_SLOT[slot].name}</span>
                <span className="block text-xs text-muted">{AD_SLOT[slot].where}</span>
              </span>
              <label className="flex items-center gap-2 text-sm">
                משבצות
                <select value={s.places[slot].positions} onChange={(e) => set(slot, { positions: Number(e.target.value) })} className={cx(inputClass, 'w-20')}>
                  {Array.from({ length: MAX_AD_POSITIONS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {!isApp(slot) && (
                <label className="flex items-center gap-2 text-sm">
                  החלפה
                  <select value={s.places[slot].rotateSeconds} onChange={(e) => set(slot, { rotateSeconds: Number(e.target.value) })} className={cx(inputClass, 'w-44')}>
                    {AD_ROTATE_SECONDS.map((n) => (
                      <option key={n} value={n}>
                        {AD_ROTATE[n]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">הקטנת מקום לא מבטלת קמפיינים שכבר אושרו: אם יש בו יותר נתחים ממשבצות, הם מתחלקים בו באופן יחסי, ולוח התפוסה מראה אותו כמלא.</p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The campaign form: its share, and whether it fits
// ---------------------------------------------------------------------------

export type FitPlan = { campaignId?: string; share: number; slots: AdSlot[]; categories: AdBooking['categories']; devices: AdBooking['devices']; startsAt: string | null; endsAt: string | null };

/** Each place of the plan: its size, the least free over the plan's days, and the days it doesn't fit. */
export function useFit(plan: FitPlan) {
  const query = useAvailability();
  if (!query.data) return null;
  const { today, places, bookings } = query.data;
  const days = bookingDays({ startsAt: plan.startsAt, endsAt: plan.endsAt }, today);
  const target = { ...plan, ...days };
  const positions = (slot: AdSlot) => places.find((p) => p.slot === slot)?.positions ?? 1;
  return Object.fromEntries(AD_SLOTS.map((slot) => [slot, { positions: positions(slot), ...placeFit(bookings, target, slot, positions(slot), today) }])) as Record<
    AdSlot,
    { positions: number; free: number; need: number; fullDays: string[] }
  >;
}

export function ShareAndFit({ plan, onShare }: { plan: FitPlan; onShare(n: number): void }) {
  const fit = useFit(plan);
  const biggest = fit && plan.slots.length ? Math.max(...plan.slots.map((s) => fit[s].positions)) : 4;
  return (
    <div className="space-y-3 rounded-lg bg-stone p-4">
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-ink-2">כמה מהמקום הקמפיין קונה (מתוך הרוטציה)</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {Array.from({ length: biggest }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={plan.share === n}
              onClick={() => onShare(n)}
              className={cx('rounded-full px-3 py-1.5 text-sm font-bold ring-1', plan.share === n ? 'bg-ink text-white ring-ink' : 'bg-white text-ink-2 ring-line hover:ring-ink')}
            >
              {adShare(n, biggest)}
              <span className="mr-1 text-xs font-normal opacity-75">({n} מתוך {biggest})</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">המודעות שבמקום מתחלפות ביניהן, וכל קמפיין מקבל את החלק שקנה מהחשיפות. &quot;כל השטח&quot; הוא בלעדיות במקום.</p>
      </fieldset>
      {!fit ? (
        <Loading label="בודק מה פנוי…" />
      ) : plan.slots.length === 0 ? null : (
        <ul className="space-y-1.5 text-sm" aria-live="polite">
          {plan.slots.map((slot) => {
            const f = fit[slot];
            const ok = f.fullDays.length === 0;
            return (
              <li key={slot} className="flex flex-wrap items-baseline gap-x-2">
                <span className={cx('font-bold', ok ? 'text-ok' : 'text-brand-deep')}>{ok ? '✓' : '✗'}</span>
                <span className="font-bold">{AD_SLOT[slot].name}:</span>
                {ok ? (
                  <span className="text-ink-2">
                    יש מקום. {adShare(f.need, f.positions)} מהחשיפות; פנויות לפחות {f.free} מתוך {f.positions} בכל התאריכים.
                  </span>
                ) : (
                  <span className="text-brand-deep">
                    אין מקום ב-{dayRanges(f.fullDays)}: פנויות {f.free} מתוך {f.positions}, והקמפיין צריך {f.need}. אפשר להקטין את הנתח או לשנות תאריכים.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A small "how much is free" under each place on the sketch, for the plan's dates and sections. */
export function freeNotes(fit: ReturnType<typeof useFit>): Partial<Record<AdSlot, { text: string; full: boolean }>> {
  if (!fit) return {};
  return Object.fromEntries(AD_SLOTS.map((slot) => [slot, { text: fit[slot].free === 0 ? 'מלא' : `פנוי ${fit[slot].free}/${fit[slot].positions}`, full: fit[slot].free === 0 }]));
}
