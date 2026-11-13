import type { ExternalSubtitleOption, ExternalSubtitleSearch } from '../../shared/externalSubtitles';
import { apiMediaUrl, requestData } from './http';

const object = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
const text = (input: unknown, max: number): input is string => typeof input === 'string' && input.length > 0 && input.length <= max;
const language = (input: unknown): input is string => text(input, 40) && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(input);
const option = (input: unknown, requestedLanguage: string): input is ExternalSubtitleOption => object(input)
  && text(input.id, 250) && text(input.release, 500) && text(input.label, 600)
  && input.provider === 'opensubtitles' && input.language === requestedLanguage
  && ['srt', 'ass', 'vtt'].includes(String(input.sourceFormat))
  && (input.format === undefined || ['srt', 'ass', 'vtt'].includes(String(input.format)))
  && typeof input.url === 'string' && /^\/api\/subtitles\/file\/[a-zA-Z0-9_-]{1,200}$/.test(input.url)
  && (input.translationToken === undefined || text(input.translationToken, 200) && /^[a-zA-Z0-9_-]+$/.test(input.translationToken))
  && (input.translationMessage === undefined || text(input.translationMessage, 500))
  && (input.downloads === undefined || typeof input.downloads === 'number' && Number.isSafeInteger(input.downloads) && input.downloads >= 0);

export async function searchExternalSubtitles(episodeId: string, requestedLanguage = 'pt-BR'): Promise<ExternalSubtitleSearch> {
  const params = new URLSearchParams({ language: requestedLanguage });
  const data = await requestData<ExternalSubtitleSearch>(`/subtitles/search/${encodeURIComponent(episodeId)}?${params}`, (input): input is ExternalSubtitleSearch => object(input)
    && input.episodeId === episodeId && input.language === requestedLanguage
    && Array.isArray(input.languages) && input.languages.length > 0 && input.languages.length <= 100
    && input.languages.every(item => object(item) && language(item.id) && text(item.label, 120))
    && Array.isArray(input.subtitles) && input.subtitles.length <= 500 && input.subtitles.every(item => option(item, requestedLanguage))
    && new Set(input.subtitles.map(item => item.id)).size === input.subtitles.length
    && (input.message === undefined || typeof input.message === 'string'), { timeoutMs: 45_000 });
  return { ...data, subtitles: data.subtitles.map(track => ({ ...track, url: apiMediaUrl(track.url) })) };
}
