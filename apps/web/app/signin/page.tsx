import type { Metadata } from 'next';
import { wrap } from '@/components/ui';
import { SignInLink } from './signin-link';

export const metadata: Metadata = { title: 'התחברות', robots: { index: false } };

/** Where "התחברות בלחיצה" in the sign-in mail lands. */
export default function SignInPage() {
  return (
    <div className={`${wrap} py-12`}>
      <div className="mx-auto max-w-[520px]">
        <SignInLink />
      </div>
    </div>
  );
}
