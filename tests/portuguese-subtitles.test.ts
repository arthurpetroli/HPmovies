import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { parseSubtitleMappings, PortugueseSubtitleProvider } from '../src/aniwatch-apis/src/providers/portuguese-subtitles';
import type { Playback } from '../src/shared/providers';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry';
import { createApp } from '../src/aniwatch-apis/src/app';
import type { ImageResponse } from '../src/aniwatch-apis/src/providers/content-image';

const imdb = 'tt0123456';
const mapping = { type: 'TV', anilist_id: 42, imdb_id: [imdb] };
const identity = { meta: { id: imdb, videos: [
  { id: `${imdb}:2:1`, season: 2, episode: 1 }, { id: `${imdb}:0:1`, season: 0, episode: 1 },
  { id: `${imdb}:1:1`, season: 1, episode: 1 }, { id: `${imdb}:1:2`, season: 1, episode: 2 },
] } };
const row = (extra: object = {}) => ({ IDSubtitleFile: '123', SubLanguageID: 'pob', SubDownloadLink: 'https://dl.opensubtitles.org/en/download/file/123.gz',
  SeriesIMDBParent: '123456', SeriesSeason: '2', SeriesEpisode: '1', MovieKind: 'episode', SubFormat: 'srt', SubEncoding: 'UTF-8',
  SubFileName: `QA.S${'SeriesSeason' in extra ? extra.SeriesSeason : '2'}E${'SeriesEpisode' in extra ? extra.SeriesEpisode : '1'}.srt`, SubDownloadsCnt: '10', ...extra });
const ownSrt = '1\n00:00:01,000 --> 00:00:03,000\nTexto original de teste em português.\n';
const ownVtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nTexto original de teste em português.\n';
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const binary = (bytes: Uint8Array, status = 200): ImageResponse => ({ status, headers: new Headers({ 'content-type': 'application/gzip' }), body: (async function* () { yield bytes; })(), cancel() {} });
function setup(options: { rows?: unknown[]; mappings?: unknown[]; metadata?: unknown; bytes?: Uint8Array; ip?: string; status?: number } = {}) {
  const calls: URL[] = [];
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === 'raw.githubusercontent.com') return json(options.mappings ?? [mapping]);
    if (url.hostname === 'v3-cinemeta.strem.io') return json(options.metadata ?? identity);
    if (url.hostname === 'opensubtitles-v3.strem.io') return json({ subtitles: [] });
    if (url.pathname.endsWith('sublanguageid-por')) return json([]);
    return json(options.rows ?? [row()]);
  });
  const transport = vi.fn(async input => {
    expect(input.url.hostname).toBe('dl.opensubtitles.org'); expect(input.address).toBe('1.1.1.1');
    expect(input.headers['User-Agent']).toContain('HPmovies/'); expect(input.headers.Cookie).toBeUndefined();
    return binary(options.bytes ?? gzipSync(ownSrt), options.status ?? 200);
  });
  return { provider: new PortugueseSubtitleProvider({ enabled: true, fetcher, resolver: async () => [{ address: options.ip ?? '1.1.1.1', family: 4 }], transport }), calls, fetcher, transport };
}
const playback: Playback = { episode: { id: 'tatakai:42:3', number: 3, title: 'QA', available: true },
  sources: [{ url: 'https://video.example.org/one.m3u8', type: 'hls', subtitles: [] }], subtitles: [], audioLanguages: ['ja'], isDemo: false };

describe('Portuguese subtitle discovery and safe files', () => {
  it('maps a whole unique series absolute episode across seasons and verifies every returned identity', async () => {
    const { provider, calls } = setup({ rows: [row(), row({ IDSubtitleFile: '124', SeriesEpisode: '2' }), row({ IDSubtitleFile: '125', SeriesIMDBParent: '654321' }), row({ IDSubtitleFile: '126', SubLanguageID: 'eng' })] });
    const tracks = await provider.subtitles('42', 3);
    expect(tracks).toHaveLength(1); expect(tracks[0]).toMatchObject({ id: 'opensubtitles-123', format: 'vtt', language: 'pt-BR' });
    expect(tracks[0].url).toMatch(/^\/api\/subtitles\/file\/[a-f0-9-]{36}$/);
    expect(calls.find(url => url.hostname === 'rest.opensubtitles.org')?.pathname).toBe('/search/episode-1/imdbid-0123456/season-2/sublanguageid-pob');
    await provider.subtitles('42', 3); expect(calls).toHaveLength(5);
  });
  it.each([
    ['episode', [{ id: `${imdb}:1:1`, season: 1, episode: 1 }, { id: `${imdb}:1:3`, season: 1, episode: 3 }]],
    ['season', [{ id: `${imdb}:1:1`, season: 1, episode: 1 }, { id: `${imdb}:3:1`, season: 3, episode: 1 }]],
  ])('does not shift absolute numbering across a missing %s and keeps the earlier episode usable', async (_gap, videos) => {
    const { provider, calls } = setup({ metadata: { meta: { id: imdb, videos } }, rows: [row({ SeriesSeason: '1', SeriesEpisode: '1' })] });
    expect(await provider.subtitles('42', 2)).toEqual([]);
    expect(calls.some(url => url.hostname === 'rest.opensubtitles.org')).toBe(false);
    expect(await provider.subtitles('42', 1)).toHaveLength(1);
    expect(calls.filter(url => url.hostname === 'rest.opensubtitles.org').every(url => url.pathname.includes('/episode-1/') && url.pathname.includes('/season-1/'))).toBe(true);
  });
  it('does not guess seasons for shared series, inconsistent mappings, duplicate AniList IDs or fractional episodes', async () => {
    const inconsistent = parseSubtitleMappings([
      mapping, { ...mapping, anilist_id: 43 },
      { ...mapping, anilist_id: 44, season: { tvdb: 1, tmdb: 2 } },
      { ...mapping, anilist_id: 45, season: { tvdb: 1, tmdb: 1 }, episode_offset: { tvdb: 0, tmdb: 12 } },
      { ...mapping, anilist_id: 46, imdb_id: [imdb, 'tt0654321'] },
    ]);
    expect(inconsistent.size).toBe(0);
    expect(parseSubtitleMappings([mapping, mapping]).has(42)).toBe(false);
    const { provider, calls } = setup(); expect(await provider.subtitles('42', 1.5)).toEqual([]);
    expect(calls.every(url => url.hostname === 'raw.githubusercontent.com')).toBe(true);
  });
  it('uses only an explicitly mapped season and episode offset', async () => {
    const { provider, calls } = setup({ mappings: [{ ...mapping, season: { tvdb: 1, tmdb: 1 }, episode_offset: { tvdb: 1, tmdb: 1 } }], rows: [row({ SeriesSeason: '1', SeriesEpisode: '2' })] });
    expect(await provider.subtitles('42', 1)).toHaveLength(1);
    expect(calls.some(url => url.pathname.includes('episode-2/imdbid-0123456/season-1'))).toBe(true);
  });
  it('rejects explicit filename contradictions even when REST metadata claims the requested episode', async () => {
    const { provider } = setup({ rows: [
      row({ IDSubtitleFile: '120', SubFileName: 'QA.S02E101.srt' }),
      row({ IDSubtitleFile: '121', SubFileName: 'QA.S01E01.srt' }),
      row({ IDSubtitleFile: '122', SubFileName: 'QA.S02E01.S02E02.srt' }),
      row({ IDSubtitleFile: '123', SubFileName: 'QA.S02E01.srt' }),
      row({ IDSubtitleFile: '124', SubFileName: 'QA - E101.srt' }),
    ] });
    expect((await provider.subtitles('42', 3)).map(track => track.id)).toEqual(['opensubtitles-123', 'opensubtitles-124']);
  });
  it('keeps the regular series absolute numbering when a TV special explicitly shares only season zero', async () => {
    const special = { ...mapping, anilist_id: 43, season: { tvdb: 0, tmdb: 0 } };
    const mappings = [mapping, special];
    expect(parseSubtitleMappings(mappings).get(42)).toMatchObject({ wholeSeries: true });
    expect(parseSubtitleMappings(mappings).get(43)).toMatchObject({ season: 0, wholeSeries: false });
    const { provider, calls } = setup({ mappings, rows: [row({ SeriesSeason: '1', SeriesEpisode: '1' })] });
    expect(await provider.subtitles('42', 1)).toHaveLength(1);
    expect(calls.some(url => url.pathname.includes('episode-1/imdbid-0123456/season-1'))).toBe(true);
    // Incomplete or inconsistent season-zero mappings must remain ambiguous.
    for (const season of [{ tvdb: 0 }, { tmdb: 0 }, { tvdb: 0, tmdb: 1 }, { tvdb: 1, tmdb: 1 }]) {
      expect(parseSubtitleMappings([mapping, { ...special, season }]).has(42)).toBe(false);
    }
  });
  it.each([['Frieren', 154587], ['Demon Slayer', 101922]])('discovers Portuguese captions for the modern AniList ID of %s', async (_title, anilistId) => {
    const { provider, calls } = setup({ mappings: [{ ...mapping, anilist_id: anilistId, season: { tvdb: 1, tmdb: 1 } }], rows: [row({ SeriesSeason: '1', SeriesEpisode: '1' })] });
    expect(await provider.subtitles(String(anilistId), 1)).toHaveLength(1);
    expect(calls.some(url => url.pathname.includes('episode-1/imdbid-0123456/season-1'))).toBe(true);
  });
  it('accepts only positive AniList IDs within the nine-digit API bound', () => {
    const candidates = [0, -1, 1.5, 1_000_000_000, Number.MAX_SAFE_INTEGER, '154587', null];
    expect(parseSubtitleMappings(candidates.map(anilist_id => ({ ...mapping, anilist_id }))).size).toBe(0);
    expect(parseSubtitleMappings([{ ...mapping, anilist_id: 999_999_999 }]).has(999_999_999)).toBe(true);
  });
  it('rejects forged download destinations and unknown formats/encodings before issuing a ticket', async () => {
    const { provider, transport } = setup({ rows: [row({ SubDownloadLink: 'https://127.0.0.1/private' }), row({ SubDownloadLink: 'https://evil.example/123.gz' }), row({ SubDownloadLink: 'https://a:b@dl.opensubtitles.org/en/download/a' }), row({ SubDownloadLink: 'https://dl.opensubtitles.org/not-download/a' }), row({ SubFormat: 'zip' }), row({ SubEncoding: 'unknown' })] });
    expect(await provider.subtitles('42', 3)).toEqual([]); expect(transport).not.toHaveBeenCalled();
    await expect(provider.file('https://dl.opensubtitles.org/en/download/a')).rejects.toMatchObject({ status: 404 });
  });
  it('keeps issued tracks usable during repeated discovery without spending the limit on invalid or undisplayed rows', async () => {
    const rows = [
      ...Array.from({ length: 100 }, (_, index) => row({ IDSubtitleFile: String(1000 + index), SeriesEpisode: '2', SubDownloadsCnt: '1000' })),
      ...Array.from({ length: 400 }, (_, index) => row({ IDSubtitleFile: String(1000 + index) })),
    ];
    const { provider } = setup({ rows });
    const first = await provider.subtitles('42', 3);
    expect(first).toHaveLength(24); expect(first[0].id).toBe('opensubtitles-1000');
    for (let query = 0; query < 11; query++) expect(await provider.subtitles('42', 3)).toHaveLength(24);
    const file = await provider.file(first[0].url.split('/').at(-1)!);
    expect(new TextDecoder().decode(file.bytes)).toBe(ownVtt);
  });
  it('downloads only an issued gzip subtitle, serves native UTF-8 WebVTT and deduplicates file requests', async () => {
    const { provider, transport } = setup(); const tracks = await provider.subtitles('42', 3); const token = tracks[0].url.split('/').at(-1)!;
    const [first, duplicate] = await Promise.all([provider.file(token), provider.file(token)]);
    expect(first).toBe(duplicate); expect(new TextDecoder().decode(first.bytes)).toBe(ownVtt);
    expect(first.contentType).toBe('text/vtt; charset=utf-8');
    await provider.file(token); expect(transport).toHaveBeenCalledOnce();
    const registry = new StreamingRegistry({ subtitles: provider }); const app = createApp({ registry });
    const response = await app.request(tracks[0].url); expect(response.status).toBe(200); expect(await response.text()).toBe(ownVtt);
    expect(response.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect((await app.request(`${tracks[0].url}?url=http://127.0.0.1`)).status).toBe(400);
  });
  it('converts ASS dialogue to native VTT while dropping malformed intervals and drawing commands', async () => {
    const ass = '[Script Info]\nTitle: Original test fixture\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
      + 'Dialogue: 0,0:00:01.20,0:00:04.50,Default,,0,0,0,,{\\an8}Olá, mundo\\N<b>Texto</b>\n'
      + 'Dialogue: 0,0:00:04.50,0:00:04.50,Default,,0,0,0,,Intervalo inválido\n'
      + 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 20 20';
    const { provider } = setup({ rows: [row({ SubFormat: 'ass' })], bytes: gzipSync(ass) });
    const [track] = await provider.subtitles('42', 3);
    expect(track.format).toBe('vtt');
    const file = await provider.file(track.url.split('/').at(-1)!);
    expect(file.contentType).toBe('text/vtt; charset=utf-8');
    expect(new TextDecoder().decode(file.bytes)).toBe('WEBVTT\n\n00:00:01.200 --> 00:00:04.500\nOlá, mundo\n&lt;b&gt;Texto&lt;/b&gt;\n');
  });
  it('keeps valid SRT dialogue when another cue is malformed instead of failing every Portuguese option', async () => {
    const brokenCue = '\n2\n00:00:04,000 --> 00:00:04,000\nIntervalo inválido\n';
    const { provider } = setup({ bytes: gzipSync(ownSrt + brokenCue) });
    const [track] = await provider.subtitles('42', 3);
    const file = await provider.file(track.url.split('/').at(-1)!);
    expect(new TextDecoder().decode(file.bytes)).toBe(ownVtt);
  });
  it.each(['WEBVTT\n\n<html>challenge</html>', 'WEBVTT\n\n00:99:01.000 --> 00:99:02.000\nInvalid time', 'WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nBackwards'])('rejects VTT without any valid dialogue instead of returning an unloadable track', async content => {
    const { provider } = setup({ rows: [row({ SubFormat: 'vtt' })], bytes: gzipSync(content) });
    const [track] = await provider.subtitles('42', 3);
    await expect(provider.file(track.url.split('/').at(-1)!)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects redirects, HTML, private DNS and decompression bombs', async () => {
    for (const options of [{ status: 302 }, { bytes: new TextEncoder().encode('<html>challenge</html>') }, { bytes: gzipSync('x'.repeat(4_000_001)) }]) {
      const { provider } = setup(options); const track = (await provider.subtitles('42', 3))[0];
      await expect(provider.file(track.url.split('/').at(-1)!)).rejects.toMatchObject({ status: 503 });
    }
    const { provider, transport } = setup({ ip: '127.0.0.1' }); const track = (await provider.subtitles('42', 3))[0];
    await expect(provider.file(track.url.split('/').at(-1)!)).rejects.toHaveProperty('status'); expect(transport).not.toHaveBeenCalled();
  });
  it('adds episode-bound Portuguese tracks to each source and keeps video usable when discovery fails', async () => {
    const { provider } = setup(); const enriched = await provider.enrich(playback, '42');
    expect(enriched.sources[0].subtitles?.[0].language).toBe('pt-BR'); expect(enriched.subtitles[0].language).toBe('pt-BR');
    expect(enriched.sources[0].url).toBe(playback.sources[0].url);
    const offline = new PortugueseSubtitleProvider({ enabled: true, fetcher: async () => new Response('blocked', { status: 403 }) });
    const result = await offline.enrich(playback, '42'); expect(result.sources).toEqual(playback.sources);
    expect(result.diagnostics?.at(-1)?.state).toBe('connection_error');
    const disabled = new PortugueseSubtitleProvider({ enabled: false }); expect(await disabled.enrich(playback, '42')).toBe(playback);
  });
});
