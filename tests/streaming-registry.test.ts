import { describe, expect, it, vi } from 'vitest';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry.js';
import type { StreamingAvailability } from '../src/shared/providers.js';

describe('streaming episode indices', () => {
  it('keeps real episodes usable when the initial video check fails and isolates a failed provider', async () => {
    const registry = new StreamingRegistry();
    const metadata = vi.spyOn(registry.subtitles, 'episodeMetadata').mockResolvedValue([]);
    vi.spyOn(registry.toko, 'episodes').mockRejectedValue(new Error('Provider unavailable'));
    vi.spyOn(registry.tatakai, 'episodes').mockResolvedValue({
      available: false, state: 'connection_error', message: 'First video unavailable',
      episodes: [{ id: 'tatakai:20:2', number: 2, title: 'Second' }, { id: 'tatakai:20:1', number: 1, title: 'First' }],
      diagnostics: [{ id: 'tatakai', state: 'connection_error', message: 'First video unavailable' }],
    } as StreamingAvailability);
    const result = await registry.episodes('20', ['Naruto']);
    expect(result.available).toBe(false);
    expect(result.episodes.map(episode => episode.number)).toEqual([1, 2]);
    expect(result.episodes.every(episode => episode.available === undefined)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(metadata).not.toHaveBeenCalled();
  });

  it('retains a real upstream failure when neither provider has an index', async () => {
    const registry = new StreamingRegistry();
    const missing: StreamingAvailability = { available: false, state: 'empty', episodes: [], message: 'This title has no episode index.' };
    vi.spyOn(registry.toko, 'episodes').mockRejectedValue(new Error('Offline'));
    vi.spyOn(registry.tatakai, 'episodes').mockResolvedValue(missing);
    vi.spyOn(registry.subtitles, 'episodeMetadata').mockRejectedValue(new Error('Metadata offline'));
    const result = await registry.episodes('20');
    expect(result.episodes).toEqual([]);
    expect(result.message).toBe(missing.message);
  });

  it('uses identified metadata during a source outage without marking it playable', async () => {
    const registry = new StreamingRegistry();
    const empty: StreamingAvailability = { available: false, state: 'connection_error', episodes: [] };
    vi.spyOn(registry.toko, 'episodes').mockResolvedValue(empty);
    vi.spyOn(registry.tatakai, 'episodes').mockResolvedValue(empty);
    const metadata = [{ id: 'tatakai:14075:7', number: 7, title: 'First Kiss', thumbnail: 'https://image.tmdb.org/t/p/w500/fixture.jpg' }];
    const lookup = vi.spyOn(registry.subtitles, 'episodeMetadata').mockResolvedValue(metadata);
    const playback = vi.spyOn(registry.stremio, 'playback');
    await expect(registry.episodes('14075')).resolves.toMatchObject({ available: false, catalogFallback: true, episodes: metadata });
    expect(lookup).toHaveBeenCalledExactlyOnceWith('14075');
    expect(playback).not.toHaveBeenCalled();
  });
});
