// Terms that send a comment to the moderation queue instead of publishing it
// right away. Matching is case-insensitive and on whole words. The newsroom
// should extend this list; nothing here rejects a comment outright.
export const FLAGGED_TERMS: readonly string[] = [
  // Hebrew insults and profanity
  'בן זונה',
  'בת זונה',
  'זונה',
  'שרמוטה',
  'כוס אמק',
  'כוסאמק',
  'לך תזדיין',
  'מזדיין',
  'זין',
  'חרא',
  'מניאק',
  'מפגר',
  'מפגרת',
  // English
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'asshole',
  // Spam
  'casino',
  'viagra',
  'crypto giveaway',
  'free money',
];
