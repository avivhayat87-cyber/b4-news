// Image upload (automatic renditions) and manual entry (by link / by writing).
import multipart from '@fastify/multipart';
import { ManualUrlInput, ManualWriteInput, MediaDto, UpdateMediaInput } from '@b4/shared';
import { eq, mediaAssets } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../../errors';
import { ingestImage, refocus, toMediaDto } from '../../lib/images';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { createFromUrl, createFromWrite } from '../../services/drafts';

const MAX_UPLOAD = 15 * 1024 * 1024;
const params = z.object({ id: z.string().uuid() });

export const mediaRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 1, fields: 4, parts: 5 } });

  app.post(
    '/media',
    { schema: { response: { 201: MediaDto } }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      const file = await req.file();
      if (!file) throw new AppError(400, 'no_file', 'לא נבחר קובץ');
      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        throw new AppError(413, 'too_large', 'הקובץ גדול מדי (עד 15MB)');
      }
      const field = (name: string) => {
        const f = file.fields[name];
        const value = f && !Array.isArray(f) && f.type === 'field' ? String(f.value).trim() : '';
        return value ? value.slice(0, 300) : null;
      };
      const media = await ingestImage(s.db, s.storage, buffer, { kind: 'upload', alt: field('alt'), credit: field('credit'), createdBy: staff.id });
      return reply.status(201).send(toMediaDto(s.storage, media));
    },
  );

  app.get('/media/:id', { schema: { params, response: { 200: MediaDto } } }, async (req) => {
    const [m] = await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, req.params.id)).limit(1);
    if (!m) throw errors.notFound('התמונה');
    return toMediaDto(s.storage, m);
  });

  app.patch('/media/:id', { schema: { params, body: UpdateMediaInput, response: { 200: MediaDto } } }, async (req) => {
    requireStaff(req, 'editor');
    let [m] = await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, req.params.id)).limit(1);
    if (!m) throw errors.notFound('התמונה');
    const { alt, credit, focalX, focalY } = req.body;
    if (alt !== undefined || credit !== undefined) {
      [m] = await s.db
        .update(mediaAssets)
        .set({ ...(alt !== undefined ? { altText: alt } : {}), ...(credit !== undefined ? { credit } : {}) })
        .where(eq(mediaAssets.id, m.id))
        .returning();
    }
    if ((focalX !== undefined && focalX !== m!.focalX) || (focalY !== undefined && focalY !== m!.focalY)) {
      m = await refocus(s.db, s.storage, m!, focalX ?? m!.focalX, focalY ?? m!.focalY);
    }
    return toMediaDto(s.storage, m!);
  });

  app.post(
    '/manual/url',
    { schema: { body: ManualUrlInput, response: { 201: z.object({ draftId: z.string().uuid() }) } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      return reply.status(201).send({ draftId: await createFromUrl(s, staff, req.body) });
    },
  );

  app.post('/manual/write', { bodyLimit: 1_000_000, schema: { body: ManualWriteInput, response: { 201: z.object({ draftId: z.string().uuid() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(201).send({ draftId: await createFromWrite(s, staff, req.body) });
  });
};
