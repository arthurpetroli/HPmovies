import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error The diagnostic is a standalone Node.js executable.
import { probeHttp, summarizeCatalog } from '../scripts/diagnose-aniwatch.mjs';

describe('legacy Aniwatch diagnosis', () => {
  it('requires actual anime metadata instead of accepting an empty or unrelated successful response', () => {
    expect(summarizeCatalog({ data: { data: { trendingAnimes: [{ id: 'bebop-27', name: 'Cowboy Bebop' }] } } }))
      .toEqual({ valid: true, count: 1 });
    expect(summarizeCatalog({ data: { spotlightAnimes: [], trendingAnimes: [] } }).valid).toBe(false);
    expect(summarizeCatalog({ data: { trendingAnimes: [null, { id: '1' }, { name: 'Missing ID' }] } }).valid).toBe(false);
    expect(summarizeCatalog('<html>unrelated site</html>').valid).toBe(false);
  });

  it('distinguishes an inactive hosting service from a valid catalog', async () => {
    const fetcher = vi.fn(async () => new Response('<title>404: No active service</title>', { status: 404 }));
    const report = await probeHttp('https://example.com/home', { fetcher });
    expect(report).toMatchObject({ ok: false, status: 404, classification: 'service-inactive', catalog: { valid: false } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports access restrictions without retrying or substituting another host', async () => {
    const fetcher = vi.fn(async () => new Response('Access denied', { status: 403 }));
    expect(await probeHttp('https://example.com/home', { fetcher }))
      .toMatchObject({ ok: false, classification: 'access-restricted' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports network timeout separately from upstream status codes', async () => {
    const fetcher = vi.fn(async () => { throw new DOMException('Timed out', 'TimeoutError'); });
    expect(await probeHttp('https://example.com/home', { fetcher }))
      .toMatchObject({ ok: false, classification: 'timeout' });
  });

  it.each([
    ['LEGACY_PROVIDER_DISABLED', 'legacy-disabled'],
    ['ANIWATCH_UPSTREAM_UNAVAILABLE', 'upstream-unavailable'],
  ])('distinguishes local configuration from provider failure (%s)', async (error, classification) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error }), { status: 503 }));
    expect(await probeHttp('http://127.0.0.1:4000/home', { fetcher }))
      .toMatchObject({ ok: false, status: 503, classification, catalog: { valid: false } });
  });
});
