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
  isMine: z.boolean(),
  /** Held for a moderator; only its author sees it. */
  pending: z.boolean(),
});
export type CommentDto = z.infer<typeof CommentDto>;

export const CommentList = z.object({
  items: z.array(CommentDto),
  total: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type CommentList = z.infer<typeof CommentList>;

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
