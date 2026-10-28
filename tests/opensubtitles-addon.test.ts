import { describe, expect, it } from 'vitest';
import { addonSubtitleUrl, contradictsSubtitleEpisode, parseAddonPortugueseSubtitles, permittedAddonSubtitleDownloadUrl } from '../src/aniwatch-apis/src/providers/opensubtitles-addon';
import type { SubtitleAddonIdentity } from '../src/aniwatch-apis/src/providers/opensubtitles-addon';

const series: SubtitleAddonIdentity = { imdb: 'tt1910272', kind: 'series', season: 1, episode: 2 };
const movie: SubtitleAddonIdentity = { imdb: 'tt2967286', kind: 'movie' };
const download = (id = '123') => `https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/${id}`;
const row = (extra: object = {}) => ({ id: 'unrelated-row-id', lang: 'pob', url: download(), season: 1, episode: 2,
  SubEncoding: 'CP1252', subtitleFileName: 'Original.S01E02.srt', ...extra });

describe('official OpenSubtitles addon identities and Portuguese metadata', () => {
  it('addresses movies and exact series episodes without title guesses', () => {
    expect(addonSubtitleUrl(movie)).toBe('https://opensubtitles-v3.strem.io/subtitles/movie/tt2967286.json');
    expect(addonSubtitleUrl(series)).toBe('https://opensubtitles-v3.strem.io/subtitles/series/tt1910272:1:2.json');
    expect(addonSubtitleUrl({ imdb: 'tt43691353', kind: 'series', season: 0, episode: 1 })).toContain('tt43691353:0:1.json');
  });

  it.each([
    { ...series, imdb: 'tt1' }, { ...series, imdb: 'tt1910272/../../private' }, { ...series, imdb: '1910272' },
    { ...series, season: -1 }, { ...series, season: 1001 }, { ...series, episode: 0 }, { ...series, episode: 100_001 },
    { ...series, episode: 1.5 }, { ...series, episode: undefined }, { ...movie, season: 0 },
  ])('rejects an invalid requested identity before building a request', identity => {
    expect(() => addonSubtitleUrl(identity)).toThrowError(expect.objectContaining({ status: 502, code: 'SUBTITLE_INVALID_RESPONSE' }));
  });

  it.each([
    'https://127.0.0.1/en/download/subencoding-stremio-utf8/src-api/file/123',
    download().replace('subs5.strem.io', 'subs5.strem.io.evil.example'),
    download().replace('subs5.strem.io', 'evilsubs5.strem.io'),
    download().replace('https:', 'http:'), download().replace('subs5.strem.io', 'user:secret@subs5.strem.io'),
    download().replace('subs5.strem.io', 'subs5.strem.io:443'), download().replace('subs5.strem.io', 'subs5.strem.io:8443'),
    `${download()}?target=http://127.0.0.1`, `${download()}?`, `${download()}#private`, `${download()}/`,
    download('0123'), download('0'), download('1'.repeat(21)), download().replace('utf8', 'cp1252'),
    download().replace('/file/123', '/file/%31%32%33'), 'not a URL', undefined,
  ])('rejects forged or noncanonical subtitle destinations: %s', url => {
    expect(permittedAddonSubtitleDownloadUrl(url)).toBeUndefined();
  });

  it('uses the shared download file ID and normalized UTF-8 instead of the row id and original encoding', () => {
    const tracks = parseAddonPortugueseSubtitles({ subtitles: [row(), row({ id: 'another-row-id' }), row({ url: download('124'), lang: 'por' })] }, series);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({ id: 'opensubtitles-123', url: download(), language: 'pt-BR', encoding: 'utf-8', format: 'srt' });
    expect(tracks[1]).toMatchObject({ id: 'opensubtitles-124', language: 'pt' });
    expect(tracks[0].label).toBe('OpenSubtitles v3 · pt-BR · Original.S01E02.srt');
  });

  it('rejects other seasons, other episodes, untyped identities, English and invalid files without hiding a later match', () => {
    const tracks = parseAddonPortugueseSubtitles({ subtitles: [
      null, row({ season: 0 }), row({ episode: 1 }), row({ season: '1' }), row({ episode: '2' }), row({ episode: undefined }),
      row({ lang: 'eng' }), row({ url: 'https://private.example/123.srt' }), row({ subtitleFileName: 'archive.zip' }), row(),
    ] }, series);
    expect(tracks.map(track => track.id)).toEqual(['opensubtitles-123']);
  });

  it('rejects contradictory filenames before deduplication even when addon metadata matches', () => {
    const tracks = parseAddonPortugueseSubtitles({ subtitles: [
      row({ subtitleFileName: 'Original.S01E101.ass' }), row({ subtitleFileName: 'Original.S02E02.ass' }),
      row({ subtitleFileName: 'Original.S01E02.S01E03.ass' }),
      row({ subtitleFileName: undefined, movieReleaseName: 'Original.S01E101' }), row(),
      row({ url: download('124'), subtitleFileName: 'Original - E101.ass' }),
    ] }, series);
    expect(tracks.map(track => track.id)).toEqual(['opensubtitles-123', 'opensubtitles-124']);
  });

  it('compares only explicit season/episode declarations to the resolved identity without guessing absolute numbering', () => {
    for (const filename of ['QA.S01E02.ass', 'QA.s001-e0002.ass', 'QA.S01 E02.ass', 'QA - 101.ass', 'QA - E101.ass', 'QA [00101].ass', undefined]) {
      expect(contradictsSubtitleEpisode(filename, series)).toBe(false);
    }
    expect(contradictsSubtitleEpisode('QA.S01E101.ass', { ...series, episode: 101 })).toBe(false);
    expect(contradictsSubtitleEpisode('QA.S01E101.ass', series)).toBe(true);
    expect(contradictsSubtitleEpisode('QA.S02E02.ass', series)).toBe(true);
  });

  it('accepts a movie only without contradictory series numbering', () => {
    const tracks = parseAddonPortugueseSubtitles({ subtitles: [row(), row({ season: 0, episode: 0 }),
      row({ url: download('124'), season: undefined, episode: undefined }), row({ url: download('125'), season: '0', episode: '0' }),
    ] }, movie);
    expect(tracks.map(track => track.id)).toEqual(['opensubtitles-123', 'opensubtitles-124']);
  });

  it('keeps explicit supported text formats and defaults to SRT only when the filename is absent', () => {
    const filenames = ['test.ASS', 'test.ssa', 'test.vtt', undefined, '', 'unknown.txt', 'no-extension', null];
    const tracks = parseAddonPortugueseSubtitles({ subtitles: filenames.map((subtitleFileName, index) => row({ url: download(String(index + 1)), subtitleFileName })) }, series);
    expect(tracks.map(track => track.format)).toEqual(['ass', 'ass', 'vtt', 'srt', 'srt']);
  });

  it('caps each Portuguese variant independently and spends no slot on invalid or duplicate rows', () => {
    const rows = [
      ...Array.from({ length: 100 }, () => row({ season: 9 })), ...Array.from({ length: 100 }, () => row()),
      ...Array.from({ length: 30 }, (_, index) => row({ url: download(String(index + 1000)) })),
      ...Array.from({ length: 30 }, (_, index) => row({ url: download(String(index + 2000)), lang: 'por' })),
    ];
    const tracks = parseAddonPortugueseSubtitles({ subtitles: rows }, series);
    expect(tracks.filter(track => track.language === 'pt-BR')).toHaveLength(24);
    expect(tracks.filter(track => track.language === 'pt')).toHaveLength(24);
    expect(new Set(tracks.map(track => track.id)).size).toBe(48);
  });

  it.each([null, [], {}, { subtitles: null }, { subtitles: {} }, { subtitles: Array.from({ length: 2001 }, () => row()) }])('fails malformed or oversized envelopes for the caller to isolate', input => {
    expect(() => parseAddonPortugueseSubtitles(input, series)).toThrowError(expect.objectContaining({ status: 502, code: 'SUBTITLE_INVALID_RESPONSE' }));
  });
});
