'use client';
// Social networks: opens only after the text is final. Story image (never the
// article's main image) + headline + two sentences; the link goes in the first
// comment on Facebook, Instagram and X.
import type { DraftDetail, MediaDto, SocialPackageDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { PLATFORM } from '@/lib/labels';
import { UploadButton } from '../image-upload';
import { Badge, Button, Field, Loading, Spinner, cx, inputClass, useToast } from '../ui';

function sentences(text: string): number {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.replace(/[.!?…"״']/g, '').trim())
    .filter(Boolean).length;
}

export function SocialPanel({ draft, onFinalize }: { draft: DraftDetail; onFinalize(): void }) {
  const open = draft.status === 'text_final' || draft.status === 'ready' || draft.status === 'published';
  if (!open) {
    return (
      <div className="space-y-3 p-6">
        <p className="font-display text-lg font-extrabold">הרשתות החברתיות נפתחות אחרי סיום הטקסט</p>
        <p className="text-ink-2">כך ה-AI מכין את הפוסט מהנוסח הסופי בלבד, ולא מבזבזים קריאות על טיוטות.</p>
        {(draft.status === 'editing' || draft.status === 'ai_failed') && (
          <Button variant="dark" onClick={onFinalize}>
            סיום טקסט ומעבר לרשתות
          </Button>
        )}
      </div>
    );
  }
  return <SocialEditor draft={draft} />;
}

function SocialEditor({ draft }: { draft: DraftDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['social', draft.id];
  const pkg = useQuery({
    queryKey: key,
    queryFn: () => admin.get<SocialPackageDto>(`/drafts/${draft.id}/social`),
    refetchInterval: (q) => (q.state.data?.activeJob ? 2500 : false),
  });
  const [headline, setHeadline] = useState('');
  const [caption, setCaption] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (pkg.data && !editing) {
      setHeadline(pkg.data.headline);
      setCaption(pkg.data.caption);
    }
  }, [pkg.data, editing]);

  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const generate = useMutation({ mutationFn: (body: { what: 'text' | 'image' | 'both'; instruction?: string }) => admin.post(`/drafts/${draft.id}/social/generate`, body), onSuccess: () => { setNote(''); refresh(); }, onError });
  const save = useMutation({
    mutationFn: (body: { headline: string; caption: string; imageMediaId?: string | null }) => admin.put(`/drafts/${draft.id}/social`, { version: pkg.data!.version, ...body }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError,
  });
  const approve = useMutation({ mutationFn: () => admin.post(`/drafts/${draft.id}/social/approve`), onSuccess: () => { toast('חבילת הרשתות אושרה. היא תעלה אחרי שהכתבה תתפרסם באתר.'); refresh(); }, onError });
  const targets = useMutation({ mutationFn: (accounts: { accountId: string; enabled: boolean }[]) => admin.put(`/drafts/${draft.id}/social/targets`, { accounts }), onSuccess: refresh, onError });

  if (pkg.isPending) return <Loading />;
  if (pkg.isError) return <p className="p-6 text-brand">{errorMessage(pkg.error)}</p>;
  const p = pkg.data;
  const busy = !!p.activeJob || generate.isPending;
  const published = draft.status === 'published';
  const chooseImage = (m: MediaDto) => {
    if (m.id === draft.hero?.id) return toast('תמונת הסטורי חייבת להיות שונה מהתמונה הראשית של הכתבה.', 'danger');
    save.mutate({ headline: p.headline, caption: p.caption, imageMediaId: m.id });
  };
  const count = sentences(caption);

  if (!p.caption && !busy) {
    return (
      <div className="space-y-3 p-6">
        <p className="font-display text-lg font-extrabold">חבילה לרשתות החברתיות</p>
        <p className="text-ink-2">ה-AI יכין כותרת, הסבר של שני משפטים ותמונת סטורי ייעודית (שונה מהתמונה של הכתבה).</p>
        <Button variant="primary" onClick={() => generate.mutate({ what: 'both' })}>
          יצירת חבילה לרשתות
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      {p.isStale && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">הטקסט של הכתבה השתנה אחרי שהחבילה נוצרה. כדאי ליצור את הטקסט מחדש.</p>}
      {busy && (
        <p className="flex items-center gap-2 text-sm font-semibold text-info" role="status">
          <Spinner small /> ה-AI מכין את החבילה…
        </p>
      )}

      <div className="flex gap-4">
        {/* Story preview, 9:16 */}
        <div className="relative aspect-[9/16] w-40 shrink-0 overflow-hidden rounded-2xl bg-night shadow-md">
          {p.image && (
            // eslint-disable-next-line @next/next/no-img-element -- API-hosted image
            <img src={p.image.storyUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10">
            <p className="font-display text-sm font-extrabold leading-tight text-white">{headline || 'כותרת'}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <Field label="כותרת לתמונה" htmlFor="s-headline">
            <input id="s-headline" value={headline} maxLength={120} disabled={published} onChange={(e) => { setEditing(true); setHeadline(e.target.value); }} className={inputClass} />
          </Field>
          <Field label="הסבר (שני משפטים)" htmlFor="s-caption" error={count > 2 ? `${count} משפטים: צריך עד שניים` : null}>
            <textarea id="s-caption" rows={4} maxLength={600} value={caption} disabled={published} onChange={(e) => { setEditing(true); setCaption(e.target.value); }} className={inputClass} />
          </Field>
          {editing && (
            <div className="flex gap-2">
              <Button size="sm" variant="dark" busy={save.isPending} onClick={() => save.mutate({ headline, caption })}>
                שמירת הטקסט
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                ביטול
              </Button>
            </div>
          )}
        </div>
      </div>

      {!published && (
        <div className="rounded-lg bg-stone p-3">
          <Field label="הערה ל-AI" htmlFor="s-note">
            <textarea id="s-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder='למשל: "יותר קליט", "בלי שאלה בסוף"' className={inputClass} />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" busy={busy} onClick={() => generate.mutate({ what: 'text', instruction: note.trim() || undefined })}>
              טקסט חדש
            </Button>
            <Button size="sm" busy={busy} onClick={() => generate.mutate({ what: 'image', instruction: note.trim() || undefined })}>
              תמונה אחרת
            </Button>
            <UploadButton variant="ghost" label="העלאת תמונה ידנית" onUploaded={chooseImage} />
          </div>
        </div>
      )}

      {p.batches.some((b) => b.images.length) && (
        <div>
          <p className="mb-2 text-sm font-bold text-ink-2">תמונות סטורי</p>
          <div className="flex flex-wrap gap-2">
            {p.batches.flatMap((b) => b.images).map((m) => (
              <button key={m.id} type="button" disabled={published} onClick={() => chooseImage(m)} aria-pressed={p.image?.id === m.id} className={cx('overflow-hidden rounded-lg', p.image?.id === m.id ? 'ring-4 ring-brand' : 'hover:ring-2 hover:ring-ink')}>
                {/* eslint-disable-next-line @next/next/no-img-element -- API-hosted image */}
                <img src={m.storyUrl} alt="" className="aspect-[9/16] w-16 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-bold text-ink-2">לאן לפרסם</p>
        {p.posts.length === 0 ? (
          <p className="text-sm text-muted">לא הוגדרו חשבונות רשתות. מנהל/ת יכול/ה להוסיף ב"הגדרות".</p>
        ) : (
          <ul className="space-y-1.5">
            {p.posts.map((post) => (
              <li key={post.accountId} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-line">
                <input
                  type="checkbox"
                  checked={post.enabled}
                  disabled={published}
                  onChange={(e) => targets.mutate([{ accountId: post.accountId, enabled: e.target.checked }])}
                  aria-label={`פרסום ב${post.displayName}`}
                />
                <span className="font-semibold">{PLATFORM[post.platform]}</span>
                <span className="text-sm text-muted">{post.displayName}</span>
                {post.linkInFirstComment && <Badge tone="info">קישור בתגובה הראשונה</Badge>}
                {post.status === 'posted' && <Badge tone="ok">פורסם</Badge>}
                {post.status === 'skipped' && <Badge tone="warn">הוכן לפרסום ידני</Badge>}
                {post.status === 'failed' && <Badge tone="danger">נכשל</Badge>}
                {post.lastError && <span className="w-full text-xs text-muted">{post.lastError}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!published && (
        <div className="flex items-center gap-3 border-t border-line-soft pt-4">
          {p.approvedAt ? <Badge tone="ok">החבילה אושרה</Badge> : <Badge tone="warn">ממתין לאישור</Badge>}
          <Button variant="primary" className="mr-auto" busy={approve.isPending} disabled={busy || editing} onClick={() => approve.mutate()}>
            {p.approvedAt ? 'אישור מחדש' : 'אישור חבילת הרשתות'}
          </Button>
        </div>
      )}
    </div>
  );
}
