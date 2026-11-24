import { describe, expect, it, vi } from 'vitest';
import { AniwatchAPICache } from '../src/aniwatch-apis/src/config/cache';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations';
import type { AdultSitesConfig } from '../src/aniwatch-apis/src/config/integrations';
import { AdultSitesProvider, bloggerMp4, mp4Video } from '../src/aniwatch-apis/src/providers/adult-sites';
import type { HeadFetcher, PageFetcher } from '../src/aniwatch-apis/src/providers/adult-sites';
import { StreamMediaGateway } from '../src/aniwatch-apis/src/providers/stream-media';

const expire = () => Math.floor(Date.now() / 1000) + 8 * 3600;
const BLOGGER = 'https://www.blogger.com/video.g?token=AD6v5dwUXq9XPS4hS2h8YI8qxBLEVG05mLnupAE1WLzbmhXNY2DVQs';
/** Same escaping as the real page: JSON in a script, with \/ and = / &. */
const bloggerPage = (itags: string | string[] = '18', expiresAt = expire()) => `<script>var c="[${[itags].flat().map(itag => `[\\"https:\\/\\/rr6---sn-abc.googlevideo.com\\/videoplayback?expire\\u003d${expiresAt}\\u0026itag\\u003d${itag}\\u0026mime\\u003dvideo%2Fmp4\\u0026sig\\u003ds${itag}\\"]`).join(',')}]";
  var s="\\"serverAbrStreamingUrl\\":\\"https:\\/\\/rr6---sn-abc.googlevideo.com\\/videoplayback?expire\\u003d${expiresAt}\\u0026sabr\\u003d1\\"";</script>`;
const genreBlock = (...names: string[]) => `<div class="sgeneros">${names.map(name => `<a href="/genero/${name.toLowerCase().replace(/\s+/g, '-')}/">${name}</a>`).join('')}<a href="/genero/h/">H</a></div>`;

const config = (overrides: Partial<AdultSitesConfig> = {}): AdultSitesConfig => ({
  enabled: true, baseUrl: '', timeoutMs: 5000, retries: 0, contentAuthorized: true, sites: ['animeshentai', 'assistirhentai', 'muitohentai'],
  allowedProviders: ['animeshentai', 'assistirhentai', 'muitohentai'], allowedMediaHosts: [], allowedStreamDomains: ['googlevideo.com'], allowedRequestOrigins: [],
  ...overrides,
});

function sites(pages: Record<string, string>) {
  return vi.fn<PageFetcher>(async url => url in pages ? { status: 200, url, body: pages[url] } : { status: 404, url, body: '' });
}
/** ftyp + moov/trak/tkhd (version 0, 92 bytes) declaring a video track size. */
function mp4Head(width: number, height: number): Buffer {
  const box = (type: string, body: Buffer) => { const header = Buffer.alloc(8); header.writeUInt32BE(8 + body.length, 0); header.write(type, 4, 'latin1'); return Buffer.concat([header, body]); };
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0isom', 'latin1')), box('moov', box('trak', box('tkhd', tkhd)))]);
}
const heads = (files: Record<string, Buffer>) => vi.fn<HeadFetcher>(async url => url in files
  ? { status: 206, contentType: 'video/mp4', body: files[url] } : { status: 404, contentType: 'text/html', body: Buffer.from('') });

const provider = (fetcher: ReturnType<typeof sites>, overrides: Partial<AdultSitesConfig> = {}, headFetcher = heads({})) => new AdultSitesProvider({
  config: config(overrides), fetcher, headFetcher, cache: new AniwatchAPICache({ maxEntries: 64 }), gateway: new StreamMediaGateway(),
});

const animeshentai = (genres = genreBlock('Romance', 'Peitoes')) => ({
  'https://animeshentai.biz/search/Office%20Affair': '<a href="https://animeshentai.biz/hentai/office-affair/"><img alt=""></a><a href="https://animeshentai.biz/hentai/other-title/">Other Title</a>',
  'https://animeshentai.biz/hentai/office-affair/': `<h1>Office Affair</h1>${genres}<a href="https://animeshentai.biz/episodio/office-affair-episodio-1/">1</a><a href="https://animeshentai.biz/episodio/office-affair-episodio-2/">2</a>`,
  'https://animeshentai.biz/episodio/office-affair-episodio-2/': `<div class="player"><iframe src="${BLOGGER}"></iframe></div>`,
  [BLOGGER]: bloggerPage(),
});

describe('adult streaming sites', () => {
  it('stays disabled until ADULT_SITES names known sites', () => {
    expect(loadIntegrationsConfig({}).adultSites).toMatchObject({ enabled: false, sites: [] });
    expect(loadIntegrationsConfig({ ADULT_SITES: 'muitohentai, AnimesHentai', ADULT_SITES_ALLOWED_STREAM_DOMAINS: 'googlevideo.com' }).adultSites)
      .toMatchObject({ enabled: true, sites: ['muitohentai', 'animeshentai'], allowedProviders: ['muitohentai', 'animeshentai'], allowedStreamDomains: ['googlevideo.com'], contentAuthorized: false });
    expect(() => loadIntegrationsConfig({ ADULT_SITES: 'example' })).toThrow(/ADULT_SITES/);
  });

  it('reads the progressive Blogger MP4 and ignores SABR or expired links', () => {
    expect(bloggerMp4(bloggerPage())[0]?.url).toMatch(/^https:\/\/rr6---sn-abc\.googlevideo\.com\/videoplayback\?.*itag=18/);
    // HD uploads also carry the progressive 720p file (itag 22), offered first.
    expect(bloggerMp4(bloggerPage(['18', '22'])).map(file => file.height)).toEqual([720, 360]);
    // Video-only adaptive formats (e.g. itag 136) and SABR are never used.
    expect(bloggerMp4(bloggerPage('136'))).toEqual([]);
    expect(bloggerMp4(bloggerPage('18', Math.floor(Date.now() / 1000) + 60))).toEqual([]);
    expect(bloggerMp4('<html>sem player</html>')).toEqual([]);
  });

  it('finds the exact title on AnimesHentai and plays its Blogger video through the gateway', async () => {
    const fetcher = sites(animeshentai());
    const playback = await provider(fetcher, { sites: ['animeshentai'] }).playback(['Office Affair'], 2);
    expect(playback.sources).toEqual([expect.objectContaining({ type: 'mp4', label: 'AnimesHentai · 360p', height: 360, url: expect.stringMatching(/^\/api\/streaming\/media\//) })]);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://animeshentai.biz/search/Office%20Affair', 'https://animeshentai.biz/hentai/office-affair/',
      'https://animeshentai.biz/episodio/office-affair-episodio-2/', BLOGGER,
    ]);
  });

  it('offers the Blogger 720p file of HD uploads before the 360p one', async () => {
    const fetcher = sites({ ...animeshentai(), [BLOGGER]: bloggerPage(['18', '22']) });
    const playback = await provider(fetcher, { sites: ['animeshentai'] }).playback(['Office Affair'], 2);
    expect(playback.sources.map(source => [source.label, source.height])).toEqual([['AnimesHentai · 720p', 720], ['AnimesHentai · 360p', 360]]);
  });

  it.each(['Lolicon', 'Shotacon', 'Vida Escolar'])('blocks a title the site files under %s', async genre => {
    const fetcher = sites(animeshentai(genreBlock('Romance', genre)));
    await expect(provider(fetcher, { sites: ['animeshentai'] }).playback(['Office Affair'], 2)).rejects.toMatchObject({ code: 'ADULT_TITLE_BLOCKED' });
    expect(fetcher.mock.calls.map(call => call[0])).not.toContain(BLOGGER);
  });

  it('lists episodes from the Assistir Hentai search and ignores other titles', async () => {
    const fetcher = sites({
      'https://www.assistirhentai.com/?s=Office%20Affair': ['01', '02'].map(number => `<a href="https://www.assistirhentai.com/episodio/office-affair-episodio-${number}/" title="Office Affair Episódio ${number}">x</a>`).join('')
        + '<a href="https://www.assistirhentai.com/episodio/office-affair-2-episodio-05/" title="Office Affair 2 Episódio 05">x</a>',
      'https://www.assistirhentai.com/episodio/office-affair-episodio-02/': `<div class="post-video"><iframe src="${BLOGGER}"></iframe></div>`,
      [BLOGGER]: bloggerPage(),
    });
    const source = provider(fetcher, { sites: ['assistirhentai'] });
    expect(await source.episodes(['Office Affair'])).toEqual([{ number: 1, title: 'Episódio 1' }, { number: 2, title: 'Episódio 2' }]);
    expect((await source.playback(['Office Affair'], 2)).sources[0]).toMatchObject({ providerId: 'adult-site:assistirhentai' });
  });

  it('reads the video size from MP4 metadata and refuses other files', () => {
    expect(mp4Video(mp4Head(1280, 720))).toEqual({ height: 720 });
    expect(mp4Video(Buffer.from('<html>not a video</html>'))).toBeUndefined();
  });

  describe('Assistir Hentai own 720p player', () => {
    const OWN = 'https://videos.assistirhentai.com/pubfolder/hentai/OfficeAffair/ep01.mp4';
    const pages = (player: string) => ({
      'https://www.assistirhentai.com/?s=Office%20Affair': '<a href="https://www.assistirhentai.com/episodio/office-affair-episodio-04/">x</a>',
      'https://www.assistirhentai.com/episodio/office-affair-episodio-04/': player,
      [BLOGGER]: bloggerPage(),
    });
    const both = `<video id="video" class="video-js"><source src="${OWN}" type="video/mp4"></video><iframe src="${BLOGGER}"></iframe>`;

    it('offers the verified 720p file first, then the Blogger 360p mirror', async () => {
      const headFetcher = heads({ [OWN]: mp4Head(1280, 720) });
      const playback = await provider(sites(pages(both)), { sites: ['assistirhentai'], allowedStreamDomains: ['googlevideo.com', 'assistirhentai.com'] }, headFetcher).playback(['Office Affair'], 4);
      expect(playback.sources.map(source => [source.label, source.height])).toEqual([['Assistir Hentai · 720p · servidor do site', 720], ['Assistir Hentai · 360p', 360]]);
      // The page's link is trusted even when the file name says another episode.
      expect(headFetcher).toHaveBeenCalledWith(OWN, 5000);
    });

    it('keeps only Blogger when the site domain is not allowed or the file is not an MP4', async () => {
      const notAllowed = await provider(sites(pages(both)), { sites: ['assistirhentai'] }, heads({ [OWN]: mp4Head(1280, 720) })).playback(['Office Affair'], 4);
      expect(notAllowed.sources.map(source => source.height)).toEqual([360]);
      const broken = await provider(sites(pages(both)), { sites: ['assistirhentai'], allowedStreamDomains: ['googlevideo.com', 'assistirhentai.com'] }, heads({})).playback(['Office Affair'], 4);
      expect(broken.sources.map(source => source.height)).toEqual([360]);
      const onlyOwn = sites(pages(`<video><source src="${OWN}" type="video/mp4"></video>`));
      await expect(provider(onlyOwn, { sites: ['assistirhentai'] }, heads({ [OWN]: mp4Head(1280, 720) })).playback(['Office Affair'], 4))
        .rejects.toMatchObject({ code: 'ADULT_SITES_MEDIA_NOT_PERMITTED', message: expect.stringContaining('assistirhentai.com') });
    });

    it('ignores <source> files hosted elsewhere', async () => {
      const elsewhere = sites(pages(`<video><source src="https://cdn.example.org/ep04.mp4" type="video/mp4"></video><iframe src="${BLOGGER}"></iframe>`));
      const headFetcher = heads({ 'https://cdn.example.org/ep04.mp4': mp4Head(1920, 1080) });
      const playback = await provider(elsewhere, { sites: ['assistirhentai'], allowedStreamDomains: ['googlevideo.com', 'example.org'] }, headFetcher).playback(['Office Affair'], 4);
      expect(playback.sources.map(source => source.height)).toEqual([360]);
      expect(headFetcher).not.toHaveBeenCalled();
    });
  });

  it('uses the Muito Hentai Blogger player and never the Referer-protected server', async () => {
    const fetcher = sites({
      'https://www.muitohentai.com/buscar/Office+Affair/': '<a href="/info/office-affair/">Office Affair</a>',
      'https://www.muitohentai.com/info/office-affair/': `<h1>Office Affair</h1>${genreBlock('romance')}<a href="/episodios/office-affair-episodio-1/">1</a>`,
      'https://www.muitohentai.com/episodios/office-affair-episodio-1/': '<iframe src="https://www.hentaitube.online/players_sites/mt/hd.php?idplay=abc"></iframe><iframe src="https://www.muitohentai.com/players/p2/?padrao=xyz"></iframe>',
      'https://www.hentaitube.online/players_sites/mt/hd.php?idplay=abc': `<iframe src="${BLOGGER}"></iframe>`,
      [BLOGGER]: bloggerPage(),
    });
    const playback = await provider(fetcher, { sites: ['muitohentai'] }).playback(['Office Affair'], 1);
    expect(playback.sources[0]).toMatchObject({ providerName: 'Muito Hentai', type: 'mp4' });
    expect(fetcher.mock.calls.some(call => call[0].includes('/players/p2/'))).toBe(false);
  });

  it('collects one source per site that has the episode', async () => {
    const fetcher = sites({
      ...animeshentai(),
      'https://www.assistirhentai.com/?s=Office%20Affair': '<a href="https://www.assistirhentai.com/episodio/office-affair-episodio-02/">x</a>',
      'https://www.assistirhentai.com/episodio/office-affair-episodio-02/': `<iframe src="${BLOGGER}"></iframe>`,
    });
    const playback = await provider(fetcher, { sites: ['animeshentai', 'assistirhentai', 'muitohentai'] }).playback(['Office Affair'], 2);
    expect(playback.sources.map(source => source.providerName)).toEqual(['AnimesHentai', 'Assistir Hentai']);
  });

  it('explains missing titles, missing media, authorization and domains', async () => {
    await expect(provider(sites({}), { sites: ['animeshentai'] }).playback(['Office Affair'], 1)).rejects.toMatchObject({ code: 'ADULT_SITES_NOT_FOUND' });
    const sabr = sites({ ...animeshentai(), [BLOGGER]: bloggerPage('136') });
    await expect(provider(sabr, { sites: ['animeshentai'] }).playback(['Office Affair'], 2)).rejects.toMatchObject({ code: 'ADULT_SITES_NO_MEDIA' });
    const unauthorized = sites(animeshentai());
    await expect(provider(unauthorized, { contentAuthorized: false }).playback(['Office Affair'], 2)).rejects.toMatchObject({ code: 'ADULT_SITES_UNAUTHORIZED' });
    expect(unauthorized).not.toHaveBeenCalled();
    await expect(provider(sites(animeshentai()), { sites: ['animeshentai'], allowedStreamDomains: [] }).playback(['Office Affair'], 2)).rejects.toMatchObject({ code: 'ADULT_SITES_MEDIA_NOT_PERMITTED' });
  });

  it('retries an episode whose video failed instead of caching the failure', async () => {
    let blogger = 0;
    const pages: Record<string, string> = animeshentai();
    const fetcher = vi.fn<PageFetcher>(async url => url === BLOGGER
      ? { status: 200, url, body: bloggerPage(++blogger === 1 ? '136' : '18') }
      : url in pages ? { status: 200, url, body: pages[url] } : { status: 404, url, body: '' });
    const source = provider(fetcher, { sites: ['animeshentai'] });
    await expect(source.playback(['Office Affair'], 2)).rejects.toMatchObject({ code: 'ADULT_SITES_NO_MEDIA' });
    expect((await source.playback(['Office Affair'], 2)).sources).toHaveLength(1);
    expect(blogger).toBe(2);
  });

  it('reports configuration in the diagnostic', async () => {
    expect((await new AdultSitesProvider({ config: loadIntegrationsConfig({}).adultSites }).diagnostic()).state).toBe('unavailable');
    const online = sites({ 'https://animeshentai.biz/': '<html></html>' });
    expect((await provider(online, { sites: ['animeshentai'], contentAuthorized: false }).diagnostic()).state).toBe('unauthorized');
    expect((await provider(online, { sites: ['animeshentai'] }).diagnostic())).toMatchObject({ state: 'available', message: expect.stringContaining('360p') });
  });
});
