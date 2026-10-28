import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic episode identities/timings over a public test video; not anime evidence.
const first = 'tatakai:235:1', second = 'tatakai:235:2';
interface FixtureOptions { next?: boolean; ending?: { start: number; end: number } | null; delayNext?: Promise<void> }
async function fixture(page: Page, options: FixtureOptions = {}) {
  const requests = { first: 0, second: 0, ending: 0, nextHints: [] as string[] };
  await page.route('**/api/catalog/anime/235', route => route.fulfill({ json: { data: { id: '235', title: 'Detetive fixture', poster: '', genres: [] } } }));
  await page.route('**/api/streaming/anime/235/episodes**', route => route.fulfill({ json: { data: { available: false, episodes: [] } } }));
  await page.route('**/api/streaming/episodes/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/intro')) return route.fulfill({ json: { data: null } });
    if (url.pathname.endsWith('/ending')) {
      requests.ending++;
      return route.fulfill({ json: { data: options.ending === undefined ? { start: 20, end: 35 } : options.ending } });
    }
    const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
    if (id !== first && id !== second) return route.abort();
    if (id === first) requests.first++;
    else {
      requests.second++;
      requests.nextHints = url.searchParams.getAll('titles[]');
      if (options.delayNext) await options.delayNext;
    }
    return route.fulfill({ json: { data: {
      episode: { id, number: id === first ? 1 : 2, title: id === first ? 'Primeiro episódio fixture' : 'Segundo episódio fixture' },
      sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' }], subtitles: [], audioLanguages: [], isDemo: true,
      ...(id === first && options.next !== false ? { nextEpisodeId: second } : {}),
    } } });
  });
  return requests;
}
async function start(page: Page) {
  await page.goto(`/watch/${encodeURIComponent(first)}?title=Detetive+fixture`);
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(1);
}
const nextButton = (page: Page) => page.getByRole('region', { name: 'Player de vídeo' }).getByRole('button', { name: 'Próximo episódio', exact: true });

test('the ending action opens and loads the next episode from the start with autoplay', async ({ page, isMobile }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests = await fixture(page, { delayNext: pending });
  await start(page);
  await expect(nextButton(page)).toHaveCount(0);
  await page.locator('video').evaluate(video => { video.currentTime = 21; });
  await expect(nextButton(page)).toBeVisible();
  expect((await nextButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (!isMobile) {
    await page.getByRole('region', { name: 'Player de vídeo' }).focus();
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await nextButton(page).focus();
    await page.keyboard.press('Enter');
  } else await nextButton(page).click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A235%3A2\?title=Detetive\+fixture$/);
  await expect(page.locator('.watch-transition')).toBeVisible();
  await expect(page.getByText('Preparando o player...', { exact: true })).toHaveCount(0);
  if (!isMobile) await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('watch-stage'))).toBe(true);
  release();
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  if (!isMobile) {
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('watch-stage'))).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
  }
  await expect(page.getByRole('heading', { name: 'Segundo episódio fixture' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(1);
  expect(await page.locator('video').evaluate(video => video.currentTime)).toBeLessThan(10);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(false);
  expect(requests.nextHints).toEqual(['Detetive fixture']);
  expect(requests.second).toBeLessThanOrEqual(2); // Development StrictMode may repeat a cancelled initial fetch.
  await expect(nextButton(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.locator('video').evaluate(video => { video.currentTime = 100; });
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(100);
  await page.getByRole('region', { name: 'Player de vídeo' }).focus();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  // A later reload must resume progress rather than replay navigation intent.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Segundo episódio fixture' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(100);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(true);
});

test('does not navigate without a click and preserves scenes after the ending', async ({ page }) => {
  await fixture(page);
  await start(page);
  await page.locator('video').evaluate(video => { video.currentTime = 21; });
  await expect(nextButton(page)).toBeVisible();
  await page.locator('video').evaluate(video => { video.currentTime = 36; });
  await expect(nextButton(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Primeiro episódio fixture' })).toBeVisible();
  await page.locator('video').evaluate(video => { video.currentTime = 21; });
  await expect(nextButton(page)).toBeVisible();
});

test('offers manual navigation at the native end when automatic advance is disabled', async ({ page }) => {
  await fixture(page, { ending: null });
  await start(page);
  await page.getByRole('checkbox', { name: 'Avançar ao terminar' }).uncheck();
  await expect(nextButton(page)).toHaveCount(0);
  await page.locator('video').evaluate(video => { video.currentTime = video.duration - 0.3; });
  await expect.poll(() => page.locator('video').evaluate(video => video.ended), { timeout: 20000 }).toBe(true);
  await expect(nextButton(page)).toBeVisible();
  await nextButton(page).click();
  await expect(page.getByRole('heading', { name: 'Segundo episódio fixture' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(1);
});

test('the last available episode has no ending action or ending lookup', async ({ page }) => {
  const requests = await fixture(page, { next: false });
  await start(page);
  await page.locator('video').evaluate(video => { video.currentTime = 21; });
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(22);
  await expect(nextButton(page)).toHaveCount(0);
  expect(requests.ending).toBe(0);
});


test('automatically opens the next episode only at the native end and preserves the stage', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await fixture(page, { delayNext: pending, ending: null });
  await start(page);
  const stage = await page.locator('.watch-stage').elementHandle();
  await expect(page.getByRole('checkbox', { name: 'Avançar ao terminar' })).toBeChecked();
  await page.locator('video').evaluate(video => { video.currentTime = video.duration - 0.3; });
  await expect(page).toHaveURL(/watch\/tatakai%3A235%3A2/);
  await expect(page.locator('.watch-transition')).toBeVisible();
  expect(await page.locator('.watch-stage').evaluate((element, previous) => element === previous, stage)).toBe(true);
  release();
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(1);
  expect(await page.locator('video').evaluate(video => video.currentTime)).toBeLessThan(10);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(false);
});

test('keeps the automatic advance preference after a reload', async ({ page }) => {
  await fixture(page, { ending: null });
  await start(page);
  await page.getByRole('checkbox', { name: 'Avançar ao terminar' }).uncheck();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Avançar ao terminar' })).not.toBeChecked();
});
