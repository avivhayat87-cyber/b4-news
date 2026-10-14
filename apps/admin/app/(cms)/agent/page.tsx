'use client';
// The newsroom agent: the chat, the editor agent (settings + learning), the social editor
// (distribution plans), the visual agent (Google: image and reel prompts + learning), and the
// connection to the Claude app.
import type { AgentStatusDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AgentChat } from '@/components/agent/chat';
import { ConnectClaude } from '@/components/agent/connect';
import { EditorAgent } from '@/components/agent/editor-agent';
import { SocialAgent } from '@/components/agent/social-agent';
import { VisualAgent } from '@/components/agent/visual-agent';
import { Badge, PageHeader, cx } from '@/components/ui';
import { admin } from '@/lib/api';

const TABS = [
  ['chat', "צ'אט עם הסוכן"],
  ['editor', 'סוכן העריכה'],
  ['social', 'עורך הרשתות'],
  ['visual', 'סוכן התמונות (Google)'],
  ['connect', 'חיבור לאפליקציית Claude'],
] as const;

export default function AgentPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('chat');
  const status = useQuery({ queryKey: ['agent', 'status'], queryFn: () => admin.get<AgentStatusDto>('/agent/status') });

  return (
    <>
      <PageHeader
        title="סוכן AI"
        subtitle="מבקשים מהסוכן בעברית, והוא קורא את המערכת ומבצע פעולות. כל שינוי מחכה לאישור שלכם."
        actions={status.data ? <Badge tone={status.data.live ? 'ok' : 'warn'}>{status.data.live ? `מחובר: ${status.data.model}` : 'מצב הדגמה'}</Badge> : null}
      />
      <div className="mb-5 inline-flex rounded-xl bg-white p-1 ring-1 ring-line" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('rounded-lg px-5 py-2.5 text-[15px] font-extrabold', tab === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'chat' && <AgentChat status={status.data} />}
      {tab === 'editor' && <EditorAgent />}
      {tab === 'social' && <SocialAgent />}
      {tab === 'visual' && <VisualAgent />}
      {tab === 'connect' && <ConnectClaude />}
    </>
  );
}
