'use client';
// "צוות הסוכנים": the map of the AI agents (the chief editor above the others, the newsroom rules
// above everyone), what each one cost in the period you pick (since the start, today, this month,
// this year, or between two days), and for the agent you pick: what it does, its skills (versions,
// editing by an admin), and its settings and what it learned.
import { AGENT_IDS, type AgentCardDto, type AgentId, type AgentTeamDto, type AgentUsageDto, type AgentUsageReportDto, USAGE_PERIODS, type UsagePeriod } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { AGENT, SKILL, USAGE_PERIOD, modelName } from '@/lib/labels';
import { Badge, Card, ErrorBox, LinkButton, Loading, cx, inputClass } from '../ui';
import { EditorAgent } from './editor-agent';
import { MeetingAgent } from './meeting-agent';
import { ResearcherAgent } from './researcher-agent';
import { ReviewerAgent } from './reviewer-agent';
import { SkillEditor } from './skill-editor';
import { SocialAgent } from './social-agent';
import { VisualAgent } from './visual-agent';

type Pick = AgentId | 'rules';
type Range = { from: string; to: string };

function cost(usage: AgentUsageDto | undefined, showPartial = true): string {
  if (!usage) return '…';
  const usd = usage.costUsd;
  const base = usd === 0 ? 'בלי עלות' : usd < 0.01 ? 'פחות מסנט' : `כ-$${usd.toFixed(2)}`;
  return showPartial && usage.partial ? `${base} + חיוב Google` : base;
}

/** Today in Israel, as YYYY-MM-DD (what the API counts days by). */
const israelToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const shortDate = (day: string) => `${Number(day.slice(8))}.${Number(day.slice(5, 7))}.${day.slice(0, 4)}`;

/** The period the costs are counted for: since the start, today, this month, this year, or two days of your choice. */
function UsageFilter({ period, onPeriod, range, onRange }: { period: UsagePeriod; onPeriod(p: UsagePeriod): void; range: Range; onRange(r: Range): void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex flex-wrap rounded-lg bg-stone p-1" role="group" aria-label="תקופת העלויות">
        {USAGE_PERIODS.map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => onPeriod(p)} className={cx('rounded-md px-3 py-1.5 text-sm font-bold', period === p ? 'bg-white shadow-sm' : 'text-ink-2')}>
            {USAGE_PERIOD[p].label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="usage-from">מתאריך</label>
          <span className="w-40">
            <input id="usage-from" type="date" value={range.from} max={range.to || undefined} onChange={(e) => onRange({ ...range, from: e.target.value })} className={inputClass} />
          </span>
          <label htmlFor="usage-to">עד</label>
          <span className="w-40">
            <input id="usage-to" type="date" value={range.to} min={range.from || undefined} onChange={(e) => onRange({ ...range, to: e.target.value })} className={inputClass} />
          </span>
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, usage, when, picked, onPick, lead }: { agent: AgentCardDto; usage: AgentUsageDto | undefined; when: string; picked: boolean; onPick(): void; lead?: boolean }) {
  const label = AGENT[agent.id];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      className={cx('flex h-full w-full flex-col rounded-xl p-4 text-right transition', lead ? 'bg-ink text-white' : 'bg-white', picked ? 'ring-4 ring-brand' : lead ? 'ring-1 ring-ink' : 'ring-1 ring-line hover:ring-ink')}
    >
      <span className="flex items-center gap-2">
        <span className="font-display text-[17px] font-extrabold">{label.name}</span>
        {!agent.live && <Badge tone="warn">לא מחובר</Badge>}
      </span>
      <span className={cx('mt-1 text-sm', lead ? 'text-white/80' : 'text-ink-2')}>{label.role}</span>
      <span className={cx('mt-auto pt-3 text-xs', lead ? 'text-white/70' : 'text-muted')}>
        {modelName(agent.model)} · {when}: {cost(usage)}
      </span>
    </button>
  );
}

function Settings({ id }: { id: AgentId }) {
  if (id === 'reporter') return <ResearcherAgent />;
  if (id === 'rewrite') return <EditorAgent />;
  if (id === 'reviewer') return <ReviewerAgent />;
  if (id === 'social') return <SocialAgent />;
  if (id === 'visual') return <VisualAgent />;
  if (id === 'chief')
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-[15px] text-ink-2">את העורך הראשי מפעילים בצ&apos;אט. מה שהוא יודע ואיך הוא עונה נקבע בסקיל שלו, ומה שהוא יכול לעשות נקבע בכלים של המערכת.</p>
          <LinkButton href="/agent">לצ&apos;אט עם העורך הראשי</LinkButton>
        </div>
        <div className="border-t border-line-soft pt-5">
          <MeetingAgent />
        </div>
      </div>
    );
  if (id === 'ads')
    return (
      <div className="space-y-3">
        <p className="text-[15px] text-ink-2">
          מפעילים אותו מדף &quot;פרסום&quot;: בלשונית &quot;סוכן הפרסום&quot; מקבלים הצעת קמפיין לעסק, ובכל מודעה יש כפתור לבדיקה שלו. עולה בערך סנט להצעה או לבדיקה, ותמונה מ-AI רק כשמבקשים. הוא אף פעם לא מעלה מודעה בעצמו.
        </p>
        <LinkButton href="/ads">לדף הפרסום</LinkButton>
      </div>
    );
  if (id === 'learning')
    return (
      <div className="space-y-3">
        <p className="text-[15px] text-ink-2">הכללים שהלמידה כתבה לעורך השכתוב, והדוח אחרי כל פרסום.</p>
        <LinkButton href="/learning">הכללים שנלמדו</LinkButton>
      </div>
    );
  return <p className="text-[15px] text-muted">אין לו הגדרות נוספות: מה שהוא עושה נקבע בסקיל שלו.</p>;
}

function AgentPanel({ agent, usage: u, when }: { agent: AgentCardDto; usage: AgentUsageDto | undefined; when: string }) {
  const [tab, setTab] = useState<'role' | 'skills' | 'settings'>('role');
  const label = AGENT[agent.id];
  return (
    <Card title={label.name}>
      <div className="-mt-1 mb-5 inline-flex rounded-lg bg-stone p-1" role="tablist">
        {(
          [
            ['role', 'התפקיד'],
            ['skills', `הסקיל (${agent.skills.length})`],
            ['settings', 'הגדרות ולמידה'],
          ] as const
        ).map(([id, text]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('rounded-md px-4 py-1.5 text-sm font-bold', tab === id ? 'bg-white shadow-sm' : 'text-ink-2')}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'role' && (
        <div className="space-y-4">
          <p className="text-[15px] leading-relaxed text-ink-2">{label.about}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-stone p-3">
              <dt className="text-muted">רץ על</dt>
              <dd className="mt-0.5 font-bold">{modelName(agent.model)}</dd>
              <dd className="text-xs text-muted">{agent.live ? 'מחובר' : 'לא מחובר: מצב הדגמה'}</dd>
            </div>
            <div className="rounded-lg bg-stone p-3">
              <dt className="text-muted">עבודות {when}</dt>
              <dd className="mt-0.5 font-bold">{u ? u.calls.toLocaleString('he-IL') : '…'}</dd>
              {u && <dd className="text-xs text-muted">{(u.inputTokens + u.outputTokens).toLocaleString('he-IL')} טוקנים</dd>}
            </div>
            <div className="rounded-lg bg-stone p-3">
              <dt className="text-muted">עלות {when} (הערכה)</dt>
              <dd className="mt-0.5 font-bold">{cost(u, false)}</dd>
              {u?.partial && <dd className="text-xs text-muted">יש עבודות של Google בלי מחיר ידוע, והן לא בסכום</dd>}
            </div>
          </dl>
          <p className="text-sm text-muted">
            הסקילים שלו: {agent.skills.map((s) => SKILL[s.key]?.name ?? s.key).join(' · ')}. כל סוכן שכותב קורא גם את &quot;נהלי המערכת&quot;.
          </p>
        </div>
      )}
      {tab === 'skills' && (
        <div className="space-y-8">
          {agent.skills.map((s) => (
            <SkillEditor key={s.key} skillKey={s.key} />
          ))}
        </div>
      )}
      {tab === 'settings' && <Settings id={agent.id} />}
    </Card>
  );
}

function RulesPanel({ fixedRules }: { fixedRules: string[] }) {
  return (
    <Card title="נהלי המערכת">
      <p className="-mt-1 mb-4 text-sm text-muted">כל סוכן שכותב משהו שיתפרסם קורא את הנהלים האלה אחרי הסקיל שלו. משנים אותם כאן, והם חלים על כולם מיד.</p>
      <div className="mb-6 rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
        <p className="font-bold">כללים קבועים (לא ניתן לשנות או לכבות):</p>
        <ul className="mt-1 list-disc space-y-1 pr-5">
          {fixedRules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <SkillEditor skillKey="newsroom.rules" />
    </Card>
  );
}

export function AgentTeam() {
  const team = useQuery({ queryKey: ['agents'], queryFn: () => admin.get<AgentTeamDto>('/agents') });
  const [picked, setPicked] = useState<Pick>('chief');
  const [period, setPeriod] = useState<UsagePeriod>('month');
  const [range, setRange] = useState<Range>(() => {
    const today = israelToday();
    return { from: `${today.slice(0, 7)}-01`, to: today };
  });
  const rangeReady = Boolean(range.from && range.to && range.from <= range.to);
  const report = useQuery({
    queryKey: ['agents', 'usage', period, period === 'custom' ? range : null],
    queryFn: () => admin.get<AgentUsageReportDto>(`/agents/usage?period=${period}${period === 'custom' ? `&from=${range.from}&to=${range.to}` : ''}`),
    enabled: period !== 'custom' || rangeReady,
    // The numbers of the last period stay on screen while the next ones load.
    placeholderData: (prev) => prev,
  });
  if (team.isPending) return <Loading />;
  if (team.isError) return <ErrorBox error={team.error} onRetry={() => team.refetch()} />;
  const { agents, fixedRules } = team.data;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const chief = byId.get('chief')!;
  const others = AGENT_IDS.filter((id) => id !== 'chief').map((id) => byId.get(id)!);
  const usageOf = (id: AgentId) => report.data?.agents.find((a) => a.id === id)?.usage;
  const when = USAGE_PERIOD[period].when;
  const span = period === 'custom' ? (rangeReady ? `${shortDate(range.from)}–${shortDate(range.to)}` : 'בחרו תאריכים') : USAGE_PERIOD[period].when;

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <UsageFilter period={period} onPeriod={setPeriod} range={range} onRange={setRange} />
          <p className="text-sm text-ink-2" aria-live="polite">
            {report.isError ? (
              <span className="text-brand-deep">{errorMessage(report.error)}</span>
            ) : (
              <>
                כל הסוכנים, {span}: <b>{cost(report.data?.total)}</b>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setPicked('rules')}
          aria-pressed={picked === 'rules'}
          className={cx('mb-6 flex w-full flex-wrap items-center gap-3 rounded-xl bg-stone px-4 py-3 text-right ring-1', picked === 'rules' ? 'ring-2 ring-brand' : 'ring-transparent hover:ring-ink')}
        >
          <span className="font-display text-[17px] font-extrabold">נהלי המערכת</span>
          <span className="text-sm text-ink-2">חלים על כל סוכן שכותב: דיוק, ייחוס, הפרדה בין דיווח לדעה, זכות תגובה, פרטיות</span>
        </button>

        <div className="mx-auto max-w-sm">
          <AgentCard agent={chief} usage={usageOf('chief')} when={when} lead picked={picked === 'chief'} onPick={() => setPicked('chief')} />
        </div>
        <div aria-hidden className="mx-auto h-6 w-px bg-line" />
        <div aria-hidden className="mx-[8%] hidden h-px bg-line lg:block" />
        <div className="mt-0 grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {others.map((a) => (
            <AgentCard key={a.id} agent={a} usage={usageOf(a.id)} when={when} picked={picked === a.id} onPick={() => setPicked(a.id)} />
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">לוחצים על סוכן כדי לראות מה הוא עושה, את הסקיל שלו ואת ההגדרות שלו. העלויות הן הערכה לפי מחירי המחירון, והימים לפי שעון ישראל.</p>
      </Card>

      {picked === 'rules' ? <RulesPanel fixedRules={fixedRules} /> : <AgentPanel key={picked} agent={byId.get(picked)!} usage={usageOf(picked)} when={when} />}
    </div>
  );
}
