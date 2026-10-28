import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { gunzipSync } from 'node:zlib';
import type { Playback, ProviderDiagnostic, StreamSubtitle } from '../../../shared/providers.js';
import { MAX_SUBTITLE_BYTES, subtitleToVtt } from '../../../shared/subtitles.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache } from '../config/cache.js';
import { pinnedRequest, publicImageAddress } from './content-image.js';
import type { ImageRequest, ImageResponse } from './content-image.js';
import { addonSubtitleUrl, contradictsSubtitleEpisode, parseAddonPortugueseSubtitles, permittedAddonSubtitleDownloadUrl } from './opensubtitles-addon.js';
import { curatedSubtitleIdentity, findCuratedPortugueseSubtitles, permittedCuratedSubtitleUrl, sanitizeCuratedSubtitleText } from './curated-portuguese-subtitles.js';
import { extractSubtitleArchive } from './subtitle-archive.js';

const MAPPINGS = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const REST = 'https://rest.opensubtitles.org/search';
const MAX_FILE = 4_000_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, max = 100_000) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const numeric = (value: unknown) => typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : NaN;
const invalid = () => new ApiError(502, 'SUBTITLE_INVALID_RESPONSE', 'A fonte de legendas retornou dados incompatíveis.');
const unavailable = () => new ApiError(503, 'SUBTITLE_UNAVAILABLE', 'A fonte de legendas em português não respondeu.');

interface Mapping {
  id: number; imdb: string; kind: 'movie' | 'series'; season?: number; offset: number; wholeSeries: boolean;
}
interface EpisodeIdentity { imdb: string; kind: 'movie' | 'series'; season?: number; episode?: number }
interface FileTicket { url: string; format: 'srt' | 'ass' | 'vtt'; encoding: string; archive?: 'zip'; machineTranslated?: boolean; expires: number }
interface SubtitleCandidate extends Omit<FileTicket, 'expires'> { id: string; language: string; label: string }
interface SubtitleFile { bytes: Uint8Array; contentType: string; cacheControl: string }
interface Options {
  enabled?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  resolver?: (host: string) => Promise<LookupAddress[]>;
  transport?: (input: ImageRequest) => Promise<ImageResponse>;
}

/** Explicit identities only: seasonless rows are usable only for a whole unique TV series. */
export function parseSubtitleMappings(input: unknown): Map<number, Mapping> {
  if (!Array.isArray(input) || input.length > 100_000) throw invalid();
  const candidates = input.filter(object).filter(row => integer(row.anilist_id, 999_999_999) && Number(row.anilist_id) > 0 && ['TV', 'MOVIE'].includes(String(row.type)));
  const owners = new Map<string, Set<number>>();
  for (const row of candidates) {
    if (row.type !== 'TV' || !Array.isArray(row.imdb_id)) continue;
    // A TV special explicitly assigned to season zero does not own the regular
    // series numbering. Conan shares its IMDb with such a special in Fribb.
    const seasons = object(row.season) ? row.season : {};
    if (seasons.tvdb === 0 && seasons.tmdb === 0) continue;
    for (const id of row.imdb_id) if (typeof id === 'string' && /^tt\d{7,10}$/.test(id)) owners.set(id, new Set([...(owners.get(id) ?? []), row.anilist_id as number]));
  }
  const result = new Map<number, Mapping>();
  const duplicate = new Set<number>();
  for (const row of candidates) {
    const ids = row.imdb_id;
    if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string' || !/^tt\d{7,10}$/.test(ids[0])) continue;
    const id = row.anilist_id as number;
    if (result.has(id) || duplicate.has(id)) { result.delete(id); duplicate.add(id); continue; }
    if (row.type === 'MOVIE') { result.set(id, { id, imdb: ids[0], kind: 'movie', offset: 0, wholeSeries: false }); continue; }
    const seasons = object(row.season) ? row.season : {};
    const offsets = object(row.episode_offset) ? row.episode_offset : {};
    const a = seasons.tvdb, b = seasons.tmdb, x = offsets.tvdb ?? 0, y = offsets.tmdb ?? 0;
    if (!integer(x, 10_000) || !integer(y, 10_000) || x !== y) continue;
    if (a === undefined && b === undefined && owners.get(ids[0])?.size === 1 && x === 0) {
      result.set(id, { id, imdb: ids[0], kind: 'series', offset: 0, wholeSeries: true });
    } else if (integer(a, 1000) && a === b) {
      result.set(id, { id, imdb: ids[0], kind: 'series', season: a as number, offset: x as number, wholeSeries: false });
    }
  }
  return result;
}

/** A separate, fail-soft subtitle source. No credentials, browser or challenge solver. */
export class PortugueseSubtitleProvider {
  readonly enabled: boolean;
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly resolver: (host: string) => Promise<Array<{ address: string; family: number }>>;
  private readonly transport: (input: ImageRequest) => Promise<ImageResponse>;
  private readonly cache = new AniwatchAPICache({ maxEntries: 64 });
  private mappings?: { value: Map<number, Mapping>; expires: number };
  private loadingMappings?: Promise<Map<number, Mapping>>;
  private active = 0;
  private readonly tickets = new Map<string, FileTicket>();
  private readonly files = new Map<string, { value: SubtitleFile; expires: number }>();
  private readonly pendingFiles = new Map<string, Promise<SubtitleFile>>();
  private fileBytes = 0;

  constructor(options: Options = {}) {
    this.enabled = options.enabled ?? process.env.EXTERNAL_SUBTITLES_ENABLED !== 'false';
    this.fetcher = options.fetcher ?? fetch;
    this.timeout = options.timeoutMs ?? 12_000;
    this.resolver = options.resolver ?? (host => lookup(host, { all: true, verbatim: true }));
    this.transport = options.transport ?? pinnedRequest;
  }

  private async json(url: string, max = 2_000_000): Promise<unknown> {
    if (this.active >= 6) throw unavailable();
    this.active++;
    try {
      const response = await this.fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'HPmovies/2.0 (Portuguese subtitles)' }, redirect: 'error', signal: AbortSignal.timeout(this.timeout) });
      if (!response.ok || !response.headers.get('content-type')?.includes('json') && !url.startsWith('https://raw.githubusercontent.com/')) { await response.body?.cancel(); throw unavailable(); }
      const declared = Number(response.headers.get('content-length'));
      if (declared > max) { await response.body?.cancel(); throw invalid(); }
      const reader = response.body?.getReader(); if (!reader) throw invalid();
      const chunks: Uint8Array[] = []; let total = 0;
      while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > max) { await reader.cancel(); throw invalid(); } chunks.push(part.value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally { this.active--; }
  }

  private mapping(): Promise<Map<number, Mapping>> {
    if (this.mappings && this.mappings.expires > Date.now()) return Promise.resolve(this.mappings.value);
    if (this.loadingMappings) return this.loadingMappings;
    this.loadingMappings = this.json(MAPPINGS, 20_000_000).then(parseSubtitleMappings).then(value => {
      this.mappings = { value, expires: Date.now() + 24 * 60 * 60_000 }; return value;
    }).finally(() => { this.loadingMappings = undefined; });
    return this.loadingMappings;
  }

  private async identity(animeId: string, episode: number): Promise<EpisodeIdentity | undefined> {
    // Curated identities remain usable when the external mapping list is down.
    const curated = curatedSubtitleIdentity(animeId, episode);
    if (curated) return curated;
    const row = (await this.mapping()).get(Number(animeId));
    if (!row || !Number.isSafeInteger(episode) || episode < 1 || episode > 100_000) return undefined;
    if (row.kind === 'movie') return episode === 1 ? { imdb: row.imdb, kind: 'movie' } : undefined;
    const metadata = await this.cache.getOrSet(() => this.json(`https://v3-cinemeta.strem.io/meta/series/${row.imdb}.json`, 6_000_000), `subtitle:identity:${row.imdb}`, 86400);
    if (!object(metadata) || !object(metadata.meta) || metadata.meta.id !== row.imdb || !Array.isArray(metadata.meta.videos) || metadata.meta.videos.length > 20_000) throw invalid();
    const videos = metadata.meta.videos.filter(object).filter(video => integer(video.season, 1000) && integer(video.episode) && Number(video.episode) > 0 && video.id === `${row.imdb}:${video.season}:${video.episode}`);
    const keys = videos.map(video => video.id); if (new Set(keys).size !== keys.length) throw invalid();
    if (row.wholeSeries) {
      const ordered = videos.filter(video => Number(video.season) > 0).sort((a, b) => Number(a.season) - Number(b.season) || Number(a.episode) - Number(b.episode));
      let previousSeason = 1, previousEpisode = 0;
      for (let index = 0; index < episode; index++) {
        const target = ordered[index]; if (!target) return undefined;
        const season = Number(target.season), number = Number(target.episode);
        // A missing earlier episode or season makes the absolute position ambiguous.
        // A gap after the requested episode does not invalidate an already known prefix.
        if (!(season === previousSeason && number === previousEpisode + 1)
          && !(previousEpisode > 0 && season === previousSeason + 1 && number === 1)) return undefined;
        if (index === episode - 1) return { imdb: row.imdb, kind: 'series', season, episode: number };
        previousSeason = season; previousEpisode = number;
      }
      return undefined;
    }
    const target = videos.find(video => video.season === row.season && video.episode === episode + row.offset);
    return target ? { imdb: row.imdb, kind: 'series', season: row.season, episode: episode + row.offset } : undefined;
  }

  private issue(row: Record<string, unknown>, identity: EpisodeIdentity, language: 'pt-BR' | 'pt'): StreamSubtitle | undefined {
    if (row.SubLanguageID !== (language === 'pt-BR' ? 'pob' : 'por') || typeof row.SubDownloadLink !== 'string' || !/^\d{1,20}$/.test(String(row.IDSubtitleFile))) return undefined;
    if (identity.kind === 'series' ? row.MovieKind !== 'episode' || numeric(row.SeriesIMDBParent) !== Number(identity.imdb.slice(2)) || numeric(row.SeriesSeason) !== identity.season || numeric(row.SeriesEpisode) !== identity.episode
      : row.MovieKind !== 'movie' || numeric(row.IDMovieImdb) !== Number(identity.imdb.slice(2))) return undefined;
    if (contradictsSubtitleEpisode(row.SubFileName, identity)) return undefined;
    const format = row.SubFormat === 'ssa' ? 'ass' : row.SubFormat;
    if (format !== 'srt' && format !== 'ass' && format !== 'vtt') return undefined;
    let url: URL;
    try { url = new URL(row.SubDownloadLink); } catch { return undefined; }
    if (url.protocol !== 'https:' || url.hostname !== 'dl.opensubtitles.org' || url.username || url.password || url.port || url.hash || !url.pathname.startsWith('/en/download/')) return undefined;
    const encoding = typeof row.SubEncoding === 'string' ? row.SubEncoding.toLowerCase().replace(/_/g, '-') : 'utf-8';
    if (!['utf-8', 'utf8', 'windows-1252', 'cp1252', 'iso-8859-1', 'utf-16', 'utf-16le'].includes(encoding)) return undefined;
    const release = typeof row.SubFileName === 'string' ? row.SubFileName.replace(/[\r\n\0]/g, '').slice(0, 170) : String(row.IDSubtitleFile);
    return this.register({ id: `opensubtitles-${row.IDSubtitleFile}`, url: url.href, format, encoding, language, label: `OpenSubtitles · ${language} · ${release}` });
  }

  private register(candidate: SubtitleCandidate): StreamSubtitle {
    for (const [token, item] of this.tickets) if (item.expires <= Date.now()) this.tickets.delete(token);
    while (this.tickets.size >= 4096) this.tickets.delete(this.tickets.keys().next().value!);
    const token = randomUUID();
    this.tickets.set(token, { url: candidate.url, format: candidate.format, encoding: candidate.encoding,
      ...(candidate.archive ? { archive: candidate.archive } : {}), ...(candidate.machineTranslated ? { machineTranslated: true } : {}), expires: Date.now() + 2 * 60 * 60_000 });
    return { id: candidate.id, url: `/api/subtitles/file/${token}`, format: 'vtt', language: candidate.language, label: candidate.label, kind: 'subtitles', ...(candidate.machineTranslated ? { machineTranslated: true } : {}) };
  }

  async subtitles(animeId: string, episode: number): Promise<StreamSubtitle[]> {
    if (!this.enabled || !/^[1-9]\d{0,8}$/.test(animeId)) return [];
    const identity = await this.identity(animeId, episode); if (!identity) return [];
    const legacy = (['pt-BR', 'pt'] as const).map(async language => {
      const filter = identity.kind === 'series' ? `episode-${identity.episode}/imdbid-${identity.imdb.slice(2)}/season-${identity.season}/` : `imdbid-${identity.imdb.slice(2)}/`;
      const payload = await this.cache.getOrSet(() => this.json(`${REST}/${filter}sublanguageid-${language === 'pt-BR' ? 'pob' : 'por'}`), `subtitle:list:${identity.imdb}:${identity.season}:${identity.episode}:${language}`, 1800);
      if (!Array.isArray(payload) || payload.length > 500) throw invalid();
      const tracks: StreamSubtitle[] = [], seen = new Set<string>();
      for (const row of payload.filter(object).sort((a, b) => Number(b.SubDownloadsCnt ?? 0) - Number(a.SubDownloadsCnt ?? 0))) {
        const id = String(row.IDSubtitleFile); if (seen.has(id)) continue;
        const track = this.issue(row, identity, language); if (!track) continue;
        seen.add(id); tracks.push(track); if (tracks.length === 24) break;
      }
      return tracks;
    });
    const addon = async () => {
      const payload = await this.cache.getOrSet(() => this.json(addonSubtitleUrl(identity)),
        `subtitle:addon:${identity.imdb}:${identity.season}:${identity.episode}`, 1800);
      return parseAddonPortugueseSubtitles(payload, identity).map(track => this.register(track));
    };
    const curated = findCuratedPortugueseSubtitles(animeId, episode, identity).map(track => this.register(track));
    const results = await Promise.allSettled([...legacy, addon()]);
    const tracks = [...results.flatMap(result => result.status === 'fulfilled' ? result.value : []), ...curated];
    if (!tracks.length && results.every(result => result.status === 'rejected')) throw unavailable();
    return [...new Map(tracks.map(track => [track.id, track])).values()];
  }

  async enrich(playback: Playback, animeId: string): Promise<Playback> {
    if (!this.enabled || playback.isDemo || !playback.episode.number) return playback;
    const diagnostic = (state: ProviderDiagnostic['state'], message: string): ProviderDiagnostic => ({ id: 'opensubtitles', name: 'Legendas em português · fontes externas', enabled: true, technicalAvailable: state !== 'connection_error', authorized: true, state, checkedAt: new Date().toISOString(), message, capabilities: ['external-subtitles'] });
    try {
      const tracks = await this.subtitles(animeId, playback.episode.number);
      const score = (track: StreamSubtitle) => track.language.startsWith('pt') ? (track.machineTranslated ? 0 : 4) + (track.language === 'pt-BR' ? 3 : 2) : 0;
      const merge = (items: StreamSubtitle[]) => [...new Map([...items, ...tracks].map(track => [track.id, track])).values()].sort((a, b) => score(b) - score(a));
      return { ...playback, sources: playback.sources.map(source => ({ ...source, subtitles: merge(source.subtitles ?? []) })), subtitles: merge(playback.subtitles), diagnostics: [...(playback.diagnostics ?? []), diagnostic(tracks.length ? 'available' : 'empty', tracks.length ? `${tracks.length} legendas em português encontradas para esta série, temporada e episódio. A versão do vídeo pode exigir ajuste de sincronização.` : 'Nenhuma legenda em português com correspondência segura foi encontrada.')] };
    } catch {
      return { ...playback, diagnostics: [...(playback.diagnostics ?? []), diagnostic('connection_error', 'A busca externa de legendas falhou; a reprodução continua disponível.')] };
    }
  }

  file(token: string): Promise<SubtitleFile> {
    const ticket = /^[0-9a-f-]{36}$/.test(token) && this.tickets.get(token);
    if (!this.enabled || !ticket || ticket.expires <= Date.now()) return Promise.reject(new ApiError(404, 'SUBTITLE_EXPIRED', 'Esta legenda expirou. Reabra o episódio.'));
    const cached = this.files.get(token); if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    const pending = this.pendingFiles.get(token); if (pending) return pending;
    if (this.pendingFiles.size >= 4) return Promise.reject(unavailable());
    const task = this.download(ticket).then(value => {
      const old = this.files.get(token); if (old) { this.fileBytes -= old.value.bytes.byteLength; this.files.delete(token); }
      while (this.files.size >= 16 || this.fileBytes + value.bytes.byteLength > 16_000_000) { const first = this.files.entries().next().value; if (!first) break; this.fileBytes -= first[1].value.bytes.byteLength; this.files.delete(first[0]); }
      this.files.set(token, { value, expires: Date.now() + 600_000 }); this.fileBytes += value.bytes.byteLength; return value;
    }).finally(() => this.pendingFiles.delete(token));
    this.pendingFiles.set(token, task); return task;
  }

  private async download(ticket: FileTicket): Promise<SubtitleFile> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeout);
    let response: ImageResponse | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true }));
      const url = new URL(ticket.url);
      const legacy = url.protocol === 'https:' && url.hostname === 'dl.opensubtitles.org' && !url.username && !url.password
        && !url.port && !url.hash && url.pathname.startsWith('/en/download/');
      if (ticket.archive === 'zip' ? !permittedCuratedSubtitleUrl(ticket.url) : !legacy && !permittedAddonSubtitleDownloadUrl(ticket.url)) throw invalid();
      const records = await Promise.race([this.resolver(url.hostname), aborted]);
      if (!records.length || records.length > 32 || records.some(row => !publicImageAddress(row.address) || isIP(row.address) !== row.family)) throw invalid();
      const target = records.find(row => row.family === 4) ?? records[0];
      response = await Promise.race([this.transport({ url, address: target.address, family: target.family as 4 | 6, headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'HPmovies/2.0 (Portuguese subtitles)' }, signal: controller.signal }), aborted]);
      if (response.status !== 200 || Number(response.headers.get('content-length')) > 2_000_000) throw unavailable();
      const chunks: Uint8Array[] = []; let total = 0; const iterator = response.body[Symbol.asyncIterator]();
      while (true) { const part = await Promise.race([iterator.next(), aborted]); if (part.done) break; total += part.value.byteLength; if (total > 2_000_000) throw invalid(); chunks.push(part.value); }
      let bytes: Uint8Array = Buffer.concat(chunks);
      if (ticket.archive === 'zip') {
        const archive = extractSubtitleArchive(bytes);
        if (archive.format !== ticket.format) throw invalid();
        bytes = archive.bytes;
      }
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes, { maxOutputLength: MAX_FILE });
      if (!bytes.length || bytes.length > MAX_FILE) throw invalid();
      const encoding = ticket.encoding === 'cp1252' ? 'windows-1252' : ticket.encoding === 'utf8' ? 'utf-8' : ticket.encoding;
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      const text = sanitizeCuratedSubtitleText(decoded, !!ticket.machineTranslated);
      if (/\0/.test(text)) throw invalid();
      // Native WebVTT avoids browser-dependent SRT/ASS blob conversion for Portuguese tracks.
      const nativeBytes = new TextEncoder().encode(subtitleToVtt(text, ticket.format));
      if (nativeBytes.byteLength > MAX_SUBTITLE_BYTES) throw invalid();
      return { bytes: nativeBytes, contentType: 'text/vtt; charset=utf-8', cacheControl: 'private, max-age=300' };
    } catch { response?.cancel(); throw unavailable(); }
    finally { clearTimeout(timer); }
  }
}

export const portugueseSubtitles = new PortugueseSubtitleProvider();
