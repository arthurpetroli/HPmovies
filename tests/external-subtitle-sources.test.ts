import { describe, expect, it, vi } from 'vitest';
import { PortugueseSubtitleProvider } from '../src/aniwatch-apis/src/providers/portuguese-subtitles.js';
import type { ImageRequest, ImageResponse } from '../src/aniwatch-apis/src/providers/content-image.js';

// ZIP contains only original test text, never a downloaded subtitle.
const archive = Buffer.from('UEsDBBQAAAAIAHlgW10ud9tHXAAAAIQAAAASAAAAb3JpZ2luYWwtcHQtYnIuc3J0M+QyMLACIUMdAwMDBV1dOwWogDFIgMvx8PLDi/MV8osy0zPzEnMUUlIVSlKLS1IVUnMVCvKLSkrTSw+vKtbj4jKCGWSCbpAp2KBHDatzFQyAMEfBCEQZGcBoLgBQSwECFAMUAAAACAB5YFtdLnfbR1wAAACEAAAAEgAAAAAAAAAAAAAAgAEAAAAAb3JpZ2luYWwtcHQtYnIuc3J0UEsFBgAAAAABAAEAQAAAAIwAAAAAAA==', 'base64');
const srt = '1\n00:00:01,000 --> 00:00:03,000\nAção original de teste em português.\n';
const addonRow = { id: '789', lang: 'pob', season: 1, episode: 1, SubEncoding: 'CP1252',
  subtitleFileName: 'original-pt-br.srt', url: 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/123' };
const legacyRow = { IDSubtitleFile: '123', SubLanguageID: 'pob', SubDownloadLink: 'https://dl.opensubtitles.org/en/download/file/123',
  SeriesIMDBParent: '123456', SeriesSeason: '1', SeriesEpisode: '1', MovieKind: 'episode', SubFormat: 'srt', SubEncoding: 'UTF-8', SubFileName: 'original-pt-br.srt' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function fixture(options: { addon?: unknown; legacy?: unknown[]; legacyOffline?: boolean; privateDns?: boolean; status?: number; body?: Uint8Array } = {}) {
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.hostname === 'raw.githubusercontent.com') return json([{ type: 'TV', anilist_id: 42, imdb_id: ['tt0123456'], season: { tvdb: 1, tmdb: 1 } }]);
    if (url.hostname === 'v3-cinemeta.strem.io') return json({ meta: { id: 'tt0123456', videos: [{ id: 'tt0123456:1:1', season: 1, episode: 1 }] } });
    if (url.hostname === 'opensubtitles-v3.strem.io') return json(options.addon ?? { subtitles: [] });
    if (url.hostname === 'rest.opensubtitles.org') return options.legacyOffline ? json({}, 503) : json(url.pathname.endsWith('sublanguageid-por') ? [] : options.legacy ?? []);
    throw new Error(`Unexpected metadata host ${url.hostname}`);
  });
  const resolver = vi.fn(async () => [{ address: options.privateDns ? '127.0.0.1' : '1.1.1.1', family: 4 }]);
  const transport = vi.fn(async (input: ImageRequest): Promise<ImageResponse> => {
    expect(input.address).toBe('1.1.1.1');
    expect(input.headers.Cookie).toBeUndefined(); expect(input.headers.Authorization).toBeUndefined();
    const bytes = options.body ?? (input.url.hostname === 'subs5.strem.io' ? new TextEncoder().encode(srt) : archive);
    return { status: options.status ?? 200, headers: new Headers({ 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }),
      body: (async function* () { yield bytes; })(), cancel: vi.fn() };
  });
  return { fetcher, resolver, transport, provider: new PortugueseSubtitleProvider({ enabled: true, fetcher, resolver, transport }) };
}
const token = (url: string) => url.split('/').at(-1)!;

describe('combined Portuguese subtitle sources', () => {
  it('uses a reviewed movie release without depending on a mapping request and converts the ZIP to VTT', async () => {
    const { provider, fetcher, resolver, transport } = fixture();
    const tracks = await provider.subtitles('11577', 1);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id: 'legendei-steins-gate-movie-2013-pt-br', language: 'pt-BR', format: 'vtt' });
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('raw.githubusercontent.com'))).toBe(false);
    const file = await provider.file(token(tracks[0].url));
    expect(file.contentType).toBe('text/vtt; charset=utf-8');
    expect(new TextDecoder().decode(file.bytes)).toContain('Ação original de teste em português.');
    expect(resolver).toHaveBeenCalledWith('legendei.net'); expect(transport).toHaveBeenCalledOnce();
  });

  it('marks the exact automatic episode and removes vector artifacts before serving Portuguese VTT', async () => {
    const { provider, resolver } = fixture();
    const tracks = await provider.subtitles('212888', 2);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ machineTranslated: true, language: 'pt-BR' });
    expect(tracks[0].label).toContain('Tradução automática');
    const text = new TextDecoder().decode((await provider.file(token(tracks[0].url))).bytes);
    expect(text).toContain('Ação original de teste em português.');
    expect(text).not.toContain('m 0 0'); expect(text).not.toContain('\u202b');
    expect(resolver).toHaveBeenCalledWith('dl.subdl.com');
  });

  it('keeps curated captions available while both remote subtitle catalogs fail', async () => {
    const { provider } = fixture({ legacyOffline: true, addon: null });
    expect((await provider.subtitles('11577', 1))[0].id).toBe('legendei-steins-gate-movie-2013-pt-br');
  });

  it('uses official addon results when legacy discovery is down and decodes the normalized endpoint as UTF-8', async () => {
    const { provider, resolver } = fixture({ legacyOffline: true, addon: { subtitles: [addonRow] } });
    const [track] = await provider.subtitles('42', 1);
    expect(track).toMatchObject({ id: 'opensubtitles-123', language: 'pt-BR', format: 'vtt' });
    expect(track.label).toContain('OpenSubtitles v3');
    const text = new TextDecoder().decode((await provider.file(token(track.url))).bytes);
    expect(text).toContain('Ação original'); expect(text).not.toContain('AÃ');
    expect(resolver).toHaveBeenCalledWith('subs5.strem.io');
  });

  it('deduplicates the same subtitle file returned by REST and the official addon', async () => {
    const { provider } = fixture({ legacy: [legacyRow], addon: { subtitles: [addonRow] } });
    const tracks = await provider.subtitles('42', 1);
    expect(tracks).toHaveLength(1); expect(tracks[0].id).toBe('opensubtitles-123');
  });

  it('blocks private DNS, redirects and invalid archives on the new download hosts', async () => {
    for (const options of [{ privateDns: true }, { status: 302 }, { body: new TextEncoder().encode('<html>not subtitles</html>') }]) {
      const { provider, transport } = fixture(options);
      const [track] = await provider.subtitles('11577', 1);
      await expect(provider.file(token(track.url))).rejects.toHaveProperty('status', 503);
      if (options.privateDns) expect(transport).not.toHaveBeenCalled();
    }
  });
});
