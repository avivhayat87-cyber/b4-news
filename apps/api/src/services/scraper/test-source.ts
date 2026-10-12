// The developer's dry run of a source configuration: what would be found, and
// how the first article reads. Nothing is saved.
import type { ConfigureSourceInput, SourceTestResult } from '@b4/shared';
import type { Fetcher } from './collect';
import { categoryFor, completeItem, listItems } from './collect';

export async function testSource(fetch: Fetcher, name: string, input: ConfigureSourceInput): Promise<SourceTestResult> {
  const spec = { name, method: input.method, listUrls: input.listUrls, config: input.selectorConfig };
  const errors: string[] = [];
  let items: Awaited<ReturnType<typeof listItems>> = [];
  try {
    items = await listItems(fetch, spec, null);
    if (items.length === 0) errors.push('לא נמצאו כתבות ברשימה. בדקו את הכתובות והסלקטורים.');
  } catch (e) {
    errors.push(`קריאת הרשימה נכשלה: ${e instanceof Error ? e.message : String(e)}`);
  }

  let article: SourceTestResult['article'] = null;
  const first = items[0];
  if (first) {
    try {
      const full = await completeItem(fetch, spec, first);
      article = { url: full.url, title: full.title, intro: full.intro, bodyText: full.bodyText ?? '', imageUrl: full.imageUrl };
      if (!full.title) errors.push('לא זוהתה כותרת בעמוד הכתבה.');
      if ((full.bodyText ?? '').length < 300) errors.push('גוף הכתבה קצר מדי או לא זוהה. בדקו את סלקטור הגוף.');
    } catch (e) {
      errors.push(`קריאת עמוד הכתבה נכשלה: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: errors.length === 0,
    items: items.slice(0, 15).map((i) => ({
      url: i.url,
      title: i.title,
      intro: i.intro,
      imageUrl: i.imageUrl,
      publishedAt: i.publishedAt?.toISOString() ?? null,
      category: categoryFor(i.url, input.selectorConfig) ?? input.defaultCategory ?? null,
    })),
    article,
    errors,
  };
}
