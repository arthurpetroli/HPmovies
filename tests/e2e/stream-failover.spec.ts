import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StreamSource } from '../../src/shared/providers';

// The failures are local fixtures. The successful source decodes real public
// demo HLS media, so reaching "playing" alone cannot hide a stalled player.
const demo = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const first = 'http://127.0.0.1:5173/qa-stream-first/master.m3u8';
const second = 'http://127.0.0.1:5173/qa-stream-second/master.m3u8';
const captions = [{ id: 'pt-qa', url: '/qa-stream-captions.vtt', label: 'Português QA', language: 'pt-BR', format: 'vtt' as const }];

async function playback(page: Page, sources: StreamSource[]) {
  await page.route('**/api/streaming/episodes/stream-failover', route => route.fulfill({ json: { data: {
    episode: { id: 'stream-failover', title: 'Teste de recuperação de vídeo' },
    sources, subtitles: captions, audioLanguages: [], isDemo: true,
  } } }));
  await page.route('**/qa-stream-captions.vtt', route => route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nLegenda QA\n' }));
}

test('a failed child playlist changes source and preserves play intent, position and caption preferences', async ({ page }) => {
  test.setTimeout(70000);
  const errors: string[] = []; page.on('pageerror', cause => errors.push(cause.message));
  let release!: () => void;
  const requestedPlay = new Promise<void>(resolve => { release = resolve; });
  let failures = 0;
  await playback(page, [
    { url: first, type: 'hls', label: 'Primeira fonte QA', subtitles: captions },
    { url: demo, type: 'hls', label: 'Segunda fonte QA', subtitles: captions },
  ]);
  await page.route('**/qa-stream-first/**', async route => {
    if (route.request().url().endsWith('/master.m3u8')) return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180\nchild.m3u8\n' });
    await requestedPlay;
    failures++;
    return route.fulfill({ status: 503, body: 'Child playlist unavailable in QA' });
  });
  await page.addInitScript(() => {
    localStorage.setItem('hpmovies.library.v1', JSON.stringify({ list: [], history: [{ episodeId: 'stream-failover', title: 'QA', currentTime: 12, duration: 600, completed: false, updatedAt: Date.now() }] }));
    localStorage.setItem('hpmovies.captions.v1', JSON.stringify({ language: 'off', offset: 1.5, size: 'large', background: false }));
  });
  await page.goto('/watch/stream-failover');
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' })).toHaveValue(first);
  await page.getByRole('button', { name: 'Reproduzir', exact: true }).click();
  release();
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' })).toHaveValue(demo, { timeout: 25000 });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 35000 }).toBeGreaterThan(13);
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
  await page.getByRole('region', { name: 'Player de vídeo' }).focus();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('combobox', { name: 'Idioma das legendas' })).toHaveValue('off');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hpmovies.captions.v1') || '{}'))).toMatchObject({ offset: 1.5, size: 'large', background: false });
  expect(failures).toBeGreaterThan(0);
  expect(failures).toBeLessThanOrEqual(8);
  expect(errors).toEqual([]);
});

test('exhausted sources stop automatically and manual selection resets the recovery cycle without autoplay', async ({ page }) => {
  test.setTimeout(65000);
  const requests = new Map<string, number>();
  let healthy = false;
  await playback(page, [
    { url: first, type: 'hls', label: 'Primeira fonte QA' },
    { url: second, type: 'hls', label: 'Segunda fonte QA' },
    { url: first, type: 'hls', label: 'Mesma URL de QA' },
  ]);
  await page.route('**/qa-stream-*/master.m3u8', route => {
    const url = route.request().url(); requests.set(url, (requests.get(url) || 0) + 1);
    if (healthy) return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=246440,CODECS="mp4a.40.5,avc1.42000d",RESOLUTION=320x184\nhttps://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_ld_7.m3u8\n' });
    return route.fulfill({ status: 503, body: 'Manifest unavailable in QA' });
  });
  await page.goto('/watch/stream-failover');
  await expect(page.getByText('Todas as fontes disponíveis falharam.', { exact: false })).toBeVisible({ timeout: 35000 });
  await expect(page.getByRole('status', { name: 'Carregando vídeo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tentar fontes novamente' })).toBeVisible();
  expect(requests.get(first)).toBeGreaterThan(0);
  expect(requests.get(second)).toBeGreaterThan(0);
  expect(requests.get(first)).toBeLessThanOrEqual(4);
  expect(requests.get(second)).toBeLessThanOrEqual(4);
  const previousCount = requests.get(first)!;
  healthy = true;
  await page.getByRole('combobox', { name: 'Fonte de vídeo' }).selectOption(first);
  await expect(page.getByText('Todas as fontes disponíveis falharam.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reproduzir vídeo', exact: true })).toBeVisible({ timeout: 25000 });
  expect(requests.get(first)).toBeGreaterThan(previousCount);
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 25000 }).toBeGreaterThan(1);
});

test('explicit retry refreshes expired tickets with the same title hints and preserves resume without autoplay', async ({ page }) => {
  test.setTimeout(45000);
  const expired = 'http://127.0.0.1:5173/qa-stream-expired/master.m3u8';
  const requests: URL[] = [];
  await page.route('**/api/streaming/episodes/stream-failover?**', route => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { data: {
      episode: { id: 'stream-failover', title: 'Teste de renovação de links' },
      sources: [{ url: requests.length === 1 ? expired : demo, type: 'hls', label: 'Fonte QA', subtitles: [] }],
      subtitles: [], audioLanguages: [], isDemo: true,
    } } });
  });
  await page.route('**/qa-stream-expired/master.m3u8', route => route.fulfill({ status: 404, body: 'Expired ticket in QA' }));
  await page.addInitScript(() => {
    localStorage.setItem('hpmovies.library.v1', JSON.stringify({ list: [], history: [{ episodeId: 'stream-failover', title: 'QA', currentTime: 12, duration: 600, completed: false, updatedAt: Date.now() }] }));
  });
  await page.goto('/watch/stream-failover?title=Teste+de+links&source=tatakai');
  await expect(page.getByRole('button', { name: 'Tentar fontes novamente' })).toBeVisible({ timeout: 15000 });
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Tentar fontes novamente' }).click();
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' })).toHaveValue(demo);
  await expect(page.getByRole('button', { name: 'Reproduzir vídeo', exact: true })).toBeVisible({ timeout: 25000 });
  expect(requests).toHaveLength(2);
  expect(requests[1].searchParams.getAll('titles[]')).toEqual(['Teste de links']);
  expect(requests[1].toString()).toBe(requests[0].toString());
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(12);
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 25000 }).toBeGreaterThan(13);
});
