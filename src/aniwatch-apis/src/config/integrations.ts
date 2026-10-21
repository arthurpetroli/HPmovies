import 'dotenv/config';

export interface TokoConfig {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  contentAuthorized: boolean;
  allowedProviders: string[];
  allowedMediaHosts: string[];
}

export interface TatakaiConfig {
  enabled: boolean;
  baseUrl?: string;
  namespace?: string;
  contentAuthorized?: boolean;
  allowedProviders?: string[];
  allowedMediaHosts?: string[];
  timeoutMs?: number;
  retries?: number;
}

export interface IntegrationsConfig {
  toko: TokoConfig;
  tatakai: TatakaiConfig;
}

const boolean = (value: string | undefined, fallback: boolean, key: string) => {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${key} deve ser true ou false.`);
};

const integer = (value: string | undefined, fallback: number, min: number, max: number, key: string) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return parsed;
};

function serviceUrl(raw: string, key: string): string {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${key} deve ser uma URL HTTP válida.`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${key} deve usar HTTP(S), sem credenciais, query ou fragmento.`);
  }
  // The backend operator explicitly configures this service, including loopback.
  // No client request can override its origin or its fixed API paths.
  return parsed.toString().replace(/\/+$/, '');
}

function namespace(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new Error('TATAKAI_NAMESPACE inválido.');
  return value;
}

export function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function mediaHosts(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))].map((host) => {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
      throw new Error('TOKO_ALLOWED_MEDIA_HOSTS deve conter nomes DNS exatos, sem protocolo, porta ou curingas.');
    }
    return host;
  });
}

/** Backend configuration only; these values must never use the VITE_ prefix. */
export function loadIntegrationsConfig(env: NodeJS.ProcessEnv = process.env): IntegrationsConfig {
  return {
    toko: {
      enabled: boolean(env.TOKO_ENABLED, false, 'TOKO_ENABLED'),
      baseUrl: serviceUrl(env.TOKO_API_URL || 'http://127.0.0.1:8099', 'TOKO_API_URL'),
      timeoutMs: integer(env.TOKO_TIMEOUT_MS, 8_000, 250, 30_000, 'TOKO_TIMEOUT_MS'),
      retries: integer(env.TOKO_RETRIES, 1, 0, 2, 'TOKO_RETRIES'),
      contentAuthorized: boolean(env.TOKO_CONTENT_AUTHORIZED, false, 'TOKO_CONTENT_AUTHORIZED'),
      allowedProviders: [...new Set((env.TOKO_ALLOWED_PROVIDERS ?? '').split(',').map(normalizeProviderKey).filter(Boolean))],
      allowedMediaHosts: mediaHosts(env.TOKO_ALLOWED_MEDIA_HOSTS),
    },
    tatakai: {
      enabled: boolean(env.TATAKAI_ENABLED, true, 'TATAKAI_ENABLED'),
      baseUrl: serviceUrl(env.TATAKAI_API_URL || 'http://127.0.0.1:8099', 'TATAKAI_API_URL'),
      namespace: namespace(env.TATAKAI_NAMESPACE || 'toko'),
      contentAuthorized: boolean(env.TATAKAI_CONTENT_AUTHORIZED, false, 'TATAKAI_CONTENT_AUTHORIZED'),
      allowedProviders: [...new Set((env.TATAKAI_ALLOWED_PROVIDERS ?? '').split(',').map(normalizeProviderKey).filter(Boolean))],
      allowedMediaHosts: mediaHosts(env.TATAKAI_ALLOWED_MEDIA_HOSTS),
      timeoutMs: integer(env.TATAKAI_TIMEOUT_MS, 8000, 250, 30000, 'TATAKAI_TIMEOUT_MS'),
      retries: integer(env.TATAKAI_RETRIES, 0, 0, 2, 'TATAKAI_RETRIES'),
    },
  };
}

export const integrationsConfig = loadIntegrationsConfig();
