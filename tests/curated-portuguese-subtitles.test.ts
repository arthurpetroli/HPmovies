import { describe, expect, it } from 'vitest';
import { curatedSubtitleIdentity, findCuratedPortugueseSubtitles, permittedCuratedSubtitleUrl, sanitizeCuratedSubtitleText } from '../src/aniwatch-apis/src/providers/curated-portuguese-subtitles';
import { subtitleToVtt } from '../src/shared/subtitles';

const identity = { imdb: 'tt2967286', kind: 'movie' as const };

describe('reviewed Portuguese subtitle release identities', () => {
  it('provides only the exact reviewed movie identity without a remote mapping request', () => {
    expect(curatedSubtitleIdentity('11577', 1)).toEqual(identity);
    expect(curatedSubtitleIdentity('9253', 1)).toBeUndefined();
    expect(curatedSubtitleIdentity('11577', 2)).toBeUndefined();
    expect(curatedSubtitleIdentity('11577', 1.5)).toBeUndefined();
    expect(curatedSubtitleIdentity('011577', 1)).toBeUndefined();
  });
  it('matches only the exact Steins;Gate movie and preserves public source credits', () => {
    const [track] = findCuratedPortugueseSubtitles('11577', 1, identity);
    expect(track).toMatchObject({ id: 'legendei-steins-gate-movie-2013-pt-br', label: 'Legendei · PT-BR · Steins;Gate (filme)', animeId: '11577', imdb: 'tt2967286', episode: 1, format: 'srt', encoding: 'utf-8', language: 'pt-BR', archive: 'zip' });
    expect(track.sourceUrl).toBe('https://legendei.net/pt-br-steinsgate-filme-load-region-of-deja-vu/');
    expect(permittedCuratedSubtitleUrl(track.url)?.hostname).toBe('legendei.net');
    track.url = 'https://example.org/changed.zip';
    expect(findCuratedPortugueseSubtitles('11577', 1, identity)[0].url).not.toBe(track.url);
  });
  it('rejects the parent series, other IMDb identities, unknown seasons and later episodes', () => {
    expect(findCuratedPortugueseSubtitles('9253', 1, identity)).toEqual([]);
    expect(findCuratedPortugueseSubtitles('11577', 1, { ...identity, imdb: 'tt1910272' })).toEqual([]);
    expect(findCuratedPortugueseSubtitles('11577', 1, { ...identity, kind: 'series', season: 1, episode: 1 })).toEqual([]);
    expect(findCuratedPortugueseSubtitles('11577', 1, { ...identity, season: 0 })).toEqual([]);
    expect(findCuratedPortugueseSubtitles('11577', 2, identity)).toEqual([]);
    expect(findCuratedPortugueseSubtitles('11577', 1.5, identity)).toEqual([]);
  });
  it('marks the reviewed Overgeared S01E02 alternative as machine translated and never shifts its season or episode', () => {
    const seriesIdentity = { imdb: 'tt43691353', kind: 'series' as const, season: 1, episode: 2 };
    expect(curatedSubtitleIdentity('212888', 2)).toEqual(seriesIdentity);
    expect(curatedSubtitleIdentity('212888', 1)).toBeUndefined();
    const [track] = findCuratedPortugueseSubtitles('212888', 2, seriesIdentity);
    expect(track).toMatchObject({ name: 'SubDL', label: 'Tradução automática · PT-BR · Overgeared — episódio 2 · SubDL', animeId: '212888', imdb: 'tt43691353', kind: 'series', season: 1, episode: 2, machineTranslated: true, language: 'pt-BR', archive: 'zip' });
    expect(track.sourceUrl).toBe('https://subdl.com/s/info/v5sUEYTk84/overgeared');
    expect(permittedCuratedSubtitleUrl(track.url)?.hostname).toBe('dl.subdl.com');
    for (const alternateIdentity of [{ ...seriesIdentity, season: 2 }, { ...seriesIdentity, episode: 1 }, { ...seriesIdentity, imdb: 'tt1910272' }, { ...seriesIdentity, season: undefined }]) {
      expect(findCuratedPortugueseSubtitles('212888', 2, alternateIdentity)).toEqual([]);
    }
    expect(findCuratedPortugueseSubtitles('212888', 1, seriesIdentity)).toEqual([]);
    expect(findCuratedPortugueseSubtitles('208067', 2, seriesIdentity)).toEqual([]);
    expect(permittedCuratedSubtitleUrl('https://dl.subdl.com/subtitle/unreviewed.zip')).toBeUndefined();
    expect(permittedCuratedSubtitleUrl(`${track.url}?other=1`)).toBeUndefined();
  });
  it('does not turn a reviewed host or path prefix into an open download permission', () => {
    const [{ url }] = findCuratedPortugueseSubtitles('11577', 1, identity);
    const attempts = [url.replace('https:', 'http:'), url.replace('legendei.net', 'legendei.net.evil.org'), url.replace('legendei.net', 'a:b@legendei.net'), url.replace('legendei.net', 'legendei.net:8443'), `${url}?download=other`, `${url}#other`, url.replace('/2025/02/', '/2025/03/'), `${url}/../other.zip`, 'https://127.0.0.1/test.zip', 'invalid'];
    for (const attempt of attempts) expect(permittedCuratedSubtitleUrl(attempt)).toBeUndefined();
  });
  it('removes only standalone vector lines and bidi controls from a machine-translated release', () => {
    const original = '1\r\n00:00:01,000 --> 00:00:03,000\r\n\u202bm 0 0 l 295 0 295 40 0 40\r\n\r\n'
      + '2\r\n00:00:04,000 --> 00:00:06,000\r\n\u2066Você chegou à vila. Tenho 0 moedas.\u2069\r\n\r\n'
      + '3\r\n00:00:07,000 --> 00:00:08,000\r\nm é uma letra; m 0 não é um desenho.\r\n\r\n'
      + '4\r\n00:00:09,000 --> 00:00:10,000\r\nm -1.5 +2 l 0 0 b 1 2 3 4 5 6 c\r\n';
    const sanitized = sanitizeCuratedSubtitleText(original, true), vtt = subtitleToVtt(sanitized, 'srt');
    expect(sanitizeCuratedSubtitleText(original, false)).toBe(original);
    expect(sanitized).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(vtt.match(/-->/g)).toHaveLength(2);
    expect(vtt).toContain('00:00:04.000 --> 00:00:06.000\nVocê chegou à vila. Tenho 0 moedas.');
    expect(vtt).toContain('m é uma letra; m 0 não é um desenho.');
    expect(vtt).not.toContain('m 0 0'); expect(vtt).not.toContain('m -1.5');
  });
});
