// "Notice and takedown": anyone can ask to remove a comment or other content
// (POST /api/v1/public/takedown); the newsroom answers from a queue in the CMS
// (/api/v1/admin/takedowns). Every request and decision is kept, with its time.
import { DecideTakedownInput, TAKEDOWN_KIND_LABELS, TAKEDOWN_RESPONSE_HOURS, TAKEDOWN_STATUSES, TakedownDto, TakedownInput } from '@b4/shared';
import { type Db, asc, comments, desc, eq, inArray, readers, takedownRequests, users } from '@b4/db';
import type { SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../errors';
import { audit } from '../lib/audit';
import { keyedHash } from '../lib/crypto';
import { requireStaff } from '../plugins/auth';
import type { Services } from '../services/context';
import { getSite } from '../services/site-settings';

const OPEN = ['new', 'in_review'] as const;
const reference = (id: string) => id.slice(0, 8).toUpperCase();

async function notify(s: Services, mail: { to: string; subject: string; text: string }) {
  // A mail problem never loses the request: it is already in the queue.
  await s.mailer.send(mail).catch((err) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'takedown mail failed'));
}

export const publicTakedownRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.post(
    '/takedown',
    {
      schema: { body: TakedownInput, response: { 201: z.object({ id: z.string().uuid(), reference: z.string(), dueAt: z.string() }) } },
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const b = req.body;
      let commentId: string | null = null;
      if (b.commentId) {
        const [c] = await s.db.select({ id: comments.id }).from(comments).where(eq(comments.id, b.commentId)).limit(1);
        commentId = c?.id ?? null;
      }
      const dueAt = new Date(Date.now() + TAKEDOWN_RESPONSE_HOURS * 3600_000);
      const [row] = await s.db
        .insert(takedownRequests)
        .values({ kind: b.kind, url: b.url, commentId, name: b.name, email: b.email, details: b.details, ipHash: keyedHash(s.config.hashPepper, 'ip', req.ip), dueAt })
        .returning({ id: takedownRequests.id });
      const ref = reference(row!.id);

      const site = await getSite(s);
      const newsroom = site.company.privacyEmail || site.contact.email;
      if (newsroom) {
        await notify(s, {
          to: newsroom,
          subject: `בקשת הסרה חדשה (${ref}): ${TAKEDOWN_KIND_LABELS[b.kind]}`,
          text: `התקבלה בקשת הסרה חדשה, והיא ממתינה בתור "בקשות הסרה" במערכת.\n\nסוג: ${TAKEDOWN_KIND_LABELS[b.kind]}\nקישור: ${b.url}\nלהשיב עד: ${dueAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
        });
      }
      await notify(s, {
        to: b.email,
        subject: `קיבלנו את הפנייה שלך (מספר ${ref})`,
        text: `שלום ${b.name},\n\nקיבלנו את בקשת ההסרה שלך לגבי:\n${b.url}\n\nמספר הפנייה: ${ref}. נבדוק אותה ונעדכן אותך בהקדם, ואנחנו משתדלים להשיב בתוך ${TAKEDOWN_RESPONSE_HOURS} שעות.\n\nצוות B4 NEW'S`,
      });
      return reply.status(201).send({ id: row!.id, reference: ref, dueAt: dueAt.toISOString() });
    },
  );
};

async function takedownDtos(db: Db, where: SQL, order: 'oldest' | 'newest'): Promise<TakedownDto[]> {
  const rows = await db
    .select({
      t: takedownRequests,
      commentBody: comments.body,
      commentStatus: comments.status,
      commentAuthor: readers.displayName,
      decidedBy: users.fullName,
    })
    .from(takedownRequests)
    .leftJoin(comments, eq(takedownRequests.commentId, comments.id))
    .leftJoin(readers, eq(comments.readerId, readers.id))
    .leftJoin(users, eq(takedownRequests.decidedBy, users.id))
    .where(where)
    .orderBy(order === 'oldest' ? asc(takedownRequests.createdAt) : desc(takedownRequests.createdAt))
    .limit(200);
  return rows.map(({ t, ...r }) => ({
    id: t.id,
    kind: t.kind,
    status: t.status,
    url: t.url,
    comment: t.commentId && r.commentBody !== null ? { id: t.commentId, body: r.commentBody, status: r.commentStatus ?? 'removed', author: r.commentAuthor ?? '' } : null,
    name: t.name,
    email: t.email,
    details: t.details,
    decisionNote: t.decisionNote,
    decidedBy: r.decidedBy,
    decidedAt: t.decidedAt?.toISOString() ?? null,
    dueAt: t.dueAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
  }));
}

export const adminTakedownRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get(
    '/takedowns',
    { schema: { querystring: z.object({ view: z.enum(['open', 'closed']).default('open') }), response: { 200: z.object({ items: z.array(TakedownDto) }) } } },
    async (req) => {
      requireStaff(req, 'editor');
      const open = req.query.view === 'open';
      const statuses = open ? [...OPEN] : TAKEDOWN_STATUSES.filter((x) => !(OPEN as readonly string[]).includes(x));
      return { items: await takedownDtos(s.db, inArray(takedownRequests.status, statuses), open ? 'oldest' : 'newest') };
    },
  );

  app.patch('/takedowns/:id', { schema: { params: z.object({ id: z.string().uuid() }), body: DecideTakedownInput } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    const { status, note, hideComment } = req.body;
    const final = status !== 'in_review';
    const [row] = await s.db
      .update(takedownRequests)
      .set({ status, decisionNote: note ?? null, ...(final ? { decidedBy: staff.id, decidedAt: new Date() } : {}) })
      .where(eq(takedownRequests.id, req.params.id))
      .returning();
    if (!row) throw errors.notFound('הבקשה');
    if (status === 'removed' && hideComment && row.commentId) {
      await s.db
        .update(comments)
        .set({ status: 'removed', moderatedBy: staff.id, moderatedAt: new Date(), moderationNote: `takedown ${reference(row.id)}` })
        .where(eq(comments.id, row.commentId));
    }
    await audit(s.db, { userId: staff.id, entity: 'takedown', entityId: row.id, action: `set_${status}`, details: { note, hideComment } });
    if (final) {
      await notify(s, {
        to: row.email,
        subject: `עדכון על הפנייה שלך (מספר ${reference(row.id)})`,
        text:
          status === 'removed'
            ? `שלום ${row.name},\n\nבדקנו את הפנייה שלך לגבי:\n${row.url}\n\nהתוכן הוסר.\n\nצוות B4 NEW'S`
            : `שלום ${row.name},\n\nבדקנו את הפנייה שלך לגבי:\n${row.url}\n\nלאחר בדיקה החלטנו שלא להסיר את התוכן.${note ? `\n\n${note}` : ''}\n\nאם יש לך מידע נוסף, אפשר להשיב למייל הזה.\n\nצוות B4 NEW'S`,
      });
    }
    return reply.status(204).send();
  });
};
