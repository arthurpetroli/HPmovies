import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AnimeCatalogProvider, AnimeStreamingProvider, ProviderDiagnostic } from '../../shared/providers.js';
import { ApiError } from './config/apiError.js';
import type { ServerContext } from './config/context.js';
import { AniListCatalogProvider, validateAnimeId, validateCatalogQuery } from './providers/anilist.js';
import { StreamingRegistry } from './providers/registry.js';
import { cache } from './config/cache.js';
import { runtimeConfig } from './config/runtime.js';
import { apiLimit } from './middleware/apiLimit.js';
import type { MangaCatalogProvider, MangaChapterProvider, MangaImageProvider } from '../../shared/manga.js';
import type { NovelProvider } from '../../shared/novel.js';
import { MangaDexProvider, validateMangaId, validateMangaQuery, validateMangaLanguage, validateMangaCatalogLanguage, validateMangaPage } from './providers/mangadex.js';
import { ContentRegistry, contentQuery, titleHints, validateWorkId } from './providers/content-registry.js';
import { NovelContentProvider } from './providers/novel-content.js';
import { AniListNovelProvider, validateNovelId, validateNovelQuery } from './providers/novels.js';
import { streamMediaGateway } from './providers/stream-media.js';
import { AutomaticSubtitleJobs } from './providers/automatic-subtitle-jobs.js';
import { IntroSkipProvider } from './providers/intro-skips.js';

interface AppOptions {
  catalog?: AnimeCatalogProvider;
  streaming?: AnimeStreamingProvider;
  legacyEnabled?: boolean;
  manga?: MangaCatalogProvider & MangaChapterProvider & Partial<MangaImageProvider>;
  novels?: NovelProvider;
  rateLimit?: number;
  mediaRateLimit?: number;
  registry?: StreamingRegistry;
  content?: ContentRegistry;
  automaticSubtitles?: AutomaticSubtitleJobs;
  introSkips?: IntroSkipProvider;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<ServerContext>();
  const catalog = options.catalog ?? new AniListCatalogProvider();
  const registry = options.registry ?? new StreamingRegistry();
  const streaming = options.streaming ?? registry;
  const legacyEnabled = options.legacyEnabled ?? process.env.ENABLE_LEGACY_HIANIME === 'true';
  const manga = options.manga ?? new MangaDexProvider();
  const content = options.content ?? new ContentRegistry(registry);
  const novels = options.novels ?? new NovelContentProvider(new AniListNovelProvider(), content);
  const introSkips = options.introSkips ?? new IntroSkipProvider();
  const automaticSubtitles = options.automaticSubtitles ?? new AutomaticSubtitleJobs({ load: async path => {
    const match = /^\/api\/(streaming\/media|subtitles\/file)\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (!match) throw new ApiError(400, 'INVALID_SUBTITLE', 'Faixa de legenda inválida.');
    return match[1] === 'streaming/media' ? (await streamMediaGateway.media(match[2])).bytes : (await registry.subtitles.file(match[2])).bytes;
  } });

  const ordinaryHeaders = secureHeaders();
  const imageHeaders = secureHeaders({ crossOriginResourcePolicy: 'cross-origin' });
  app.use('*', (c, next) => (c.req.path.startsWith('/api/manga/image/') || c.req.path.startsWith('/api/content/image/') || c.req.path.startsWith('/api/streaming/media/') || c.req.path.startsWith('/api/subtitles/file/') ? imageHeaders : ordinaryHeaders)(c, next));
  app.use('*', cors({
    origin: runtimeConfig.allowedOrigins,
    allowHeaders: ['Content-Type', 'Accept', 'Range'],
    exposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }));
  const requestLimit = apiLimit(options.rateLimit ?? runtimeConfig.rateLimit, runtimeConfig.rateWindowMs);
  const mediaLimit = apiLimit(options.mediaRateLimit ?? runtimeConfig.mediaRateLimit, runtimeConfig.rateWindowMs);
  app.use('/api/*', (c, next) => (c.req.path.startsWith('/api/manga/image/') || c.req.path.startsWith('/api/content/image/') || c.req.path.startsWith('/api/streaming/media/') || c.req.path.startsWith('/api/subtitles/file/') ? mediaLimit : requestLimit)(c, next));
  app.get('/health', (c) => c.json({
    status: 'OK', catalogProvider: 'anilist', streamingProvider: 'registry', mangaProvider: 'mangadex',
    legacyEnabled, timestamp: new Date().toISOString(),
  }));
  app.get('/api/providers', async (c) => {
    const probe = async (id: string, name: string, task: () => Promise<unknown>, capabilities: string[]): Promise<ProviderDiagnostic> => {
      try {
        await task();
        return { id, name, enabled: true, state: 'available', technicalAvailable: true, authorized: true, checkedAt: new Date().toISOString(), message: 'API de metadados disponível. A reprodução e a leitura dependem das fontes de conteúdo.', capabilities };
      } catch (error) {
        return { id, name, enabled: true, state: 'connection_error', technicalAvailable: false, authorized: true, checkedAt: new Date().toISOString(), message: error instanceof ApiError ? error.message : 'Não foi possível conectar ao serviço.', capabilities };
      }
    };
    const data = await cache.getOrSet(() => Promise.all([
      probe('anilist', 'AniList', () => catalog.genres(), ['anime-catalog', 'novel-catalog']),
      probe('mangadex', 'MangaDex', () => manga.tags(), ['manga-catalog', 'manga-chapters']),
      registry.toko.diagnostic(), registry.tatakai.diagnostic(), registry.stremio.diagnostic(),
      Promise.resolve<ProviderDiagnostic>({ id: 'demo', name: 'Demonstrações locais', enabled: true, state: 'available', technicalAvailable: true, authorized: true, checkedAt: new Date().toISOString(), message: 'Vídeo de demonstração com licença CC BY e texto original para testar os leitores.', capabilities: ['video-demo', 'novel-demo'] }),
    ]), 'providers:diagnostics', 20);
    return c.json({ data });
  });

  app.get('/api/catalog/home', async (c) => c.json({ data: await catalog.home() }));
  app.get('/api/catalog/search', async (c) => c.json({ data: await catalog.search(validateCatalogQuery(c.req.query())) }));
  app.get('/api/catalog/genres', async (c) => c.json({ data: await catalog.genres() }));
  app.get('/api/catalog/anime/:id', async (c) => c.json({ data: await catalog.details(validateAnimeId(c.req.param('id'))) }));
  app.get('/api/streaming/anime/:id/episodes', async (c) => {
    const id = c.req.param('id');
    if (id !== 'demo') validateAnimeId(id);
    return c.json({ data: await streaming.episodes(id, titleHints(new URL(c.req.url).searchParams)) });
  });
  app.get('/api/streaming/episodes/:id', async (c) => c.json({ data: await automaticSubtitles.offer(await streaming.playback(c.req.param('id'), titleHints(new URL(c.req.url).searchParams))) }));
  for (const segment of ['intro', 'ending'] as const) app.get(`/api/streaming/episodes/:id/${segment}`, async c => {
    const params = new URL(c.req.url).searchParams;
    const id = c.req.param('id');
    const duration = Number(params.get('duration'));
    if (!/^(?:toko|tatakai):[1-9]\d{0,8}:[1-9]\d{0,5}$/.test(id) || Number(id.split(':')[2]) > 100_000
      || params.getAll('duration').length !== 1 || [...params.keys()].some(key => key !== 'duration')
      || !Number.isFinite(duration) || duration < 1 || duration > 86_400) throw new ApiError(400, segment === 'intro' ? 'INVALID_INTRO_QUERY' : 'INVALID_ENDING_QUERY', 'Informe um episódio e uma duração de vídeo válidos.');
    return c.json({ data: await introSkips[segment](id, duration) ?? null });
  });
  app.get('/api/streaming/media/:token', async c => {
    if (new URL(c.req.url).search) throw new ApiError(400, 'INVALID_MEDIA_QUERY', 'A mídia aceita somente o identificador emitido pela fonte.');
    const media = await streamMediaGateway.media(c.req.param('token'), c.req.header('range'));
    return new Response(media.bytes as Uint8Array<ArrayBuffer>, { status: media.status, headers: media.headers });
  });

  app.get('/api/subtitles/file/:token', async c => {
    if (new URL(c.req.url).search) throw new ApiError(400, 'INVALID_SUBTITLE_QUERY', 'Use apenas o identificador da legenda emitido pelo servidor.');
    const file = await registry.subtitles.file(c.req.param('token'));
    return new Response(file.bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': file.contentType, 'Cache-Control': file.cacheControl, 'X-Content-Type-Options': 'nosniff' } });
  });

  app.post('/api/subtitles/automatic/:token', c => {
    const origin = c.req.header('origin');
    if (origin && !runtimeConfig.allowedOrigins.includes(origin)) return c.json({ error: 'INVALID_ORIGIN', message: 'Origem da solicitação não permitida.' }, 403);
    if (new URL(c.req.url).search || c.req.header('content-type') !== 'application/json') throw new ApiError(400, 'INVALID_SUBTITLE_REQUEST', 'Use a opção de tradução do player.');
    return c.json({ data: automaticSubtitles.start(c.req.param('token')) }, 202);
  });
  app.get('/api/subtitles/automatic/jobs/:id', c => c.json({ data: automaticSubtitles.status(c.req.param('id')) }));
  app.get('/api/subtitles/automatic/file/:token', c => {
    if (new URL(c.req.url).search) throw new ApiError(400, 'INVALID_SUBTITLE_QUERY', 'Use apenas o identificador da legenda.');
    const file = automaticSubtitles.translator.file(c.req.param('token'));
    return new Response(file.bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': file.contentType, 'Cache-Control': file.cacheControl, 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' } });
  });

  app.get('/api/content/anime/:id/episodes/:episode', async c => {
    const id = validateWorkId(c.req.param('id')).slice('anilist:'.length);
    const episode = c.req.param('episode');
    if (!/^(?:[1-9]\d{0,5}|0)(?:\.\d{1,3})?$/.test(episode)) throw new ApiError(400, 'INVALID_EPISODE', 'Episódio inválido.');
    const params = new URL(c.req.url).searchParams;
    return c.json({ data: await automaticSubtitles.offer(await registry.resolve(id, Number(episode), params.get('source') || undefined, titleHints(params))) });
  });
  app.get('/api/content/stremio/:imdb/:season/:episode', async c => c.json({ data: await registry.stremio.playback({ imdbId: c.req.param('imdb'), season: Number(c.req.param('season')), episode: Number(c.req.param('episode')), provider: c.req.query('provider') || undefined }) }));
  app.get('/api/content/image/:token', async c => {
    const image = await content.image(c.req.param('token'));
    return new Response(image.bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': image.contentType, 'Cache-Control': image.cacheControl, 'X-Content-Type-Options': 'nosniff' } });
  });
  app.get('/api/content/:kind/:workId/chapters', async c => {
    const kind = c.req.param('kind');
    if (kind !== 'manga' && kind !== 'novel') throw new ApiError(400, 'INVALID_CONTENT_KIND', 'Escolha manga ou novel.');
    return c.json({ data: await content.chapters(kind, c.req.param('workId'), contentQuery(new URL(c.req.url).searchParams)) });
  });
  app.get('/api/content/manga/:workId/chapters/:chapterId/pages', async c => c.json({ data: await content.pages(c.req.param('workId'), c.req.param('chapterId'), contentQuery(new URL(c.req.url).searchParams)) }));
  app.get('/api/content/novel/:workId/chapters/:chapterId/content', async c => c.json({ data: await content.text(c.req.param('workId'), c.req.param('chapterId'), contentQuery(new URL(c.req.url).searchParams)) }));

  app.get('/api/manga/image/:token', async (c) => {
    if (!manga.image) throw new ApiError(404, 'IMAGE_UNAVAILABLE', 'Imagem indisponível.');
    const image = await manga.image(c.req.param('token'));
    return new Response(image.bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': image.contentType, 'Cache-Control': image.cacheControl, 'X-Content-Type-Options': 'nosniff' } });
  });
  app.get('/api/manga/home', async (c) => c.json({ data: await manga.home(validateMangaCatalogLanguage(c.req.query('language'))) }));
  app.get('/api/manga/search', async (c) => c.json({ data: await manga.search(validateMangaQuery(c.req.query())) }));
  app.get('/api/manga/tags', async (c) => c.json({ data: await manga.tags() }));
  app.get('/api/manga/chapter/:chapterId/pages', async (c) => c.json({ data: await manga.pages(validateMangaId(c.req.param('chapterId'))) }));
  app.get('/api/manga/:id/chapters', async (c) => c.json({ data: await manga.chapters(validateMangaId(c.req.param('id')), validateMangaLanguage(c.req.query('language') || 'pt-br'), validateMangaPage(c.req.query('page') || '1', true)) }));
  app.get('/api/manga/:id', async (c) => c.json({ data: await manga.details(validateMangaId(c.req.param('id'))) }));
  app.get('/api/novels/search', async (c) => c.json({ data: await novels.search(validateNovelQuery(c.req.query())) }));
  app.get('/api/novels/genres', async (c) => c.json({ data: await novels.genres() }));
  app.get('/api/novels/:id/chapters/:chapterId/content', async (c) => c.json({ data: await novels.content(validateNovelId(c.req.param('id')), c.req.param('chapterId'), contentQuery(new URL(c.req.url).searchParams)) }));
  app.get('/api/novels/:id/chapters', async (c) => c.json({ data: await novels.chapters(validateNovelId(c.req.param('id')), contentQuery(new URL(c.req.url).searchParams)) }));
  app.get('/api/novels/:id', async (c) => c.json({ data: await novels.details(validateNovelId(c.req.param('id'))) }));

  // This route remains blocked even when compatibility scraping is enabled.
  app.all('/api/v2/hianime/proxy-stream', (c) => c.json({
    error: 'STREAM_PROXY_REMOVED', message: 'O proxy de URLs arbitrárias foi removido. Use uma fonte autorizada no player.',
  }, 410));
  app.use('/api/v2/hianime/*', async (c) => {
    if (!legacyEnabled) return c.json({
      error: 'LEGACY_PROVIDER_DISABLED',
      message: 'A integração legada HiAnime está desativada. O catálogo local usa o AniList.',
    }, 503);
    // Compatibility code and its optional scraper are loaded only for an
    // explicitly enabled legacy request. Catalog, health and demo stay independent.
    let legacy: typeof import('./routes/legacy.js');
    try {
      legacy = await import('./routes/legacy.js');
    } catch {
      throw new ApiError(503, 'LEGACY_PROVIDER_UNAVAILABLE', 'A compatibilidade HiAnime foi habilitada, mas sua dependência opcional não pôde ser carregada. A API local continua ativa.');
    }
    return legacy.legacyRouter.fetch(c.req.raw, c.env);
  });
  app.notFound((c) => c.json({ error: 'NOT_FOUND', message: 'Rota não encontrada.' }, 404));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.retryAfter) c.header('Retry-After', String(error.retryAfter));
      return c.json({ error: error.code, message: error.message }, error.status);
    }
    console.error('[HPmovies API]', error.name, error.message);
    return c.json({ error: 'INTERNAL_ERROR', message: 'Não foi possível concluir a solicitação. Tente novamente.' }, 500);
  });
  return app;
}

export default createApp();
