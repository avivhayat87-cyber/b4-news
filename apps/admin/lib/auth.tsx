'use client';
// Who is signed in. Every CMS screen sits behind <RequireStaff>.
import type { StaffDto, StaffRole } from '@b4/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Loading } from '@/components/ui';
import { ApiFailure, api } from './api';

const StaffContext = createContext<StaffDto | null>(null);

export function useStaff(): StaffDto {
  const staff = useContext(StaffContext);
  if (!staff) throw new Error('useStaff outside <RequireStaff>');
  return staff;
}

/** Admins can do everything; otherwise the role must be listed. */
export function useCan(...roles: StaffRole[]): boolean {
  const staff = useStaff();
  return staff.role === 'admin' || roles.includes(staff.role);
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<StaffDto>('/auth/staff/me');
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function RequireStaff({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();

  useEffect(() => {
    if (me.data === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.data, pathname, router]);

  // Any 401 from the API (expired session) sends the editor back to sign in.
  useEffect(() => {
    const onSignedOut = () => qc.setQueryData(['me'], null);
    window.addEventListener('b4:signed-out', onSignedOut);
    return () => window.removeEventListener('b4:signed-out', onSignedOut);
  }, [qc]);

  if (me.isPending || !me.data) return <Loading label="בודק התחברות…" />;
  return <StaffContext.Provider value={me.data}>{children}</StaffContext.Provider>;
}
