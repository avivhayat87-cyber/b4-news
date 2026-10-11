// Renders the article HTML produced by the CMS (a small, sanitized subset:
// p, h2, h3, blockquote, ul/ol/li, a, strong/b, em/i, br) as native text.
import { router } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, rtl } from '@/lib/theme';

type Span = { text: string; bold?: boolean; italic?: boolean; href?: string };
type Block = { kind: 'p' | 'h2' | 'h3' | 'quote'; spans: Span[] } | { kind: 'ul' | 'ol'; items: Span[][] };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseArticleHtml(html: string): Block[] {
  const blocks: Block[] = [];
  let current: Span[] | null = null;
  let list: { kind: 'ul' | 'ol'; items: Span[][] } | null = null;
  const style = { bold: 0, italic: 0, href: undefined as string | undefined };

  const startBlock = (kind: 'p' | 'h2' | 'h3' | 'quote') => {
    current = [];
    blocks.push({ kind, spans: current });
  };
  const push = (text: string) => {
    if (!text) return;
    if (!current) {
      if (!text.trim()) return;
      startBlock('p');
    }
    current!.push({ text, bold: style.bold > 0 || undefined, italic: style.italic > 0 || undefined, href: style.href });
  };

  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, closing, rawTag, attrs, text] = m;
    if (text !== undefined) {
      push(decode(text.replace(/\s+/g, ' ')));
      continue;
    }
    const tag = rawTag!.toLowerCase();
    const open = !closing;
    switch (tag) {
      case 'p':
      case 'h2':
      case 'h3':
      case 'blockquote':
        if (open) startBlock(tag === 'blockquote' ? 'quote' : tag);
        else current = null;
        break;
      case 'ul':
      case 'ol':
        if (open) {
          list = { kind: tag, items: [] };
          blocks.push(list);
        } else list = null;
        current = null;
        break;
      case 'li':
        if (open && list) {
          current = [];
          list.items.push(current);
        } else current = null;
        break;
      case 'strong':
      case 'b':
        style.bold += open ? 1 : -1;
        break;
      case 'em':
      case 'i':
        style.italic += open ? 1 : -1;
        break;
      case 'a':
        style.href = open ? /href\s*=\s*"([^"]*)"/i.exec(attrs ?? '')?.[1] : undefined;
        break;
      case 'br':
        push('\n');
        break;
      default:
        break; // unknown tags: keep their text
    }
  }
  return blocks.filter((b) => ('spans' in b ? b.spans.some((s) => s.text.trim()) : b.items.length > 0));
}

function openLink(href: string) {
  if (href.startsWith('/article/') || href.startsWith('/a/')) router.push(href as never);
  else if (/^https?:\/\//.test(href)) void Linking.openURL(href);
}

function Spans({ spans }: { spans: Span[] }) {
  return spans.map((s, i) => (
    <Text
      key={i}
      style={[s.bold && { fontFamily: fonts.textBold }, s.italic && { fontStyle: 'italic' }, s.href && styles.link]}
      onPress={s.href ? () => openLink(s.href!) : undefined}
      accessibilityRole={s.href ? 'link' : undefined}
    >
      {s.text}
    </Text>
  ));
}

export function ArticleBody({ html }: { html: string }) {
  const blocks = parseArticleHtml(html);
  return (
    <View style={{ gap: 18 }}>
      {blocks.map((b, i) => {
        if ('items' in b) {
          return (
            <View key={i} style={{ gap: 6 }}>
              {b.items.map((item, j) => (
                <View key={j} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={styles.body}>{b.kind === 'ol' ? `${j + 1}.` : '•'}</Text>
                  <Text style={[styles.body, { flex: 1 }]}>
                    <Spans spans={item} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        const style = b.kind === 'h2' ? styles.h2 : b.kind === 'h3' ? styles.h3 : b.kind === 'quote' ? styles.quote : styles.body;
        return (
          <Text key={i} style={style} accessibilityRole={b.kind === 'h2' || b.kind === 'h3' ? 'header' : undefined}>
            <Spans spans={b.spans} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.text, fontSize: 18, lineHeight: 30, color: colors.ink },
  h2: { fontFamily: fonts.display, fontSize: 22, lineHeight: 29, color: colors.ink, marginTop: 8 },
  h3: { fontFamily: fonts.displayBold, fontSize: 19, lineHeight: 26, color: colors.ink },
  quote: {
    fontFamily: fonts.textBold,
    fontSize: 20,
    lineHeight: 30,
    color: colors.ink,
    ...rtl.borderStart(4, colors.brand),
    ...rtl.padStart(14),
  },
  link: { color: colors.brand, textDecorationLine: 'underline' },
});
