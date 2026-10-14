// "החשבון שלי": display name, sign out, and deleting the account from inside the
// app (required by the App Store and Google Play for apps where readers sign up).
import { DisplayName, type ReaderNotificationDto, type ReaderPrefs } from '@b4/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignIn, useReader } from '@/components/comments';
import { openSitePage } from '@/components/terms-checkbox';
import { TopBar } from '@/components/top-bar';
import { Loading } from '@/components/ui';
import { ApiFailure, api } from '@/lib/api';
import { relinkDevice } from '@/lib/push';
import { colors, fonts, space } from '@/lib/theme';
import { setToken } from '@/lib/token';

const errorText = (e: unknown) => (e instanceof ApiFailure ? e.message : 'משהו השתבש. נסו שוב.');

export default function AccountScreen() {
  const qc = useQueryClient();
  const reader = useReader();
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const signedOut = async () => {
    await setToken(null);
    qc.setQueryData(['reader'], null);
    void qc.invalidateQueries({ queryKey: ['comments'] });
    // Replies and likes stop reaching this phone.
    void relinkDevice();
  };

  const saveName = async () => {
    const parsed = DisplayName.safeParse(name ?? '');
    if (!parsed.success) return Alert.alert('השם לא תקין', parsed.error.issues[0]?.message ?? '');
    try {
      qc.setQueryData(['reader'], await api.rename(parsed.data));
      setName(null);
      Alert.alert('השם עודכן');
    } catch (e) {
      Alert.alert('שגיאה', errorText(e));
    }
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    await signedOut();
  };

  const remove = () =>
    Alert.alert('למחוק את החשבון לצמיתות?', 'נמחק את המייל, שם התצוגה וכל התגובות שכתבת. אי אפשר לבטל את זה.', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחיקה',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await api.deleteAccount();
            await signedOut();
            setDeleted(true);
          } catch (e) {
            Alert.alert('שגיאה', errorText(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const r = reader.data;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.white }}>
      <TopBar />
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Text style={s.heading} accessibilityRole="header">
          החשבון שלי
        </Text>
        {reader.isPending ? (
          <Loading />
        ) : deleted ? (
          <Text style={s.body}>החשבון נמחק, יחד עם התגובות שלך. תודה שקראת אותנו.</Text>
        ) : !r ? (
          <>
            <Text style={s.body}>כדי לנהל את החשבון או למחוק אותו, התחברו עם קוד חד-פעמי למייל.</Text>
            <SignIn title="התחברות לחשבון" onSignedIn={(x) => qc.setQueryData(['reader'], x)} />
          </>
        ) : (
          <>
            <View style={s.card}>
              <Text style={s.label}>מייל</Text>
              <Text style={[s.body, { writingDirection: 'ltr', textAlign: 'right' }]}>{r.email}</Text>
              <Text style={s.label}>שם התצוגה ליד התגובות</Text>
              <TextInput value={name ?? r.displayName} onChangeText={setName} maxLength={40} style={s.input} accessibilityLabel="שם התצוגה" />
              {name !== null && name.trim() !== r.displayName ? (
                <Pressable onPress={saveName} style={s.darkButton} accessibilityRole="button">
                  <Text style={s.buttonText}>שמירת השם</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={logout} hitSlop={8} accessibilityRole="button">
                <Text style={s.link}>התנתקות</Text>
              </Pressable>
            </View>
            <Notifications />
            <View style={[s.card, s.danger]}>
              <Text style={s.cardTitle}>מחיקת החשבון</Text>
              <Text style={s.small}>
                המחיקה סופית: המייל, שם התצוגה, כל התגובות שכתבת והדיווחים ששלחת. ההרשמה לניוזלטר נפרדת, ואפשר להסיר אותה בקישור שבכל דיוור.
              </Text>
              <Pressable onPress={remove} disabled={busy} style={[s.outlineDanger, busy && { opacity: 0.5 }]} accessibilityRole="button">
                <Text style={s.outlineDangerText}>{busy ? 'מוחק…' : 'מחיקת החשבון'}</Text>
              </Pressable>
            </View>
          </>
        )}
        <Text style={s.small} onPress={() => openSitePage('privacy')} accessibilityRole="link">
          מה אנחנו שומרים ולמה: <Text style={s.link}>מדיניות הפרטיות</Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const NOTICE: Record<ReaderNotificationDto['kind'], (actor: string | null) => string> = {
  reply: (a) => `${a ?? 'מישהו'} הגיב/ה לך`,
  like: (a) => `${a ?? 'מישהו'} אהב/ה את התגובה שלך`,
  pick: () => 'התגובה שלך נבחרה ל"בחירת העורכים"',
};

/** Replies, likes and the editors' pick: the latest, and how to hear about them. */
function Notifications() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.prefs });
  const unread = list.data?.unread ?? 0;
  useEffect(() => {
    // Seen here: they won't be mailed.
    if (unread > 0) void api.markNotificationsRead().catch(() => undefined);
  }, [unread]);
  const save = async (next: ReaderPrefs) => {
    qc.setQueryData(['prefs'], next);
    try {
      qc.setQueryData(['prefs'], await api.savePrefs(next));
    } catch (e) {
      Alert.alert('שגיאה', errorText(e));
      void prefs.refetch();
    }
  };
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>התראות{unread > 0 ? ` (${unread} חדשות)` : ''}</Text>
      {list.data?.items.length ? (
        list.data.items.slice(0, 10).map((n) => (
          <Pressable key={n.id} onPress={() => router.push(`/article/${n.article.slug}` as never)} accessibilityRole="link" style={s.notice}>
            <Text style={[s.small, { fontFamily: fonts.textBold, color: colors.ink }]}>{NOTICE[n.kind](n.actor)}</Text>
            <Text style={s.small} numberOfLines={2}>
              {n.excerpt}
            </Text>
            <Text style={[s.small, { color: colors.muted }]} numberOfLines={1}>
              {n.article.title}
            </Text>
          </Pressable>
        ))
      ) : (
        <Text style={s.small}>עוד אין התראות. כשיגיבו לתגובות שלך או יאהבו אותן, זה יופיע כאן.</Text>
      )}
      {prefs.data ? (
        <>
          <View style={s.switchRow}>
            <Text style={[s.small, { flex: 1 }]}>התראה בטלפון</Text>
            <Switch value={prefs.data.notifyPush} onValueChange={(v) => void save({ ...prefs.data!, notifyPush: v })} accessibilityLabel="התראה בטלפון" />
          </View>
          <View style={s.switchRow}>
            <Text style={[s.small, { flex: 1 }]}>מייל מרוכז (לכל היותר פעם בשעה)</Text>
            <Switch value={prefs.data.notifyEmail} onValueChange={(v) => void save({ ...prefs.data!, notifyEmail: v })} accessibilityLabel="מייל מרוכז" />
          </View>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  notice: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: space.sm, gap: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  page: { padding: space.lg, gap: space.lg, paddingBottom: 48 },
  heading: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  body: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: colors.ink2 },
  small: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: colors.ink2 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: space.lg, gap: space.sm },
  danger: { borderColor: colors.brandSoft, borderWidth: 2 },
  cardTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  label: { fontFamily: fonts.textBold, fontSize: 13, color: colors.muted, marginTop: space.xs },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: fonts.text, fontSize: 16, color: colors.ink },
  darkButton: { alignSelf: 'flex-start', backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 20, height: 42, justifyContent: 'center' },
  buttonText: { fontFamily: fonts.textHeavy, fontSize: 14, color: colors.white },
  link: { fontFamily: fonts.textBold, fontSize: 15, color: colors.brand, textDecorationLine: 'underline' },
  outlineDanger: { alignSelf: 'flex-start', borderWidth: 2, borderColor: colors.brand, borderRadius: 999, paddingHorizontal: 20, height: 42, justifyContent: 'center' },
  outlineDangerText: { fontFamily: fonts.textHeavy, fontSize: 14, color: colors.brand },
});
