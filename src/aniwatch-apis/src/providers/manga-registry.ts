import type { MangaCatalogProvider, MangaChapterProvider, MangaImageProvider, MangaProviderId, MangaQuery, MangaTitle } from '../../../shared/manga.js';
import { isMangaChapterId, isMangaTagId, isMangaWorkId, mangaChapterBelongsTo, mangaProviderForId, mangaProviderLabel } from '../../../shared/mangaIdentity.js';
import { ApiError } from '../config/apiError.js';
import { MangaDexProvider, validateMangaQuery } from './mangadex.js';
import { MangaLivreProvider } from './mangalivre.js';

type Source = MangaCatalogProvider & MangaChapterProvider & Partial<MangaImageProvider>;
export function validateMangaProvider(value = 'mangadex'): MangaProviderId {
  if (value !== 'mangadex' && value !== 'mangalivre') throw new ApiError(400, 'INVALID_MANGA_PROVIDER', 'Escolha MangaDex ou Mangá Livre (.to).');
  return value;
}
export function validateReadingMangaId(id: string, chapter = false): string {
  if (!(chapter ? isMangaChapterId(id) : isMangaWorkId(id))) throw new ApiError(400, 'INVALID_MANGA_ID', 'Identificador de mangá ou capítulo inválido.');
  return id.toLowerCase();
}
export function validateReadingMangaQuery(params: Record<string, string>): MangaQuery {
  const { provider: value, tag, ...rest } = params;
  const provider = validateMangaProvider(value);
  const query = validateMangaQuery(rest);
  if (tag) {
    if (!isMangaTagId(tag) || mangaProviderForId(tag) !== provider) throw new ApiError(400, 'INVALID_FILTER', 'O gênero não pertence ao provedor escolhido.');
    query.tag = tag;
  }
  return { ...query, provider };
}

/** Qualified work/chapter IDs keep sources separate; only issued image tickets are routed. */
export class MangaRegistry implements MangaCatalogProvider, MangaChapterProvider, MangaImageProvider {
  private readonly sources: Record<MangaProviderId, Source>;
  private readonly owners = new Map<string, { provider: MangaProviderId; expires: number }>();
  constructor(options: { mangadex?: Source; mangalivre?: Source } = {}) {
    this.sources = { mangadex: options.mangadex ?? new MangaDexProvider(), mangalivre: options.mangalivre ?? new MangaLivreProvider() };
  }
  private remember(path: string, provider: MangaProviderId) {
    const token = /^\/api\/manga\/image\/([0-9a-f-]{36})$/.exec(path)?.[1];
    if (!token) return;
    if (this.owners.size >= 16000) {
      for (const [key, entry] of this.owners) if (entry.expires <= Date.now()) this.owners.delete(key);
      if (this.owners.size >= 16000) this.owners.delete(this.owners.keys().next().value!);
    }
    this.owners.set(token, { provider, expires: Date.now() + 60 * 60_000 });
  }
  private card(manga: MangaTitle, provider: MangaProviderId): MangaTitle {
    if (!isMangaWorkId(manga.id) || mangaProviderForId(manga.id) !== provider) throw new ApiError(502, 'INVALID_MANGA_RESPONSE', 'A fonte retornou uma obra de outro provedor.');
    this.remember(manga.poster, provider);
    return { ...manga, providerId: provider, providerName: mangaProviderLabel(provider) };
  }
  async home(language = 'pt-br', provider: MangaProviderId = 'mangadex') {
    const result = await this.sources[provider].home(language);
    return { ...result, popular: result.popular.map(manga => this.card(manga, provider)), topRated: result.topRated.map(manga => this.card(manga, provider)), ongoing: result.ongoing.map(manga => this.card(manga, provider)), latest: result.latest.map(manga => this.card(manga, provider)) };
  }
  async search(query: MangaQuery) {
    const { provider = 'mangadex', ...filters } = query;
    const result = await this.sources[provider].search(filters);
    return { ...result, items: result.items.map(manga => this.card(manga, provider)) };
  }
  async details(id: string) {
    const valid = validateReadingMangaId(id); const provider = mangaProviderForId(valid);
    const manga = await this.sources[provider].details(valid);
    if (manga.id !== valid) throw new ApiError(502, 'INVALID_MANGA_RESPONSE', 'A fonte retornou outra obra.');
    return this.card(manga, provider);
  }
  tags(provider: MangaProviderId = 'mangadex') { return this.sources[provider].tags(); }
  async chapters(id: string, language = 'pt-br', page = 1) {
    const valid = validateReadingMangaId(id);
    const result = await this.sources[mangaProviderForId(valid)].chapters(valid, language, page);
    if (result.items.some(chapter => chapter.mangaId !== valid || !mangaChapterBelongsTo(chapter.id, valid))) throw new ApiError(502, 'INVALID_MANGA_RESPONSE', 'A fonte retornou capítulos de outra obra.');
    return result;
  }
  async pages(id: string) {
    const valid = validateReadingMangaId(id, true); const provider = mangaProviderForId(valid);
    const result = await this.sources[provider].pages(valid);
    if (result.chapter.id !== valid || !mangaChapterBelongsTo(valid, result.chapter.mangaId)) throw new ApiError(502, 'INVALID_MANGA_RESPONSE', 'A fonte retornou outro capítulo.');
    if ([result.navigation?.previousId, result.navigation?.nextId].some(id => id !== undefined && !mangaChapterBelongsTo(id, result.chapter.mangaId))) throw new ApiError(502, 'INVALID_MANGA_RESPONSE', 'A navegação retornada pertence a outra obra ou provedor.');
    result.pages.forEach(path => this.remember(path, provider));
    return result;
  }
  async image(token: string) {
    const entry = this.owners.get(token);
    const provider = entry && entry.expires > Date.now() ? entry.provider : 'mangadex';
    const source = this.sources[provider];
    if (!source.image) throw new ApiError(404, 'MANGA_IMAGE_UNAVAILABLE', 'Imagem indisponível.');
    return source.image(token);
  }
}
