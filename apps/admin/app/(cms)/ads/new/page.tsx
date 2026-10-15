'use client';
// A new campaign: its details first (a draft, nothing on the site yet), then its ads on its own page.
import type { AdsOverviewDto, CampaignDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { CampaignForm, draftFrom, toInput } from '@/components/ads/campaign-form';
import { Card, ErrorBox, Loading, PageHeader, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';

export default function NewCampaignPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['ads'], queryFn: () => admin.get<AdsOverviewDto>('/ads') });
  const create = useMutation({
    mutationFn: (input: ReturnType<typeof toInput>) => admin.post<CampaignDto>('/ads/campaigns', input),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast('נשמר כטיוטה. עכשיו מעצבים את המודעה.');
      router.push(`/ads/${c.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const preset = typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('advertiser') ?? '');
  return (
    <>
      <PageHeader title="מודעה חדשה" subtitle="בוחרים איפה היא תופיע, למי ומתי, ומה קורה בלחיצה. אחר כך מעצבים אותה. שום דבר לא עולה לאתר עד שמנהל מאשר." />
      <Card>
        <CampaignForm initial={draftFrom(null, preset)} advertisers={query.data.advertisers} busy={create.isPending} submitLabel="המשך: עיצוב המודעה" onSubmit={(d) => create.mutate(toInput(d))} />
      </Card>
    </>
  );
}
