import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HiAnime } from 'aniwatch';

export const LOCAL_BACKEND = 'http://127.0.0.1:4000';

const isAnime = (anime) => anime && typeof anime.id === 'string' && anime.id.trim()
  && typeof anime.name === 'string' && anime.name.trim();

export function unwrapLegacyResponse(payload) {
  let value = payload;
  for (let depth = 0; depth < 3 && value && typeof value === 'object' && 'data' in value; depth += 1) {
    value = value.data;
  }
  return value;
}

export function summarizeCatalog(payload) {
  const value = unwrapLegacyResponse(payload);
  if (!value || typeof value !== 'object') return { valid: false, count: 0 };
  const rows = ['spotlightAnimes', 'trendingAnimes', 'mostPopularAnimes', 'topAiringAnimes'];
  const ids = new Set();
  for (const key of rows) {
    if (!Array.isArray(value[key])) continue;
    for (const anime of value[key]) {
      if (isAnime(anime)) ids.add(anime.id);
    }
  }
  return { valid: ids.size > 0, count: ids.size };
}

export async function probeHttp(url, options = {}) {
  const start = Date.now();
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
      headers: { Accept: 'application/json' },
    });
    const body = await response.text();
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* HTML is not a catalog response. */ }
    const inactive = response.status === 404 && /no active service/i.test(body);
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - start,
      classification: payload?.error === 'LEGACY_PROVIDER_DISABLED' ? 'legacy-disabled'
        : payload?.error === 'ANIWATCH_UPSTREAM_UNAVAILABLE' ? 'upstream-unavailable'
        : inactive ? 'service-inactive'
        : response.status === 401 || response.status === 403 || response.status === 451 ? 'access-restricted'
        : response.ok ? 'response-received' : 'upstream-error',
      catalog: summarizeCatalog(payload),
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - start,
      classification: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'network-error',
    };
  }
}

async function probeScraper(request, kind) {
  const start = Date.now();
  try {
    const value = await request();
    const searchItems = Array.isArray(value?.animes) ? value.animes.filter(isAnime) : [];
    const catalog = kind === 'home' ? summarizeCatalog(value)
      : { valid: searchItems.length > 0, count: searchItems.length };
    return { ok: catalog.valid, elapsedMs: Date.now() - start, catalog };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - start,
      classification: 'library-error',
      libraryStatus: typeof error?.status === 'number' ? error.status : undefined,
      // Library statuses can wrap timeouts; they are not proof of upstream HTTP status.
      errorName: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

export async function diagnoseAniwatch(backend = LOCAL_BACKEND) {
  const url = new URL(backend);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !['/', '/api/v2/hianime', '/api/v2/hianime/'].includes(url.pathname)) {
    throw new Error('Informe a origem HTTP/HTTPS do backend, sem credenciais ou parâmetros.');
  }
  const require = createRequire(import.meta.url);
  const packageSource = await readFile(require.resolve('aniwatch'), 'utf8');
  const defaultDomain = packageSource.match(/var DOMAIN = (?:process\.env\.ANIWATCH_DOMAIN \|\| )?"([^"]+)"/)?.[1];
  const domain = packageSource.includes('process.env.ANIWATCH_DOMAIN')
    ? process.env.ANIWATCH_DOMAIN || defaultDomain : defaultDomain;
  const packageInfo = JSON.parse(await readFile(require.resolve('aniwatch/package.json'), 'utf8'));
  const scraper = new HiAnime.Scraper();
  const [health, home, nativeHome, nativeSearch] = await Promise.all([
    probeHttp(`${url.origin}/health`),
    probeHttp(`${url.origin}/api/v2/hianime/home`),
    probeScraper(() => scraper.getHomePage(), 'home'),
    probeScraper(() => scraper.search('Frieren', 1), 'search'),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    backend: { origin: url.origin, health, home, catalogReady: home.ok && home.catalog.valid },
    library: { version: packageInfo.version, domain, home: nativeHome, search: nativeSearch },
    playback: {
      verified: false,
      message: 'Catálogo acessível não comprova reprodução. Episódios, servidores, autorização das fontes e CORS do vídeo/legendas exigem validação própria antes da integração.',
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--backend')) {
    console.error('Uso: npm run diagnose:aniwatch -- --backend https://seu-backend');
    process.exitCode = 1;
  } else {
    try {
      const report = await diagnoseAniwatch(args[1]);
      console.log(JSON.stringify(report, null, 2));
      if (!report.backend.catalogReady && !report.library.home.ok) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Não foi possível executar o diagnóstico.');
      process.exitCode = 1;
    }
  }
}
