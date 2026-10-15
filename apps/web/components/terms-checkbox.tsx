'use client';

import { MIN_READER_AGE } from '@b4/shared';
import Link from 'next/link';
import { NewWindowHint } from './ui';

/** The checkbox every sign-up form carries (comments, newsletter). Required by the API too. */
export function TermsCheckbox({
  id,
  checked,
  onChange,
  tone = 'light',
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tone?: 'light' | 'dark';
}) {
  const link = tone === 'dark' ? 'font-bold text-white underline underline-offset-2' : 'font-bold text-brand underline underline-offset-2';
  return (
    <div className={`flex items-start gap-2.5 text-[14px] leading-snug ${tone === 'dark' ? 'text-mist' : 'text-ink-2'}`}>
      <input
        id={id}
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer ${tone === 'dark' ? 'accent-white' : 'accent-brand'}`}
      />
      <label htmlFor={id} className="cursor-pointer">
        אני בן/בת {MIN_READER_AGE} ומעלה ומסכים/ה ל
        <Link href="/terms" target="_blank" className={link}>
          תנאי השימוש
          <NewWindowHint />
        </Link>{' '}
        ול
        <Link href="/privacy" target="_blank" className={link}>
          מדיניות הפרטיות
          <NewWindowHint />
        </Link>
      </label>
    </div>
  );
}
