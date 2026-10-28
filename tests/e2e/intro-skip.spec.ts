import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Isolated opening intervals over a public test video; these are not anime timings.
const episode = '/api/streaming/episodes/tatakai%3A235%3A1';
async function playback(page: Page, intro?: { start: number; end: number }) {
  await page.route(`**${episode}`, route => route.fulfill({ json: { data: {
    episode: { id: 'tatakai:235:1', number: 1, title: 'Fixture de abertura' }, isDemo: true, audioLanguages: [], subtitles: [],
    sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' }], ...(intro ? { intro } : {}),
  } } }));
}
const start = async (page: Page) => {
  await page.goto('/watch/tatakai%3A235%3A1');
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(1);
};

test('loads opening times without blocking playback and skips only during the opening', async ({ page, isMobile }) => {
  await playback(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let queriedLength = 0;
  await page.route(`**${episode}/intro?*`, async route => {
    queriedLength = Number(new URL(route.request().url()).searchParams.get('duration'));
    await pending;
    await route.fulfill({ json: { data: { start: 20, end: 35 } } });
  });
  await start(page);
  const skip = page.getByRole('button', { name: 'Pular abertura', exact: true });
  await expect(skip).toHaveCount(0);
  await expect.poll(() => queriedLength).toBeGreaterThan(100);
  release();
  await page.locator('video').evaluate(video => { video.currentTime = 21; });
  await expect(skip).toBeVisible();
  const bounds = await skip.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  const position = { x: bounds!.x, y: bounds!.y };
  await page.getByRole('heading', { name: 'Fixture de abertura' }).click();
  await expect(page.locator('.video-player')).toHaveClass(/cursor-none/);
  expect(await skip.boundingBox()).toMatchObject(position);
  if (!isMobile) {
    await page.getByRole('region', { name: 'Player de vídeo' }).focus();
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(skip).toBeVisible();
  }
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(35);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(false);
  await expect(skip).toHaveCount(0);
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 5; });
  await expect(skip).toHaveCount(0);
  await page.locator('video').evaluate(video => { video.currentTime = 21; });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(35);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(true);
});

for (const scenario of ['absent', 'out-of-bounds'] as const) {
  test(`an ${scenario} opening never invents a skip or interrupts the video`, async ({ page }) => {
    await playback(page);
    await page.route(`**${episode}/intro?*`, route => route.fulfill({ json: { data: scenario === 'absent' ? null : { start: 10, end: 999999 } } }));
    await start(page);
    await page.locator('video').evaluate(video => { video.currentTime = 21; });
    await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(22);
    await expect(page.getByRole('button', { name: 'Pular abertura', exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('uses a valid source opening without a separate lookup', async ({ page }) => {
  await playback(page, { start: 0, end: 35 });
  let lookups = 0;
  await page.route(`**${episode}/intro?*`, route => { lookups++; return route.fulfill({ json: { data: null } }); });
  await start(page);
  await expect(page.getByRole('button', { name: 'Pular abertura', exact: true })).toBeVisible();
  expect(lookups).toBe(0);
});
