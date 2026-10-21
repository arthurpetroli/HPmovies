import { createHash } from 'node:crypto';
import type {
  ChapterQuery, ContentChapter, ContentChapterList, ContentPages, ContentText,
  ReadingContentProvider, ReadingKind,
} from '../../../shared/content.js';
import type { ProviderDiagnostic, ProviderState } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { integrationsConfig } from '../config/integrations.js';
import type { TokoConfig } from '../config/integrations.js';
import { normalizeTokoLanguage, permittedMediaUrl } from './toko.js';
import { TokoHttpClient } from './toko-http.js';
import type { TokoChapter } from './toko-http.js';
import type { ContentImageGateway } from './content-image.js';

export interface TokoReadingOptions {
  config?: TokoConfig;
  client?: TokoHttpClient;
  id?: 'toko' | 'tatakai';
  name?: string;
  imageGateway?: ContentImageGateway;
}

interface IssuedChapter {
  kind: ReadingKind;
  workId: string;
  key: string;
  provider: string;
  chapter: ContentChapter;
}

interface ChapterListing {
  result: ContentChapterList;
  issued: IssuedChapter[];
}

const natural = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
// eslint-disable-next-line no-control-regex -- Remove binary controls from upstream text while retaining tabs/newlines.
const plain = (value: string | undefined): string => (value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
const ordered = (a: ContentChapter, b: ContentChapter): number =>
  Number(b.language === 'pt-BR') - Number(a.language === 'pt-BR') ||
  natural.compare(a.number ?? '', b.number ?? '') || natural.compare(a.title, b.title) ||
  natural.compare(a.providerId, b.providerId) || natural.compare(a.language, b.language) || a.id.localeCompare(b.id);

function failureState(error: unknown): ProviderState {
  if (error instanceof ApiError) {
    if (error.code === 'TOKO_UNAUTHORIZED') return 'unauthorized';
    if (['TOKO_DISABLED', 'TOKO_NOT_READY', 'TOKO_NOT_FOUND'].includes(error.code)) return 'unavailable';
  }
  return 'connection_error';
}

function invalidResponse(): never {
  throw new ApiError(502, 'TOKO_INVALID_RESPONSE', 'O Toko retornou conteúdo de capítulo inválido ou com posições duplicadas.');
}

/** Stable server identities never contain chapter keys, which can contain upstream URLs. */
function chapterId(id: string, kind: ReadingKind, workId: string, provider: string, key: string): string {
  return `${id}-${createHash('sha256').update(JSON.stringify([id, kind, workId, provider, key])).digest('hex')}`;
}

/** Reading through the verified HTTP contract, scoped to explicitly permitted sources. */
export class TokoReadingProvider implements ReadingContentProvider {
  readonly id: 'toko' | 'tatakai';
  readonly name: string;
  readonly config: TokoConfig;
  readonly client: TokoHttpClient;
  private readonly imageGateway?: ContentImageGateway;
  private readonly issued = new Map<string, IssuedChapter>();

  constructor(options: TokoReadingOptions = {}) {
    this.id = options.id ?? 'toko';
    this.name = options.name ?? (this.id === 'tatakai' ? 'Tatakai local' : 'Toko HTTP');
    this.config = options.config ?? options.client?.config ?? integrationsConfig.toko;
    this.client = options.client ?? new TokoHttpClient(this.config);
    this.imageGateway = options.imageGateway;
  }

  supports(kind: ReadingKind, workId: string): boolean {
    const match = /^anilist:([1-9]\d{0,9})$/.exec(workId);
    return (kind === 'manga' || kind === 'novel') && !!match && Number(match[1]) <= 2_147_483_647;
  }

  private workNumber(kind: ReadingKind, workId: string): number {
    if (!this.supports(kind, workId)) throw new ApiError(400, 'INVALID_WORK_ID', 'Informe uma obra AniList no formato anilist:123.');
    return Number(workId.slice('anilist:'.length));
  }

  private get contentPermitted(): boolean {
    // Novel text does not use media hosts. Manga pages validate every image separately.
    return this.config.contentAuthorized && this.config.allowedProviders.length > 0;
  }

  private status(state: ProviderState, technicalAvailable: boolean, message: string, provider?: string): ProviderDiagnostic {
    return {
      id: provider ? `${this.id}:${provider}` : this.id,
      name: provider ? `${this.name} · ${provider}` : `${this.name} · Leitura`,
      enabled: this.config.enabled, state, technicalAvailable, authorized: this.contentPermitted,
      checkedAt: new Date().toISOString(), message,
      capabilities: ['manga-chapters', 'manga-pages', 'novel-chapters', 'novel-text'],
    };
  }

  async diagnostic(): Promise<ProviderDiagnostic> {
    if (!this.config.enabled) return this.status('unavailable', false, 'A integração HTTP de leitura do Toko está desativada.');
    try {
      const health = await this.client.health();
      if (!health.ok || !health.toko) return this.status('unavailable', health.ok && health.service === 'extension-api-host', `${this.name} está acessível, mas não possui uma extensão compatível de leitura carregada.`);
      return this.contentPermitted
        ? this.status('available', true, 'Toko HTTP disponível para consultar as fontes de leitura configuradas.')
        : this.status('unauthorized', true, 'Configure a autorização de conteúdo e os provedores de leitura do Toko.');
    } catch (error) {
      return this.status(failureState(error), false, error instanceof ApiError ? error.message : 'Não foi possível verificar o serviço Toko.');
    }
  }

  private remember(chapter: IssuedChapter): void {
    this.issued.delete(chapter.chapter.id);
    this.issued.set(chapter.chapter.id, chapter);
    while (this.issued.size > 20_000) this.issued.delete(this.issued.keys().next().value!);
  }

  private normalize(kind: ReadingKind, workId: string, provider: string, row: TokoChapter): IssuedChapter {
    if (row.provider !== provider || !row.chapterKey.trim()) return invalidResponse();
    const number = plain(row.number) || undefined;
    const chapter: ContentChapter = {
      id: chapterId(this.id, kind, workId, provider, row.chapterKey), workId,
      providerId: provider, providerName: provider, number,
      title: plain(row.title) || (number ? `Capítulo ${number}` : 'Capítulo sem número'),
      language: normalizeTokoLanguage(row.language),
      credits: [...new Set([plain(row.scanlator), plain(row.translator)].filter(Boolean))],
      available: true,
    };
    return { kind, workId, provider, key: row.chapterKey, chapter };
  }

  private async listing(kind: ReadingKind, workId: string, query: ChapterQuery = {}): Promise<ChapterListing> {
    const anilistId = this.workNumber(kind, workId);
    if (query.provider !== undefined && !this.config.allowedProviders.includes(query.provider)) {
      throw new ApiError(400, 'INVALID_READING_PROVIDER', 'O provedor solicitado não está configurado para leitura.');
    }
    if (query.language !== undefined && normalizeTokoLanguage(query.language) === 'und' && query.language !== 'und') {
      throw new ApiError(400, 'INVALID_READING_LANGUAGE', 'Informe um código de idioma válido.');
    }
    const diagnostic = await this.diagnostic();
    if (diagnostic.state !== 'available') return {
      result: { available: false, state: diagnostic.state, message: diagnostic.message, chapters: [], languages: [], diagnostics: [diagnostic] }, issued: [],
    };
    const providers = query.provider ? [query.provider] : [...new Set(this.config.allowedProviders)];
    const results = await Promise.all(providers.map(async (provider) => {
      try {
        const response = await this.client.chapters(kind, anilistId, provider, query.titles);
        const unique = new Map<string, IssuedChapter>();
        for (const row of response.chapters) {
          const chapter = this.normalize(kind, workId, provider, row);
          if (!unique.has(chapter.chapter.id)) unique.set(chapter.chapter.id, chapter);
        }
        const issued = [...unique.values()];
        for (const chapter of issued) this.remember(chapter);
        const upstreamStatus = response.providerStatus?.find((item) => item.provider === provider);
        const failed = upstreamStatus?.status === 'error' || upstreamStatus?.status === 'timeout';
        const pending = !issued.length && (upstreamStatus?.status === 'pending' || upstreamStatus?.status === 'running' || (response.partial === true && !upstreamStatus));
        const state = failed ? 'connection_error' : issued.length ? 'available' : pending ? 'checking' : 'empty';
        const message = failed ? `A fonte ${provider} informou uma falha ao consultar seus capítulos.`
          : issued.length ? `${issued.length} capítulo(s) listado(s) por ${provider}; o conteúdo é verificado ao abrir.`
            : pending ? `A consulta de capítulos em ${provider} ainda está incompleta.` : `Nenhum capítulo encontrado em ${provider}.`;
        return {
          issued, partial: response.partial === true,
          diagnostic: this.status(state, !failed, message, provider),
        };
      } catch (error) {
        return {
          issued: [] as IssuedChapter[], partial: false,
          diagnostic: this.status(failureState(error), false, error instanceof ApiError ? error.message : `Falha ao consultar capítulos em ${provider}.`, provider),
        };
      }
    }));
    const all = results.flatMap((result) => result.issued).sort((a, b) => ordered(a.chapter, b.chapter));
    const language = query.language === undefined ? undefined : normalizeTokoLanguage(query.language);
    const issued = language ? all.filter((row) => row.chapter.language === language) : all;
    const diagnostics = results.map((result) => result.diagnostic);
    const partial = results.some((result) => result.partial);
    const state: ProviderState = issued.length ? 'available'
      : diagnostics.every((item) => item.state === 'empty' || item.state === 'available') ? 'empty'
        : diagnostics.find((item) => item.state !== 'empty' && item.state !== 'available')?.state ?? 'empty';
    const message = issued.length ? partial ? 'Consulta parcial: capítulos encontrados nas fontes que já responderam.' : 'Capítulos encontrados nas fontes de leitura configuradas.'
      : state === 'empty' ? 'Nenhum capítulo encontrado para esta obra e os filtros selecionados.'
        : 'As fontes de leitura não puderam concluir a consulta. Consulte os diagnósticos por provedor.';
    return {
      result: {
        available: issued.length > 0, state, message, chapters: issued.map((row) => row.chapter),
        languages: [...new Set(all.map((row) => row.chapter.language))].sort((a, b) => Number(b === 'pt-BR') - Number(a === 'pt-BR') || natural.compare(a, b)),
        diagnostics, ...(partial ? { partial: true } : {}),
      }, issued,
    };
  }

  async chapters(kind: ReadingKind, workId: string, query: ChapterQuery = {}): Promise<ContentChapterList> {
    return (await this.listing(kind, workId, query)).result;
  }

  private async resolve(kind: ReadingKind, workId: string, id: string, query: ChapterQuery = {}): Promise<{ target: IssuedChapter; previousChapterId?: string; nextChapterId?: string }> {
    this.workNumber(kind, workId);
    if (!id.startsWith(`${this.id}-`) || !/^[a-f0-9]{64}$/.test(id.slice(this.id.length + 1))) throw new ApiError(400, 'INVALID_CHAPTER_ID', `Identificador de capítulo ${this.name} inválido.`);
    if (!this.config.enabled) throw new ApiError(503, 'TOKO_DISABLED', 'A integração HTTP de leitura do Toko está desativada.');
    if (!this.contentPermitted) throw new ApiError(503, 'TOKO_UNAUTHORIZED', 'Nenhuma fonte autorizada de leitura foi configurada no Toko.');
    const remembered = this.issued.get(id);
    if (remembered && (remembered.kind !== kind || remembered.workId !== workId)) throw new ApiError(404, 'CHAPTER_NOT_FOUND', 'O capítulo não pertence a esta obra.');
    // Re-listing reconstructs stable identities after restart and renews the HTTP
    // client's issued-key permission. User input is never used as an upstream key.
    const listing = await this.listing(kind, workId, { titles: query.titles });
    const target = listing.issued.find((chapter) => chapter.chapter.id === id);
    if (!target) {
      if (listing.result.state !== 'available' && listing.result.state !== 'empty') {
        const state = listing.result.state;
        throw new ApiError(503, state === 'unauthorized' ? 'TOKO_UNAUTHORIZED' : 'TOKO_READING_UNAVAILABLE', listing.result.message);
      }
      throw new ApiError(404, 'CHAPTER_NOT_FOUND', 'O capítulo não foi encontrado nesta obra e nas fontes autorizadas.');
    }
    const siblings = listing.issued.filter((row) => row.provider === target.provider && row.chapter.language === target.chapter.language);
    const position = siblings.findIndex((row) => row.chapter.id === id);
    return {
      target,
      ...(position > 0 ? { previousChapterId: siblings[position - 1].chapter.id } : {}),
      ...(position + 1 < siblings.length ? { nextChapterId: siblings[position + 1].chapter.id } : {}),
    };
  }

  async pages(workId: string, id: string, query: ChapterQuery = {}): Promise<ContentPages> {
    const { target, previousChapterId, nextChapterId } = await this.resolve('manga', workId, id, query);
    const result = await this.client.mangaPages(target.key, target.provider, Number(workId.slice('anilist:'.length)));
    if (!result.length) throw new ApiError(404, 'CHAPTER_UNAVAILABLE', 'Este capítulo não possui páginas disponíveis.');
    const indexes = new Set<number>();
    const sorted = [...result].sort((a, b) => a.pageNumber - b.pageNumber);
    for (const page of sorted) {
      if (!Number.isSafeInteger(page.pageNumber) || page.pageNumber < 1 || indexes.has(page.pageNumber)) return invalidResponse();
      indexes.add(page.pageNumber);
      if (page.requiresHeaders && (!page.headers || !this.imageGateway)) throw new ApiError(503, 'TOKO_REQUIRED_HEADERS_UNSUPPORTED', 'Esta fonte exige cabeçalhos de acesso e não oferece páginas com acesso direto compatível.');
    }
    const pages = sorted.map((page) => {
      const url = permittedMediaUrl(page.imageUrl, this.config.allowedMediaHosts);
      if (!url) throw new ApiError(503, 'TOKO_MEDIA_NOT_PERMITTED', 'Uma página usa um domínio ou formato de URL sem permissão de mídia configurada.');
      if (page.requiresHeaders) return this.imageGateway!.issue(this.config, target.provider, url, page.headers!);
      return url;
    });
    return { chapter: target.chapter, pages, previousChapterId, nextChapterId, isDemo: false };
  }

  async text(workId: string, id: string, query: ChapterQuery = {}): Promise<ContentText> {
    const { target, previousChapterId, nextChapterId } = await this.resolve('novel', workId, id, query);
    const result = await this.client.novelContent(target.key, target.provider, Number(workId.slice('anilist:'.length)));
    const indexes = new Set<number>();
    const paragraphs = [...result.paragraphs].sort((a, b) => a.index - b.index).map((paragraph) => {
      if (!Number.isSafeInteger(paragraph.index) || paragraph.index < 0 || indexes.has(paragraph.index)) return invalidResponse();
      indexes.add(paragraph.index);
      // Keep strings as text. The reader renders them with React text nodes.
      return plain(paragraph.text);
    }).filter(Boolean);
    if (!paragraphs.length) throw new ApiError(404, 'CHAPTER_UNAVAILABLE', 'Este capítulo não possui texto disponível.');
    return { chapter: target.chapter, paragraphs, previousChapterId, nextChapterId, isDemo: false };
  }
}
