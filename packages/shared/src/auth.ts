// Reader sign-in (email one-time code) and staff sign-in (password).
import { z } from 'zod';

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email('כתובת המייל לא תקינה');

/** A path on the site to come back to (never another site). */
export const ReturnPath = z
  .string()
  .max(300)
  .regex(/^\/(?![/\\])[^\s]*$/, 'כתובת חזרה לא תקינה');

export const RequestCodeInput = z.object({
  email: Email,
  /** The terms box was ticked; the one-click link then signs in without asking again. */
  acceptTerms: z.boolean().optional(),
  /** Where the one-click link returns to (the article the reader was on). */
  returnTo: ReturnPath.optional(),
});
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
  /** The terms checkbox. Required on first sign-in and after a new terms version. */
  acceptTerms: z.boolean().optional(),
  /** "app" returns a bearer token in the body instead of setting a cookie. */
  client: z.enum(['web', 'app']).default('web'),
});
export type VerifyCodeInput = z.infer<typeof VerifyCodeInput>;

export const ReaderDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  /** Has accepted the current terms version (otherwise they are asked before commenting). */
  termsAccepted: z.boolean(),
});
export type ReaderDto = z.infer<typeof ReaderDto>;

export const ReaderSession = z.object({
  reader: ReaderDto,
  token: z.string().optional(),
});
export type ReaderSession = z.infer<typeof ReaderSession>;

/** "Sign in with one click": the token from the mailed link (it travels in the URL's #, never to a server log). */
export const VerifyLinkInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/, 'הקישור לא תקין'),
  /** Required on the first sign-in, as with the code. */
  displayName: DisplayName.optional(),
  acceptTerms: z.boolean().optional(),
});
export const ReaderLinkSession = z.object({ reader: ReaderDto, returnTo: z.string().nullable() });
export type ReaderLinkSession = z.infer<typeof ReaderLinkSession>;

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

// ---------------------------------------------------------------------------
// Two-step sign-in for staff (a code from an authenticator app)
// ---------------------------------------------------------------------------
/** After the password: signed in (`staff`), or the authenticator code is next ("code"), or setting the app up first ("setup"). */
export const StaffLoginResult = z.object({
  staff: StaffDto.nullable(),
  twoFactor: z.enum(['code', 'setup']).nullable(),
  /** Ties the next step to this password check (5 minutes, a few tries). */
  challenge: z.string().nullable(),
});
export type StaffLoginResult = z.infer<typeof StaffLoginResult>;

/** A 6-digit code from the app, or a recovery code ("abcd-efgh"). */
export const TwoFactorCode = z.string().trim().min(6, 'קוד בן 6 ספרות').max(20);
export const StaffTwoFactorInput = z.object({ challenge: z.string().min(20).max(100), code: TwoFactorCode });
export const StaffChallengeInput = z.object({ challenge: z.string().min(20).max(100) });

/** What the authenticator app scans (and the secret, to type in by hand). */
export const TwoFactorSetupDto = z.object({ secret: z.string(), otpauthUrl: z.string(), qrSvg: z.string() });
export type TwoFactorSetupDto = z.infer<typeof TwoFactorSetupDto>;

/** Signed in; `recoveryCodes` only right after the app was set up (shown once). */
export const StaffTwoFactorResult = z.object({ staff: StaffDto, recoveryCodes: z.array(z.string()).nullable() });
export type StaffTwoFactorResult = z.infer<typeof StaffTwoFactorResult>;

export const TwoFactorStatus = z.object({
  enabled: z.boolean(),
  enabledAt: z.string().nullable(),
  recoveryCodesLeft: z.number().int(),
  /** The newsroom requires it for everyone (then it can't be turned off, only reset by an admin). */
  required: z.boolean(),
});
export type TwoFactorStatus = z.infer<typeof TwoFactorStatus>;

export const ConfirmTwoFactorInput = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'קוד בן 6 ספרות מהאפליקציה') });
export const DisableTwoFactorInput = z.object({ password: z.string().min(1).max(200), code: TwoFactorCode });
export const RecoveryCodesDto = z.object({ recoveryCodes: z.array(z.string()) });

export const SecuritySettings = z.object({ requireTwoFactor: z.boolean() });
export type SecuritySettings = z.infer<typeof SecuritySettings>;

/** Error body for every non-2xx response. `message` is safe to show to the user. */
export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;
