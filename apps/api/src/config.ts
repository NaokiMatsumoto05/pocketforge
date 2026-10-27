import { normalizeServerUrl } from '@pocketforge/core';

export function serverConfig(env: Record<string, string | undefined>) {
  const production = env.NODE_ENV === 'production';
  if (production && !/^[a-fA-F0-9]{64}$/.test(env.VAULT_KEY || ''))
    throw new Error('Production requires VAULT_KEY (64 hex characters).');
  if (env.RENDER === 'true' && !env.DATABASE_URL)
    throw new Error('Render requires DATABASE_URL; SQLite is not persistent on Free.');
  const origin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL;
  const publicOrigin = production ? normalizeServerUrl(origin || '') : origin;
  const origins =
    env.ALLOWED_ORIGINS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? (production ? [publicOrigin!] : undefined);
  if (production) {
    if (!origins?.length || !origins.includes(publicOrigin!))
      throw new Error('ALLOWED_ORIGINS must include PUBLIC_ORIGIN.');
    for (const origin of origins)
      if (normalizeServerUrl(origin) !== origin)
        throw new Error('ALLOWED_ORIGINS must contain exact HTTPS origins.');
  }
  if (env.TRUST_PROXY && !['loopback', '1'].includes(env.TRUST_PROXY))
    throw new Error(
      'TRUST_PROXY must be loopback or 1. Only enable it behind your own reverse proxy.',
    );
  return {
    production,
    publicOrigin,
    origins,
    allowRegistration:
      env.ALLOW_REGISTRATION === 'true' || (!production && env.ALLOW_REGISTRATION !== 'false'),
    trustProxy: env.TRUST_PROXY === '1' ? 1 : env.TRUST_PROXY,
  };
}
