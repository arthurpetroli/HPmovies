import 'dotenv/config';

export interface TokoConfig {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  contentAuthorized: boolean;
  allowedProviders: string[];
  allowedMediaHosts: string[];
  allowedStreamDomains?: string[];
  allowedRequestOrigins?: string[];
}

export interface TatakaiConfig {
  enabled: boolean;
  baseUrl?: string;
  namespace?: string;
  contentAuthorized?: boolean;
  allowedProviders?: string[];
  allowedMediaHosts?: string[];
  allowedStreamDomains?: string[];
  allowedRequestOrigins?: string[];
  timeoutMs?: number;
  retries?: number;
}

/** The operator's own hentai-api instance (github.com/sulvii/hentai-api); adult routes only. */
export interface HentaiApiConfig extends TokoConfig {
  apiKey?: string;
}

/** Streaming sites read by HPmovies itself; adult routes only. */
export const ADULT_SITE_IDS = ['animeshentai', 'assistirhentai', 'muitohentai'] as const;
export type AdultSiteId = typeof ADULT_SITE_IDS[number];
export interface AdultSitesConfig extends TokoConfig {
  sites: AdultSiteId[];
}

export interface IntegrationsConfig {
  toko: TokoConfig;
  tatakai: TatakaiConfig;
  hentaiApi: HentaiApiConfig;
  adultSites: AdultSitesConfig;
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

function mediaHosts(raw: string | undefined, key = 'TOKO_ALLOWED_MEDIA_HOSTS'): string[] {
  return [...new Set((raw ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))].map((host) => {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
      throw new Error(`${key} deve conter nomes DNS exatos, sem protocolo, porta ou curingas.`);
    }
    return host;
  });
}

function requestOrigins(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map(value => value.trim()).filter(Boolean))].map(value => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash
      || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(parsed.hostname)) {
      throw new Error('ALLOWED_REQUEST_ORIGINS deve conter origens HTTPS exatas, sem caminho, credenciais ou porta.');
    }
    return parsed.origin;
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
      allowedStreamDomains: mediaHosts(env.TOKO_ALLOWED_STREAM_DOMAINS, 'TOKO_ALLOWED_STREAM_DOMAINS'),
      allowedRequestOrigins: requestOrigins(env.TOKO_ALLOWED_REQUEST_ORIGINS),
    },
    tatakai: {
      enabled: boolean(env.TATAKAI_ENABLED, true, 'TATAKAI_ENABLED'),
      baseUrl: serviceUrl(env.TATAKAI_API_URL || 'http://127.0.0.1:8099', 'TATAKAI_API_URL'),
      namespace: namespace(env.TATAKAI_NAMESPACE || 'toko'),
      contentAuthorized: boolean(env.TATAKAI_CONTENT_AUTHORIZED, false, 'TATAKAI_CONTENT_AUTHORIZED'),
      allowedProviders: [...new Set((env.TATAKAI_ALLOWED_PROVIDERS ?? '').split(',').map(normalizeProviderKey).filter(Boolean))],
      allowedMediaHosts: mediaHosts(env.TATAKAI_ALLOWED_MEDIA_HOSTS),
      allowedStreamDomains: mediaHosts(env.TATAKAI_ALLOWED_STREAM_DOMAINS, 'TATAKAI_ALLOWED_STREAM_DOMAINS'),
      allowedRequestOrigins: requestOrigins(env.TATAKAI_ALLOWED_REQUEST_ORIGINS),
      timeoutMs: integer(env.TATAKAI_TIMEOUT_MS, 8000, 250, 60000, 'TATAKAI_TIMEOUT_MS'),
      retries: integer(env.TATAKAI_RETRIES, 0, 0, 2, 'TATAKAI_RETRIES'),
    },
    hentaiApi: hentaiApiConfig(env),
    adultSites: adultSitesConfig(env),
  };
}

function adultSitesConfig(env: NodeJS.ProcessEnv): AdultSitesConfig {
  const sites = [...new Set((env.ADULT_SITES ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
  const unknown = sites.find(site => !(ADULT_SITE_IDS as readonly string[]).includes(site));
  if (unknown) throw new Error(`ADULT_SITES aceita somente: ${ADULT_SITE_IDS.join(', ')}.`);
  return {
    enabled: sites.length > 0, baseUrl: '', retries: 0, sites: sites as AdultSiteId[],
    timeoutMs: integer(env.ADULT_SITES_TIMEOUT_MS, 15_000, 1_000, 60_000, 'ADULT_SITES_TIMEOUT_MS'),
    contentAuthorized: boolean(env.ADULT_SITES_CONTENT_AUTHORIZED, false, 'ADULT_SITES_CONTENT_AUTHORIZED'),
    allowedProviders: sites,
    allowedMediaHosts: [],
    allowedStreamDomains: mediaHosts(env.ADULT_SITES_ALLOWED_STREAM_DOMAINS, 'ADULT_SITES_ALLOWED_STREAM_DOMAINS'),
    allowedRequestOrigins: [],
  };
}

function hentaiApiConfig(env: NodeJS.ProcessEnv): HentaiApiConfig {
  const baseUrl = env.HENTAI_API_URL?.trim() ? serviceUrl(env.HENTAI_API_URL.trim(), 'HENTAI_API_URL') : '';
  const apiKey = env.HENTAI_API_KEY?.trim();
  if (apiKey && (apiKey.length > 256 || /[\s\0]/.test(apiKey))) throw new Error('HENTAI_API_KEY inválida.');
  return {
    enabled: !!baseUrl, baseUrl, retries: 0,
    timeoutMs: integer(env.HENTAI_API_TIMEOUT_MS, 15_000, 1_000, 60_000, 'HENTAI_API_TIMEOUT_MS'),
    contentAuthorized: boolean(env.HENTAI_API_CONTENT_AUTHORIZED, false, 'HENTAI_API_CONTENT_AUTHORIZED'),
    allowedProviders: ['hanime', 'hentaihaven'],
    allowedMediaHosts: mediaHosts(env.HENTAI_API_ALLOWED_MEDIA_HOSTS, 'HENTAI_API_ALLOWED_MEDIA_HOSTS'),
    allowedStreamDomains: mediaHosts(env.HENTAI_API_ALLOWED_STREAM_DOMAINS, 'HENTAI_API_ALLOWED_STREAM_DOMAINS'),
    allowedRequestOrigins: requestOrigins(env.HENTAI_API_ALLOWED_REQUEST_ORIGINS),
    ...(apiKey ? { apiKey } : {}),
  };
}

export const integrationsConfig = loadIntegrationsConfig();
