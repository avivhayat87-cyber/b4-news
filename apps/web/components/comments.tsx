'use client';

import { COMMENT_LIMITS } from '@b4/shared';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ApiFailure, commentsApi, readerApi } from '@/lib/client-api';
import type { CommentDto, ReaderDto } from '@/lib/types';
import { TermsCheckbox } from './terms-checkbox';
import { SectionHeader } from './ui';

type Auth = { state: 'loading' } | { state: 'anonymous' } | { state: 'signed-in'; reader: ReaderDto };

const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
function relativeTime(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return 'עכשיו';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

const message = (err: unknown) => (err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.');

export function Comments({
  articleId,
  articleUrl,
  enabled,
  initialCount,
  termsVersion,
}: {
  articleId: number;
  articleUrl: string;
  enabled: boolean;
  initialCount: number;
  termsVersion: string;
}) {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const [items, setItems] = useState<CommentDto[]>([]);
  const [total, setTotal] = useState(initialCount);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (next?: string | null) => {
      setLoading(true);
      setLoadError(null);
      try {
        const page = await commentsApi.list(articleId, next);
        setItems((prev) => (next ? [...prev, ...page.items] : page.items));
        setTotal(page.total);
        setCursor(page.nextCursor);
      } catch (err) {
        setLoadError(message(err));
      } finally {
        setLoading(false);
      }
    },
    [articleId],
  );

  useEffect(() => {
    readerApi
      .me()
      .then((reader) => setAuth(reader ? { state: 'signed-in', reader } : { state: 'anonymous' }))
      .catch(() => setAuth({ state: 'anonymous' }));
    void load();
  }, [load]);

  const onSignedIn = (reader: ReaderDto) => {
    setAuth({ state: 'signed-in', reader });
    void load(); // show own pending comments, ownership
  };

  const onPosted = (comment: CommentDto) => {
    setItems((prev) => {
      if (!comment.parentId) return [comment, ...prev];
      // Insert a reply after the last item of its thread.
      const idx = prev.findIndex((c) => c.id === comment.parentId);
      let end = idx;
      while (end + 1 < prev.length && prev[end + 1]!.parentId === comment.parentId) end++;
      return [...prev.slice(0, end + 1), comment, ...prev.slice(end + 1)];
    });
    if (!comment.pending) setTotal((n) => n + 1);
  };

  const onRemoved = (id: string) => {
    setItems((prev) => prev.filter((c) => c.id !== id && c.parentId !== id));
    setTotal((n) => Math.max(0, n - 1));
  };

  const signOut = async () => {
    await readerApi.logout().catch(() => undefined);
    setAuth({ state: 'anonymous' });
    void load();
  };

  return (
    <section id="comments" aria-labelledby="comments-title" className="mx-auto mt-12 max-w-[68ch]">
      <SectionHeader id="comments-title" title="תגובות" size="md" className="mb-5">
        <span className="rounded-full bg-stone px-3 py-1 font-mono text-sm tabular-nums text-ink-2" aria-label={`${total} תגובות`}>
          {total}
        </span>
      </SectionHeader>

      {!enabled ? (
        <p className="rounded-xl bg-stone px-5 py-4 text-ink-2">התגובות לכתבה הזאת סגורות.</p>
      ) : auth.state === 'loading' ? null : auth.state === 'signed-in' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            מגיב/ה בתור <strong className="font-bold text-ink">{auth.reader.displayName}</strong> ·{' '}
            <Link href="/account" className="font-semibold text-ink-2 underline-offset-2 hover:underline">
              החשבון שלי
            </Link>{' '}
            ·{' '}
            <button type="button" onClick={signOut} className="font-semibold text-brand underline-offset-2 hover:underline">
              התנתקות
            </button>
          </p>
          {auth.reader.termsAccepted ? (
            <Composer
              articleId={articleId}
              onPosted={onPosted}
              onTermsRequired={() => setAuth({ state: 'signed-in', reader: { ...auth.reader, termsAccepted: false } })}
            />
          ) : (
            <TermsUpdate version={termsVersion} onAccepted={(reader) => setAuth({ state: 'signed-in', reader })} />
          )}
        </div>
      ) : (
        <SignIn onSignedIn={onSignedIn} />
      )}

      <ul className="mt-8 flex flex-col" aria-live="polite">
        {items.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            articleId={articleId}
            articleUrl={articleUrl}
            canReply={enabled && auth.state === 'signed-in' && !c.parentId && !c.pending}
            signedIn={auth.state === 'signed-in'}
            onPosted={onPosted}
            onRemoved={onRemoved}
          />
        ))}
      </ul>

      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-brand-deep">
          {loadError}{' '}
          <button type="button" onClick={() => load()} className="font-bold underline">
            לנסות שוב
          </button>
        </p>
      ) : null}
      {!loading && !loadError && items.length === 0 ? <p className="mt-2 text-ink-2">עדיין אין תגובות. אפשר להיות הראשונים.</p> : null}
      {cursor ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => load(cursor)}
            disabled={loading}
            className="inline-flex h-11 items-center rounded-full border-2 border-ink px-6 font-extrabold hover:bg-ink hover:text-white disabled:opacity-60"
          >
            {loading ? 'טוען…' : 'תגובות נוספות'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CommentItem({
  comment,
  articleId,
  articleUrl,
  canReply,
  signedIn,
  onPosted,
  onRemoved,
}: {
  comment: CommentDto;
  articleId: number;
  articleUrl: string;
  canReply: boolean;
  signedIn: boolean;
  onPosted: (c: CommentDto) => void;
  onRemoved: (id: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const initial = comment.author.displayName.trim().charAt(0) || '?';
  const takedownHref = `/report?url=${encodeURIComponent(`${articleUrl}#comments`)}&comment=${comment.id}`;

  const report = async (reason: 'spam' | 'abuse' | 'misinformation' | 'other') => {
    try {
      await commentsApi.report(comment.id, reason);
      setNotice('תודה, הדיווח התקבל ויבדק.');
    } catch (err) {
      setNotice(message(err));
    }
    setReporting(false);
  };

  const remove = async () => {
    if (!window.confirm('למחוק את התגובה?')) return;
    try {
      await commentsApi.remove(comment.id);
      onRemoved(comment.id);
    } catch (err) {
      setNotice(message(err));
    }
  };

  return (
    <li className={`flex gap-3 border-t border-line py-4 ${comment.parentId ? 'ms-10 border-t-0 border-s-2 ps-4 pt-2' : ''}`}>
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone font-display text-lg font-extrabold text-ink-2">
        {initial}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <strong className="font-bold">{comment.author.displayName}</strong>
          <time dateTime={comment.createdAt} className="text-muted">
            {relativeTime(comment.createdAt)}
          </time>
          {comment.pending ? <span className="rounded-full bg-[#FFF4D6] px-2 py-0.5 text-xs font-bold text-[#7A5600]">ממתינה לאישור</span> : null}
        </div>
        {/* Plain text from the API; React escapes it. */}
        <p className="whitespace-pre-line break-words text-[16px] leading-relaxed">{comment.body}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-muted">
          {canReply ? (
            <button type="button" onClick={() => setReplying((v) => !v)} className="hover:text-brand" aria-expanded={replying}>
              הגבה
            </button>
          ) : null}
          {comment.isMine ? (
            <button type="button" onClick={remove} className="hover:text-brand">
              מחיקה
            </button>
          ) : signedIn && !comment.pending ? (
            <button type="button" onClick={() => setReporting((v) => !v)} className="hover:text-brand" aria-expanded={reporting}>
              דיווח
            </button>
          ) : !comment.pending ? (
            // Anyone, signed in or not, can file a formal removal request.
            <Link href={takedownHref} className="hover:text-brand">
              דיווח
            </Link>
          ) : null}
        </div>
        {reporting ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="סיבת הדיווח">
            {(
              [
                ['spam', 'ספאם'],
                ['abuse', 'תוכן פוגעני'],
                ['misinformation', 'מידע שגוי'],
                ['other', 'אחר'],
              ] as const
            ).map(([reason, label]) => (
              <button key={reason} type="button" onClick={() => report(reason)} className="rounded-full border border-line px-3 py-1 hover:border-brand hover:text-brand">
                {label}
              </button>
            ))}
            <Link href={takedownHref} className="px-1 font-semibold text-ink-2 underline underline-offset-2 hover:text-brand">
              פוגע בך? בקשת הסרה
            </Link>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-ink-2">
            {notice}
          </p>
        ) : null}
        {replying ? (
          <Composer
            articleId={articleId}
            parentId={comment.id}
            compact
            onPosted={(c) => {
              onPosted(c);
              setReplying(false);
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

function Composer({
  articleId,
  parentId,
  compact = false,
  onPosted,
  onTermsRequired,
}: {
  articleId: number;
  parentId?: string;
  compact?: boolean;
  onPosted: (c: CommentDto) => void;
  /** The terms changed since this reader accepted them. */
  onTermsRequired?: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const created = await commentsApi.create(articleId, body, parentId);
      setBody('');
      setHeld(created.pending);
      onPosted(created);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'terms_required' && onTermsRequired) onTermsRequired();
      else setError(message(err));
    } finally {
      setSending(false);
    }
  };

  const remaining = COMMENT_LIMITS.maxLength - body.length;
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className={compact ? 'sr-only' : 'text-sm font-bold'}>
        {parentId ? 'התגובה שלך' : 'מה דעתך?'}
      </label>
      <textarea
        id={id}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        minLength={COMMENT_LIMITS.minLength}
        maxLength={COMMENT_LIMITS.maxLength}
        rows={compact ? 2 : 4}
        aria-describedby={`${id}-count`}
        className="w-full resize-y rounded-xl border-[1.5px] border-line bg-white px-4 py-3 text-base leading-relaxed focus:border-ink focus:outline-none"
        placeholder={parentId ? 'כתבו תגובה…' : 'כתבו תגובה לכתבה…'}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={`${id}-count`} className={`text-xs tabular-nums ${remaining < 100 ? 'text-brand-deep' : 'text-muted'}`}>
          נשארו {remaining} תווים
        </span>
        <button
          type="submit"
          disabled={sending || body.trim().length < COMMENT_LIMITS.minLength}
          className="inline-flex h-10 items-center rounded-full bg-brand px-5 text-sm font-extrabold text-white hover:bg-brand-deep disabled:opacity-50"
        >
          {sending ? 'שולח…' : parentId ? 'שליחת תגובה' : 'פרסום תגובה'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-brand-deep">
          {error}
        </p>
      ) : null}
      {held ? (
        <p role="status" className="text-sm text-ink-2">
          התגובה התקבלה ותופיע אחרי בדיקה של המערכת.
        </p>
      ) : null}
      <p className="text-xs text-muted">
        התגובות נבדקות. תגובות פוגעניות, ספאם או פרטים אישיים יוסרו.{' '}
        <Link href="/comment-rules" className="font-semibold text-ink-2 underline underline-offset-2 hover:text-brand">
          כללי ההשתתפות
        </Link>
      </p>
    </form>
  );
}

/** Shown instead of the composer after a new version of the terms, until the reader accepts it. */
function TermsUpdate({ version, onAccepted }: { version: string; onAccepted: (reader: ReaderDto) => void }) {
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAccepted(await readerApi.acceptTerms(version));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-stone p-5">
      <h3 className="text-lg font-extrabold">עדכנו את תנאי השימוש</h3>
      <p className="text-[15px] text-ink-2">כדי להמשיך להגיב, קראו ואשרו את הנוסח המעודכן.</p>
      <TermsCheckbox id={id} checked={checked} onChange={setChecked} />
      <button type="submit" disabled={!checked || busy} className="h-11 self-start rounded-full bg-brand px-5 font-extrabold text-white hover:bg-brand-deep disabled:opacity-50">
        {busy ? 'שומר…' : 'אישור והמשך'}
      </button>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-deep">
          {error}
        </p>
      ) : null}
    </form>
  );
}

type Step = 'email' | 'code' | 'name';

export function SignIn({
  onSignedIn,
  title = 'רוצים להגיב?',
}: {
  onSignedIn: (reader: ReaderDto) => void;
  title?: string;
}) {
  const id = useId();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      // The mailed button brings the reader back to this page, signed in.
      await readerApi.requestCode(email, { acceptTerms: accepted, returnTo: `${window.location.pathname}${window.location.search}` });
      setStep('code');
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    verifyWith(code);
  };

  const verifyWith = (value: string) => {
    void run(async () => {
      try {
        const session = await readerApi.verify(email, value, { displayName: step === 'name' ? name : undefined, acceptTerms: accepted });
        onSignedIn(session.reader);
      } catch (err) {
        if (err instanceof ApiFailure && err.code === 'name_required') {
          setStep('name');
          return;
        }
        if (err instanceof ApiFailure && err.code === 'terms_required') {
          setAccepted(false);
          setStep('email');
        }
        throw err;
      }
    });
  };

  return (
    <div className="rounded-xl bg-stone p-5">
      <h3 className="text-lg font-extrabold">{title}</h3>
      <p className="mt-1 text-[15px] text-ink-2">
        {step === 'email'
          ? 'נשלח אליכם קוד חד-פעמי למייל. בלי סיסמאות.'
          : step === 'code'
            ? `שלחנו מייל אל ${email}: לחצו בו על "התחברות בלחיצה", או הקלידו כאן את הקוד בן 6 הספרות.`
            : 'זו הפעם הראשונה שלכם כאן. בחרו שם שיופיע ליד התגובות.'}
      </p>

      {step === 'email' ? (
        <form onSubmit={requestCode} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <label htmlFor={`${id}-email`} className="sr-only">
              כתובת מייל
            </label>
            <input
              id={`${id}-email`}
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="h-11 min-w-0 flex-[1_1_220px] rounded-full border-[1.5px] border-line bg-white px-4 text-right focus:border-ink focus:outline-none"
            />
            <button type="submit" disabled={busy || !accepted} className="h-11 rounded-full bg-ink px-5 font-extrabold text-white hover:bg-black disabled:opacity-60">
              {busy ? 'שולח…' : 'שלחו לי קוד'}
            </button>
          </div>
          <TermsCheckbox id={`${id}-terms`} checked={accepted} onChange={setAccepted} />
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <label htmlFor={`${id}-code`} className="sr-only">
              קוד אימות
            </label>
            <input
              id={`${id}-code`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              dir="ltr"
              value={code}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                // Six digits (typed, pasted or filled in from the mail): sign in without another click.
                if (next.length === 6 && next !== code && step === 'code' && !busy) verifyWith(next);
              }}
              placeholder="000000"
              className="h-11 w-36 rounded-full border-[1.5px] border-line bg-white px-4 text-center font-mono text-lg tracking-[.3em] focus:border-ink focus:outline-none"
            />
            {step === 'name' ? (
              <>
                <label htmlFor={`${id}-name`} className="sr-only">
                  שם תצוגה
                </label>
                <input
                  id={`${id}-name`}
                  required
                  minLength={2}
                  maxLength={40}
                  autoComplete="nickname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="השם שיופיע ליד התגובות"
                  className="h-11 min-w-0 flex-[1_1_200px] rounded-full border-[1.5px] border-line bg-white px-4 focus:border-ink focus:outline-none"
                />
              </>
            ) : null}
            <button type="submit" disabled={busy} className="h-11 rounded-full bg-brand px-5 font-extrabold text-white hover:bg-brand-deep disabled:opacity-60">
              {busy ? 'בודק…' : 'התחברות'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setStep('email');
              setCode('');
            }}
            className="self-start text-sm font-semibold text-muted underline-offset-2 hover:underline"
          >
            להחליף כתובת או לשלוח קוד חדש
          </button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-brand-deep">
          {error}
        </p>
      ) : null}
    </div>
  );
}
