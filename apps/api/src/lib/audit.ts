import { type Db, auditLog } from '@b4/db';

export async function audit(
  db: Db,
  entry: { userId?: string; readerId?: string; entity: string; entityId: string; action: string; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.userId ?? null,
    actorReaderId: entry.readerId ?? null,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    details: entry.details ?? null,
  });
}
