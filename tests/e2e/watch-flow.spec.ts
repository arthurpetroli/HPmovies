import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic anime identities, episode titles and artwork test the interface only.
// The public HLS demo is not evidence of anime, episode or language availability.
const anime = {
  id: '21', title: 'Jornada sintética do player', titleOriginal: 'Watch flow fixture', genres: ['Action'],
  poster: 'https://qa.hpmovies.invalid/watch-poster.svg', banner: 'https://qa.hpmovies.invalid/watch-banner.svg',
  episodeCount: 121, description: 'Sinopse exclusiva para o teste de continuidade visual do player.',
};
const episode = (number: number) => ({
  id: `tatakai:21:${number}`, number, title: `Jornada de teste ${number}`,
  thumbnail: `https://qa.hpmovies.invalid/watch-episode-${number}.svg`,
});
const episodes = [...Array.from({ length: 120 }, (_, index) => episode(index + 1)), episode(1000)];
const watchUrl = (number: number) => `/watch/${encodeURIComponent(episode(number).id)}?title=${encodeURIComponent(anime.title)}&title=${encodeURIComponent(anime.titleOriginal)}`;

function gate() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
}

async function fixture(page: Page, options: { pending?: Map<number, ReturnType<typeof gate>>; failures?: Set<number>; catalogPending?: ReturnType<typeof gate> } = {}) {
  const playbackRequests: URL[] = [];
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="art" x2="1" y2="1"><stop stop-color="#154b5d"/><stop offset="1" stop-color="#ca712f"/></linearGradient></defs><rect width="1280" height="720" fill="url(#art)"/><circle cx="900" cy="220" r="155" fill="#efbf78"/><path d="M0 720 420 230 850 720Z" fill="#132c3e"/><text x="60" y="650" fill="white" font-size="42" font-family="sans-serif">Arte sintética do teste</text></svg>',
  }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/catalog/anime/21') {
      await options.catalogPending?.pending;
      return route.fulfill({ json: { data: anime } });
    }
    if (url.pathname === '/api/streaming/anime/21/episodes') return route.fulfill({ json: { data: { available: true, episodes } } });
    if (url.pathname.endsWith('/intro') || url.pathname.endsWith('/ending')) return route.fulfill({ json: { data: null } });
    if (url.pathname.startsWith('/api/streaming/episodes/')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      const number = Number(id.split(':').at(-1));
      const current = episodes.find(item => item.number === number);
      if (!current) return route.fulfill({ status: 404, json: { message: 'Episódio fora da fixture.' } });
      playbackRequests.push(url);
      await options.pending?.get(number)?.pending;
      if (options.failures?.has(number)) return route.fulfill({ status: 503, json: { message: 'Falha sintética ao preparar o próximo episódio.' } });
      return route.fulfill({ json: { data: {
        episode: current,
        sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls', label: 'Vídeo público de demonstração' }],
        subtitles: [], audioLanguages: [], isDemo: true,
        previousEpisodeId: number > 1 ? episode(number - 1).id : undefined,
        nextEpisodeId: number < 120 ? episode(number + 1).id : undefined,
      } } });
    }
    return route.fulfill({ status: 404, json: { message: 'Rota fora da fixture de continuidade do player.' } });
  });
  page.on('close', () => { options.pending?.forEach(item => item.release()); options.catalogPending?.release(); });
  return playbackRequests;
}

const sidebar = (page: Page) => page.getByRole('region', { name: 'Episódios', exact: true });
const episodeLink = (page: Page, number: number) => sidebar(page).getByRole('link', { name: `Assistir episódio ${number} — Jornada de teste ${number}`, exact: true });
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

test('entry keeps artwork, the player space and the episode list while playback resolves', async ({ page, isMobile }) => {
  const pending = gate();
  const requests = await fixture(page, { pending: new Map([[1, pending]]) });
  await page.goto('/anime/21');
  await page.getByRole('link', { name: 'Assistir agora', exact: true }).click();
  const stage = page.locator('.watch-stage');
  await expect(stage).toBeVisible();
  await expect(page.locator('.watch-transition')).toBeVisible();
  await expect(page.locator('.watch-transition img')).toBeVisible();
  await expect(episodeLink(page, 2)).toBeVisible();
  await expect(page.getByText('Preparando o player...', { exact: true })).toHaveCount(0);
  const initialBox = await stage.boundingBox();
  expect(initialBox!.height).toBeGreaterThan(150);
  if (!isMobile) expect((await sidebar(page).boundingBox())!.x).toBeGreaterThan(initialBox!.x + initialBox!.width);
  await page.screenshot({ path: test.info().outputPath('watch-entry-loading.png') });
  pending.release();
  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByRole('heading', { name: episode(1).title, exact: true })).toBeVisible();
  const finalBox = await stage.boundingBox();
  expect(Math.abs(finalBox!.height - initialBox!.height)).toBeLessThanOrEqual(1);
  expect(requests[0].searchParams.getAll('titles[]')).toEqual([anime.title, anime.titleOriginal]);
  await noOverflow(page);
});

test('selecting an episode preserves the stage element, the list and transition artwork', async ({ page }) => {
  const pending = gate();
  await fixture(page, { pending: new Map([[2, pending]]) });
  await page.goto(watchUrl(1));
  await expect(page.locator('video')).toBeVisible();
  const stage = page.locator('.watch-stage');
  const previousStage = await stage.elementHandle();
  await episodeLink(page, 2).click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A2\?/);
  await expect(page.locator('.watch-transition')).toBeVisible();
  await expect(page.locator('.watch-transition img')).toBeVisible();
  await expect(episodeLink(page, 2)).toHaveAttribute('aria-current', 'page');
  await expect(episodeLink(page, 3)).toBeVisible();
  expect(await stage.evaluate((element, previous) => element === previous, previousStage)).toBe(true);
  await expect(page.getByText('Preparando o player...', { exact: true })).toHaveCount(0);
  pending.release();
  await expect(page.getByRole('heading', { name: episode(2).title, exact: true })).toBeVisible();
  await expect(page.locator('video')).toBeVisible();
  expect(await stage.evaluate((element, previous) => element === previous, previousStage)).toBe(true);
  await noOverflow(page);
});

test('a playback failure preserves episode navigation and retries the selected episode', async ({ page }) => {
  const failures = new Set([2]);
  const requests = await fixture(page, { failures });
  await page.goto(watchUrl(1));
  await expect(page.locator('video')).toBeVisible();
  const previousStage = await page.locator('.watch-stage').elementHandle();
  await episodeLink(page, 2).click();
  await expect(page.getByRole('alert')).toContainText('Falha sintética ao preparar o próximo episódio.');
  await expect(episodeLink(page, 3)).toBeVisible();
  expect(await page.locator('.watch-stage').evaluate((element, previous) => element === previous, previousStage)).toBe(true);
  failures.delete(2);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('heading', { name: episode(2).title, exact: true })).toBeVisible();
  await expect(page.locator('video')).toBeVisible();
  expect(requests.filter(url => decodeURIComponent(url.pathname).endsWith(episode(2).id))).toHaveLength(2);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(true);
  await noOverflow(page);
});

test('long series follow the current range and support global search, keyboard and modified clicks', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fixture(page);
  await page.goto(watchUrl(76));
  await expect(episodeLink(page, 76)).toHaveAttribute('aria-current', 'page');
  await expect(sidebar(page).getByRole('combobox', { name: 'Intervalo de episódios do player' })).toHaveValue('1');
  await expect(sidebar(page).getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(50);
  await sidebar(page).getByRole('searchbox', { name: 'Buscar episódio no player' }).fill('1000');
  await expect(sidebar(page).getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(1);
  const target = episodeLink(page, 1000);
  await expect(target).toHaveAttribute('href', /\/watch\/tatakai%3A21%3A1000\?/);
  if (!isMobile) {
    // Observe React's result before preventing browser activation in this test.
    // Native modified navigation must remain available without invoking onNavigate.
    const intercepted = await target.evaluate(element => {
      let prevented = true;
      window.addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
      return prevented;
    });
    expect(intercepted).toBe(false);
    await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A76\?/);
    await target.focus();
    await page.keyboard.press('Enter');
  } else await target.tap();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A1000\?/);
  await expect(episodeLink(page, 1000)).toHaveAttribute('aria-current', 'page');
  await expect(sidebar(page).getByRole('combobox', { name: 'Intervalo de episódios do player' })).toHaveValue('2');
  await expect(sidebar(page).getByRole('searchbox', { name: 'Buscar episódio no player' })).toHaveValue('');
  await expect(sidebar(page).getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(21);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('the loading composition fits small phones and landscape with reduced motion', async ({ page }) => {
  const pending = gate();
  await fixture(page, { pending: new Map([[1, pending]]) });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(watchUrl(1));
  const stage = page.locator('.watch-stage');
  await expect(stage).toBeVisible();
  await expect(page.locator('.watch-transition')).toBeVisible();
  await expect(episodeLink(page, 2)).toBeAttached();
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    await noOverflow(page);
    const stageBox = await stage.boundingBox();
    const listBox = await sidebar(page).boundingBox();
    expect(listBox!.y).toBeGreaterThanOrEqual(stageBox!.y + stageBox!.height);
  }
  const durations = await page.locator('.watch-transition').evaluate(element => {
    const style = getComputedStyle(element);
    return [...style.animationDuration.split(','), ...style.transitionDuration.split(',')].map(value => parseFloat(value));
  });
  expect(durations.every(value => value <= 0.001)).toBe(true);
  pending.release();
  await expect(page.locator('video')).toBeVisible();
  await noOverflow(page);
});

test('the next action works again after returning to the previous episode with browser history', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto(watchUrl(1));
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  await expect(page.locator('video')).toBeVisible();
  const next = page.getByRole('navigation', { name: 'Navegação entre episódios', exact: true }).getByRole('link', { name: 'Próximo episódio', exact: true });
  await next.click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A2\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A1\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  expect(requests.some(url => decodeURIComponent(url.pathname).endsWith(episode(1).id))).toBe(true);
  await next.click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A2\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  expect(requests.some(url => decodeURIComponent(url.pathname).endsWith(episode(2).id))).toBe(true);
  await expect(episodeLink(page, 2)).toHaveAttribute('aria-current', 'page');
});

test('duplicate next callbacks and immediate Back in the same event leave the next action available', async ({ page }) => {
  await fixture(page);
  await page.goto(watchUrl(1));
  await expect(page.locator('video')).toBeVisible();
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  const next = page.getByRole('navigation', { name: 'Navegação entre episódios', exact: true }).getByRole('link', { name: 'Próximo episódio', exact: true });
  const pushedEntries = await next.evaluate(element => {
    const before = history.state.idx;
    // These callbacks run before React can commit episode two. A rapid Back
    // may cancel that commit, so a request-key effect cannot unlock navigation.
    (element as HTMLAnchorElement).click();
    (element as HTMLAnchorElement).click();
    const pushed = history.state.idx - before;
    history.back();
    return pushed;
  });
  expect(pushedEntries).toBe(1);
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A1\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  await expect(episodeLink(page, 1)).toHaveAttribute('aria-current', 'page');
  await next.click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A2\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  await expect(episodeLink(page, 2)).toHaveAttribute('aria-current', 'page');
});

test('pending next navigation preserves browser Back and consumes autoplay only on its own history entry', async ({ page }) => {
  const pending = gate();
  await fixture(page, { pending: new Map([[2, pending]]) });
  await page.goto(watchUrl(1));
  await expect(page.locator('video')).toBeVisible();
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  const firstEntry = await page.evaluate(() => ({ key: history.state.key, index: history.state.idx }));
  const next = page.getByRole('navigation', { name: 'Navegação entre episódios', exact: true }).getByRole('link', { name: 'Próximo episódio', exact: true });
  await next.click();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A2\?/);
  await expect(page.locator('.watch-transition')).toBeVisible();
  const secondEntry = await page.evaluate(() => ({ key: history.state.key, index: history.state.idx, autoPlay: history.state.usr?.autoPlay, anime: history.state.usr?.anime?.id }));
  expect(secondEntry).toMatchObject({ index: firstEntry.index + 1, autoPlay: false, anime: anime.id });
  expect(secondEntry.key).not.toBe(firstEntry.key);
  await page.goBack();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A1\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  expect(await page.evaluate(() => history.state.key)).toBe(firstEntry.key);
  const response = page.waitForResponse(value => decodeURIComponent(new URL(value.url()).pathname).endsWith(episode(2).id));
  pending.release();
  await response;
  await expect(page.getByRole('heading', { name: episode(1).title, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A1\?/);
  await page.goForward();
  await expect(page).toHaveURL(/\/watch\/tatakai%3A21%3A2\?/);
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  expect(await page.evaluate(() => history.state.key)).toBe(secondEntry.key);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(true);
  await page.reload();
  await expect(page.locator('video')).toBeVisible();
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  expect(await page.locator('video').evaluate(video => video.paused)).toBe(true);
  expect(await page.evaluate(() => history.state.usr?.autoPlay)).toBe(false);
});

test('a direct episode link saves the anime identity when catalog metadata arrives after playback', async ({ page }) => {
  const catalogPending = gate();
  await fixture(page, { catalogPending });
  await page.goto(watchUrl(5));
  await expect(page.locator('.watch-transition')).toHaveCount(0);
  await expect(page.locator('video')).toBeVisible();
  catalogPending.release();
  await expect(page.getByRole('link', { name: anime.title, exact: true })).toBeVisible();
  // Real HLS metadata supplies duration. Seeking and pause exercise progress saving;
  // this does not claim anime identity or language verification for the demo media.
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 25), { timeout: 30000 }).toBe(true);
  await page.locator('video').evaluate(video => {
    video.currentTime = 25;
    video.pause();
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('pause'));
  });
  await page.goto('/library?tab=history&format=anime');
  const card = page.locator('.history-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText(anime.title, { exact: true })).toBeVisible();
  await expect(card.locator('.history-art img')).toHaveAttribute('src', anime.banner);
  await expect(card.locator('.history-demo-label')).toHaveCount(0);
  await expect(card).toHaveAttribute('href', `/watch/${encodeURIComponent(episode(5).id)}`);
  await noOverflow(page);
});
