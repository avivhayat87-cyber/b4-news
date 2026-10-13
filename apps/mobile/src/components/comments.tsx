import { COMMENT_LIMITS, type CommentDto, type ReaderDto } from '@b4/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiFailure, SITE_URL, api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { colors, fonts, rtl, space } from '@/lib/theme';
import { setToken } from '@/lib/token';
import { TermsCheckbox, openSitePage } from './terms-checkbox';
import { SectionHeader } from './ui';

const errorText = (err: unknown) => (err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.');

export function useReader() {
  return useQuery({ queryKey: ['reader'], queryFn: api.me, staleTime: Infinity });
}

export function Comments({ articleId, articleSlug, enabled }: { articleId: number; articleSlug: string; enabled: boolean }) {
  const qc = useQueryClient();
  const reader = useReader();
  const list = useInfiniteQuery({
    queryKey: ['comments', articleId],
    queryFn: ({ pageParam }) => api.comments(articleId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ['comments', articleId] });

  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={`תגובות (${total})`} />
      <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
        {!enabled ? (
          <Text style={s.note}>התגובות לכתבה הזאת סגורות.</Text>
        ) : reader.data ? (
          <>
            <Text style={s.small}>
              מגיב/ה בתור <Text style={{ fontFamily: fonts.textBold, color: colors.ink }}>{reader.data.displayName}</Text>
              {' · '}
              <Text style={s.inlineLink} onPress={() => router.push('/account')} accessibilityRole="link">
                החשבון שלי
              </Text>
            </Text>
            {reader.data.termsAccepted ? (
              <Composer articleId={articleId} onPosted={refresh} onTermsRequired={() => void qc.invalidateQueries({ queryKey: ['reader'] })} />
            ) : (
              <TermsUpdate onAccepted={(r) => qc.setQueryData(['reader'], r)} />
            )}
          </>
        ) : reader.isFetched ? (
          <SignIn
            onSignedIn={(r) => {
              qc.setQueryData(['reader'], r);
              void refresh();
            }}
          />
        ) : null}

        {items.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            articleId={articleId}
            articleSlug={articleSlug}
            signedIn={Boolean(reader.data)}
            canReply={enabled && Boolean(reader.data?.termsAccepted)}
            onChanged={refresh}
          />
        ))}
        {list.isFetched && items.length === 0 ? <Text style={s.note}>עדיין אין תגובות. אפשר להיות הראשונים.</Text> : null}
        {list.hasNextPage ? (
          <Pressable onPress={() => list.fetchNextPage()} style={s.outlineButton} accessibilityRole="button">
            <Text style={s.outlineButtonText}>{list.isFetchingNextPage ? 'טוען…' : 'תגובות נוספות'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function CommentRow({
  comment,
  articleId,
  articleSlug,
  signedIn,
  canReply,
  onChanged,
}: {
  comment: CommentDto;
  articleId: number;
  articleSlug: string;
  signedIn: boolean;
  canReply: boolean;
  onChanged: () => void;
}) {
  const [replying, setReplying] = useState(false);
  // The formal removal request is a form on the site, open to anyone.
  const takedown = () =>
    void Linking.openURL(`${SITE_URL}/report?url=${encodeURIComponent(`${SITE_URL}/article/${articleSlug}#comments`)}&comment=${comment.id}`);

  const report = () =>
    Alert.alert('דיווח על תגובה', 'מה הבעיה בתגובה?', [
      ...(
        [
          ['spam', 'ספאם'],
          ['abuse', 'תוכן פוגעני'],
          ['misinformation', 'מידע שגוי'],
        ] as const
      ).map(([reason, label]) => ({
        text: label,
        onPress: () =>
          api
            .reportComment(comment.id, reason)
            .then(() => Alert.alert('תודה', 'הדיווח התקבל ויבדק.'))
            .catch((e) => Alert.alert('שגיאה', errorText(e))),
      })),
      { text: 'פוגע בי: בקשת הסרה', onPress: takedown },
      { text: 'ביטול', style: 'cancel' as const },
    ]);

  const remove = () =>
    Alert.alert('למחוק את התגובה?', undefined, [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחיקה', style: 'destructive', onPress: () => api.deleteComment(comment.id).then(onChanged).catch((e) => Alert.alert('שגיאה', errorText(e))) },
    ]);

  return (
    <View style={[s.comment, comment.parentId && s.reply]}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{comment.author.displayName.trim().charAt(0) || '?'}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
          <Text style={s.name}>{comment.author.displayName}</Text>
          <Text style={s.small}>{relativeTime(comment.createdAt)}</Text>
          {comment.pending ? <Text style={s.pending}>ממתינה לאישור</Text> : null}
        </View>
        <Text style={s.body} selectable>
          {comment.body}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.lg }}>
          {canReply && !comment.parentId && !comment.pending ? (
            <Pressable onPress={() => setReplying((v) => !v)} hitSlop={8} accessibilityRole="button">
              <Text style={s.action}>הגבה</Text>
            </Pressable>
          ) : null}
          {comment.isMine ? (
            <Pressable onPress={remove} hitSlop={8} accessibilityRole="button">
              <Text style={s.action}>מחיקה</Text>
            </Pressable>
          ) : !comment.pending ? (
            <Pressable onPress={signedIn ? report : takedown} hitSlop={8} accessibilityRole="button">
              <Text style={s.action}>דיווח</Text>
            </Pressable>
          ) : null}
        </View>
        {replying ? (
          <Composer
            articleId={articleId}
            parentId={comment.id}
            onPosted={() => {
              setReplying(false);
              onChanged();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function Composer({
  articleId,
  parentId,
  onPosted,
  onTermsRequired,
}: {
  articleId: number;
  parentId?: string;
  onPosted: () => void;
  /** The terms changed since this reader accepted them. */
  onTermsRequired?: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.postComment(articleId, body, parentId);
      setBody('');
      setHeld(created.pending);
      onPosted();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'terms_required' && onTermsRequired) onTermsRequired();
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={COMMENT_LIMITS.maxLength}
        placeholder={parentId ? 'כתבו תגובה…' : 'מה דעתך?'}
        placeholderTextColor={colors.muted}
        style={[s.input, { minHeight: parentId ? 64 : 96, textAlignVertical: 'top' }]}
        accessibilityLabel="התגובה שלך"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={s.small}>נשארו {COMMENT_LIMITS.maxLength - body.length} תווים</Text>
        <Pressable
          onPress={submit}
          disabled={busy || body.trim().length < COMMENT_LIMITS.minLength}
          style={({ pressed }) => [s.button, (busy || body.trim().length < COMMENT_LIMITS.minLength) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
        >
          <Text style={s.buttonText}>{busy ? 'שולח…' : 'פרסום'}</Text>
        </Pressable>
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {held ? <Text style={s.small}>התגובה התקבלה ותופיע אחרי בדיקה.</Text> : null}
      {parentId ? null : (
        <Text style={s.small}>
          תגובות פוגעניות, ספאם או פרטים אישיים יוסרו.{' '}
          <Text style={s.inlineLink} onPress={() => openSitePage('comment-rules')} accessibilityRole="link">
            כללי ההשתתפות
          </Text>
        </Text>
      )}
    </View>
  );
}

/** Instead of the composer after a new terms version, until the reader accepts it. */
function TermsUpdate({ onAccepted }: { onAccepted: (r: ReaderDto) => void }) {
  const site = useQuery({ queryKey: ['site'], queryFn: api.site, staleTime: 10 * 60_000 });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!site.data) return;
    setBusy(true);
    setError(null);
    try {
      onAccepted(await api.acceptTerms(site.data.consent.version));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.signIn}>
      <Text style={s.signInTitle}>עדכנו את תנאי השימוש</Text>
      <Text style={s.signInBody}>כדי להמשיך להגיב, קראו ואשרו את הנוסח המעודכן.</Text>
      <TermsCheckbox checked={checked} onChange={setChecked} />
      <Pressable onPress={submit} disabled={!checked || busy || !site.data} style={[s.button, (!checked || busy) && { opacity: 0.5 }]} accessibilityRole="button">
        <Text style={s.buttonText}>{busy ? 'שומר…' : 'אישור והמשך'}</Text>
      </Pressable>
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export function SignIn({ onSignedIn, title = 'רוצים להגיב?' }: { onSignedIn: (r: ReaderDto) => void; title?: string }) {
  const [step, setStep] = useState<'email' | 'code' | 'name'>('email');
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
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'name_required') setStep('name');
      else {
        if (e instanceof ApiFailure && e.code === 'terms_required') {
          setAccepted(false);
          setStep('email');
        }
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      await api.requestCode(email.trim());
      setStep('code');
    });

  const verify = () =>
    run(async () => {
      const session = await api.verify(email.trim(), code, { displayName: step === 'name' ? name.trim() : undefined, acceptTerms: accepted });
      if (session.token) await setToken(session.token);
      onSignedIn(session.reader);
    });

  return (
    <View style={s.signIn}>
      <Text style={s.signInTitle}>{title}</Text>
      <Text style={s.signInBody}>
        {step === 'email'
          ? 'נשלח אליכם קוד חד-פעמי למייל. בלי סיסמאות.'
          : step === 'code'
            ? `שלחנו קוד בן 6 ספרות אל ${email}.`
            : 'זו הפעם הראשונה שלכם כאן. בחרו שם שיופיע ליד התגובות.'}
      </Text>
      {step === 'email' ? (
        <TextInput
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          placeholder="name@example.com"
          placeholderTextColor={colors.muted}
          style={[s.input, { writingDirection: 'ltr', textAlign: 'right' }]}
          accessibilityLabel="כתובת מייל"
          onSubmitEditing={() => accepted && requestCode()}
        />
      ) : (
        <>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="000000"
            placeholderTextColor={colors.muted}
            style={[s.input, s.codeInput]}
            accessibilityLabel="קוד אימות"
          />
          {step === 'name' ? (
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={40}
              placeholder="השם שיופיע ליד התגובות"
              placeholderTextColor={colors.muted}
              style={s.input}
              accessibilityLabel="שם תצוגה"
            />
          ) : null}
        </>
      )}
      {step === 'email' ? <TermsCheckbox checked={accepted} onChange={setAccepted} /> : null}
      <Pressable
        onPress={step === 'email' ? requestCode : verify}
        disabled={busy || (step === 'email' && !accepted)}
        style={[s.button, (busy || (step === 'email' && !accepted)) && { opacity: 0.5 }]}
        accessibilityRole="button"
      >
        <Text style={s.buttonText}>{busy ? 'רגע…' : step === 'email' ? 'שלחו לי קוד' : 'התחברות'}</Text>
      </Pressable>
      {step !== 'email' ? (
        <Pressable onPress={() => setStep('email')} hitSlop={8}>
          <Text style={s.action}>להחליף כתובת או לשלוח קוד חדש</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  note: { fontFamily: fonts.text, fontSize: 15, color: colors.ink2 },
  small: { fontFamily: fonts.text, fontSize: 13, color: colors.muted },
  comment: { flexDirection: 'row', gap: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  reply: { ...rtl.marginStart(36), ...rtl.padStart(space.md), borderTopWidth: 0, ...rtl.borderStart(2, colors.line) },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.stone, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.display, fontSize: 17, color: colors.ink2 },
  name: { fontFamily: fonts.textBold, fontSize: 14, color: colors.ink },
  pending: { fontFamily: fonts.textBold, fontSize: 11, color: colors.pendingText, backgroundColor: colors.pending, borderRadius: 999, paddingHorizontal: 8, overflow: 'hidden' },
  body: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: colors.ink },
  action: { fontFamily: fonts.textSemi, fontSize: 13, color: colors.muted },
  inlineLink: { fontFamily: fonts.textBold, color: colors.ink2, textDecorationLine: 'underline' },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.text,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  codeInput: { fontSize: 22, letterSpacing: 8, textAlign: 'center', writingDirection: 'ltr' },
  button: { alignSelf: 'flex-start', backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 20, height: 42, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: fonts.textHeavy, fontSize: 14, color: colors.white },
  outlineButton: { alignSelf: 'center', borderWidth: 2, borderColor: colors.ink, borderRadius: 999, paddingHorizontal: 20, height: 42, justifyContent: 'center' },
  outlineButtonText: { fontFamily: fonts.textHeavy, fontSize: 14, color: colors.ink },
  error: { fontFamily: fonts.textSemi, fontSize: 13, color: colors.brandDeep },
  signIn: { backgroundColor: colors.stone, borderRadius: 16, padding: space.lg, gap: space.sm },
  signInTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  signInBody: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: colors.ink2 },
});
