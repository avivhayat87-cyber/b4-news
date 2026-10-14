// Reader comments: registered readers post, everyone reads.
import { z } from 'zod';

export const COMMENT_LIMITS = {
  minLength: 2,
  maxLength: 2000,
  maxLinks: 2,
  /** Reports from distinct readers that hide a comment until a moderator decides. */
  autoHideReports: 3,
} as const;

export const CommentDto = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  body: z.string(),
  createdAt: z.string(),
  author: z.object({ id: z.string().uuid(), displayName: z.string() }),
  /** In a thread, whom this one answers ("@name"). */
  replyTo: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  likeCount: z.number().int(),
  likedByMe: z.boolean(),
  /** "בחירת העורכים". */
  picked: z.boolean(),
  isMine: z.boolean(),
  /** Held for a moderator; only its author sees it. */
  pending: z.boolean(),
});
export type CommentDto = z.infer<typeof CommentDto>;

/** top: the editors' picks, then the most liked; new: the latest first. */
export const COMMENT_SORTS = ['top', 'new'] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

export const CommentList = z.object({
  items: z.array(CommentDto),
  total: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type CommentList = z.infer<typeof CommentList>;

export const LikeResult = z.object({ likeCount: z.number().int(), likedByMe: z.boolean() });
export type LikeResult = z.infer<typeof LikeResult>;

// ---------------------------------------------------------------------------
// What a reader is told about: replies to them, likes, the editors' pick
// ---------------------------------------------------------------------------
export const NOTIFICATION_KINDS = ['reply', 'like', 'pick'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const ReaderNotificationDto = z.object({
  id: z.string().uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  /** Who replied or liked (null for the editors' pick). */
  actor: z.string().nullable(),
  article: z.object({ id: z.number().int(), slug: z.string(), title: z.string() }),
  /** The comment it is about (the reply itself, for a reply), shortened. */
  excerpt: z.string(),
  commentId: z.string().uuid(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type ReaderNotificationDto = z.infer<typeof ReaderNotificationDto>;
export const ReaderNotificationList = z.object({ items: z.array(ReaderNotificationDto), unread: z.number().int() });
export type ReaderNotificationList = z.infer<typeof ReaderNotificationList>;
export const MarkNotificationsInput = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });

export const CreateCommentInput = z.object({
  body: z
    .string()
    .trim()
    .min(COMMENT_LIMITS.minLength, 'התגובה קצרה מדי')
    .max(COMMENT_LIMITS.maxLength, `התגובה ארוכה מדי (עד ${COMMENT_LIMITS.maxLength} תווים)`),
  parentId: z.string().uuid().nullable().optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const REPORT_REASONS = ['spam', 'abuse', 'misinformation', 'other'] as const;
export const ReportCommentInput = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).optional(),
});
export type ReportCommentInput = z.infer<typeof ReportCommentInput>;

export const COMMENT_STATUSES = ['visible', 'hidden', 'removed'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
