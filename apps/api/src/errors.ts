/** An error whose `message` is safe to show to the user (Hebrew). */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  notFound: (what = 'הפריט') => new AppError(404, 'not_found', `${what} לא נמצא`),
  authRequired: () => new AppError(401, 'auth_required', 'צריך להתחבר כדי להמשיך'),
  forbidden: () => new AppError(403, 'forbidden', 'אין לך הרשאה לפעולה הזאת'),
  banned: () => new AppError(403, 'banned', 'החשבון הזה חסום מלהגיב'),
  rateLimited: () => new AppError(429, 'rate_limited', 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.'),
};
