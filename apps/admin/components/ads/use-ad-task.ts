'use client';
// The ads agent works in the background: start a task, then ask for it every two seconds until it
// is done (or failed).
import type { AdTaskDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { admin } from '@/lib/api';

export function useAdTask() {
  const [id, setId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['ad-task', id],
    queryFn: () => admin.get<AdTaskDto>(`/ads/agent/tasks/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'done' || q.state.data.status === 'failed') ? false : 2000),
  });
  const task = id ? (query.data ?? null) : null;
  return {
    task,
    running: Boolean(id) && (!task || task.status === 'queued' || task.status === 'running'),
    track: (t: AdTaskDto) => setId(t.id),
    clear: () => setId(null),
  };
}
