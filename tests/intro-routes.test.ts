import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/aniwatch-apis/src/app';
import { IntroSkipProvider } from '../src/aniwatch-apis/src/providers/intro-skips';

describe('opening timing endpoint', () => {
  it('keeps the ending query separate from the opening', async () => {
    const introSkips = new IntroSkipProvider();
    const intro = vi.spyOn(introSkips, 'intro');
    const ending = vi.spyOn(introSkips, 'ending').mockResolvedValue({ start: 1313.25, end: 1405.125 });
    const response = await createApp({ introSkips }).request('/api/streaming/episodes/tatakai%3A235%3A1/ending?duration=1496.506');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { start: 1313.25, end: 1405.125 } });
    expect(ending).toHaveBeenCalledExactlyOnceWith('tatakai:235:1', 1496.506);
    expect(intro).not.toHaveBeenCalled();
  });
  it('resolves an exact episode independently of playback and catalog requests', async () => {
    const introSkips = new IntroSkipProvider();
    const lookup = vi.spyOn(introSkips, 'intro').mockResolvedValue({ start: 0.625, end: 104.875 });
    const app = createApp({ introSkips });
    const response = await app.request('/api/streaming/episodes/tatakai%3A235%3A1/intro?duration=1496.506');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { start: 0.625, end: 104.875 } });
    expect(lookup).toHaveBeenCalledExactlyOnceWith('tatakai:235:1', 1496.506);
    lookup.mockResolvedValue(undefined);
    expect(await (await app.request('/api/streaming/episodes/tatakai%3A235%3A1/intro?duration=1496.506')).json()).toEqual({ data: null });
  });
  it('rejects invalid IDs, repeated or arbitrary queries before contacting the timing source', async () => {
    const introSkips = new IntroSkipProvider();
    const lookup = vi.spyOn(introSkips, 'intro');
    const app = createApp({ introSkips });
    for (const path of ['demo/intro?duration=1496', 'tatakai:235:0/intro?duration=1496', 'tatakai:235:100001/intro?duration=1496',
      'tatakai:235:1/intro', 'tatakai:235:1/intro?duration=Infinity', 'tatakai:235:1/intro?duration=1496&duration=1496',
      'tatakai:235:1/intro?duration=1496&url=https://example.com']) {
      expect((await app.request(`/api/streaming/episodes/${path}`)).status).toBe(400);
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});
