import { afterEach, describe, expect, it, vi } from 'vitest';
const id = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const manga = { id, title: 'História', poster: `/api/manga/image/${token}`, authors: [], availableLanguages: ['pt-br'], tags: [], contentRating: 'safe', sourceUrl: `https://mangadex.org/title/${id}` };
describe('manga service image gateway configuration', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
  it('resolves scoped image paths against a separately configured backend', async () => {
    vi.resetModules(); vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.org');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: manga })));
    vi.stubGlobal('fetch', fetcher);
    const { mangaService } = await import('../src/frontend/services/manga');
    const result = await mangaService.details(id);
    expect(String(fetcher.mock.calls[0])).toContain(`https://api.example.org/api/manga/${id}`);
    expect(result.poster).toBe(`https://api.example.org/api/manga/image/${token}`);
  });
  it('accepts only the configured HTTP image gateway when local API uses another origin', async () => {
    vi.resetModules(); vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4000');
    const { isManga } = await import('../src/frontend/services/manga');
    expect(isManga({ ...manga, poster: `http://localhost:4000/api/manga/image/${token}` })).toBe(true);
    expect(isManga({ ...manga, poster: `http://localhost:4001/api/manga/image/${token}` })).toBe(false);
    expect(isManga({ ...manga, poster: `http://localhost:4000/api/manga/image/${token}?url=http://127.0.0.1` })).toBe(false);
  });
  it('rejects untrusted relative paths and executable image protocols', async () => {
    const { isManga } = await import('../src/frontend/services/manga');
    expect(isManga(manga)).toBe(true);
    expect(isManga({ ...manga, poster: '/admin/private-file' })).toBe(false);
    expect(isManga({ ...manga, poster: 'javascript:alert(1)' })).toBe(false);
    expect(isManga({ ...manga, poster: 'http://127.0.0.1/private' })).toBe(false);
  });
});
