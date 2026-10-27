import { describe, expect, it, vi } from 'vitest';
import { loadIntegrationsConfig, type TokoConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import { ContentImageGateway, type ImageRequest, type ImageResponse } from '../src/aniwatch-apis/src/providers/content-image.js';
import { permittedStreamUrl, StreamMediaGateway } from '../src/aniwatch-apis/src/providers/stream-media.js';

const config = (): TokoConfig => ({
  enabled: true, contentAuthorized: true, baseUrl: 'http://127.0.0.1:8099', timeoutMs: 8000, retries: 0,
  allowedProviders: ['source'], allowedMediaHosts: ['images.example.org'],
  allowedStreamDomains: ['video.example.org', 'segments.example.net'], allowedRequestOrigins: ['https://player.example.org'],
});
const token = (path: string) => path.split('/').at(-1)!;
const publicDns = async () => [{ address: '1.1.1.1', family: 4 }];
const bytes = () => { const data = new Uint8Array(188 * 3); data[0] = data[188] = data[376] = 0x47; return data; };
const response = (input: string | Uint8Array, mime = 'application/vnd.apple.mpegurl'): ImageResponse => {
  const body = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return { status: 200, headers: new Headers({ 'Content-Type': mime, 'Content-Length': String(body.byteLength) }), body: (async function* () { yield body; })(), cancel: vi.fn() };
};
const mediaReference = (content: Uint8Array) => new TextDecoder().decode(content).split('\n').find(line => line.startsWith('/api/'))!;

describe('explicit streaming DNS domain policy', () => {
  it('loads normalized distinct domain roots independently of exact image hosts and namespaces', () => {
    const loaded = loadIntegrationsConfig({
      TOKO_ALLOWED_MEDIA_HOSTS: 'images.example.org', TOKO_ALLOWED_STREAM_DOMAINS: 'Video.Example.org, video.example.org',
      TATAKAI_ALLOWED_STREAM_DOMAINS: 'segments.example.net',
    });
    expect(loaded.toko.allowedMediaHosts).toEqual(['images.example.org']);
    expect(loaded.toko.allowedStreamDomains).toEqual(['video.example.org']);
    expect(loaded.tatakai.allowedStreamDomains).toEqual(['segments.example.net']);
    expect(loaded.tatakai.allowedMediaHosts).toEqual([]);
    for (const invalid of ['*.example.org', 'https://example.org', 'example.org/path', 'example.org:443', 'user@example.org', 'org', '127.0.0.1', '[::1]']) {
      expect(() => loadIntegrationsConfig({ TOKO_ALLOWED_STREAM_DOMAINS: invalid })).toThrow();
      expect(() => loadIntegrationsConfig({ TATAKAI_ALLOWED_STREAM_DOMAINS: invalid })).toThrow();
    }
  });

  it('permits exact configured DNS roots and their descendants while rejecting lookalike suffixes', () => {
    for (const host of ['video.example.org', 'cdn1.video.example.org', 'deep.cdn2.video.example.org', 'images.example.org']) {
      expect(permittedStreamUrl(`https://${host}/master.m3u8`, config()).hostname).toBe(host);
    }
    const resolver = vi.fn(publicDns); const transport = vi.fn(async () => response('#EXTM3U'));
    const gateway = new StreamMediaGateway({ resolver, transport });
    for (const host of ['notvideo.example.org', 'video.example.org.evil.com', 'cdn1.video.example.org.evil.com', 'sub.images.example.org', 'unconfigured.example.org']) {
      expect(() => gateway.issue(config(), 'source', `https://${host}/master.m3u8`, 'hls')).toThrow(expect.objectContaining({ code: 'STREAM_MEDIA_NOT_PERMITTED' }));
    }
    expect(resolver).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });

  it('verifies a real master, variant and segment hosted on different approved subdomains', async () => {
    const transport = vi.fn(async (input: ImageRequest) => {
      expect(input.address).toBe('1.1.1.1');
      if (input.url.hostname === 'entry.video.example.org') return response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://variant.video.example.org/video.m3u8');
      if (input.url.hostname === 'variant.video.example.org') return response('#EXTM3U\n#EXTINF:6,\nhttps://changing.segments.example.net/first.ts\n#EXT-X-ENDLIST');
      expect(input.url.hostname).toBe('changing.segments.example.net'); return response(bytes(), 'video/mp2t');
    });
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport });
    const master = gateway.issue(config(), 'source', 'https://entry.video.example.org/master.m3u8', 'hls');
    await gateway.probe(master);
    const variant = mediaReference((await gateway.media(token(master))).bytes);
    const segment = mediaReference((await gateway.media(token(variant))).bytes);
    expect((await gateway.media(token(segment))).bytes).toEqual(bytes());
    expect(transport.mock.calls.map(([input]) => input.url.hostname)).toEqual(['entry.video.example.org', 'variant.video.example.org', 'changing.segments.example.net']);
  });

  it('refuses malicious HLS descendants before resolving or fetching the new host', async () => {
    for (const child of ['https://notvideo.example.org/first.ts', 'https://video.example.org.evil.com/first.ts', 'https://user:pass@variant.video.example.org/first.ts', 'http://variant.video.example.org/first.ts']) {
      const resolver = vi.fn(publicDns);
      const transport = vi.fn(async () => response(`#EXTM3U\n#EXTINF:6,\n${child}\n#EXT-X-ENDLIST`));
      const gateway = new StreamMediaGateway({ resolver, transport });
      const master = gateway.issue(config(), 'source', 'https://entry.video.example.org/master.m3u8', 'hls');
      await expect(gateway.probe(master)).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
      expect(resolver).toHaveBeenCalledTimes(1); expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects private, mixed, reserved and invalid DNS answers even below an approved root', async () => {
    for (const records of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '10.0.0.1', family: 4 }], [{ address: '1.1.1.1', family: 4 }, { address: '192.168.1.1', family: 4 }], [{ address: '::1', family: 6 }], [{ address: '2001:db8::1', family: 6 }], [{ address: '1.1.1.1', family: 6 }]]) {
      const transport = vi.fn(async () => response('#EXTM3U'));
      const gateway = new StreamMediaGateway({ resolver: async () => records, transport });
      const path = gateway.issue(config(), 'source', 'https://entry.video.example.org/master.m3u8', 'hls');
      await expect(gateway.media(token(path))).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it('invalidates cached media and successful probes after its configured root is revoked', async () => {
    const settings = config();
    const transport = vi.fn(async (input: ImageRequest) => input.url.pathname.endsWith('.m3u8')
      ? response('#EXTM3U\n#EXTINF:6,\nhttps://data.video.example.org/first.ts\n#EXT-X-ENDLIST') : response(bytes(), 'video/mp2t'));
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport });
    const master = gateway.issue(settings, 'source', 'https://entry.video.example.org/master.m3u8', 'hls');
    await gateway.probe(master);
    const segment = mediaReference((await gateway.media(token(master))).bytes);
    await gateway.media(token(segment));
    expect(transport).toHaveBeenCalledTimes(2);
    settings.allowedStreamDomains = [];
    await expect(gateway.media(token(master))).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
    await expect(gateway.media(token(segment))).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
    await expect(gateway.probe(master)).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('revalidates a cached successful probe when only the descendant CDN root is revoked', async () => {
    const settings = config();
    const transport = vi.fn(async (input: ImageRequest) => input.url.pathname.endsWith('.m3u8')
      ? response('#EXTM3U\n#EXTINF:6,\nhttps://data.segments.example.net/first.ts\n#EXT-X-ENDLIST') : response(bytes(), 'video/mp2t'));
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport });
    const master = gateway.issue(settings, 'source', 'https://entry.video.example.org/master.m3u8', 'hls');
    await gateway.probe(master);
    const segment = mediaReference((await gateway.media(token(master))).bytes);
    settings.allowedStreamDomains = ['video.example.org'];
    // The master still has permission, while its previously cached segment no
    // longer does. A cached success must not hide that permission change.
    await expect(gateway.media(token(segment))).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
    await expect(gateway.probe(master)).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('keeps image permissions restricted to configured exact hosts regardless of streaming roots', async () => {
    const transport = vi.fn(async () => response(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg'));
    const resolver = vi.fn(publicDns);
    const images = new ContentImageGateway({ resolver, transport });
    for (const host of ['video.example.org', 'entry.video.example.org', 'changing.segments.example.net', 'sub.images.example.org']) {
      expect(() => images.issue(config(), 'source', `https://${host}/page.jpg`, {})).toThrow(expect.objectContaining({ code: 'CONTENT_IMAGE_NOT_PERMITTED' }));
    }
    expect(resolver).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
    const exact = images.issue(config(), 'source', 'https://images.example.org/page.jpg', {});
    expect((await images.image(token(exact))).contentType).toBe('image/jpeg');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
