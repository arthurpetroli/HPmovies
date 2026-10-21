import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamingService } from '../src/frontend/services/streaming';

const playback = {
  episode: { id: 'demo', title: 'Demonstrativo' }, isDemo: true,
  sources: [{ url: 'https://example.com/video.m3u8', type: 'hls' }],
  subtitles: [{ id: 'pt', url: '/demo-pt-BR.vtt', language: 'pt-BR', label: 'Guia' }],
  audioLanguages: [],
};

describe('streaming contracts', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    { ...playback, sources: [null] },
    { ...playback, subtitles: [null] },
    { ...playback, audioLanguages: null },
    { ...playback, subtitles: [{ url: '/captions.vtt', language: 'pt-BR', label: 'Guia' }] },
  ])('rejects malformed provider data with a contract error', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }))));
    await expect(streamingService.playback('demo')).rejects.toThrow('dados inesperados');
  });
  it('rejects a null episode instead of presenting a connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { available: true, episodes: [null] } }))));
    await expect(streamingService.episodes('1')).rejects.toThrow('dados inesperados');
  });
});
