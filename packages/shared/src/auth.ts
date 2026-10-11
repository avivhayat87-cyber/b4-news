// Reader sign-in (email one-time code) and staff sign-in (password).
import { z } from 'zod';

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email('כתובת המייל לא תקינה');

export const RequestCodeInput = z.object({ email: Email });
export type RequestCodeInput = z.infer<typeof RequestCodeInput>;

export const DisplayName = z
  .string()
  .trim()
  .min(2, 'השם קצר מדי')
  .max(40, 'השם ארוך מדי (עד 40 תווים)')
  .regex(/^[\p{L}\p{M}\p{N} .'\-״׳]+$/u, 'השם יכול להכיל אותיות, מספרים, רווח ומקף');

export const VerifyCodeInput = z.object({
  email: Email,
  code: z.string().trim().regex(/^\d{6}$/, 'הקוד מורכב מ-6 ספרות'),
  /** Required on first sign-in, ignored afterwards. */
  displayName: DisplayName.optional(),
  /** "app" returns a bearer token in the body instead of setting a cookie. */
  client: z.enum(['web', 'app']).default('web'),
});
export type VerifyCodeInput = z.infer<typeof VerifyCodeInput>;

export const ReaderDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
});
export type ReaderDto = z.infer<typeof ReaderDto>;

export const ReaderSession = z.object({
  reader: ReaderDto,
  token: z.string().optional(),
});
export type ReaderSession = z.infer<typeof ReaderSession>;

export const UpdateReaderInput = z.object({ displayName: DisplayName });

export const STAFF_ROLES = ['admin', 'editor', 'developer', 'viewer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const StaffLoginInput = z.object({
  email: Email,
  password: z.string().min(1).max(200),
});
export type StaffLoginInput = z.infer<typeof StaffLoginInput>;

export const StaffDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(STAFF_ROLES),
});
export type StaffDto = z.infer<typeof StaffDto>;

/** Error body for every non-2xx response. `message` is safe to show to the user. */
export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;
