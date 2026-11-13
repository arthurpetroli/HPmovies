import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/aniwatch-apis/src/app';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry';
import { ApiError } from '../src/aniwatch-apis/src/config/apiError';

describe('on-demand subtitle search HTTP contract', () => {
  it('passes the exact playback identity and language without downloading a file', async () => {
    const registry = new StreamingRegistry();
    const search = vi.spyOn(registry.subtitles, 'search').mockResolvedValue({
      episodeId: 'tatakai:16498:1', language: 'pt-BR', languages: [{ id: 'pt-BR', label: 'Português (Brasil)' }],
      subtitles: [{ id: 'opensubtitles-123', url: '/api/subtitles/file/opaque-qa', language: 'pt-BR', label: 'Release QA', release: 'Release QA',
        format: 'vtt', sourceFormat: 'srt', provider: 'opensubtitles', downloads: 123 }],
    });
    const file = vi.spyOn(registry.subtitles, 'file');
    const app = createApp({ registry });
    const response = await app.request('/api/subtitles/search/tatakai%3A16498%3A1?language=pt-BR');
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith('tatakai:16498:1', 'pt-BR');
    expect((await response.json()).data.subtitles[0]).toMatchObject({ downloads: 123, sourceFormat: 'srt' });
    expect(file).not.toHaveBeenCalled();
  });

  it('rejects ambiguous filters before invoking the source', async () => {
    const registry = new StreamingRegistry();
    const search = vi.spyOn(registry.subtitles, 'search');
    const app = createApp({ registry });
    for (const query of ['language=pt-BR&language=en', 'url=https://private.invalid/file', 'provider=arbitrary']) {
      expect((await app.request(`/api/subtitles/search/stremio:all:movie:tt0133093?${query}`)).status).toBe(400);
    }
    expect(search).not.toHaveBeenCalled();
  });

  it('keeps a source failure specific to subtitles', async () => {
    const registry = new StreamingRegistry();
    vi.spyOn(registry.subtitles, 'search').mockRejectedValue(new ApiError(503, 'SUBTITLE_UNAVAILABLE', 'A busca de legendas está indisponível.'));
    const response = await createApp({ registry }).request('/api/subtitles/search/stremio:all:movie:tt0133093');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'SUBTITLE_UNAVAILABLE', message: 'A busca de legendas está indisponível.' });
  });
});
