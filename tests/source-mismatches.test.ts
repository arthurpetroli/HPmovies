import { describe, expect, it, vi } from 'vitest';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations.js';
import { isKnownSourceMismatch } from '../src/aniwatch-apis/src/providers/source-mismatches.js';
import { TokoHttpClient, type TokoStream } from '../src/aniwatch-apis/src/providers/toko-http.js';
import { TokoStreamingProvider } from '../src/aniwatch-apis/src/providers/toko.js';

const mismatch = { anilistId: 101922, episode: 1, providerId: 'nebula', audioLanguage: 'en', type: 'hls' };
const stream = (providerKey = 'nebula', audioLanguage = 'en', type = 'hls'): TokoStream => ({
  url: `https://${providerKey}.media.example.org/episode.${type === 'hls' ? 'm3u8' : 'mp4'}`,
  providerKey, providerName: providerKey, audioLanguage, type, requiresHeaders: false, subtitles: [],
});

function fixture(sources: TokoStream[]) {
  const config = loadIntegrationsConfig({
    TOKO_ENABLED: 'true', TOKO_API_URL: 'http://127.0.0.1:8099', TOKO_RETRIES: '0',
    TOKO_CONTENT_AUTHORIZED: 'true', TOKO_ALLOWED_PROVIDERS: 'nebula,anizone',
    TOKO_ALLOWED_STREAM_DOMAINS: 'media.example.org',
  }).toko;
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const fetcher = vi.fn(async (raw: string) => {
    const path = new URL(raw).pathname;
    if (path === '/api/v3/health') return json({ ok: true, toko: true, service: 'toko-api' });
    if (path === '/api/v3/toko/index/episodes') return json({ provider: 'nebula', episodeCount: 2, episodes: [{ number: 1 }, { number: 2 }] });
    if (path === '/api/v3/toko/stream') return json({ sources });
    throw new Error(`Unexpected fixture endpoint ${path}`);
  });
  const probe = vi.fn(async () => {});
  const client = new TokoHttpClient(config, { fetcher: fetcher as typeof fetch });
  return { probe, provider: new TokoStreamingProvider({ client, probe }) };
}

describe('known source mapping mismatch', () => {
  it('matches only the confirmed title, episode, provider, audio language and media type', () => {
    expect(isKnownSourceMismatch(mismatch)).toBe(true);
    for (const other of [
      { anilistId: 20 }, { episode: 2 }, { providerId: 'anizone' },
      { audioLanguage: 'ja' }, { audioLanguage: 'pt-BR' }, { audioLanguage: 'und' }, { type: 'mp4' },
    ]) expect(isKnownSourceMismatch({ ...mismatch, ...other })).toBe(false);
  });

  it('excludes the wrong Nebula film before probing and retains the AniZone episode', async () => {
    const { provider, probe } = fixture([stream(), stream('anizone', 'ja')]);
    const playback = await provider.playback('toko:101922:1');
    expect(playback.sources).toHaveLength(1);
    expect(playback.sources[0]).toMatchObject({ providerId: 'anizone', audioLanguage: 'ja', type: 'hls' });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'anizone' }), expect.any(AbortSignal));
    expect(playback.audioLanguages).toEqual(['ja']);
  });

  it.each([
    ['another title', 'toko:20:1', 'en', 'hls'],
    ['another episode', 'toko:101922:2', 'en', 'hls'],
    ['Japanese audio', 'toko:101922:1', 'ja', 'hls'],
    ['unknown audio', 'toko:101922:1', 'und', 'hls'],
    ['MP4 media', 'toko:101922:1', 'en', 'mp4'],
  ])('keeps Nebula results for %s', async (_label, episodeId, audioLanguage, type) => {
    const { provider, probe } = fixture([stream('nebula', audioLanguage, type)]);
    const playback = await provider.playback(episodeId);
    expect(playback.sources).toHaveLength(1);
    expect(playback.sources[0]).toMatchObject({ providerId: 'nebula', audioLanguage, type });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('reports no media when only known wrong results remain without probing them', async () => {
    const { provider, probe } = fixture([stream()]);
    await expect(provider.playback('toko:101922:1')).rejects.toMatchObject({ code: 'EPISODE_UNAVAILABLE', status: 404 });
    expect(probe).not.toHaveBeenCalled();
  });
});
