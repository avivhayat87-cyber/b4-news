// A real photo of the public figure an article is about, only from a source that allows its use
// with a credit: Wikimedia Commons, where every file carries its license (many photos of Israeli
// officials there come from the Government Press Office and the Knesset). Only free licenses that
// allow commercial use and changes (cropping) are taken; the credit goes under the photo on the
// site. A photo on any other site is never taken, credit or not. Searching costs nothing.
import type { Services } from './context';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
/** Free licenses that allow a news site with ads to use and crop the photo (no NC, no ND). */
const FREE_LICENSE = /^(cc0|pd|public domain|cc[ -]by(-sa)?[ -]\d)/i;
const NOT_FREE = /\b(nc|nd)\b|non-?commercial|no ?deriv/i;

export type PublicPhoto = {
  /** The image itself, at most 1600px wide. */
  data: Buffer;
  /** What goes under the photo: "צילום: <author> / ויקישיתוף (<license>)". */
  credit: string;
  license: string;
  /** The file's page, as proof of where it came from and under what license. */
  sourceUrl: string;
  alt: string;
};

type CommonsPage = {
  title?: string;
  imageinfo?: {
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
};

/** Commons fields are HTML: the text only, without tags or entities. */
function plain(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The search query and the check that a file really is about the person (their surname in its name or description). */
function matchesPerson(page: CommonsPage, nameEn: string): boolean {
  const surname = nameEn.trim().split(/\s+/).at(-1)?.toLowerCase() ?? '';
  if (surname.length < 3) return false;
  const text = `${page.title ?? ''} ${plain(page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value)}`.toLowerCase();
  return text.includes(surname);
}

/**
 * The best freely licensed photo of a public figure on Wikimedia Commons, downloaded, or null when
 * there is none (or Commons can't be reached: the drawn options are enough).
 */
export async function findPublicPhoto(s: Services, person: { he: string; en: string }): Promise<PublicPhoto | null> {
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${person.en} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1600',
    iiextmetadatafilter: 'LicenseShortName|License|Artist|Credit|ImageDescription|AttributionRequired',
  });
  let pages: CommonsPage[];
  try {
    const res = await s.fetch(`${COMMONS_API}?${query}`, { accept: 'application/json', allowTypes: ['application/json'], maxBytes: 2 * 1024 * 1024 });
    const body = JSON.parse(res.body.toString('utf8')) as { query?: { pages?: Record<string, CommonsPage & { index?: number }> } };
    pages = Object.values(body.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  } catch (e) {
    s.log.warn({ person: person.en, err: e instanceof Error ? e.message : e }, 'public photo search failed');
    return null;
  }
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = plain(meta.LicenseShortName?.value);
    const machine = plain(meta.License?.value);
    if (!info?.descriptionurl || !(info.thumburl ?? info.url)) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) continue;
    if ((info.width ?? 0) < 600 || (info.height ?? 0) < 400) continue;
    if (!(FREE_LICENSE.test(machine) || FREE_LICENSE.test(license)) || NOT_FREE.test(`${machine} ${license}`)) continue;
    if (!matchesPerson(page, person.en)) continue;
    const author = plain(meta.Artist?.value).slice(0, 80) || plain(meta.Credit?.value).slice(0, 80) || 'לא ידוע';
    try {
      const img = await s.fetch(info.thumburl ?? info.url!, { accept: 'image/*', allowTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 15 * 1024 * 1024 });
      return {
        data: img.body,
        credit: `צילום: ${author} / ויקישיתוף (${license || machine})`.slice(0, 200),
        license: license || machine,
        sourceUrl: info.descriptionurl,
        alt: person.he,
      };
    } catch (e) {
      s.log.warn({ file: page.title, err: e instanceof Error ? e.message : e }, 'public photo download failed');
    }
  }
  return null;
}
