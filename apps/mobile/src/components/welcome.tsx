// First launch (and after a new terms version): accept the terms, then, on a device
// that hasn't been asked yet, an explanation of breaking-news notifications before
// the system prompt.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useConsentGate } from '@/lib/consent';
import { enablePush, pushPermission } from '@/lib/push';
import { colors, fonts, space } from '@/lib/theme';
import { Logo } from './brand';
import { TermsCheckbox, openSitePage } from './terms-checkbox';

/**
 * Covers every screen (deep links from notifications and shared links included) until
 * the terms are accepted; the navigator stays mounted underneath.
 */
export function ConsentOverlay() {
  const consent = useConsentGate();
  // Stays up through the notifications question, after the terms are accepted.
  const [welcoming, setWelcoming] = useState(false);
  if (!consent.loading && !consent.needed && !welcoming) return null;
  return (
    <View style={StyleSheet.absoluteFill}>
      {consent.loading ? (
        <View style={{ flex: 1, backgroundColor: colors.white }} />
      ) : (
        <Welcome
          onAccept={async () => {
            setWelcoming(true);
            await consent.accept();
          }}
          onDone={() => setWelcoming(false)}
        />
      )}
    </View>
  );
}

function Welcome({ onAccept, onDone }: { onAccept: () => Promise<void>; onDone: () => void }) {
  const [step, setStep] = useState<'terms' | 'push'>('terms');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    await onAccept();
    const permission = await pushPermission().catch(() => 'unsupported' as const);
    setBusy(false);
    if (permission === 'undetermined') setStep('push');
    else onDone();
  };

  const answerPush = async (yes: boolean) => {
    if (yes) {
      setBusy(true);
      await enablePush();
      setBusy(false);
    }
    onDone();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
      <ScrollView contentContainerStyle={s.page}>
        <Logo width={150} />
        {step === 'terms' ? (
          <>
            <Text style={s.title} accessibilityRole="header">
              ברוכים הבאים ל-B4 NEW&apos;S
            </Text>
            <Text style={s.body}>חדשות כלכלה, שוק ההון, נדל״ן והייטק, בשפה ברורה. לפני שמתחילים, צריך לאשר את התנאים.</Text>
            <View style={s.box}>
              <Text style={s.boxText}>
                התוכן באפליקציה הוא מידע כללי בלבד, ואינו ייעוץ השקעות או המלצה לקנות או למכור ניירות ערך. תגובות נכתבות מגיל 18, בהתאם לכללי ההשתתפות.
              </Text>
              <Text style={s.links}>
                <Text style={s.link} onPress={() => openSitePage('terms')} accessibilityRole="link">
                  תנאי השימוש
                </Text>
                {'  ·  '}
                <Text style={s.link} onPress={() => openSitePage('privacy')} accessibilityRole="link">
                  מדיניות הפרטיות
                </Text>
                {'  ·  '}
                <Text style={s.link} onPress={() => openSitePage('comment-rules')} accessibilityRole="link">
                  כללי התגובות
                </Text>
              </Text>
            </View>
            <TermsCheckbox checked={checked} onChange={setChecked} />
            <Pressable onPress={accept} disabled={!checked || busy} style={[s.primary, (!checked || busy) && { opacity: 0.5 }]} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={s.primaryText}>אישור והמשך</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.title} accessibilityRole="header">
              מבזקים חשובים, ישר אליך
            </Text>
            <Text style={s.body}>נשלח התראה רק על חדשות כלכליות חשובות באמת: החלטות ריבית, תנודות חדות בשוק, שינויים שנוגעים לכיס. אפשר לבטל בכל עת בהגדרות המכשיר.</Text>
            <Pressable onPress={() => answerPush(true)} disabled={busy} style={[s.primary, busy && { opacity: 0.5 }]} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={s.primaryText}>כן, שלחו לי מבזקים</Text>}
            </Pressable>
            <Pressable onPress={() => answerPush(false)} disabled={busy} style={s.secondary} accessibilityRole="button">
              <Text style={s.secondaryText}>לא עכשיו</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.lg },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.ink },
  body: { fontFamily: fonts.text, fontSize: 17, lineHeight: 26, color: colors.ink2 },
  box: { backgroundColor: colors.stone, borderRadius: 14, padding: space.lg, gap: space.sm },
  boxText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: colors.ink2 },
  links: { fontFamily: fonts.text, fontSize: 14, color: colors.muted },
  link: { fontFamily: fonts.textBold, color: colors.brand, textDecorationLine: 'underline' },
  primary: { backgroundColor: colors.brand, borderRadius: 999, height: 50, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.textHeavy, fontSize: 16, color: colors.white },
  secondary: { height: 46, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: fonts.textBold, fontSize: 15, color: colors.ink2 },
});
