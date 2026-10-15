'use client';
// "צוות הסוכנים": the map of the AI agents (the chief editor above the others, the newsroom rules
// above everyone), and for the agent you pick: what it does and costs, its skills (versions,
// editing by an admin), and its settings and what it learned.
import { AGENT_IDS, type AgentCardDto, type AgentId, type AgentTeamDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { admin } from '@/lib/api';
import { AGENT, SKILL, modelName } from '@/lib/labels';
import { Badge, Card, ErrorBox, LinkButton, Loading, cx } from '../ui';
import { EditorAgent } from './editor-agent';
import { ResearcherAgent } from './researcher-agent';
import { ReviewerAgent } from './reviewer-agent';
import { SkillEditor } from './skill-editor';
import { SocialAgent } from './social-agent';
import { VisualAgent } from './visual-agent';

type Pick = AgentId | 'rules';

function cost(usd: number, partial: boolean): string {
  const base = usd === 0 ? 'בלי עלות' : usd < 0.01 ? 'פחות מסנט' : `כ-$${usd.toFixed(2)}`;
  return partial ? `${base} + חיוב Google` : base;
}

function AgentCard({ agent, picked, onPick, lead }: { agent: AgentCardDto; picked: boolean; onPick(): void; lead?: boolean }) {
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
        {modelName(agent.model)} · החודש: {cost(agent.usage.costUsd, agent.usage.partial)}
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
      <div className="space-y-3">
        <p className="text-[15px] text-ink-2">את העורך הראשי מפעילים בצ&apos;אט. מה שהוא יודע ואיך הוא עונה נקבע בסקיל שלו, ומה שהוא יכול לעשות נקבע בכלים של המערכת.</p>
        <LinkButton href="/agent">לצ&apos;אט עם העורך הראשי</LinkButton>
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

function AgentPanel({ agent }: { agent: AgentCardDto }) {
  const [tab, setTab] = useState<'role' | 'skills' | 'settings'>('role');
  const label = AGENT[agent.id];
  const u = agent.usage;
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
              <dt className="text-muted">עבודות החודש</dt>
              <dd className="mt-0.5 font-bold">{u.calls.toLocaleString('he-IL')}</dd>
              <dd className="text-xs text-muted">{(u.inputTokens + u.outputTokens).toLocaleString('he-IL')} טוקנים</dd>
            </div>
            <div className="rounded-lg bg-stone p-3">
              <dt className="text-muted">עלות החודש (הערכה)</dt>
              <dd className="mt-0.5 font-bold">{cost(u.costUsd, false)}</dd>
              {u.partial && <dd className="text-xs text-muted">תמונות של Google מחויבות בחשבון Google Cloud</dd>}
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
  if (team.isPending) return <Loading />;
  if (team.isError) return <ErrorBox error={team.error} onRetry={() => team.refetch()} />;
  const { agents, fixedRules } = team.data;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const chief = byId.get('chief')!;
  const others = AGENT_IDS.filter((id) => id !== 'chief').map((id) => byId.get(id)!);
  const total = agents.reduce((sum, a) => sum + a.usage.costUsd, 0);
  const partial = agents.some((a) => a.usage.partial);

  return (
    <div className="space-y-6">
      <Card>
        <button
          type="button"
          onClick={() => setPicked('rules')}
          aria-pressed={picked === 'rules'}
          className={cx('mb-6 flex w-full flex-wrap items-center gap-3 rounded-xl bg-stone px-4 py-3 text-right ring-1', picked === 'rules' ? 'ring-2 ring-brand' : 'ring-transparent hover:ring-ink')}
        >
          <span className="font-display text-[17px] font-extrabold">נהלי המערכת</span>
          <span className="text-sm text-ink-2">חלים על כל סוכן שכותב: דיוק, ייחוס, הפרדה בין דיווח לדעה, זכות תגובה, פרטיות</span>
          <span className="mr-auto text-xs text-muted">החודש, כל הסוכנים: {cost(total, partial)}</span>
        </button>

        <div className="mx-auto max-w-sm">
          <AgentCard agent={chief} lead picked={picked === 'chief'} onPick={() => setPicked('chief')} />
        </div>
        <div aria-hidden className="mx-auto h-6 w-px bg-line" />
        <div aria-hidden className="mx-[8%] hidden h-px bg-line lg:block" />
        <div className="mt-0 grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {others.map((a) => (
            <AgentCard key={a.id} agent={a} picked={picked === a.id} onPick={() => setPicked(a.id)} />
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">לוחצים על סוכן כדי לראות מה הוא עושה, את הסקיל שלו ואת ההגדרות שלו. העלויות הן הערכה לפי מחירי המחירון.</p>
      </Card>

      {picked === 'rules' ? <RulesPanel fixedRules={fixedRules} /> : <AgentPanel key={picked} agent={byId.get(picked)!} />}
    </div>
  );
}
