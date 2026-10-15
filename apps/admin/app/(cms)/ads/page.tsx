'use client';
// "פרסום": our own ad server. Campaigns (waiting, running, paused), the archive, leads and
// inquiries, advertisers, the ads agent, and the switches. Admins only: leads are personal data.
import type { AdsOverviewDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Advertisers } from '@/components/ads/advertisers';
import { AdsSettings } from '@/components/ads/ads-settings';
import { AgentTab } from '@/components/ads/agent-tab';
import { Archive, CampaignCards } from '@/components/ads/campaign-list';
import { LeadsTable } from '@/components/ads/leads';
import { Badge, Empty, ErrorBox, LinkButton, Loading, PageHeader, cx } from '@/components/ui';
import { admin } from '@/lib/api';
import { useCan } from '@/lib/auth';

const TABS = ['campaigns', 'archive', 'leads', 'advertisers', 'agent', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function AdsPage() {
  const isAdmin = useCan();
  const [tab, setTab] = useState<Tab>('campaigns');
  // A link straight to a tab (the inquiry email opens "לידים ופניות").
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (TABS as readonly string[]).includes(t)) setTab(t as Tab);
  }, []);
  const query = useQuery({ queryKey: ['ads'], queryFn: () => admin.get<AdsOverviewDto>('/ads'), enabled: isAdmin });

  if (!isAdmin) return <Empty title="רק למנהלים">ניהול הפרסום והלידים פתוח למנהלי המערכת בלבד.</Empty>;
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const o = query.data;
  const labels: Record<Tab, ReactNode> = {
    campaigns: `קמפיינים (${o.campaigns.length})`,
    archive: `ארכיון (${o.archive.length})`,
    leads: (
      <>
        לידים ופניות {o.newLeads + o.newInquiries > 0 && <Badge tone="danger">{o.newLeads + o.newInquiries}</Badge>}
      </>
    ),
    advertisers: `מפרסמים (${o.advertisers.length})`,
    agent: 'סוכן הפרסום',
    settings: 'הגדרות',
  };

  return (
    <>
      <PageHeader
        title="פרסום"
        subtitle={o.settings.enabled ? 'מודעות של לקוחות באתר ובאפליקציה: קמפיינים, לידים, ודוח לכל מפרסם.' : 'המודעות כבויות כרגע בכל האתר (הגדרות).'}
        actions={
          <LinkButton href="/ads/new" variant="primary">
            קמפיין חדש
          </LinkButton>
        }
      />
      <div className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('inline-flex items-center gap-1.5 rounded-md px-4 py-2 font-bold', tab === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {labels[id]}
          </button>
        ))}
      </div>
      {tab === 'campaigns' && <CampaignCards campaigns={o.campaigns} />}
      {tab === 'archive' && <Archive campaigns={o.archive} />}
      {tab === 'leads' && (
        <div className="space-y-8">
          <LeadsTable kind="lead" title="לידים מהמודעות" />
          <LeadsTable kind="inquiry" title='פניות מעמוד "פרסום באתר"' />
        </div>
      )}
      {tab === 'advertisers' && <Advertisers advertisers={o.advertisers} />}
      {tab === 'agent' && <AgentTab advertisers={o.advertisers} />}
      {tab === 'settings' && <AdsSettings settings={o.settings} />}
    </>
  );
}
