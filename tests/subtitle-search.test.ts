import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { PortugueseSubtitleProvider } from '../src/aniwatch-apis/src/providers/portuguese-subtitles';
import { parseAddonSubtitles } from '../src/aniwatch-apis/src/providers/opensubtitles-addon';
import { externalSubtitleLanguages, subtitleEncoding, subtitleLanguage } from '../src/aniwatch-apis/src/providers/subtitle-languages';
import type { ImageRequest, ImageResponse } from '../src/aniwatch-apis/src/providers/content-image';

// Synthetic metadata and original dialogue; no live catalog or media is imported by tests.
const imdb = 'tt0123456';
const movie = `stremio:all:movie:${imdb}`;
const series = `stremio:fmhy:${imdb}:2:3`;
const legacy = (extra: object = {}) => ({ IDSubtitleFile: '123', SubLanguageID: 'pob', SubDownloadLink: 'https://dl.opensubtitles.org/en/download/file/123.gz',
  IDMovieImdb: '123456', SeriesIMDBParent: '0', SeriesSeason: '0', SeriesEpisode: '0', MovieKind: 'movie',
  SubFormat: 'srt', SubEncoding: 'UTF-8', SubFileName: 'QA.1080p.BluRay.srt', SubDownloadsCnt: '25', ...extra });
const addon = (extra: object = {}) => ({ id: 'unrelated', lang: 'pob', url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/123',
  subtitleFileName: 'QA.1080p.BluRay.srt', season: 0, episode: 0, ...extra });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const srt = '1\n00:00:01,000 --> 00:00:03,000\nDiálogo original para o teste.\n';

function fixture(options: { legacy?: unknown; addon?: unknown; legacyStatus?: number; addonStatus?: number; mapping?: unknown; enabled?: boolean } = {}) {
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.hostname === 'rest.opensubtitles.org') return json(options.legacy ?? [], options.legacyStatus ?? 200);
    if (url.hostname === 'opensubtitles-v3.strem.io') return json(options.addon ?? { subtitles: [] }, options.addonStatus ?? 200);
    if (url.hostname === 'raw.githubusercontent.com') return json(options.mapping ?? [{ type: 'TV', anilist_id: 42, imdb_id: [imdb], season: { tvdb: 2, tmdb: 2 }, episode_offset: { tvdb: 2, tmdb: 2 } }]);
    if (url.hostname === 'v3-cinemeta.strem.io') return json({ meta: { id: imdb, videos: [{ id: `${imdb}:2:3`, season: 2, episode: 3 }] } });
    throw new Error('Unexpected fixture host');
  });
  const transport = vi.fn(async (input: ImageRequest): Promise<ImageResponse> => {
    expect(input.address).toBe('1.1.1.1');
    expect(['subs5.strem.io', 'dl.opensubtitles.org']).toContain(input.url.hostname);
    const bytes = input.url.hostname === 'subs5.strem.io' ? Buffer.from(srt) : gzipSync(srt);
    return { status: 200, headers: new Headers({ 'Content-Type': 'application/octet-stream' }), body: (async function* () { yield bytes; })(), cancel() {} };
  });
  const provider = new PortugueseSubtitleProvider({ enabled: options.enabled ?? true, fetcher, resolver: async () => [{ address: '1.1.1.1', family: 4 }], transport });
  return { provider, fetcher, transport };
}

describe('on-demand OpenSubtitles languages and versions', () => {
  it('offers explicit language choices and normalizes known codes only', () => {
    expect(externalSubtitleLanguages.length).toBeGreaterThanOrEqual(40);
    expect(externalSubtitleLanguages[0]).toEqual({ id: 'pt-BR', label: 'Português (Brasil)' });
    expect(subtitleLanguage('PT-br')).toEqual({ id: 'pt-BR', iso: 'pob' });
    expect(subtitleLanguage('en')).toEqual({ id: 'en', iso: 'eng' });
    for (const input of ['eng', 'all', 'xx', '../../private', 'pt-BR\n', '']) expect(subtitleLanguage(input)).toBeUndefined();
  });

  it('rejects forged videos and unknown languages before any request', async () => {
    const { provider, fetcher } = fixture();
    for (const id of ['42', 'demo', 'tatakai:42:1.5', 'tatakai:42:0', 'tatakai:42:100001', 'toko:0:1', 'stremio:all:tt1:1:1', 'https://127.0.0.1', `${series}?url=http://localhost`]) {
      await expect(provider.search(id)).rejects.toMatchObject({ status: 400 });
    }
    await expect(provider.search(movie, 'eng')).rejects.toMatchObject({ code: 'INVALID_SUBTITLE_LANGUAGE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not query mappings or subtitle services when the search is disabled', async () => {
    const { provider, fetcher } = fixture({ enabled: false });
    const result = await provider.search('tatakai:42:1');
    expect(result).toMatchObject({ language: 'pt-BR', subtitles: [], message: expect.stringContaining('desativada') });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves release, original format and actual download counts without downloading files', async () => {
    const { provider, fetcher, transport } = fixture({ legacy: [legacy({ IDSubtitleFile: '124', SubDownloadsCnt: '100' }), legacy(),
      legacy({ IDSubtitleFile: '125', SubLanguageID: 'eng' })], addon: { subtitles: [addon(), addon({ lang: 'eng' })] } });
    const result = await provider.search(movie, 'pt-br');
    expect(result).toMatchObject({ episodeId: movie, language: 'pt-BR' });
    expect(result.subtitles.map(track => track.id)).toEqual(['opensubtitles-124', 'opensubtitles-123']);
    expect(result.subtitles[0]).toMatchObject({ release: 'QA.1080p.BluRay.srt', sourceFormat: 'srt', downloads: 100, format: 'vtt', provider: 'opensubtitles' });
    expect(result.subtitles[0].url).toMatch(/^\/api\/subtitles\/file\/[0-9a-f-]{36}$/);
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('raw.githubusercontent.com'))).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it('reuses metadata and chooses normalized UTF-8 for a duplicate while keeping REST popularity', async () => {
    const { provider, fetcher, transport } = fixture({ legacy: [legacy()], addon: { subtitles: [addon()] } });
    const first = await provider.search(movie);
    await provider.search(movie);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.subtitles).toHaveLength(1);
    expect(first.subtitles[0].downloads).toBe(25);
    const file = await provider.file(first.subtitles[0].url.split('/').at(-1)!);
    expect(transport.mock.calls[0][0].url.hostname).toBe('subs5.strem.io');
    expect(new TextDecoder().decode(file.bytes)).toContain('Diálogo original para o teste.');
    expect(file.contentType).toBe('text/vtt; charset=utf-8');
  });

  it('uses the requested Stremio season and episode and omits absent popularity', async () => {
    const { provider, fetcher } = fixture({ addon: { subtitles: [addon({ lang: 'eng', season: 2, episode: 3, subtitleFileName: 'QA.S02E03.srt' }),
      addon({ lang: 'eng', season: 1, episode: 3 }), addon({ lang: 'eng', season: 2, episode: 4 })] } });
    const result = await provider.search(series, 'en');
    expect(result.subtitles).toHaveLength(1);
    expect(result.subtitles[0]).toMatchObject({ language: 'en', release: 'QA.S02E03.srt' });
    expect(result.subtitles[0]).not.toHaveProperty('downloads');
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(expect.arrayContaining([
      '/search/episode-3/imdbid-0123456/season-2/sublanguageid-eng', `/subtitles/series/${imdb}:2:3.json`,
    ]));
  });

  it('maps an AniList episode through an explicit offset rather than guessing season one', async () => {
    const { provider, fetcher } = fixture();
    expect((await provider.search('tatakai:42:1', 'es')).subtitles).toEqual([]);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toContain('/search/episode-3/imdbid-0123456/season-2/sublanguageid-spa');
  });

  it('returns an identity-specific empty state when an anime mapping is ambiguous', async () => {
    const { provider, fetcher } = fixture({ mapping: [] });
    expect(await provider.search('toko:42:1')).toMatchObject({ subtitles: [], message: expect.stringContaining('correspondência segura') });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps working-source versions and distinguishes total failure from valid empty results', async () => {
    const fallback = fixture({ legacyStatus: 403, addon: { subtitles: [addon()] } });
    expect((await fallback.provider.search(movie)).subtitles).toHaveLength(1);
    const offline = fixture({ legacyStatus: 503, addonStatus: 503 });
    await expect(offline.provider.search(movie)).rejects.toMatchObject({ code: 'SUBTITLE_SEARCH_UNAVAILABLE', status: 503 });
    expect(await fixture().provider.search(movie)).toMatchObject({ subtitles: [], message: expect.stringContaining('Nenhuma legenda') });
  });

  it('ignores unsafe, unrelated, malformed or contradictory versions before issuing file tickets', async () => {
    const { provider, transport } = fixture({ legacy: [legacy({ MovieKind: 'episode' }), legacy({ IDMovieImdb: '654321' }),
      legacy({ SubDownloadLink: 'http://127.0.0.1/private' }), legacy({ SubFormat: 'sub' }), legacy({ SubEncoding: 'custom' }),
      legacy({ IDSubtitleFile: '999', SubDownloadsCnt: 'NaN' })] });
    const result = await provider.search(movie);
    expect(result.subtitles).toHaveLength(1);
    expect(result.subtitles[0].id).toBe('opensubtitles-999');
    expect(result.subtitles[0]).not.toHaveProperty('downloads');
    expect(transport).not.toHaveBeenCalled();
  });

  it('validates text encoding declarations for additional languages', () => {
    expect(subtitleEncoding('CP1251')).toBe('windows-1251');
    expect(subtitleEncoding('WINDOWS_1256')).toBe('windows-1256');
    expect(subtitleEncoding('UTF-8')).toBe('utf-8');
    for (const encoding of ['custom', 'javascript', '\0', 'gzip']) expect(subtitleEncoding(encoding)).toBeUndefined();
  });

  it('generalized addon parsing keeps language isolation and exact series identity', () => {
    const identity = { imdb, kind: 'series' as const, season: 2, episode: 3 };
    const rows = [addon({ lang: 'ara', season: 2, episode: 3, subtitleFileName: 'QA.S02E03.srt' }),
      addon({ lang: 'eng', season: 2, episode: 3 }), addon({ lang: 'ara', season: 2, episode: 3, subtitleFileName: 'QA.S01E03.srt' }),
      addon({ lang: 'ara', season: 2, episode: 3, type: 'movie' }), addon({ lang: 'ara', season: 2, episode: 3, imdbId: 'tt6543210' })];
    const result = parseAddonSubtitles({ subtitles: rows }, identity, ['ar']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ language: 'ar', release: 'QA.S02E03.srt' });
  });
});
