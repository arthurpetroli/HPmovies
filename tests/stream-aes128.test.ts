import { createCipheriv } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { StreamMediaGateway } from '../src/aniwatch-apis/src/providers/stream-media.js';
import type { TokoConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import type { ImageRequest, ImageResponse } from '../src/aniwatch-apis/src/providers/content-image.js';

const config = (): TokoConfig => ({ enabled: true, contentAuthorized: true, baseUrl: 'http://127.0.0.1:8099', timeoutMs: 8000, retries: 0,
  allowedProviders: ['source'], allowedMediaHosts: ['cdn.example.org', 'keys.example.org'], allowedRequestOrigins: [] });
const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const iv = Buffer.from('00000000000000000000000000000007', 'hex');
const ts = () => { const bytes = Buffer.alloc(188 * 3); bytes[0] = bytes[188] = bytes[376] = 0x47; return bytes; };
const encrypt = (plain = ts(), chosenIv = iv) => { const cipher = createCipheriv('aes-128-cbc', key, chosenIv); return Buffer.concat([cipher.update(plain), cipher.final()]); };
const response = (input: string | Uint8Array, mime = 'application/vnd.apple.mpegurl', status = 200): ImageResponse => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return { status, headers: new Headers({ 'Content-Type': mime, 'Content-Length': String(bytes.length) }), body: (async function* () { yield bytes; })(), cancel: vi.fn() };
};
const token = (path: string) => path.split('/').at(-1)!;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const manifest = (attributes = 'METHOD=AES-128,URI="https://keys.example.org/public.key",IV=0x7') => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:${attributes}\n#EXTINF:6,\nfirst.ts\n#EXT-X-ENDLIST`;
const publicDns = async () => [{ address: '1.1.1.1', family: 4 }];

describe('ordinary identity AES-128 HLS playback', () => {
  it('rewrites a public key into an opaque ticket and verifies real CBC-decrypted TS with an explicit IV', async () => {
    const ciphertext = encrypt();
    const transport = vi.fn(async (input: ImageRequest) => input.url.hostname === 'keys.example.org' ? response(key, 'application/octet-stream')
      : input.url.pathname.endsWith('.m3u8') ? response(manifest()) : response(ciphertext, 'video/mp2t'));
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
    await gateway.probe(path);
    const playlist = decode((await gateway.media(token(path))).bytes);
    expect(playlist).not.toContain('keys.example.org');
    expect(playlist).toContain('IV=0x00000000000000000000000000000007');
    const keyPath = playlist.match(/#EXT-X-KEY:.*URI="([^"]+)"/)?.[1];
    expect(keyPath).toMatch(/^\/api\/streaming\/media\/[0-9a-f-]{36}$/);
    expect((await gateway.media(token(keyPath!))).bytes).toEqual(new Uint8Array(key));
    const segmentPath = playlist.split('\n').find(line => line.startsWith('/api/'))!;
    expect((await gateway.media(token(segmentPath))).bytes).toEqual(new Uint8Array(ciphertext));
    expect(transport).toHaveBeenCalledTimes(3);
    await expect(gateway.media(token(keyPath!), 'bytes=0-15')).rejects.toMatchObject({ status: 416 });
  });

  it('derives the default CBC IV from MEDIA-SEQUENCE and supports the explicit identity format', async () => {
    const transport = vi.fn(async (input: ImageRequest) => input.url.hostname === 'keys.example.org' ? response(key, 'application/octet-stream')
      : input.url.pathname.endsWith('.m3u8') ? response(manifest('METHOD=AES-128,URI="https://keys.example.org/public.key",KEYFORMAT="identity",KEYFORMATVERSIONS="1"')) : response(encrypt(), 'application/octet-stream'));
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport });
    await gateway.probe(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls'));
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('uses media sequence zero when no IV or MEDIA-SEQUENCE tag is supplied', async () => {
    const playlist = manifest('METHOD=AES-128,URI="https://keys.example.org/public.key"').replace('#EXT-X-MEDIA-SEQUENCE:7\n', '');
    const transport = vi.fn(async (input: ImageRequest) => input.url.hostname === 'keys.example.org' ? response(key, 'application/octet-stream')
      : input.url.pathname.endsWith('.m3u8') ? response(playlist) : response(encrypt(ts(), Buffer.alloc(16)), 'video/mp2t'));
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport });
    await gateway.probe(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls'));
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('preserves an explicitly zero IV and expands it to 16 bytes for HLS.js', async () => {
    const transport = vi.fn(async (input: ImageRequest) => input.url.hostname === 'keys.example.org' ? response(key, 'application/octet-stream')
      : input.url.pathname.endsWith('.m3u8') ? response(manifest('METHOD=AES-128,URI="https://keys.example.org/public.key",IV=0x0')) : response(encrypt(ts(), Buffer.alloc(16)), 'video/mp2t'));
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
    await gateway.probe(path);
    expect(decode((await gateway.media(token(path))).bytes)).toContain('IV=0x00000000000000000000000000000000');
  });

  it('refuses an implicit IV beyond the HLS.js 32-bit sequence range while accepting an explicit IV', async () => {
    const implicit = manifest('METHOD=AES-128,URI="https://keys.example.org/public.key"').replace('#EXT-X-MEDIA-SEQUENCE:7', '#EXT-X-MEDIA-SEQUENCE:4294967296');
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport: async () => response(implicit) });
    await expect(gateway.media(token(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls')))).rejects.toMatchObject({ code: 'ENCRYPTED_MEDIA_UNSUPPORTED' });
    const explicit = manifest().replace('#EXT-X-MEDIA-SEQUENCE:7', '#EXT-X-MEDIA-SEQUENCE:4294967296');
    const supported = new StreamMediaGateway({ resolver: publicDns, transport: async input => input.url.hostname === 'keys.example.org' ? response(key, 'application/octet-stream')
      : input.url.pathname.endsWith('.m3u8') ? response(explicit) : response(encrypt(), 'video/mp2t') });
    await supported.probe(supported.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls'));
  });

  it('requires a real decrypted TS segment rather than accepting the key or a plausible playlist', async () => {
    for (const ciphertext of [encrypt(Buffer.from('<html>validly encrypted but not a transport stream</html>')), Buffer.alloc(16), encrypt(ts(), Buffer.alloc(16, 1))]) {
      const gateway = new StreamMediaGateway({ resolver: publicDns, transport: async input => input.url.hostname === 'keys.example.org' ? response(key, 'application/octet-stream')
        : input.url.pathname.endsWith('.m3u8') ? response(manifest()) : response(ciphertext, 'application/octet-stream') });
      await expect(gateway.probe(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls'))).rejects.toMatchObject({ code: 'STREAM_MEDIA_UNAVAILABLE' });
    }
  });

  it('requires exactly 16 binary key bytes and refuses redirects or HTML from the key host', async () => {
    for (const keyResponse of [response(Buffer.alloc(15), 'application/octet-stream'), response(Buffer.alloc(17), 'application/octet-stream'), response(key, 'text/html'), response(key, 'application/octet-stream', 302), response(key, 'application/octet-stream', 403)]) {
      const gateway = new StreamMediaGateway({ resolver: publicDns, transport: async input => input.url.hostname === 'keys.example.org' ? keyResponse
        : input.url.pathname.endsWith('.m3u8') ? response(manifest()) : response(encrypt(), 'application/octet-stream') });
      await expect(gateway.probe(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls'))).rejects.toMatchObject({ code: 'STREAM_MEDIA_UNAVAILABLE' });
      expect(keyResponse.cancel).toHaveBeenCalled();
    }
  });

  it('blocks private key DNS before opening transport and rejects unapproved or authenticated key URLs', async () => {
    const transport = vi.fn(async () => response(manifest()));
    const gateway = new StreamMediaGateway({ resolver: async host => [{ address: host === 'keys.example.org' ? '127.0.0.1' : '1.1.1.1', family: 4 }], transport });
    await expect(gateway.probe(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls'))).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
    expect(transport.mock.calls.length).toBe(1);
    for (const url of ['https://unapproved.example.org/key', 'http://keys.example.org/key', 'https://user:pass@keys.example.org/key']) {
      const constrained = new StreamMediaGateway({ resolver: publicDns, transport: async () => response(manifest(`METHOD=AES-128,URI="${url}"`)) });
      await expect(constrained.media(token(constrained.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls')))).rejects.toMatchObject({ code: 'STREAM_MEDIA_NOT_PERMITTED' });
    }
  });

  it('continues refusing DRM, session keys, incompatible formats, duplicate and malformed attributes', async () => {
    const attributes = ['METHOD=SAMPLE-AES,URI="key"', 'METHOD=AES-128,URI="key",KEYFORMAT="com.apple.streamingkeydelivery"',
      'METHOD=AES-128,URI="key",KEYFORMATVERSIONS="1/2"', 'METHOD=AES-128,URI=key', 'METHOD=AES-128,URI="key",URI="other"',
      'METHOD=AES-128,URI="key",IV=0xg', 'METHOD=AES-128,URI="key",IV=0x100000000000000000000000000000000', 'METHOD=NONE,URI="key"'];
    for (const attributesLine of attributes) {
      const gateway = new StreamMediaGateway({ resolver: publicDns, transport: async () => response(manifest(attributesLine)) });
      await expect(gateway.media(token(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls')))).rejects.toMatchObject({ code: 'ENCRYPTED_MEDIA_UNSUPPORTED' });
    }
    for (const playlist of [manifest().replace('#EXT-X-KEY:', '#EXT-X-SESSION-KEY:'), manifest().replace('#EXTINF:6,', '#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,'), manifest().replace('#EXTINF:6,', '#EXT-X-BYTERANGE:100@0\n#EXTINF:6,')]) {
      const gateway = new StreamMediaGateway({ resolver: publicDns, transport: async () => response(playlist) });
      await expect(gateway.media(token(gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls')))).rejects.toMatchObject({ code: 'ENCRYPTED_MEDIA_UNSUPPORTED' });
    }
  });

  it('handles METHOD=NONE after an encrypted segment without treating later plaintext as ciphertext', async () => {
    const playlist = manifest().replace('#EXT-X-ENDLIST', '#EXT-X-KEY:METHOD=NONE\n#EXTINF:6,\nplain.ts\n#EXT-X-ENDLIST');
    const gateway = new StreamMediaGateway({ resolver: publicDns, transport: async input => input.url.hostname === 'keys.example.org' ? response(key, 'application/octet-stream')
      : input.url.pathname.endsWith('.m3u8') ? response(playlist) : response(input.url.pathname === '/plain.ts' ? ts() : encrypt(), 'application/octet-stream') });
    const path = gateway.issue(config(), 'source', 'https://cdn.example.org/master.m3u8', 'hls');
    await gateway.probe(path);
    const plainPath = decode((await gateway.media(token(path))).bytes).split('\n').filter(line => line.startsWith('/api/'))[1];
    expect((await gateway.media(token(plainPath))).bytes).toEqual(new Uint8Array(ts()));
  });
});
