// The legal reviewer's settings: whether every article is checked when its text is marked final,
// and whether the admins are emailed when one is stopped. The review itself is legal-review.ts.
import { type ReviewerSettings, ReviewerSettings as Schema } from '@b4/shared';
import { type Db, appSettings, eq } from '@b4/db';

const KEY = 'agent.review';

export async function getReviewerSettings(db: Db): Promise<ReviewerSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  const parsed = Schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : Schema.parse({});
}

export async function saveReviewerSettings(db: Db, staffId: string, input: ReviewerSettings): Promise<ReviewerSettings> {
  const value = Schema.parse(input);
  await db
    .insert(appSettings)
    .values({ key: KEY, value, updatedBy: staffId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: staffId, updatedAt: new Date() } });
  return value;
}
