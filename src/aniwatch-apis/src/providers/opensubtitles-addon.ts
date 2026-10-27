import { ApiError } from '../config/apiError.js';

export interface SubtitleAddonIdentity {
  imdb: string;
  kind: 'movie' | 'series';
  season?: number;
  episode?: number;
}

export interface ParsedAddonPortugueseSubtitle {
  id: string;
  url: string;
  format: 'srt' | 'ass' | 'vtt';
  encoding: 'utf-8';
  language: 'pt-BR' | 'pt';
  label: string;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const invalid = () => new ApiError(502, 'SUBTITLE_INVALID_RESPONSE', 'A fonte de legendas retornou dados incompatíveis.');
const DOWNLOAD = /^https:\/\/subs5\.strem\.io\/en\/download\/subencoding-stremio-utf8\/src-api\/file\/[1-9]\d{0,19}$/;

/** The official addon accepts exact IMDb identities, including a series season and episode. */
export function addonSubtitleUrl(identity: SubtitleAddonIdentity): string {
  if (!identity || typeof identity.imdb !== 'string' || !/^tt\d{7,10}$/.test(identity.imdb)) throw invalid();
  if (identity.kind === 'movie') {
    if (identity.season !== undefined || identity.episode !== undefined) throw invalid();
    return `https://opensubtitles-v3.strem.io/subtitles/movie/${identity.imdb}.json`;
  }
  if (identity.kind !== 'series' || !integer(identity.season, 0, 1000) || !integer(identity.episode, 1, 100_000)) throw invalid();
  return `https://opensubtitles-v3.strem.io/subtitles/series/${identity.imdb}:${identity.season}:${identity.episode}.json`;
}

/** Only the observed, UTF-8-normalizing download route is accepted, never arbitrary addon URLs. */
export function permittedAddonSubtitleDownloadUrl(raw: unknown): URL | undefined {
  if (typeof raw !== 'string' || !DOWNLOAD.test(raw)) return undefined;
  return new URL(raw);
}

function formatFromFilename(filename: unknown): ParsedAddonPortugueseSubtitle['format'] | undefined {
  // The official normalized download endpoint serves SRT by default. Keep an
  // explicit supported extension when the addon identifies another text format.
  if (filename === undefined || filename === '') return 'srt';
  if (typeof filename !== 'string') return undefined;
  const extension = /\.([a-z0-9]+)$/i.exec(filename.trim())?.[1].toLowerCase();
  if (extension === 'ssa') return 'ass';
  return extension === 'srt' || extension === 'ass' || extension === 'vtt' ? extension : undefined;
}

/** Parse only Portuguese rows bound to the exact identity requested from the official addon. */
export function parseAddonPortugueseSubtitles(input: unknown, identity: SubtitleAddonIdentity): ParsedAddonPortugueseSubtitle[] {
  addonSubtitleUrl(identity);
  if (!object(input) || !Array.isArray(input.subtitles) || input.subtitles.length > 2000) throw invalid();
  const result: ParsedAddonPortugueseSubtitle[] = [];
  const seen = new Set<string>();
  const counts = { 'pt-BR': 0, pt: 0 };
  for (const row of input.subtitles) {
    if (!object(row)) continue;
    const language = row.lang === 'pob' ? 'pt-BR' : row.lang === 'por' ? 'pt' : undefined;
    if (!language || counts[language] >= 24) continue;
    if (identity.kind === 'series' ? row.season !== identity.season || row.episode !== identity.episode
      : row.season !== undefined && row.season !== 0 || row.episode !== undefined && row.episode !== 0) continue;
    const url = permittedAddonSubtitleDownloadUrl(row.url);
    const format = formatFromFilename(row.subtitleFileName);
    if (!url || !format) continue;
    // The row id is not IDSubtitleFile. The download path is the shared file
    // identity used by the legacy REST source, so both sources can deduplicate.
    const id = `opensubtitles-${url.pathname.split('/').at(-1)!}`;
    if (seen.has(id)) continue;
    const release = typeof row.subtitleFileName === 'string' && row.subtitleFileName.trim() ? row.subtitleFileName : row.movieReleaseName;
    const label = typeof release === 'string' ? release.replace(/\p{Cc}/gu, ' ').trim().slice(0, 170) : id;
    result.push({ id, url: url.href, format, encoding: 'utf-8', language, label: `OpenSubtitles v3 · ${language} · ${label || id}` });
    seen.add(id); counts[language]++;
  }
  return result;
}
