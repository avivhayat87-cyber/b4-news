// Foreign articles in Hebrew: the headline and intro right after discovery (so
// the editor can choose what to take), the whole text when an article goes to
// the editor. The original stays as it was; the translation sits beside it.
import { eq, inArray, scrapedItems } from '@b4/db';
import { enqueue, type JobRow } from '../lib/jobs';
import { activePrompt, tracked } from './ai';
import type { Services } from './context';

export const TRANSLATE_JOB = 'items.translate';
const BATCH = 12;

/** The language of a text by its script: Hebrew → null (nothing to translate). Latin script takes the site's language. */
export function detectLanguage(text: string, siteLanguage?: string | null): string | null {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const hebrew = count(/[֐-׿]/g);
  const arabic = count(/[؀-ۿ]/g);
  const cyrillic = count(/[Ѐ-ӿ]/g);
  const latin = count(/[A-Za-zÀ-ɏ]/g);
  const total = hebrew + arabic + cyrillic + latin;
  if (total === 0 || hebrew / total > 0.3) return null;
  if (arabic >= cyrillic && arabic >= latin) return 'ar';
  if (cyrillic >= latin) return 'ru';
  return siteLanguage && !siteLanguage.startsWith('he') ? siteLanguage : 'en';
}

export async function queueHeadlineTranslation(s: Services, itemIds: string[], createdBy: string | null) {
  if (!itemIds.length) return null;
  return enqueue(s.db, TRANSLATE_JOB, { itemIds }, { createdBy, maxAttempts: 2 });
}

/** Job: Hebrew headline and intro for the listed foreign items (in batches, by language). */
export async function runHeadlineTranslation(s: Services, job: JobRow) {
  const ids = (job.payload.itemIds as string[]) ?? [];
  if (!ids.length) return { translated: 0 };
  const rows = (await s.db.select({ id: scrapedItems.id, title: scrapedItems.title, intro: scrapedItems.intro, language: scrapedItems.language, titleHe: scrapedItems.titleHe }).from(scrapedItems).where(inArray(scrapedItems.id, ids))).filter(
    (r) => r.language && !r.titleHe,
  );
  const textAi = await s.ai.text();
  const prompt = await activePrompt(s.db, 'translate.system');
  let translated = 0;
  const byLanguage = new Map<string, typeof rows>();
  for (const r of rows) byLanguage.set(r.language!, [...(byLanguage.get(r.language!) ?? []), r]);
  for (const [language, list] of byLanguage) {
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const { result } = await tracked(
        s.db,
        { type: 'translate', provider: textAi.provider, requestedBy: job.createdBy, promptKey: 'translate.system', promptVersion: prompt.version },
        () => textAi.translate({ systemPrompt: prompt.body, language, items: chunk.map((r) => ({ id: r.id, title: r.title, intro: r.intro })) }),
      );
      for (const out of result.data.items) {
        if (!chunk.some((r) => r.id === out.id) || !out.title.trim()) continue;
        await s.db
          .update(scrapedItems)
          .set({ titleHe: out.title.trim().slice(0, 500), introHe: out.intro.trim().slice(0, 2000) || null })
          .where(eq(scrapedItems.id, out.id));
        translated++;
      }
    }
  }
  return { translated };
}

/** The whole article in Hebrew, for the editor (kept, so it is translated once). Null for Hebrew originals. */
export async function translateFullItem(s: Services, itemId: string, requestedBy: string | null, draftId: string | null) {
  const [item] = await s.db.select().from(scrapedItems).where(eq(scrapedItems.id, itemId)).limit(1);
  if (!item?.language) return null;
  if (item.bodyHe) return { title: item.titleHe ?? item.title, intro: item.introHe, body: item.bodyHe };
  const textAi = await s.ai.text();
  const prompt = await activePrompt(s.db, 'translate.system');
  const { result } = await tracked(s.db, { type: 'translate', provider: textAi.provider, draftId, requestedBy, promptKey: 'translate.system', promptVersion: prompt.version }, () =>
    textAi.translate({ systemPrompt: prompt.body, language: item.language, items: [{ id: item.id, title: item.title, intro: item.intro, body: item.bodyText ?? item.intro ?? '' }] }),
  );
  const out = result.data.items.find((x) => x.id === item.id) ?? result.data.items[0];
  if (!out) return null;
  const translated = { title: out.title.trim().slice(0, 500) || item.title, intro: out.intro.trim().slice(0, 2000) || null, body: out.body.trim().slice(0, 100_000) || null };
  await s.db.update(scrapedItems).set({ titleHe: translated.title, introHe: translated.intro, bodyHe: translated.body }).where(eq(scrapedItems.id, item.id));
  return translated;
}
