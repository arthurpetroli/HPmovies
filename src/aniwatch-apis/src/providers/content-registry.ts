import type { ChapterQuery, ContentChapterList, ReadingContentProvider, ReadingKind } from '../../../shared/content.js';
import type { ProviderDiagnostic } from '../../../shared/providers.js';
import { ApiError } from '../config/apiError.js';
import { TokoReadingProvider } from './toko-reading.js';
import type { StreamingRegistry } from './registry.js';
import { ContentImageGateway } from './content-image.js';

export interface ContentQuery extends ChapterQuery { source?: string }

export function validateWorkId(value: string): string {
  const id = value.startsWith('anilist:') ? value : `anilist:${value}`;
  if (!/^anilist:[1-9]\d{0,8}$/.test(id)) throw new ApiError(400, 'INVALID_WORK_ID', 'Use o identificador AniList da obra, como anilist:30001.');
  return id;
}

export function titleHints(params: URLSearchParams): string[] {
  const values = [...params.getAll('title'), ...params.getAll('titles[]')];
  if (values.length > 5 || values.some(value => !value.trim() || value.length > 200 || [...value].some(char => char.charCodeAt(0) < 32))) throw new ApiError(400, 'INVALID_TITLE_HINT', 'Informe até cinco títulos de até 200 caracteres.');
  return [...new Set(values.map(value => value.trim()))];
}

export function contentQuery(params: URLSearchParams): ContentQuery {
  const allowed = new Set(['source', 'provider', 'language', 'title', 'titles[]']);
  if ([...params.keys()].some(key => !allowed.has(key))) throw new ApiError(400, 'INVALID_CONTENT_QUERY', 'Filtro de conteúdo desconhecido.');
  const source = params.get('source') || undefined, provider = params.get('provider') || undefined, language = params.get('language') || undefined;
  if (source && !['tatakai', 'toko'].includes(source) || provider && !/^[a-z0-9][a-z0-9-]{0,149}$/.test(provider) || language && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) throw new ApiError(400, 'INVALID_CONTENT_QUERY', 'Fonte, provedor ou idioma inválido.');
  return { source, provider, language, titles: titleHints(params) };
}

export class ContentRegistry {
  readonly providers: ReadingContentProvider[];
  constructor(streaming: StreamingRegistry, providers?: ReadingContentProvider[], readonly imageGateway = new ContentImageGateway()) {
    this.providers = providers ?? [
      new TokoReadingProvider({ client: streaming.toko.client, config: streaming.toko.config, imageGateway }),
      new TokoReadingProvider({ client: streaming.tatakai.client, config: streaming.tatakai.contentConfig, id: 'tatakai', name: 'Tatakai local', imageGateway }),
    ];
  }

  image(token: string) { return this.imageGateway.image(token); }

  async chapters(kind: ReadingKind, work: string, query: ContentQuery = {}): Promise<ContentChapterList> {
    const workId = validateWorkId(work);
    const providers = this.providers.filter(provider => provider.supports(kind, workId) && (!query.source || provider.id === query.source));
    if (!providers.length) throw new ApiError(400, 'READING_SOURCE_UNSUPPORTED', 'Nenhuma fonte configurada aceita esta obra.');
    const results = await Promise.all(providers.map(async (provider): Promise<ContentChapterList> => {
      try { return await provider.chapters(kind, workId, query); }
      catch (error) {
        if (error instanceof ApiError && error.status === 400 && query.source) throw error;
        const diagnostic: ProviderDiagnostic = { id: provider.id, name: provider.id, enabled: true, state: 'connection_error', technicalAvailable: false, authorized: false, checkedAt: new Date().toISOString(), message: error instanceof ApiError ? error.message : 'Não foi possível consultar esta fonte.', capabilities: [`${kind}-chapters`] };
        return { available: false, state: diagnostic.state, message: diagnostic.message, chapters: [], languages: [], diagnostics: [diagnostic] } satisfies ContentChapterList;
      }
    }));
    const chapters = results.flatMap(result => result.chapters).sort((a, b) => Number(b.language === 'pt-BR') - Number(a.language === 'pt-BR') || (a.number ?? '').localeCompare(b.number ?? '', 'pt-BR', { numeric: true }));
    const state = chapters.length ? 'available' : results.find(result => result.state === 'unauthorized')?.state ?? results.find(result => result.state === 'connection_error')?.state ?? results[0].state;
    return { available: chapters.length > 0, state, message: chapters.length ? 'Capítulos encontrados nas fontes conectadas.' : results.map(result => result.message).join(' '), chapters, languages: [...new Set(results.flatMap(result => result.languages))], diagnostics: results.flatMap(result => result.diagnostics), partial: results.some(result => result.partial || result.state === 'connection_error') };
  }

  private provider(kind: ReadingKind, work: string, chapterId: string, query: ContentQuery) {
    const workId = validateWorkId(work);
    const selected = this.providers.find(provider => chapterId.startsWith(`${provider.id}-`) && provider.supports(kind, workId) && (!query.source || provider.id === query.source));
    if (!selected) throw new ApiError(400, 'INVALID_CHAPTER_ID', 'Identificador de capítulo ou fonte inválido.');
    return { selected, workId };
  }
  pages(work: string, chapterId: string, query: ContentQuery = {}) {
    const { selected, workId } = this.provider('manga', work, chapterId, query);
    return selected.pages(workId, chapterId, query);
  }
  text(work: string, chapterId: string, query: ContentQuery = {}) {
    const { selected, workId } = this.provider('novel', work, chapterId, query);
    return selected.text(workId, chapterId, query);
  }
}
