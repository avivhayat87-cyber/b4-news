// Reader comments as the site and the app show them: threads one level deep, sorted by the
// editors' picks and the most liked ("top") or the latest ("new"), with likes, "@name" for the
// comment a reply answers, and the editors' pick. Liking and picking notify the comment's author.
import type { CommentDto, CommentList, CommentSort, LikeResult } from '@b4/shared';
import { type Db, and, asc, commentLikes, comments, desc, eq, inArray, isNull, or, readers, sql } from '@b4/db';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import type { Services } from './context';
import { notify } from './notifications';

const PAGE_SIZE = 20;

const columns = {
  id: comments.id,
  articleId: comments.articleId,
  parentId: comments.parentId,
  replyToId: comments.replyToId,
  body: comments.body,
  status: comments.status,
  likeCount: comments.likeCount,
  pickedAt: comments.pickedAt,
  createdAt: comments.createdAt,
  readerId: comments.readerId,
  displayName: readers.displayName,
};
type Row = { id: string; parentId: string | null; replyToId: string | null; body: string; status: string; likeCount: number; pickedAt: Date | null; createdAt: Date; readerId: string; displayName: string };

/** Comments the viewer may see: visible ones, plus their own held for review. */
function viewable(viewerId: string | undefined) {
  return viewerId ? or(eq(comments.status, 'visible'), and(eq(comments.status, 'hidden'), eq(comments.readerId, viewerId))) : eq(comments.status, 'visible');
}

/** The DTOs of some comments for one viewer: whether they liked each, and whom each reply answers. */
export async function commentDtos(db: Db, rows: Row[], viewerId: string | undefined): Promise<CommentDto[]> {
  const ids = rows.map((r) => r.id);
  const answered = [...new Set(rows.flatMap((r) => (r.replyToId ? [r.replyToId] : [])))];
  const [mine, names] = await Promise.all([
    viewerId && ids.length
      ? db.select({ id: commentLikes.commentId }).from(commentLikes).where(and(eq(commentLikes.readerId, viewerId), inArray(commentLikes.commentId, ids)))
      : Promise.resolve([]),
    answered.length
      ? db.select({ id: comments.id, displayName: readers.displayName }).from(comments).innerJoin(readers, eq(comments.readerId, readers.id)).where(inArray(comments.id, answered))
      : Promise.resolve([]),
  ]);
  const liked = new Set(mine.map((m) => m.id));
  return rows.map((r) => {
    const to = r.replyToId ? names.find((n) => n.id === r.replyToId) : undefined;
    return {
      id: r.id,
      parentId: r.parentId,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      author: { id: r.readerId, displayName: r.displayName },
      replyTo: to ? { id: to.id, displayName: to.displayName } : null,
      likeCount: r.likeCount,
      likedByMe: liked.has(r.id),
      picked: Boolean(r.pickedAt),
      isMine: r.readerId === viewerId,
      pending: r.status === 'hidden',
    };
  });
}

function encode(row: { createdAt: Date; id: string }) {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}
function decode(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}

/** Top-level comments page by page (with their replies, oldest first). "top" pages by position. */
export async function listComments(db: Db, articleId: number, viewerId: string | undefined, sort: CommentSort, cursor: string | undefined): Promise<CommentList> {
  const base = and(eq(comments.articleId, articleId), isNull(comments.parentId), viewable(viewerId));
  let top: Row[];
  let next: string | null = null;
  if (sort === 'top') {
    const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
    top = await db
      .select(columns)
      .from(comments)
      .innerJoin(readers, eq(comments.readerId, readers.id))
      .where(base)
      .orderBy(sql`${comments.pickedAt} desc nulls last`, desc(comments.likeCount), desc(comments.createdAt), desc(comments.id))
      .limit(PAGE_SIZE + 1)
      .offset(offset);
    if (top.length > PAGE_SIZE) next = String(offset + PAGE_SIZE);
  } else {
    const c = decode(cursor);
    top = await db
      .select(columns)
      .from(comments)
      .innerJoin(readers, eq(comments.readerId, readers.id))
      .where(and(base, c ? sql`(${comments.createdAt}, ${comments.id}) < (${c.at}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(PAGE_SIZE + 1);
    if (top.length > PAGE_SIZE) next = encode(top[PAGE_SIZE - 1]!);
  }
  const page = top.slice(0, PAGE_SIZE);
  const replies = page.length
    ? await db
        .select(columns)
        .from(comments)
        .innerJoin(readers, eq(comments.readerId, readers.id))
        .where(and(inArray(comments.parentId, page.map((c) => c.id)), viewable(viewerId)))
        .orderBy(asc(comments.createdAt))
    : [];
  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(comments).where(and(eq(comments.articleId, articleId), eq(comments.status, 'visible')));
  const ordered = page.flatMap((c) => [c, ...replies.filter((r) => r.parentId === c.id)]);
  return { items: await commentDtos(db, ordered, viewerId), total: total?.n ?? 0, nextCursor: next };
}

async function visibleComment(db: Db, id: string) {
  const [c] = await db
    .select({ id: comments.id, readerId: comments.readerId, articleId: comments.articleId, likeCount: comments.likeCount, pickedAt: comments.pickedAt })
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.status, 'visible')))
    .limit(1);
  if (!c) throw errors.notFound('התגובה');
  return c;
}

export async function likeComment(s: Services, readerId: string, commentId: string): Promise<LikeResult> {
  const c = await visibleComment(s.db, commentId);
  if (c.readerId === readerId) throw new AppError(400, 'own_comment', 'אי אפשר לאהוב תגובה שלך');
  const added = await s.db.insert(commentLikes).values({ commentId, readerId }).onConflictDoNothing().returning({ id: commentLikes.commentId });
  if (!added.length) return { likeCount: c.likeCount, likedByMe: true };
  const [after] = await s.db.update(comments).set({ likeCount: sql`${comments.likeCount} + 1` }).where(eq(comments.id, commentId)).returning({ n: comments.likeCount });
  await notify(s, { readerId: c.readerId, kind: 'like', commentId, actorReaderId: readerId, articleId: c.articleId });
  return { likeCount: after?.n ?? c.likeCount + 1, likedByMe: true };
}

export async function unlikeComment(s: Services, readerId: string, commentId: string): Promise<LikeResult> {
  const c = await visibleComment(s.db, commentId);
  const removed = await s.db
    .delete(commentLikes)
    .where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.readerId, readerId)))
    .returning({ id: commentLikes.commentId });
  if (!removed.length) return { likeCount: c.likeCount, likedByMe: false };
  const [after] = await s.db
    .update(comments)
    .set({ likeCount: sql`greatest(${comments.likeCount} - 1, 0)` })
    .where(eq(comments.id, commentId))
    .returning({ n: comments.likeCount });
  return { likeCount: after?.n ?? Math.max(0, c.likeCount - 1), likedByMe: false };
}

/** "בחירת העורכים" (and back); the author hears about it once. */
export async function setPick(s: Services, staff: { id: string }, commentId: string, picked: boolean) {
  const c = await visibleComment(s.db, commentId);
  await s.db
    .update(comments)
    .set(picked ? { pickedAt: c.pickedAt ?? new Date(), pickedBy: staff.id } : { pickedAt: null, pickedBy: null })
    .where(eq(comments.id, commentId));
  await audit(s.db, { userId: staff.id, entity: 'comment', entityId: commentId, action: picked ? 'pick' : 'unpick' });
  if (picked && !c.pickedAt) await notify(s, { readerId: c.readerId, kind: 'pick', commentId, actorReaderId: null, articleId: c.articleId });
}
