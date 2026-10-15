// Ads in the app (the home feed every few stories, and after an article), calm and labeled:
// "פרסומת" and the advertiser's name above it, then a banner, or a card with a picture, a headline
// and a button. A link ad opens the advertiser's page through our counting address; a lead ad opens
// a short form in place, with explicit consent.
import { AD_LABEL, AD_LEAD_FIELD_LABELS, AD_SIZES, type AdLeadField, type PublicAd } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { countSeen, reachedCap, viewTimer } from '@/lib/ads';
import { ApiFailure, api } from '@/lib/api';
import { colors, fonts, space } from '@/lib/theme';

function LeadForm({ ad }: { ad: PublicAd }) {
  const lead = ad.lead!;
  const [fields, setFields] = useState<Partial<Record<AdLeadField, string>>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!consent) return setError('צריך לאשר שיחזרו אליך.');
    setBusy(true);
    setError(null);
    try {
      setDone((await api.adLead({ token: ad.token, fields, consent: true })).thankYou);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'השליחה נכשלה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Text style={[s.formBox, s.done]}>{done}</Text>;
  return (
    <View style={s.formBox}>
      {lead.question ? <Text style={s.question}>{lead.question}</Text> : null}
      {lead.fields.map((f) => (
        <View key={f} style={{ gap: 4 }}>
          <Text style={s.fieldLabel}>{AD_LEAD_FIELD_LABELS[f]}</Text>
          <TextInput
            style={s.input}
            value={fields[f] ?? ''}
            onChangeText={(v) => setFields({ ...fields, [f]: v })}
            keyboardType={f === 'phone' ? 'phone-pad' : f === 'email' ? 'email-address' : 'default'}
            autoComplete={f === 'name' ? 'name' : f === 'phone' ? 'tel' : f === 'email' ? 'email' : 'off'}
            autoCapitalize="none"
            maxLength={f === 'note' ? 1000 : 300}
            accessibilityLabel={AD_LEAD_FIELD_LABELS[f]}
          />
        </View>
      ))}
      <Pressable onPress={() => setConsent(!consent)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }} style={s.consentRow}>
        <View style={[s.box, consent && s.boxOn]}>
          {consent ? (
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Path d="M5 12.5 10 17l9-10" fill="none" stroke={colors.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          ) : null}
        </View>
        <Text style={s.consent}>{lead.consent}</Text>
      </Pressable>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable onPress={submit} disabled={busy} accessibilityRole="button" style={({ pressed }) => [s.submit, (pressed || busy) && { opacity: 0.7 }]}>
        <Text style={s.submitText}>{busy ? 'שולח…' : 'שליחה'}</Text>
      </Pressable>
      <Text style={s.small}>הפרטים עוברים ל{ad.sponsor} בלבד, כדי שיחזרו אליך.</Text>
    </View>
  );
}

/** One ad place in the home feed: it asks for its ad once, skipping campaigns already in the feed or seen enough today. */
export function FeedAd({ pos, taken, onToken }: { pos: number; taken: Set<string>; onToken(pos: number, token: string): void }) {
  const q = useQuery({
    queryKey: ['ad', 'app_feed', pos],
    queryFn: () => api.ad('app_feed', { exclude: [...new Set([...reachedCap(), ...taken])] }),
    staleTime: Infinity,
  });
  const ad = q.data?.ad ?? null;
  useEffect(() => {
    if (!ad) return;
    taken.add(ad.campaignId);
    countSeen(ad);
    onToken(pos, ad.token);
  }, [ad, pos, taken, onToken]);
  return ad ? (
    <View style={{ paddingHorizontal: space.lg }}>
      <AdCard ad={ad} />
    </View>
  ) : null;
}

/**
 * The ad after an article (inside its scroll view): the screen tells it how far the reader
 * scrolled, and a view is counted once half of it was on screen for a second.
 */
export function ArticleAd({ category, scroll }: { category: string; scroll: { y: number; height: number } }) {
  const q = useQuery({ queryKey: ['ad', 'app_article', category], queryFn: () => api.ad('app_article', { category, exclude: reachedCap() }), staleTime: 60_000 });
  const ad = q.data?.ad ?? null;
  const [box, setBox] = useState<{ y: number; h: number } | null>(null);
  const timer = useMemo(() => (ad ? viewTimer(() => void api.adSeen(ad.token)) : null), [ad]);
  useEffect(() => {
    if (ad) countSeen(ad);
  }, [ad]);
  useEffect(() => {
    if (!timer || !box || !box.h) return;
    const visible = Math.min(scroll.y + scroll.height, box.y + box.h) - Math.max(scroll.y, box.y);
    timer(Math.max(0, visible) / box.h);
  }, [timer, box, scroll]);
  if (!ad) return null;
  return (
    <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }} onLayout={(e) => setBox({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}>
      <AdCard ad={ad} />
    </View>
  );
}

export function AdCard({ ad }: { ad: PublicAd }) {
  const [open, setOpen] = useState(false);
  const press = () => {
    if (ad.action === 'link' && ad.href) void Linking.openURL(ad.href);
    else if (!open) {
      void api.adSeen(ad.token, 'open');
      setOpen(true);
    }
  };
  const size = AD_SIZES[ad.format][ad.format === 'billboard' ? 'mobile' : 'desktop'];
  const banner = ad.image.mobile ?? ad.image.desktop;
  return (
    <View style={s.wrap} accessibilityLabel={`${AD_LABEL}: ${ad.sponsor}`}>
      <View style={s.labelRow}>
        <Text style={s.label}>{AD_LABEL}</Text>
        {ad.sponsor ? <Text style={s.sponsor}>בחסות {ad.sponsor}</Text> : null}
      </View>
      <Pressable onPress={press} accessibilityRole={ad.action === 'link' ? 'link' : 'button'} accessibilityLabel={ad.headline || ad.image.alt || ad.sponsor} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        {ad.format === 'native' ? (
          <View style={s.card}>
            {ad.image.desktop ? <Image source={{ uri: ad.image.desktop }} style={s.cardImage} contentFit="cover" /> : null}
            <View style={s.cardText}>
              <Text style={s.headline}>{ad.headline}</Text>
              {ad.body ? <Text style={s.body}>{ad.body}</Text> : null}
              {ad.cta ? <Text style={s.cta}>{ad.cta}</Text> : null}
            </View>
          </View>
        ) : banner ? (
          <Image source={{ uri: banner }} style={[s.banner, { aspectRatio: size.width / size.height, maxWidth: size.width }]} contentFit="contain" accessibilityLabel={ad.image.alt} />
        ) : null}
      </Pressable>
      {open && ad.lead ? <LeadForm ad={ad} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, paddingVertical: space.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.textBold, fontSize: 11, color: colors.ink2, backgroundColor: colors.stone, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  sponsor: { fontFamily: fonts.text, fontSize: 12, color: colors.muted },
  card: { borderRadius: 12, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', backgroundColor: colors.white },
  cardImage: { width: '100%', aspectRatio: 16 / 9 },
  cardText: { padding: space.md, gap: 6 },
  headline: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 23, color: colors.ink },
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: colors.ink2 },
  cta: { alignSelf: 'flex-start', fontFamily: fonts.textBold, fontSize: 13, color: colors.white, backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, overflow: 'hidden' },
  banner: { width: '100%', alignSelf: 'center', borderRadius: 6 },
  formBox: { marginTop: space.sm, gap: space.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: space.md },
  done: { fontFamily: fonts.textBold, fontSize: 15, color: colors.ink, backgroundColor: colors.stone, overflow: 'hidden' },
  question: { fontFamily: fonts.textBold, fontSize: 16, color: colors.ink },
  fieldLabel: { fontFamily: fonts.textSemi, fontSize: 13, color: colors.ink2 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.text, fontSize: 16, color: colors.ink, textAlign: 'right' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.ink2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  consent: { flex: 1, fontFamily: fonts.text, fontSize: 13, lineHeight: 20, color: colors.ink2 },
  error: { fontFamily: fonts.textBold, fontSize: 14, color: colors.brandDeep },
  submit: { height: 44, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontFamily: fonts.textHeavy, fontSize: 15, color: colors.white },
  small: { fontFamily: fonts.text, fontSize: 12, color: colors.muted },
});
