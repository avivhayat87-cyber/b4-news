// Settings and secrets managed in the CMS, with a short cache so every AI call
// or email doesn't hit the database. A value entered in the CMS wins over the
// same value in the server environment.
import { INTEGRATIONS, type IntegrationId, type IntegrationStatus } from '@b4/shared';
import { type Db, appSettings, eq, inArray, secrets, users } from '@b4/db';
import type { Config } from '../config';
import { SecretBox, hintOf } from '../lib/secret-box';

const TTL_MS = 30_000;

export const secretKey = {
  integration: (id: IntegrationId, field: string) => `integration:${id}:${field}`,
  socialToken: (accountId: string) => `social:${accountId}:token`,
};

export class SettingsStore {
  private readonly box: SecretBox;
  private readonly cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {
    this.box = new SecretBox(config.secretsKey);
  }

  private cached<T>(key: string): T | undefined | null {
    const hit = this.cache.get(key);
    return hit && Date.now() - hit.at < TTL_MS ? (hit.value as T | undefined) : null;
  }

  async getSecret(name: string): Promise<string | undefined> {
    const key = `secret:${name}`;
    const hit = this.cached<string>(key);
    if (hit !== null) return hit;
    const [row] = await this.db.select({ ciphertext: secrets.ciphertext }).from(secrets).where(eq(secrets.key, name)).limit(1);
    let value: string | undefined;
    if (row) {
      try {
        value = this.box.open(name, row.ciphertext);
      } catch {
        // Wrong SECRETS_KEY (e.g. rotated): treat as not set rather than crash every request.
        value = undefined;
      }
    }
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async setSecret(name: string, value: string | null, staffId: string): Promise<void> {
    if (value === null) await this.db.delete(secrets).where(eq(secrets.key, name));
    else {
      const row = { key: name, ciphertext: this.box.seal(name, value), hint: hintOf(value), updatedBy: staffId };
      await this.db.insert(secrets).values(row).onConflictDoUpdate({ target: secrets.key, set: { ciphertext: row.ciphertext, hint: row.hint, updatedBy: staffId, updatedAt: new Date() } });
    }
    this.cache.delete(`secret:${name}`);
  }

  async secretInfo(names: string[]) {
    if (names.length === 0) return [];
    return this.db
      .select({ key: secrets.key, hint: secrets.hint, updatedAt: secrets.updatedAt, updatedBy: users.fullName })
      .from(secrets)
      .leftJoin(users, eq(secrets.updatedBy, users.id))
      .where(inArray(secrets.key, names));
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const hit = this.cached<T>(`setting:${key}`);
    if (hit !== null) return hit;
    const [row] = await this.db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
    const value = row?.value as T | undefined;
    this.cache.set(`setting:${key}`, { value, at: Date.now() });
    return value;
  }

  async settingInfo(key: string) {
    const [row] = await this.db
      .select({ updatedAt: appSettings.updatedAt, updatedBy: users.fullName })
      .from(appSettings)
      .leftJoin(users, eq(appSettings.updatedBy, users.id))
      .where(eq(appSettings.key, key))
      .limit(1);
    return row ?? null;
  }

  async setSetting(key: string, value: unknown, staffId: string): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key, value: value as object, updatedBy: staffId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: value as object, updatedBy: staffId, updatedAt: new Date() } });
    this.cache.delete(`setting:${key}`);
  }

  // --- Integrations -----------------------------------------------------------
  private envValue(id: IntegrationId, field: string): string | undefined {
    const c = this.config;
    const map: Record<string, string | undefined> = {
      'anthropic.apiKey': c.ai.anthropicKey,
      'anthropic.model': c.ai.model,
      'anthropic.modelFast': c.ai.modelFast,
      'gemini.apiKey': c.ai.geminiKey,
      'gemini.imageModel': c.ai.imageModel,
      'gemini.imageSize': c.ai.imageSize,
      'smtp.url': c.smtpUrl,
      'smtp.from': c.mailFrom,
    };
    return map[`${id}.${field}`];
  }

  /** The effective values of an integration: CMS first, then the environment, then the field default. */
  async integration(id: IntegrationId): Promise<Record<string, string | undefined> & { source: 'cms' | 'env' | null }> {
    const def = INTEGRATIONS[id];
    const plain = (await this.getSetting<Record<string, string>>(`integration:${id}`)) ?? {};
    const out: Record<string, string | undefined> = {};
    let source: 'cms' | 'env' | null = null;
    for (const f of def.fields) {
      const fromCms = f.secret ? await this.getSecret(secretKey.integration(id, f.key)) : plain[f.key] || undefined;
      const fromEnv = this.envValue(id, f.key);
      out[f.key] = fromCms ?? fromEnv ?? f.defaultValue;
      if (f.secret && !source) source = fromCms ? 'cms' : fromEnv ? 'env' : null;
    }
    return Object.assign(out, { source });
  }

  async integrationStatus(id: IntegrationId): Promise<IntegrationStatus> {
    const def = INTEGRATIONS[id];
    const effective = await this.integration(id);
    const plain = (await this.getSetting<Record<string, string>>(`integration:${id}`)) ?? {};
    const info = await this.secretInfo(def.fields.filter((f) => f.secret).map((f) => secretKey.integration(id, f.key)));
    const meta = await this.settingInfo(`integration:${id}`);
    const stamps = [...info.map((i) => ({ at: i.updatedAt, by: i.updatedBy })), ...(meta ? [{ at: meta.updatedAt, by: meta.updatedBy }] : [])].sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      id,
      connected: def.fields.filter((f) => f.secret).every((f) => Boolean(effective[f.key])),
      source: effective.source,
      fields: def.fields.map((f) => {
        const stored = info.find((i) => i.key === secretKey.integration(id, f.key));
        const envSet = Boolean(this.envValue(id, f.key)) && f.secret;
        return {
          key: f.key,
          configured: f.secret ? Boolean(stored) || envSet : Boolean(plain[f.key]),
          hint: f.secret ? (stored?.hint ?? (envSet ? 'מוגדר בשרת' : null)) : null,
          value: f.secret ? null : (plain[f.key] ?? effective[f.key] ?? null),
        };
      }),
      updatedAt: stamps[0]?.at.toISOString() ?? null,
      updatedBy: stamps[0]?.by ?? null,
    };
  }

  /** A social account's token: entered in the CMS, or SOCIAL_SECRET_<ref> in the environment. */
  async socialToken(account: { id: string; secretRef: string }): Promise<string | undefined> {
    return (await this.getSecret(secretKey.socialToken(account.id))) ?? this.config.socialSecret(account.secretRef);
  }
}
