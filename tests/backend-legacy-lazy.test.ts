import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/aniwatch-apis/src/app';
import type { AnimeCatalogProvider } from '../src/shared/providers';

const legacyImport = vi.hoisted(() => vi.fn());
vi.mock('aniwatch', () => {
  legacyImport();
  throw new Error('Optional legacy scraper is absent in this test environment.');
});

const catalog: AnimeCatalogProvider = {
  home: async () => ({ trending: [], popular: [], airing: [], topRated: [], upcoming: [] }),
  search: async () => ({ items: [], page: 1, hasNextPage: false }),
  details: async () => ({ id: '1', title: 'A title', poster: '', genres: [] }),
  genres: async () => [],
};

describe('optional legacy loading', () => {
  it('starts and serves the active API without importing an absent Aniwatch dependency', async () => {
    const app = createApp({ catalog, legacyEnabled: false });
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/api/catalog/home')).status).toBe(200);
    expect((await app.request('/api/streaming/episodes/demo')).status).toBe(200);
    const disabled = await app.request('/api/v2/hianime/home');
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toMatchObject({ error: 'LEGACY_PROVIDER_DISABLED' });
    expect(legacyImport).not.toHaveBeenCalled();
  });

  it('does not load legacy code for health or the removed proxy even when compatibility is enabled', async () => {
    const app = createApp({ catalog, legacyEnabled: true });
    expect((await app.request('/health')).status).toBe(200);
    const proxy = await app.request('/api/v2/hianime/proxy-stream?url=http://127.0.0.1/private');
    expect(proxy.status).toBe(410);
    expect(await proxy.json()).toMatchObject({ error: 'STREAM_PROXY_REMOVED' });
    expect(legacyImport).not.toHaveBeenCalled();
  });

  it('reports the absent optional dependency only when a legacy endpoint is actually requested', async () => {
    const app = createApp({ catalog, legacyEnabled: true });
    const response = await app.request('/api/v2/hianime/home');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'LEGACY_PROVIDER_UNAVAILABLE' });
    expect(legacyImport).toHaveBeenCalledOnce();
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/api/catalog/home')).status).toBe(200);
  });
});
