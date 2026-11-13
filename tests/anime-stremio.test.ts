import { describe, expect, it, vi } from 'vitest';
import { AnimeStremioProvider, mergeAnimePlaybacks } from '../src/aniwatch-apis/src/providers/anime-stremio';
import { StremioStreamingProvider } from '../src/aniwatch-apis/src/providers/stremio';
import { PortugueseSubtitleProvider } from '../src/aniwatch-apis/src/providers/portuguese-subtitles';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry';
import { ApiError } from '../src/aniwatch-apis/src/config/apiError';
import type { Playback, StreamSubtitle } from '../src/shared/providers';
import type { EpisodeIdentity } from '../src/aniwatch-apis/src/providers/portuguese-subtitles';

// Synthetic source contracts. They never contact an addon or real media host.
const caption = (id: string): StreamSubtitle => ({ id, url: `https://subtitles.example.com/${id}.vtt`, label: id, language: 'pt-BR', kind: 'subtitles' });
const playback = (name = 'legacy'): Playback => ({ episode: { id: 'tatakai:42:13', number: 13, title: 'Episódio QA', thumbnail: 'https://images.example.com/qa.jpg', available: true },
  sources: [{ url: `https://media.example.com/${name}.m3u8`, type: 'hls', providerId: name, label: name }],
  subtitles: [caption(name)], audioLanguages: ['ja'], isDemo: false, nextEpisodeId: 'tatakai:42:14' });
const remote = (): Playback => ({ ...playback('fmhy'), episode: { id: 'stremio:all:tt1234567:2:1', number: 1, title: 'IMDb episode' }, nextEpisodeId: undefined,
  sources: [{ url: 'https://media.example.com/fmhy.m3u8', type: 'hls', providerId: 'fmhy', label: 'BingeBang · Aldebaran', subtitles: [] }], subtitles: [], audioLanguages: ['en'] });

function adapter(identity: EpisodeIdentity | undefined = { imdb: 'tt1234567', kind: 'series', season: 2, episode: 1 }) {
  const resolved = vi.fn(async () => identity);
  const stremio = { hasConfiguredAddons: vi.fn(() => true), playback: vi.fn(async () => remote()) };
  return { provider: new AnimeStremioProvider({ stremio, identity: resolved }), stremio, resolved };
}

function registry() {
  const stremio = new StremioStreamingProvider({ addons: [{ id: 'fmhy', name: 'QA addon', manifestUrl: 'https://addon.example.com/manifest.json', authorized: true, allowedMediaHosts: ['media.example.com'] }] });
  const subtitles = new PortugueseSubtitleProvider({ enabled: false });
  const identity = vi.spyOn(subtitles, 'resolveIdentity').mockResolvedValue({ imdb: 'tt1234567', kind: 'series', season: 2, episode: 1 });
  const source = vi.spyOn(stremio, 'playback').mockResolvedValue(remote());
  const value = new StreamingRegistry({ stremio, subtitles });
  const tatakai = vi.spyOn(value.tatakai, 'playback').mockResolvedValue(playback());
  const toko = vi.spyOn(value.toko, 'playback').mockRejectedValue(new ApiError(404, 'EPISODE_UNAVAILABLE', 'QA source missing'));
  return { value, source, identity, tatakai, toko };
}

describe('safe AniList to Stremio video adaptation', () => {
  it('uses the explicit mapped season and episode while keeping the AniList playback identity', async () => {
    const { provider, stremio, resolved } = adapter();
    const result = await provider.resolve('42', 13, 'tatakai:42:13');
    expect(resolved).toHaveBeenCalledWith('42', 13);
    expect(stremio.playback).toHaveBeenCalledWith({ imdbId: 'tt1234567', season: 2, episode: 1 });
    expect(result.playback?.episode).toMatchObject({ id: 'tatakai:42:13', number: 13, title: 'Episódio 13' });
    expect(result.playback?.sources[0].label).toContain('Aldebaran');
  });

  it('requests movie streams only for a mapped movie first episode', async () => {
    const { provider, stremio } = adapter({ imdb: 'tt1234567', kind: 'movie' });
    expect((await provider.resolve('42', 1, 'toko:42:1')).playback?.episode.id).toBe('toko:42:1');
    expect(stremio.playback).toHaveBeenCalledWith({ type: 'movie', imdbId: 'tt1234567' });
    expect((await provider.resolve('42', 2, 'toko:42:2')).diagnostic?.state).toBe('unavailable');
    expect(stremio.playback).toHaveBeenCalledTimes(1);
  });

  it('skips mappings and all network work when no addon is configured', async () => {
    const { provider, stremio, resolved } = adapter();
    stremio.hasConfiguredAddons.mockReturnValue(false);
    expect(await provider.resolve('42', 1, 'tatakai:42:1')).toEqual({});
    expect(resolved).not.toHaveBeenCalled();
    expect(stremio.playback).not.toHaveBeenCalled();
  });

  it('does not guess a missing, fractional or invalid IMDb episode identity', async () => {
    const missing = adapter(undefined);
    missing.resolved.mockResolvedValue(undefined);
    expect((await missing.provider.resolve('42', 13, 'tatakai:42:13')).diagnostic?.state).toBe('unavailable');
    expect(missing.stremio.playback).not.toHaveBeenCalled();
    const fractional = adapter();
    expect((await fractional.provider.resolve('42', 0.5, 'tatakai:42:0.5')).diagnostic?.state).toBe('unavailable');
    expect(fractional.resolved).not.toHaveBeenCalled();
    for (const identity of [{ imdb: 'tt1234567', kind: 'series', season: -1, episode: 1 }, { imdb: '42', kind: 'movie' }] as EpisodeIdentity[]) {
      const result = adapter(identity);
      expect((await result.provider.resolve('42', 1, 'tatakai:42:1')).diagnostic?.state).toBe('unavailable');
      expect(result.stremio.playback).not.toHaveBeenCalled();
    }
  });

  it('returns a scoped failure instead of leaking mapping or addon errors', async () => {
    const mapping = adapter();
    mapping.resolved.mockRejectedValue(new Error('private upstream URL'));
    const failed = await mapping.provider.resolve('42', 13, 'tatakai:42:13');
    expect(failed).toMatchObject({ diagnostic: { state: 'connection_error' }, error: { code: 'STREMIO_ANIME_MAPPING_UNAVAILABLE' } });
    expect(failed.diagnostic?.message).not.toContain('private');
    expect(mapping.stremio.playback).not.toHaveBeenCalled();
    const addon = adapter();
    addon.stremio.playback.mockRejectedValue(new ApiError(503, 'STREMIO_UNAUTHORIZED', 'QA addon permission required'));
    expect(await addon.provider.resolve('42', 13, 'tatakai:42:13')).toMatchObject({ diagnostic: { state: 'unauthorized' } });
  });

  it('never treats an empty or demo addon result as additional anime media', async () => {
    for (const result of [{ ...remote(), sources: [] }, { ...remote(), isDemo: true }]) {
      const { provider, stremio } = adapter(); stremio.playback.mockResolvedValue(result);
      expect((await provider.resolve('42', 13, 'tatakai:42:13')).playback).toBeUndefined();
    }
  });
});

describe('anime sources inside the existing registry/player path', () => {
  it('adds Stremio to the existing anime player while preserving legacy metadata and scoped captions', async () => {
    const { value, source, identity } = registry();
    const result = await value.playback('tatakai:42:13', ['Anime QA']);
    expect(result.episode).toEqual(playback().episode);
    expect(result.nextEpisodeId).toBe('tatakai:42:14');
    expect(result.sources.map(item => item.providerId)).toEqual(['legacy', 'fmhy']);
    expect(result.sources[0].subtitles).toEqual([caption('legacy')]);
    expect(result.sources[1].subtitles).toEqual([]);
    expect(result.audioLanguages).toEqual(['ja', 'en']);
    expect(identity).toHaveBeenCalledWith('42', 13);
    expect(source).toHaveBeenCalledWith({ imdbId: 'tt1234567', season: 2, episode: 1 });
  });

  it('isolates mapping and addon failures without discarding playable legacy sources', async () => {
    const mapped = registry(); mapped.identity.mockRejectedValue(new Error('QA mapping unavailable'));
    const first = await mapped.value.playback('tatakai:42:13');
    expect(first.sources).toHaveLength(1);
    expect(first.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'stremio-anime', state: 'connection_error' })]));
    const addon = registry(); addon.source.mockRejectedValue(new ApiError(504, 'STREMIO_TIMEOUT', 'QA timeout'));
    expect((await addon.value.playback('tatakai:42:13')).sources).toHaveLength(1);
  });

  it('rescues a failed legacy episode with safely mapped Stremio media and the same player route', async () => {
    const { value, tatakai } = registry(); tatakai.mockRejectedValue(new ApiError(502, 'STREAM_MEDIA_UNAVAILABLE', 'QA failed media'));
    const result = await value.playback('tatakai:42:13');
    expect(result.episode).toMatchObject({ id: 'tatakai:42:13', number: 13 });
    expect(result.sources.map(item => item.providerId)).toEqual(['fmhy']);
    expect(result.isDemo).toBe(false);
  });

  it('starts the independent source lookups together and merges all successful providers', async () => {
    const { value, tatakai, toko, identity } = registry();
    let finish!: (value: Playback) => void;
    tatakai.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    toko.mockResolvedValue(playback('toko'));
    const pending = value.resolve('42', 13, undefined, ['Anime QA']);
    await vi.waitFor(() => expect(identity).toHaveBeenCalled());
    expect(toko).toHaveBeenCalled();
    finish(playback());
    const result = await pending;
    expect(result.sources.map(item => item.providerId)).toEqual(['legacy', 'toko', 'fmhy']);
    expect(result.episode.id).toBe('tatakai:42:13');
  });

  it('respects an explicitly selected content source and keeps fractional legacy episodes valid', async () => {
    const { value, source, identity, toko, tatakai } = registry();
    toko.mockResolvedValue(playback('toko'));
    expect((await value.resolve('42', 13, 'toko')).sources.map(item => item.providerId)).toEqual(['toko']);
    expect(source).not.toHaveBeenCalled(); expect(identity).not.toHaveBeenCalled(); expect(tatakai).not.toHaveBeenCalled();
    await value.playback('tatakai:42:0.5');
    expect(tatakai).toHaveBeenCalledWith('tatakai:42:0.5', undefined);
    expect(source).not.toHaveBeenCalled();
  });

  it('deduplicates identical video URLs without assigning one mirror captions to another', () => {
    const first = playback();
    const second = { ...playback('other'), sources: [...first.sources, { url: 'https://media.example.com/other.mp4', type: 'mp4' as const }], subtitles: [caption('other')] };
    const merged = mergeAnimePlaybacks([first, second]);
    expect(merged.sources).toHaveLength(2);
    expect(merged.sources[0].subtitles).toEqual([caption('legacy'), caption('other')]);
    expect(merged.sources[1].subtitles).toEqual([]);
  });
});
