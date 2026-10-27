import { describe, expect, it, vi } from 'vitest';
import { StreamMediaGateway } from '../src/aniwatch-apis/src/providers/stream-media.js';
import { normalizeTokoSource } from '../src/aniwatch-apis/src/providers/toko.js';
import type { ImageRequest, ImageResponse } from '../src/aniwatch-apis/src/providers/content-image.js';
import type { TokoConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import type { TokoStream } from '../src/aniwatch-apis/src/providers/toko-http.js';

const config = (): TokoConfig => ({ enabled: true, contentAuthorized: true, baseUrl: 'http://127.0.0.1:8099', timeoutMs: 8000, retries: 0,
  allowedProviders: ['source'], allowedMediaHosts: ['cdn.example.org'], allowedRequestOrigins: ['https://player.example.org'] });
const resolver = async () => [{ address: '1.1.1.1', family: 4 }];
const response = (text: string | Uint8Array, mime = 'application/vnd.apple.mpegurl', status = 200, extra: Record<string, string> = {}): ImageResponse => {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return { status, headers: new Headers({ 'Content-Type': mime, 'Content-Length': String(bytes.length), ...extra }),
    body: (async function* () { yield bytes; })(), cancel: vi.fn() };
};
const token = (path: string) => path.split('/').at(-1)!;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const headers = { Referer: 'https://player.example.org/', Origin: 'https://player.example.org', 'User-Agent': 'Mozilla/5.0 provider agent' };
const ts = () => { const bytes = new Uint8Array(188 * 3); bytes[0] = bytes[188] = bytes[376] = 0x47; return bytes; };
const mp4 = () => new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

describe('scoped streaming transport', () => {
  it('rewrites master, alternate audio, relative segments and initialization URIs into opaque scoped tickets', async () => {
    const transport = vi.fn(async (input: ImageRequest) => {
      expect(input.headers['User-Agent']).toContain('HPmovies/');
      expect(input.headers.referer).toBe('https://player.example.org/');
      expect(input.headers.origin).toBe('https://player.example.org');
      expect(input.address).toBe('1.1.1.1');
      if (input.url.pathname.endsWith('master.m3u8')) return response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo/main.m3u8\n');
      if (input.url.pathname.endsWith('main.m3u8')) return response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\n../segment.ts?signature=private\n#EXT-X-ENDLIST\n');
      return response(new Uint8Array([0x47, 0x40, 0]), 'video/mp2t');
    });
    const gateway = new StreamMediaGateway({ resolver, transport });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/show/master.m3u8', 'hls', headers);
    const master = decode((await gateway.media(token(path))).bytes);
    expect(master).not.toContain('cdn.example.org'); expect(master).not.toContain('audio.m3u8');
    expect(master).toMatch(/URI="\/api\/streaming\/media\/[0-9a-f-]+"/);
    const child = master.split('\n').find(line => line.startsWith('/api/'))!;
    const media = decode((await gateway.media(token(child))).bytes);
    expect(media).not.toContain('signature'); expect(media).not.toContain('init.mp4');
    const segment = media.split('\n').find(line => line.startsWith('/api/'))!;
    const content = await gateway.media(token(segment));
    expect(content.bytes).toEqual(new Uint8Array([0x47, 0x40, 0]));
    expect(transport.mock.calls.at(-1)?.[0].url.pathname).toBe('/show/segment.ts');
    await gateway.media(token(segment)); expect(transport).toHaveBeenCalledTimes(3);
  });

  it('refuses DRM playlists and unapproved HLS descendants', async () => {
    for (const manifest of ['#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\nsegment.ts', '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"', '#EXTM3U\nhttps://private.example.org/segment.ts', '#EXTM3U\nhttp://cdn.example.org/segment.ts', '#EXTM3U\n#EXT-X-MAP:URI=data:abc']) {
      const transport = vi.fn(async () => response(manifest));
      const gateway = new StreamMediaGateway({ resolver, transport });
      const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
      await expect(gateway.media(token(path))).rejects.toHaveProperty('status');
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it('remaps image permission failures to streaming errors, including nested CDN hosts', async () => {
    const gateway = new StreamMediaGateway({ resolver, transport: async () => response('#EXTM3U\n#EXTINF:6,\nhttps://other.example.org/a.ts') });
    expect(() => gateway.issue(config(), 'source', 'https://other.example.org/a.m3u8', 'hls')).toThrow(expect.objectContaining({ code: 'STREAM_MEDIA_NOT_PERMITTED' }));
    expect(() => gateway.issue(config(), 'source', 'https://cdn.example.org/a.m3u8', 'hls', { Cookie: 'secret' })).toThrow(expect.objectContaining({ code: 'STREAM_MEDIA_NOT_PERMITTED' }));
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
    await expect(gateway.probe(path)).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
  });

  it('probes the real first HLS variant and segment, then deduplicates and briefly caches verification', async () => {
    const transport = vi.fn(async (input: ImageRequest) => {
      if (input.url.pathname === '/master.m3u8') return response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="iframes.m3u8"');
      if (input.url.pathname === '/video.m3u8') return response('#EXTM3U\n#EXTINF:6,\nsegment.html\n#EXT-X-ENDLIST');
      expect(input.url.pathname).toBe('/segment.html'); return response(ts(), 'text/html');
    });
    const gateway = new StreamMediaGateway({ resolver, transport });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
    await Promise.all([gateway.probe(path), gateway.probe(path)]); await gateway.probe(path);
    expect(transport).toHaveBeenCalledTimes(3);
    await expect(gateway.probe('https://cdn.example.org/master.m3u8')).rejects.toMatchObject({ status: 502 });
    await expect(gateway.probe(`${path}?url=other`)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects a successful HLS master when its actual video is missing or is HTML', async () => {
    for (const body of [response('<html>not a video</html>', 'application/octet-stream'), response('redirect', 'video/mp2t', 302)]) {
      const gateway = new StreamMediaGateway({ resolver, transport: async input => input.url.pathname.endsWith('.m3u8')
        ? response('#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST') : body });
      const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
      await expect(gateway.probe(path)).rejects.toMatchObject({ status: 502 });
    }
  });

  it('probes MP4 with at most 64 KiB, checks its signature and refuses redirects or ignored oversized ranges', async () => {
    for (const body of [response(mp4(), 'video/mp4', 206, { 'Content-Range': 'bytes 0-15/100000' }),
      response('redirect', 'video/mp4', 302), response('<html>not media</html>', 'video/mp4'), response(new Uint8Array(65537), 'video/mp4')]) {
      const transport = vi.fn(async (input: ImageRequest) => { expect(input.headers.Range).toBe('bytes=0-65535'); return body; });
      const gateway = new StreamMediaGateway({ resolver, transport });
      const path = gateway.issue(config(), 'source', 'https://cdn.example.org/video.mp4', 'mp4');
      if (body.status === 206) await gateway.probe(path);
      else await expect(gateway.probe(path)).rejects.toMatchObject({ status: 502 });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it('cancels a stalled transport when the shared preflight budget expires', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const gateway = new StreamMediaGateway({ resolver, transport: async input => { upstreamSignal = input.signal; return new Promise<ImageResponse>(() => {}); } });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
    await expect(gateway.probe(path, AbortSignal.timeout(10))).rejects.toMatchObject({ code: 'STREAM_MEDIA_UNAVAILABLE' });
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it('limits MP4 byte ranges and preserves valid partial-content headers', async () => {
    const transport = vi.fn(async (input: ImageRequest) => {
      expect(input.headers.Range).toBe('bytes=100-8000099');
      return response(new Uint8Array([1, 2, 3]), 'video/mp4', 206, { 'Content-Range': 'bytes 100-102/9000000' });
    });
    const gateway = new StreamMediaGateway({ resolver, transport });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/video.mp4', 'mp4', headers);
    const out = await gateway.media(token(path), 'bytes=100-');
    expect(out.status).toBe(206); expect(out.headers['Content-Range']).toBe('bytes 100-102/9000000');
    expect(out.headers['Content-Length']).toBe('3');
    for (const range of ['bytes=0-1,3-4', 'bytes=50-10', 'bytes=-9000000', 'other=0-']) await expect(gateway.media(token(path), range)).rejects.toMatchObject({ status: 416 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('corrects mislabeled MPEG-TS segments only after validating every 188-byte packet', async () => {
    const packets = new Uint8Array(188 * 3); packets[0] = packets[188] = packets[376] = 0x47;
    for (const mime of ['image/jpeg', 'text/html', 'application/javascript', 'text/css']) {
      const gateway = new StreamMediaGateway({ resolver, transport: async () => response(packets, mime) });
      const result = await gateway.media(token(gateway.issue(config(), 'source', 'https://cdn.example.org/segment.jpg', 'segment')));
      expect(result.headers['Content-Type']).toBe('video/mp2t'); expect(result.bytes).toEqual(packets);
    }
    packets[188] = 0;
    const broken = new StreamMediaGateway({ resolver, transport: async () => response(packets, 'image/jpeg') });
    await expect(broken.media(token(broken.issue(config(), 'source', 'https://cdn.example.org/segment.jpg', 'segment')))).rejects.toMatchObject({ status: 502 });
    const jpeg = new StreamMediaGateway({ resolver, transport: async () => response(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg') });
    await expect(jpeg.media(token(jpeg.issue(config(), 'source', 'https://cdn.example.org/segment.jpg', 'segment')))).rejects.toMatchObject({ status: 502 });
  });

  it('refuses authentication, arbitrary URLs, private DNS, redirects and challenge responses', async () => {
    const gateway = new StreamMediaGateway();
    for (const input of [{ Authorization: 'Bearer secret' }, { Cookie: 'session=secret' }, { Origin: 'https://other.example.org' }]) {
      expect(() => gateway.issue(config(), 'source', 'https://cdn.example.org/v.m3u8', 'hls', input)).toThrow();
    }
    expect(() => gateway.issue(config(), 'source', 'https://127.0.0.1/v.m3u8', 'hls')).toThrow();
    expect(() => gateway.issue(config(), 'other', 'https://cdn.example.org/v.m3u8', 'hls')).toThrow();
    await expect(gateway.media('https://cdn.example.org/v.m3u8')).rejects.toMatchObject({ status: 404 });
    const transport = vi.fn(async () => response('#EXTM3U'));
    const privateGateway = new StreamMediaGateway({ resolver: async () => [{ address: '127.0.0.1', family: 4 }], transport });
    await expect(privateGateway.media(token(privateGateway.issue(config(), 'source', 'https://cdn.example.org/a.m3u8', 'hls')))).rejects.toHaveProperty('status');
    expect(transport).not.toHaveBeenCalled();
    for (const upstream of [response('redirect', 'text/plain', 302), response('challenge', 'text/html', 403), response('<html>challenge</html>', 'text/html')]) {
      const constrained = new StreamMediaGateway({ resolver, transport: async () => upstream });
      await expect(constrained.media(token(constrained.issue(config(), 'source', 'https://cdn.example.org/a.m3u8', 'hls')))).rejects.toMatchObject({ status: 502 });
      expect(upstream.cancel).toHaveBeenCalled();
    }
  });

  it('validates subtitles and makes provider-header sources usable through the streaming adapter', async () => {
    const gateway = new StreamMediaGateway({ resolver, transport: async () => response('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello', 'text/vtt') });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/en.vtt', 'subtitle', headers);
    expect((await gateway.media(token(path))).headers['Content-Type']).toBe('text/vtt; charset=utf-8');
    const source: TokoStream = { url: 'https://cdn.example.org/master.m3u8', type: 'hls', providerKey: 'source', providerName: 'Source', requiresHeaders: true, headers,
      subtitles: [{ url: 'https://cdn.example.org/en.vtt', label: 'English', language: 'en' }] };
    const normalized = normalizeTokoSource(source, config());
    expect(normalized?.url).toMatch(/^\/api\/streaming\/media\/[0-9a-f-]{36}$/);
    expect(normalizeTokoSource({ ...source, requiresHeaders: false, headers: undefined }, config())?.url).toMatch(/^\/api\/streaming\/media\/[0-9a-f-]{36}$/);
    expect(normalized?.subtitles[0].url).toMatch(/^\/api\/streaming\/media\/[0-9a-f-]{36}$/);
    expect(normalizeTokoSource({ ...source, headers: { Cookie: 'secret' } }, config())).toBeUndefined();
  });

  it('expires tickets, applies revoked source permissions and enforces deadlines and response sizes', async () => {
    const transport = vi.fn(async () => response('large', 'video/mp4', 206, { 'Content-Length': '8000001' }));
    const settings = config(); const gateway = new StreamMediaGateway({ resolver, transport });
    const path = gateway.issue(settings, 'source', 'https://cdn.example.org/video.mp4', 'mp4');
    await expect(gateway.media(token(path))).rejects.toMatchObject({ status: 502 });
    settings.contentAuthorized = false;
    await expect(gateway.media(token(path))).rejects.toHaveProperty('status');
    expect(transport).toHaveBeenCalledTimes(1);
    const timeoutGateway = new StreamMediaGateway({ resolver, timeoutMs: 10, transport: async () => new Promise<ImageResponse>(() => {}) });
    await expect(timeoutGateway.media(token(timeoutGateway.issue(config(), 'source', 'https://cdn.example.org/a.m3u8', 'hls')))).rejects.toMatchObject({ status: 504 });
    const expired = gateway.issue(config(), 'source', 'https://cdn.example.org/expired.m3u8', 'hls', {}, Date.now() - 1);
    await expect(gateway.media(token(expired))).rejects.toMatchObject({ status: 404 });
  });
});
