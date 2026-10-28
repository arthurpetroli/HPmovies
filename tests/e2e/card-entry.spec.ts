import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// All catalog/episode identities and artwork are synthetic. The HLS asset is a
// public playback demo, not a verification of anime content or spoken language.
const animes = [21, 22].map(id => ({
  id: String(id), title: `Jornada fixture ${id}`, titleOriginal: `Watch fixture ${id}`,
  poster: `https://qa.hpmovies.invalid/card-${id}.svg`, banner: `https://qa.hpmovies.invalid/banner-${id}.svg`,
  genres: ['Action'], description: `Sinopse sintética da jornada ${id}.`, episodeCount: 3, score: 87, year: 2026,
}));
const anime = animes[0];
const episode = (id: string, number: number) => ({ id: `tatakai:${id}:${number}`, number, title: `Episódio fixture ${id}-${number}`, thumbnail: `https://qa.hpmovies.invalid/episode-${id}-${number}.svg` });
function gate() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
}

async function fixture(page: Page, pendingIndex?: ReturnType<typeof gate>, directContent = false) {
  const requests = { details: [] as string[], indexes: [] as URL[], playback: [] as URL[], content: [] as URL[] };
  await page.addInitScript(() => {
    const routes: string[] = [];
    Object.defineProperty(window, '__watchEntryRoutes', { value: routes });
    const push = history.pushState.bind(history), replace = history.replaceState.bind(history);
    history.pushState = (data, unused, url) => { if (url) routes.push(String(url)); push(data, unused, url); };
    history.replaceState = (data, unused, url) => { if (url) routes.push(String(url)); replace(data, unused, url); };
  });
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#17534d"/><circle cx="900" cy="220" r="170" fill="#bd7b41"/><text x="60" y="640" fill="white" font-size="44">Arte sintética do teste</text></svg>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/catalog/home') return route.fulfill({ json: { data: { trending: animes, popular: animes, topRated: animes, airing: animes, upcoming: animes } } });
    if (path === '/api/catalog/genres') return route.fulfill({ json: { data: ['Action'] } });
    if (path === '/api/content/anime/21/episodes/1') {
      requests.content.push(url);
      if (!directContent) return route.fulfill({ status: 404, json: { message: 'Sem resolução direta nesta fixture.' } });
      return route.fulfill({ json: { data: {
        episode: { ...episode('21', 1), id: 'toko:21:1' },
        sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' }],
        subtitles: [], audioLanguages: [], isDemo: true,
      } } });
    }
    if (path.startsWith('/api/catalog/anime/')) {
      const id = path.split('/').at(-1)!;
      requests.details.push(id);
      return route.fulfill({ json: { data: animes.find(item => item.id === id) } });
    }
    const index = /^\/api\/streaming\/anime\/(21|22)\/episodes$/.exec(path);
    if (index) {
      requests.indexes.push(url);
      if (index[1] === '21') await pendingIndex?.pending;
      return route.fulfill({ json: { data: { available: true, episodes: [1, 2, 3].map(number => episode(index[1], number)) } } });
    }
    if (path.endsWith('/intro') || path.endsWith('/ending')) return route.fulfill({ json: { data: null } });
    if (path.startsWith('/api/streaming/episodes/')) {
      requests.playback.push(url);
      const [, id, number] = decodeURIComponent(path.split('/').at(-1)!).split(':');
      return route.fulfill({ json: { data: {
        episode: episode(id, Number(number)), sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' }],
        subtitles: [], audioLanguages: [], isDemo: true,
        previousEpisodeId: Number(number) > 1 ? episode(id, Number(number) - 1).id : undefined,
        nextEpisodeId: Number(number) < 3 ? episode(id, Number(number) + 1).id : undefined,
      } } });
    }
    return route.fulfill({ status: 404, json: { message: 'Rota fora da fixture de entrada direta.' } });
  });
  page.on('close', () => pendingIndex?.release());
  return requests;
}

const firstCard = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Em alta agora', exact: true }) }).getByRole('article').first();
const directPaths = async (page: Page) => page.evaluate(() => (window as Window & { __watchEntryRoutes: string[] }).__watchEntryRoutes);

test('a card opens the player immediately and resolves an episode without visiting details', async ({ page }) => {
  const pendingIndex = gate();
  const requests = await fixture(page, pendingIndex);
  await page.goto('/');
  const card = firstCard(page);
  const link = card.getByRole('link', { name: anime.title, exact: true });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toHaveAttribute('href', /\/watch\/anime\/21\?/);
  await expect(card.getByRole('link')).toHaveCount(1);
  await expect(card.locator('a a, a button')).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(/\/watch\/anime\/21\?/);
  const stage = page.locator('.watch-stage');
  await expect(stage).toBeVisible();
  await expect(page.locator('.watch-transition img')).toBeVisible();
  await expect(page.locator('.anime-details')).toHaveCount(0);
  const initialStage = await stage.elementHandle();
  expect(requests.details).toEqual([]);
  expect((await directPaths(page)).some(path => /^\/anime\//.test(path))).toBe(false);
  pendingIndex.release();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A1\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  expect(await stage.evaluate((element, previous) => element === previous, initialStage)).toBe(true);
  expect(requests.indexes.filter(url => url.pathname.includes('/21/'))).toHaveLength(1);
  expect(requests.playback[0].searchParams.getAll('titles[]')).toEqual([anime.title, anime.titleOriginal]);
  const details = page.getByRole('link', { name: 'Ver anime', exact: true });
  await expect(details).toBeVisible();
  expect((await details.boundingBox())!.y).toBeGreaterThan((await stage.boundingBox())!.y + (await stage.boundingBox())!.height);
  await details.click();
  await expect(page).toHaveURL('/anime/21');
  await expect(page.locator('.anime-details')).toBeVisible();
});

test('hero and editorial watch actions also bypass the detail page', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/');
  await page.getByRole('region', { name: 'Anime em destaque', exact: true }).getByRole('link', { name: 'Assistir agora', exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A1\?/);
  await expect(page.locator('.watch-stage')).toBeVisible();
  expect(requests.details).toEqual([]);
  await page.goto('/');
  await page.getByRole('region', { name: 'Uma história para descobrir', exact: true }).getByRole('link', { name: 'Assistir agora', exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A22%3A1\?/);
  await expect(page.locator('.watch-stage')).toBeVisible();
  expect(requests.details).toEqual([]);
  expect((await directPaths(page)).some(path => /^\/anime\//.test(path))).toBe(false);
});

test('backend playback opens before the full episode index and preserves the backend-issued identity', async ({ page }) => {
  const pendingIndex = gate();
  const requests = await fixture(page, pendingIndex, true);
  await page.goto('/');
  await firstCard(page).getByRole('link', { name: anime.title, exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/toko%3A21%3A1\?/);
  await expect(page.locator('video')).toBeVisible();
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Episódios', exact: true })).toHaveAttribute('aria-busy', 'true');
  expect(requests.content).toHaveLength(1);
  expect(requests.playback).toHaveLength(0);
  expect(requests.details).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('direct-watch-index-pending.png') });
  pendingIndex.release();
  await expect(page.getByRole('region', { name: 'Episódios', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(page).toHaveURL(/\/watch\/toko%3A21%3A1\?/);
});

test('keyboard entry resumes an indexed episode and preserves native modified links', async ({ page, isMobile }) => {
  await fixture(page);
  await page.addInitScript(({ anime, id }) => {
    localStorage.setItem('hpmovies.library.v1', JSON.stringify({ list: [], history: [{ episodeId: id, title: 'Fixture em andamento', anime, currentTime: 25, duration: 600, completed: false, updatedAt: Date.now() }] }));
  }, { anime, id: episode(anime.id, 2).id });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const target = firstCard(page).getByRole('link', { name: anime.title, exact: true });
  if (!isMobile) {
    const intercepted = await target.evaluate(element => {
      let prevented = true;
      window.addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
      return prevented;
    });
    expect(intercepted).toBe(false);
    await expect(page).toHaveURL('/');
    await target.focus();
    await page.keyboard.press('Enter');
  } else await target.tap();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A2\?/);
  await expect(page.locator('video')).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime), { timeout: 30000 }).toBeGreaterThanOrEqual(25);
  expect((await directPaths(page)).some(path => /^\/anime\//.test(path))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
