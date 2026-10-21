import { describe, expect, it, vi } from 'vitest';
import { ContentImageGateway, publicImageAddress, type ImageRequest, type ImageResponse } from '../src/aniwatch-apis/src/providers/content-image.js';
import type { TokoConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import { createApp } from '../src/aniwatch-apis/src/app.js';
import { ContentRegistry } from '../src/aniwatch-apis/src/providers/content-registry.js';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry.js';

const config = (): TokoConfig => ({
  enabled: true, baseUrl: 'http://127.0.0.1:8099', timeoutMs: 8000, retries: 0,
  contentAuthorized: true, allowedProviders: ['webtoons'], allowedMediaHosts: ['webtoon-phinf.pstatic.net'],
  allowedRequestOrigins: ['https://www.webtoons.com'],
});
const source = 'https://webtoon-phinf.pstatic.net/public/chapter-1.jpg';
const publicDns = vi.fn(async () => [{ address: '1.1.1.1', family: 4 }]);
const response = (status = 200, mime = 'image/jpeg', bytes = new Uint8Array([255, 216, 255]), contentLength?: number): ImageResponse => ({
  status, headers: new Headers({ 'Content-Type': mime, ...(contentLength === undefined ? {} : { 'Content-Length': String(contentLength) }) }),
  body: (async function* () { yield bytes; })(), cancel: vi.fn(),
});
const token = (path: string) => path.split('/').at(-1)!;

describe('scoped content image gateway', () => {
  it('issues an opaque ticket and sends only permitted source headers to the pinned public address', async () => {
    const transport = vi.fn(async (input: ImageRequest) => { expect(input.signal.aborted).toBe(false); return response(); });
    const gateway = new ContentImageGateway({ resolver: publicDns, transport });
    const path = gateway.issue(config(), 'webtoons', source, { Referer: 'https://www.webtoons.com/' });
    expect(path).toMatch(/^\/api\/content\/image\/[0-9a-f-]{36}$/);
    expect(path).not.toContain('pstatic');
    const image = await gateway.image(token(path));
    expect(image.contentType).toBe('image/jpeg');
    expect(image.bytes).toEqual(new Uint8Array([255, 216, 255]));
    const request = transport.mock.calls[0][0];
    expect(request.url.hostname).toBe('webtoon-phinf.pstatic.net');
    expect(request.address).toBe('1.1.1.1'); expect(request.family).toBe(4);
    expect(request.headers.referer).toBe('https://www.webtoons.com/');
    expect(request.headers.Cookie).toBeUndefined(); expect(request.headers.Authorization).toBeUndefined();
    await gateway.image(token(path));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(gateway.issue(config(), 'webtoons', source, { Referer: 'https://www.webtoons.com/' })).toBe(path);
  });

  it('rejects arbitrary URLs, credentials, other providers and any unapproved access header', () => {
    const gateway = new ContentImageGateway();
    for (const url of ['http://webtoon-phinf.pstatic.net/a.jpg', 'https://evil.example/a.jpg', 'https://webtoon-phinf.pstatic.net.evil.example/a.jpg', 'https://127.0.0.1/a.jpg', 'https://user:pass@webtoon-phinf.pstatic.net/a.jpg', 'https://webtoon-phinf.pstatic.net:444/a.jpg']) {
      expect(() => gateway.issue(config(), 'webtoons', url, {})).toThrow();
    }
    for (const headers of [{ Cookie: 'x=1' }, { Authorization: 'Bearer x' }, { 'User-Agent': 'source' }, { Referer: 'https://evil.example/' }, { Origin: 'https://www.webtoons.com/' }, { Referer: 'https://www.webtoons.com/\r\nCookie:x' }, { Referer: 'https://www.webtoons.com/', referer: 'https://www.webtoons.com/' }]) {
      expect(() => gateway.issue(config(), 'webtoons', source, headers)).toThrow();
    }
    expect(() => gateway.issue(config(), 'other', source, {})).toThrow();
    expect(() => gateway.issue({ ...config(), contentAuthorized: false }, 'webtoons', source, {})).toThrow();
  });

  it('rejects absent and expired tickets without fetching and honors revoked configuration', async () => {
    const transport = vi.fn(async () => response());
    const gateway = new ContentImageGateway({ resolver: publicDns, transport });
    await expect(gateway.image(source)).rejects.toMatchObject({ status: 404 });
    await expect(gateway.image('bc5be985-40df-46aa-afb0-ac9524c44d4a')).rejects.toMatchObject({ status: 404 });
    const settings = config(); const path = gateway.issue(settings, 'webtoons', source, {});
    settings.contentAuthorized = false;
    await expect(gateway.image(token(path))).rejects.toMatchObject({ code: 'CONTENT_IMAGE_NOT_PERMITTED' });
    expect(transport).not.toHaveBeenCalled();
    settings.contentAuthorized = true;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    await expect(gateway.image(token(path))).rejects.toMatchObject({ status: 404 });
    clock.mockRestore();
  });

  it('blocks private, reserved and mixed DNS records before opening a TLS connection', async () => {
    for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }], [{ address: '::ffff:127.0.0.1', family: 6 }]]) {
      const transport = vi.fn(async () => response());
      const gateway = new ContentImageGateway({ resolver: async () => addresses, transport });
      const path = gateway.issue(config(), 'webtoons', source, {});
      await expect(gateway.image(token(path))).rejects.toMatchObject({ code: 'CONTENT_IMAGE_NOT_PERMITTED' });
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it('accepts current public IPv4/IPv6 and rejects local, mapped, transition and documentation ranges', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(publicImageAddress(address), address).toBe(true);
    for (const address of ['0.1.2.3', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.2.1', '172.31.3.1', '192.168.0.1', '192.0.2.1', '198.51.100.4', '198.18.0.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '2001:db8::1', '2001::1', '2001:20::1', '2002::1', '3fff::1']) expect(publicImageAddress(address), address).toBe(false);
  });

  it('rejects redirects, challenges, unsupported types and oversized images without following them', async () => {
    for (const upstream of [response(302), response(403, 'text/html'), response(200, 'image/svg+xml'), response(200, 'image/jpeg', new Uint8Array([1]), 12_000_001), response(200, 'image/jpeg', new Uint8Array(12_000_001))]) {
      const gateway = new ContentImageGateway({ resolver: publicDns, transport: async () => upstream });
      const path = gateway.issue(config(), 'webtoons', source, {});
      await expect(gateway.image(token(path))).rejects.toMatchObject({ status: 502 });
      expect(upstream.cancel).toHaveBeenCalledTimes(1);
    }
  });

  it('deduplicates simultaneous page requests and applies a bounded network deadline', async () => {
    let complete!: (value: ImageResponse) => void;
    const transport = vi.fn(() => new Promise<ImageResponse>(resolve => { complete = resolve; }));
    const gateway = new ContentImageGateway({ resolver: publicDns, transport });
    const path = gateway.issue(config(), 'webtoons', source, {});
    const first = gateway.image(token(path)); const second = gateway.image(token(path));
    expect(first).toBe(second);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    complete(response()); await first;
    const stalled = new ContentImageGateway({ resolver: () => new Promise(() => undefined), timeoutMs: 5 });
    await expect(stalled.image(token(stalled.issue(config(), 'webtoons', source, {})))).rejects.toMatchObject({ status: 504 });
  });

  it('limits simultaneous image downloads', async () => {
    const gateway = new ContentImageGateway({ resolver: publicDns, transport: () => new Promise(() => undefined), timeoutMs: 10 });
    const images = Array.from({ length: 8 }, (_, index) => gateway.image(token(gateway.issue(config(), 'webtoons', `${source}?page=${index}`, {}))).catch(error => error));
    await expect(gateway.image(token(gateway.issue(config(), 'webtoons', `${source}?page=9`, {})))).rejects.toMatchObject({ code: 'CONTENT_IMAGES_BUSY' });
    await Promise.all(images);
  });

  it('serves opaque tickets with image security headers and rejects caller supplied URL parameters', async () => {
    const gateway = new ContentImageGateway({ resolver: publicDns, transport: async () => response() });
    const registry = new StreamingRegistry(); const content = new ContentRegistry(registry, [], gateway);
    const app = createApp({ registry, content });
    const path = gateway.issue(config(), 'webtoons', source, { Referer: 'https://www.webtoons.com/' });
    const result = await app.request(path);
    expect(result.status).toBe(200); expect(result.headers.get('content-type')).toBe('image/jpeg');
    expect(result.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
    const arbitrary = await app.request('/api/content/image/https%3A%2F%2F127.0.0.1%2Fsecret');
    expect(arbitrary.status).toBe(404);
  });

  it('loads only exact configured HTTPS request origins', () => {
    const loaded = loadIntegrationsConfig({ TATAKAI_ALLOWED_REQUEST_ORIGINS: 'https://www.webtoons.com/', TOKO_ALLOWED_REQUEST_ORIGINS: 'https://www.webtoons.com' });
    expect(loaded.tatakai.allowedRequestOrigins).toEqual(['https://www.webtoons.com']);
    expect(loaded.toko.allowedRequestOrigins).toEqual(['https://www.webtoons.com']);
    for (const origin of ['http://www.webtoons.com', 'https://www.webtoons.com/read', 'https://a:b@www.webtoons.com', 'https://www.webtoons.com:444', 'https://*.webtoons.com', 'https://127.0.0.1']) {
      expect(() => loadIntegrationsConfig({ TATAKAI_ALLOWED_REQUEST_ORIGINS: origin })).toThrow();
    }
  });
});
