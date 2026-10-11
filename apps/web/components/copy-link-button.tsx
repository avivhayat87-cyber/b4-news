'use client';

import { useState } from 'react';
import { LinkIcon } from './icons';

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('העתיקו את הקישור:', url);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex h-10 items-center gap-2 rounded-full border-[1.5px] border-line px-3.5 text-sm font-bold hover:border-brand hover:text-brand"
    >
      <LinkIcon size={18} />
      <span aria-live="polite">{copied ? 'הקישור הועתק' : 'העתקת קישור'}</span>
    </button>
  );
}
