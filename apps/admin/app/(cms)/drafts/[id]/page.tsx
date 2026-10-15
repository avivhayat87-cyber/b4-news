'use client';
// The split-screen editor: the canvas on the right (Hebrew reading start), the
// read-only original and the tools on the left. Everything autosaves. Above them, what the
// article still needs before it is published; with ?fix=stuck (or a magazine's id) the editor is
// walked through it, article after article, moving to the next missing step by itself.
import type { DraftDetail, DraftReviewDto, MediaDto, MissingKey, ResearchTaskDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect, useRef, useState } from 'react';
import { Canvas } from '@/components/editor/canvas';
import { AiPanel, ImagesPanel, MetaPanel, OriginalPane } from '@/components/editor/panels';
import { type EditorTab, FOCUS_RING, FixBanner, MISSING_TAB, ReadinessBar, useFixQueue } from '@/components/editor/readiness';
import { SocialPanel } from '@/components/editor/social-panel';
import { DossierPanel } from '@/components/research/dossier-panel';
import { ReviewPanel } from '@/components/review/review-panel';
import { type SaveState, useAutosave } from '@/components/editor/use-autosave';
import { Badge, Button, ColorDot, ErrorBox, Loading, Spinner, cx, useToast } from '@/components/ui';
import { SITE_URL, admin, errorMessage, idempotencyKey } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { DRAFT_STATUS, formatTime } from '@/lib/labels';

type Tab = EditorTab;

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'נשמר',
  dirty: 'יש שינויים…',
  saving: 'שומר…',
  error: 'השמירה נכשלה, מנסה שוב',
  conflict: 'גרסה חדשה נשמרה במקום אחר',
  locked: 'הטקסט נעול',
};

export default function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <Editor key={id} id={id} />
    </Suspense>
  );
}

function Editor({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const fixMode = useSearchParams().get('fix');
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const [selection, setSelection] = useState('');
  // The step the editor clicked in the bar (in fixing mode: always the first missing one).
  const [clicked, setClicked] = useState<MissingKey | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const finalizeRef = useRef<HTMLSpanElement>(null);

  const draftQ = useQuery({
    queryKey: ['draft', id],
    queryFn: () => admin.get<DraftDetail>(`/drafts/${id}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d && (d.activeJob || ['queued_ai', 'ai_processing'].includes(d.status))) return 2000;
      // While fixing, the legal review and the chief editor finish by themselves: their result moves the page on.
      return fixMode && d?.missing.some((m) => m.key === 'review') ? 3000 : false;
    },
  });
  const draft = draftQ.data;
  const queue = useFixQueue(fixMode, id);
  const focus: MissingKey | null = fixMode ? (draft?.missing[0]?.key ?? null) : clicked && draft?.missing.some((m) => m.key === clicked) ? clicked : null;
  // Fixing: each time the step to do changes, its place opens by itself.
  useEffect(() => {
    if (!fixMode || !focus) return;
    const tab = MISSING_TAB[focus];
    if (tab) setTab(tab);
    if (focus === 'title') titleRef.current?.focus();
    if (focus === 'text') finalizeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [fixMode, focus]);
  const goTo = (key: MissingKey) => {
    setClicked(key);
    const tab = MISSING_TAB[key];
    if (tab) setTab(tab);
    if (key === 'title') titleRef.current?.focus();
    if (key === 'text') finalizeRef.current?.querySelector('button')?.focus();
  };
  const fixHref = (draftId: string) => `/drafts/${draftId}?fix=${encodeURIComponent(fixMode ?? '')}`;
  const publishNow = useMutation({
    mutationFn: () => admin.post(`/drafts/${id}/publish`, { idempotencyKey: idempotencyKey() }),
    onSuccess: () => {
      toast('הכתבה עולה לאתר.');
      void qc.invalidateQueries({ queryKey: ['saved'] });
      if (queue?.nextId) router.push(fixHref(queue.nextId));
      else router.push(queue?.backHref ?? '/saved');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  // A research behind the article: it wrote it, or proposes an update to it.
  const researchQ = useQuery({ queryKey: ['draft-research', id], queryFn: () => admin.get<ResearchTaskDto | null>(`/drafts/${id}/research`) });
  const hasResearch = draft?.origin === 'research' || Boolean(researchQ.data);
  const updateWaiting = researchQ.data?.update?.state === 'ready';
  // An article from a research (or with an update waiting) opens on its file; any other on its original.
  const tab: Tab = chosenTab ?? (draft?.origin === 'research' || updateWaiting ? 'research' : 'original');
  // The legal review of the final text: a red bar while a risk waits for a decision.
  const final = draft?.status === 'text_final' || draft?.status === 'ready';
  const reviewQ = useQuery({
    queryKey: ['review', id],
    queryFn: () => admin.get<DraftReviewDto>(`/drafts/${id}/review`),
    enabled: final,
    refetchInterval: (q) => (q.state.data?.state === 'checking' ? 2000 : false),
  });
  const stopped = final && (reviewQ.data?.state === 'flagged' || reviewQ.data?.state === 'failed');
  const aiBusy = !!draft && (!!draft.activeJob || draft.status === 'queued_ai' || draft.status === 'ai_processing');
  const editable = !!draft && canEdit && !aiBusy && (draft.status === 'editing' || draft.status === 'ai_failed');
  const autosave = useAutosave(draft, editable);

  const refetch = () => void qc.invalidateQueries({ queryKey: ['draft', id] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const action = useMutation({
    // "approve": the text is final, then on to the next article (in fixing mode the page moves to the next step instead);
    // "finalize": the same, staying for the social networks.
    mutationFn: async (path: 'approve' | 'finalize' | 'reopen' | 'skip' | 'unskip') => {
      if ((path === 'approve' || path === 'finalize') && !(await autosave.flush(true))) throw new Error('השמירה נכשלה. נסו שוב לפני אישור הטקסט.');
      return admin.post(`/drafts/${id}/${path === 'approve' ? 'finalize' : path}`, path === 'skip' ? {} : undefined);
    },
    onSuccess: (_r, path) => {
      refetch();
      void qc.invalidateQueries({ queryKey: ['saved'] });
      if (path === 'approve') {
        toast('הטקסט אושר. הבדיקה המשפטית ותוכנית ההפצה מוכנות בעוד רגע.');
        if (!fixMode) void saveAndNext();
      }
      if (path === 'finalize') {
        toast('הטקסט אושר. אפשר לעבור לרשתות החברתיות.');
        setTab('social');
      }
    },
    onError: (e) => {
      onError(e);
      // A missing section stops the approval: open its place.
      if (/קטגוריה/.test(errorMessage(e))) goTo('category');
    },
  });
  // A draft of an article that is already on the site: the site changes only on "שמירה ועדכון באתר".
  const liveEdit = !!draft?.publishedArticle && draft.status !== 'published';
  const updateSite = useMutation({
    mutationFn: async () => {
      if (editable && !(await autosave.flush(true))) throw new Error('השמירה נכשלה. נסו שוב לפני העדכון באתר.');
      return admin.post<{ slug: string }>(`/drafts/${id}/update-article`);
    },
    onSuccess: () => {
      toast('הכתבה עודכנה באתר.');
      refetch();
      void qc.invalidateQueries({ queryKey: ['articles'] });
    },
    onError,
  });
  const reopenArticle = useMutation({
    mutationFn: () => admin.post<{ draftId: string }>(`/articles/${draft!.publishedArticle!.id}/edit`),
    onSuccess: refetch,
    onError,
  });
  const setHero = useMutation({
    mutationFn: (m: MediaDto | null) => admin.patch(`/drafts/${id}`, { heroMediaId: m?.id ?? null }),
    // A quick draft stays one until the final approval (an article already on the site: drawn now, and the panel follows it).
    onSuccess: () => {
      refetch();
      void qc.invalidateQueries({ queryKey: ['images', id] });
    },
    onError,
  });

  async function saveAndNext() {
    if (editable && !(await autosave.flush(true))) return toast('השמירה נכשלה. נסו שוב.', 'danger');
    const next = draft?.nav?.nextId;
    if (next) router.push(`/drafts/${next}`);
    else if (draft?.magazine) router.push(`/magazines/${draft.magazine.id}/preview`);
    else router.push(`/drafts/${id}/preview`);
  }

  if (draftQ.isPending) return <Loading />;
  if (draftQ.isError) return <ErrorBox error={draftQ.error} onRetry={() => draftQ.refetch()} />;
  if (!draft || !autosave.content) return <Loading />;
  const status = DRAFT_STATUS[draft.status];
  const back = draft.magazine ? `/magazines/${draft.magazine.id}` : '/saved';

  const tabs: { id: Tab; label: string; dot?: boolean }[] = [
    ...(hasResearch ? [{ id: 'research' as const, label: 'תיק התחקיר', dot: updateWaiting }] : []),
    { id: 'original', label: 'המקור' },
    { id: 'ai', label: 'עוזר AI', dot: aiBusy },
    { id: 'images', label: 'תמונות', dot: !draft.hero },
    { id: 'meta', label: 'מיקום ותגיות', dot: !draft.category },
    { id: 'review', label: 'בדיקה משפטית', dot: stopped },
    { id: 'social', label: 'רשתות חברתיות' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-5 py-2.5">
        <Link href={back} className="text-sm font-semibold text-ink-2 hover:text-brand">
          → {draft.magazine ? draft.magazine.title : 'עריכות שמורות'}
        </Link>
        {draft.nav && (
          <span className="text-sm text-muted">
            כתבה {draft.nav.index + 1} מתוך {draft.nav.total}
          </span>
        )}
        <ColorDot color={draft.colorLabel} />
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className={cx('text-sm', autosave.state === 'conflict' || autosave.state === 'error' ? 'font-semibold text-brand' : 'text-muted')} role="status" aria-live="polite">
          {editable || autosave.state !== 'saved' ? SAVE_LABEL[autosave.state] : ''}
          {autosave.state === 'saved' && autosave.savedAt ? ` ${formatTime(autosave.savedAt)}` : ''}
        </span>
        <div className="mr-auto flex items-center gap-2">
          {draft.nav?.prevId && (
            <Button size="sm" variant="ghost" onClick={() => router.push(`/drafts/${draft.nav!.prevId}`)}>
              הקודמת
            </Button>
          )}
          {draft.publishedArticle && (
            <a href={`${SITE_URL}/article/${draft.publishedArticle.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:underline">
              לכתבה באתר ↗
            </a>
          )}
          {canEdit && draft.status === 'published' && draft.publishedArticle && (
            <Button size="sm" variant="dark" busy={reopenArticle.isPending} onClick={() => reopenArticle.mutate()}>
              עריכת הכתבה
            </Button>
          )}
        </div>
      </header>

      {queue && <FixBanner draft={draft} queue={queue} onNext={() => queue.nextId && router.push(fixHref(queue.nextId))} onPublish={() => publishNow.mutate()} publishing={publishNow.isPending} />}
      {!liveEdit && <ReadinessBar draft={draft} focus={focus} onGo={goTo} />}

      {stopped && reviewQ.data && (
        <div className="flex flex-wrap items-center gap-3 bg-brand px-5 py-2.5 text-sm font-bold text-white" role="alert">
          {reviewQ.data.state === 'failed'
            ? 'הבדיקה המשפטית לא הושלמה. עד שתבדקו שוב או תאשרו, אי אפשר לפרסם.'
            : `הכתבה נעצרה לבדיקה משפטית: ${reviewQ.data.openCount === 1 ? 'סוגיה אחת מחכה' : `${reviewQ.data.openCount} סוגיות מחכות`} להחלטה שלך.`}
          <Button size="sm" className="mr-auto" onClick={() => setTab('review')}>
            לפרטים ולהחלטה
          </Button>
        </div>
      )}

      {liveEdit && (
        <p className="bg-info-soft px-5 py-2 text-sm font-semibold text-info" role="note">
          זו כתבה שכבר באתר. השינויים נשמרים כאן, ומופיעים באתר רק אחרי &quot;שמירה ועדכון באתר&quot;, באותה כתובת. המיקום בעמוד הבית לא משתנה.
        </p>
      )}

      {autosave.state === 'conflict' && (
        <div className="flex items-center gap-3 bg-brand-soft px-5 py-2 text-sm font-semibold text-brand-deep" role="alert">
          {autosave.message}
          <Button
            size="sm"
            onClick={async () => {
              const fresh = await admin.get<DraftDetail>(`/drafts/${id}`);
              qc.setQueryData(['draft', id], fresh);
              autosave.reloadFromServer(fresh);
            }}
          >
            טעינת הגרסה העדכנית
          </Button>
        </div>
      )}

      {/* Split screen */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Canvas (right) */}
        <section className="flex min-h-0 flex-col border-l border-line bg-white" aria-label="הקנבס: עריכת הכתבה">
          <div className="space-y-2 border-b border-line-soft px-6 pb-3 pt-5">
            <textarea
              ref={titleRef}
              value={autosave.content.title}
              onChange={(e) => autosave.update({ title: e.target.value.replace(/\n/g, ' ') })}
              readOnly={!editable}
              rows={2}
              maxLength={200}
              placeholder="כותרת"
              aria-label="כותרת"
              className={cx('block w-full resize-none bg-transparent font-display text-[26px] font-extrabold leading-tight outline-none placeholder:text-muted/60', focus === 'title' && FOCUS_RING)}
            />
            <textarea
              value={autosave.content.subtitle}
              onChange={(e) => autosave.update({ subtitle: e.target.value.replace(/\n/g, ' ') })}
              readOnly={!editable}
              rows={2}
              maxLength={400}
              placeholder="כותרת משנה"
              aria-label="כותרת משנה"
              className="block w-full resize-none bg-transparent text-lg font-semibold text-ink-2 outline-none placeholder:text-muted/60"
            />
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <Canvas doc={autosave.content.bodyDoc} contentKey={autosave.contentKey} editable={editable} onChange={(bodyDoc) => autosave.update({ bodyDoc })} onSelection={setSelection} />
            {aiBusy && (
              <div className="absolute inset-0 flex items-start justify-center bg-white/70 pt-24 backdrop-blur-[1px]">
                <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 font-semibold text-info shadow-lg ring-1 ring-line">
                  <Spinner /> {draft.status === 'queued_ai' || draft.status === 'ai_processing' ? 'ה-AI כותב את הטיוטה מהמקור…' : 'ה-AI מתקן את הכתבה לפי ההערה…'}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Original + tools (left) */}
        <section className="flex min-h-0 flex-col bg-canvas">
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-white px-3 pt-2" role="tablist" aria-label="כלים">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cx('relative whitespace-nowrap rounded-t-lg px-3.5 py-2 text-sm font-bold', tab === t.id ? 'bg-canvas text-ink ring-1 ring-line' : 'text-muted hover:text-ink')}
              >
                {t.label}
                {t.dot && <span className="absolute left-1 top-1.5 size-2 rounded-full bg-brand" aria-hidden />}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
            {tab === 'research' && <DossierPanel draftId={id} />}
            {tab === 'original' && <OriginalPane draft={draft} onQueued={refetch} />}
            {tab === 'ai' && <AiPanel draft={draft} selection={selection} busyJob={draft.activeJob} onQueued={refetch} />}
            {tab === 'images' && <ImagesPanel draft={draft} focus={focus === 'image'} onHero={(m) => setHero.mutate(m)} />}
            {tab === 'meta' && <MetaPanel draft={draft} focus={focus === 'category'} onSaved={refetch} onShowSource={() => setTab('original')} />}
            {tab === 'review' && (
              <div className={cx('p-5', focus === 'review' && 'bg-brand-soft/40')}>
                <ReviewPanel draftId={id} final={final} />
              </div>
            )}
            {tab === 'social' && <SocialPanel draft={draft} onFinalize={() => action.mutate('finalize')} />}
          </div>
        </section>
      </div>

      {/* Actions */}
      {canEdit && liveEdit && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-white px-5 py-3">
          <span className="text-sm text-muted">באתר מופיעה עדיין הגרסה הקודמת.</span>
          <span className="mr-auto" />
          <Button variant="primary" busy={updateSite.isPending} disabled={aiBusy} onClick={() => updateSite.mutate()}>
            שמירה ועדכון באתר
          </Button>
        </footer>
      )}
      {canEdit && !liveEdit && draft.status !== 'published' && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-white px-5 py-3">
          {draft.status === 'skipped' ? (
            <Button busy={action.isPending} onClick={() => action.mutate('unskip')}>
              החזרה לעריכה
            </Button>
          ) : (
            <Button variant="danger" busy={action.isPending && action.variables === 'skip'} onClick={() => confirm('לסמן את הכתבה כ"לא לפרסם"? היא תישאר בעריכות השמורות.') && action.mutate('skip')}>
              לא לפרסם
            </Button>
          )}
          {draft.status === 'text_final' && (
            <Button busy={action.isPending && action.variables === 'reopen'} onClick={() => action.mutate('reopen')}>
              פתיחת הטקסט לעריכה
            </Button>
          )}
          <span className="mr-auto" />
          {!draft.magazine && !fixMode && (
            <Button onClick={() => router.push(`/drafts/${id}/preview`)} disabled={draft.status === 'skipped'}>
              תצוגה מקדימה ופרסום
            </Button>
          )}
          {/* One step: the text approved and on to the next article. Saving without approving stays possible. */}
          {editable && (
            <Button variant="ghost" onClick={fixMode ? () => void autosave.flush(true) : saveAndNext}>
              {fixMode ? 'שמירה' : draft.nav?.nextId ? 'שמירה בלי אישור והמשך' : 'שמירה בלי אישור'}
            </Button>
          )}
          {editable ? (
            <span ref={finalizeRef} className={cx('inline-flex', focus === 'text' && FOCUS_RING)}>
              <Button variant="primary" busy={action.isPending && action.variables === 'approve'} onClick={() => action.mutate('approve')}>
                {fixMode ? 'אישור הטקסט' : draft.nav?.nextId ? 'אישור הטקסט והמשך לכתבה הבאה' : draft.magazine ? 'אישור הטקסט ולתצוגה המקדימה' : 'אישור הטקסט'}
              </Button>
            </span>
          ) : (
            !fixMode &&
            draft.status !== 'skipped' && (
              <Button variant="primary" onClick={saveAndNext}>
                {draft.nav?.nextId ? 'לכתבה הבאה' : draft.magazine ? 'לתצוגה המקדימה' : 'לתצוגה המקדימה ולפרסום'}
              </Button>
            )
          )}
        </footer>
      )}
    </div>
  );
}
