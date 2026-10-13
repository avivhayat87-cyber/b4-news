import { MIN_READER_AGE } from '@b4/shared';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SITE_URL } from '@/lib/api';
import { colors, fonts } from '@/lib/theme';

export const openSitePage = (slug: string) => void Linking.openURL(`${SITE_URL}/${slug}`);

/** The terms checkbox every sign-up carries (the API refuses a sign-up without it). */
export function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.row}>
      <Pressable
        onPress={() => onChange(!checked)}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`אני בן או בת ${MIN_READER_AGE} ומעלה ומסכים לתנאי השימוש ולמדיניות הפרטיות`}
        style={[s.box, checked && s.boxOn]}
      >
        {checked ? (
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Path d="M5 12.5 10 17l9-10" fill="none" stroke={colors.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : null}
      </Pressable>
      <Text style={s.label} onPress={() => onChange(!checked)}>
        אני בן/בת {MIN_READER_AGE} ומעלה ומסכים/ה ל
        <Text style={s.link} onPress={() => openSitePage('terms')} accessibilityRole="link">
          תנאי השימוש
        </Text>{' '}
        ול
        <Text style={s.link} onPress={() => openSitePage('privacy')} accessibilityRole="link">
          מדיניות הפרטיות
        </Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.ink2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  label: { flex: 1, fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: colors.ink2 },
  link: { fontFamily: fonts.textBold, color: colors.brand, textDecorationLine: 'underline' },
});
