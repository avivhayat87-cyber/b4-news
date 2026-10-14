'use client';
// The chief editor: the chat with the agent that runs the others, and the connection to the Claude
// app. The agents' skills and settings live in "הגדרות" > "צוות הסוכנים".
import type { AgentStatusDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AgentChat } from '@/components/agent/chat';
import { ConnectClaude } from '@/components/agent/connect';
import { Badge, LinkButton, PageHeader, cx } from '@/components/ui';
import { admin } from '@/lib/api';

const TABS = [
  ['chat', "צ'אט עם העורך הראשי"],
  ['connect', 'חיבור לאפליקציית Claude'],
] as const;

export default function AgentPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('chat');
  const status = useQuery({ queryKey: ['agent', 'status'], queryFn: () => admin.get<AgentStatusDto>('/agent/status') });

  return (
    <>
      <PageHeader
        title="סוכן AI"
        subtitle="מבקשים מהעורך הראשי בעברית, והוא קורא את המערכת ומפעיל את שאר הסוכנים. כל שינוי מחכה לאישור שלכם."
        actions={
          <span className="flex items-center gap-2">
            <LinkButton href="/settings?tab=agents">צוות הסוכנים והסקילים</LinkButton>
            {status.data ? <Badge tone={status.data.live ? 'ok' : 'warn'}>{status.data.live ? `מחובר: ${status.data.model}` : 'מצב הדגמה'}</Badge> : null}
          </span>
        }
      />
      <div className="mb-5 inline-flex rounded-xl bg-white p-1 ring-1 ring-line" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('rounded-lg px-5 py-2.5 text-[15px] font-extrabold', tab === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'chat' && <AgentChat status={status.data} />}
      {tab === 'connect' && <ConnectClaude />}
    </>
  );
}
