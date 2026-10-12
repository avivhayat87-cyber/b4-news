'use client';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { RequireStaff } from '@/lib/auth';

export default function CmsLayout({ children }: { children: ReactNode }) {
  return (
    <RequireStaff>
      <Shell>{children}</Shell>
    </RequireStaff>
  );
}
