import { describe, expect, it, vi } from 'vitest';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import { TokoHttpClient } from '../src/aniwatch-apis/src/providers/toko-http.js';
import { TokoStreamingProvider } from '../src/aniwatch-apis/src/providers/toko.js';

const settings = () => loadIntegrationsConfig({
  TOKO_ENABLED: 'true', TOKO_API_URL: 'http://127.0.0.1:8099',
  TOKO_CONTENT_AUTHORIZED: 'true', TOKO_ALLOWED_PROVIDERS: 'permitted',
  TOKO_ALLOWED_STREAM_DOMAINS: 'media.example.org', TOKO_RETRIES: '0',
}).toko;
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const episodeIndex = { provider: 'permitted', episodeCount: 2, episodes: [{ number: 1, title: 'Primeiro' }, { number: 2 }] };
const source = (url: string) => ({
  url, type: 'hls', providerKey: 'permitted', providerName: 'Permitted', audioLanguage: 'ja',
  subtitles: [{ url: 'https://captions.media.example.org/pt-br.vtt', label: 'Português (Brasil)', language: 'pt-br' }],
});

function fixture(mediaUrl = 'https://rotating.media.example.org/episode.m3u8') {
  const config = settings();
  const fetcher = vi.fn(async (raw: string) => {
    const path = new URL(raw).pathname;
    if (path === '/api/v3/health') return json({ ok: true, toko: true, service: 'toko-api' });
    if (path === '/api/v3/toko/index/episodes') return json(episodeIndex);
    if (path === '/api/v3/toko/stream') return json({ sources: [source(mediaUrl)] });
    throw new Error(`Unexpected fixture endpoint ${path}`);
  });
  const client = new TokoHttpClient(config, { fetcher: fetcher as typeof fetch });
  const probe = vi.fn(async () => {});
  return { config, fetcher, client, probe, provider: new TokoStreamingProvider({ client, probe }) };
}

describe('Toko streaming with only an approved DNS domain', () => {
  it('uses the HTTP client and scoped media normalization without requiring an exact host', async () => {
    const { config, fetcher, probe, provider } = fixture();
    expect(config.allowedMediaHosts).toEqual([]);
    expect(config.allowedStreamDomains).toEqual(['media.example.org']);
    expect(await provider.episodes('20', ['Naruto'])).toMatchObject({
      available: true, state: 'available', episodes: [{ id: 'toko:20:1', available: true }, { id: 'toko:20:2' }],
    });
    const playback = await provider.playback('toko:20:1', ['Naruto']);
    expect(playback).toMatchObject({ isDemo: false, nextEpisodeId: 'toko:20:2' });
    expect(playback.sources).toHaveLength(1);
    expect(playback.sources[0]).toMatchObject({ providerId: 'permitted', type: 'hls', audioLanguage: 'ja' });
    expect(playback.sources[0].url).toMatch(/^\/api\/streaming\/media\/[0-9a-f-]{36}$/);
    expect(playback.subtitles).toMatchObject([{ language: 'pt-BR', url: 'https://captions.media.example.org/pt-br.vtt' }]);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const request = fetcher.mock.calls.map(([raw]) => new URL(raw)).find(url => url.pathname.endsWith('/stream'))!;
    expect(request.searchParams.get('anilistId')).toBe('20');
    expect(request.searchParams.get('episode')).toBe('1');
    expect(request.searchParams.getAll('titles[]')).toEqual(['Naruto']);
  });

  it.each(['notmedia.example.org', 'media.example.org.evil.com'])('rejects a source at the lookalike host %s before probing', async host => {
    const { fetcher, probe, provider } = fixture(`https://${host}/episode.m3u8`);
    await expect(provider.playback('toko:20:1')).rejects.toMatchObject({ code: 'TOKO_UNAUTHORIZED' });
    expect(fetcher.mock.calls.some(([raw]) => new URL(raw).pathname.endsWith('/stream'))).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it('still requires an exact host or a streaming domain before requesting sources', () => {
    const fetcher = vi.fn();
    const client = new TokoHttpClient({ ...settings(), allowedStreamDomains: [] }, { fetcher });
    expect(() => client.streams(20, 1)).toThrow(expect.objectContaining({ code: 'TOKO_UNAUTHORIZED' }));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
