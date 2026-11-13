import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic metadata, library and media events exercise UI/storage contracts.
// No case here establishes availability or decoding of an external movie/episode.
const movieId = 'stremio:all:movie:tt27543632';
const seriesId = 'stremio:all:tt0903747:2:3';
const animeId = 'tatakai:170000:7';
const asset = 'https://qa-history.hpmovies.invalid';
const movie = { id: 'tt27543632', type: 'movie', title: 'The Housemaid QA', poster: `${asset}/movie-poster.svg`, background: `${asset}/movie-background.svg`, year: '2025', genres: ['Drama'] };
const series = { id: 'tt0903747', type: 'series', title: 'Breaking Bad QA', poster: `${asset}/series-poster.svg`, background: `${asset}/series-background.svg`, genres: ['Drama'] };
const anime = { id: '170000', title: 'Chained Soldier Season 2 QA', poster: `${asset}/anime-poster.svg`, banner: `${asset}/anime-background.svg`, genres: ['Action'], format: 'TV' };
const episodes = [{ id: `${series.id}:2:3`, season: 2, episode: 3, title: 'Episódio de série QA', released: '2020-01-01T00:00:00.000Z', thumbnail: `${asset}/episode-background.svg` }];
const history = [
  { episodeId: movieId, title: 'Filme · tt27543632', currentTime: 30, duration: 600, updatedAt: 1700000400000, completed: false },
  { episodeId: seriesId, title: 'Episódio 3 · temporada 2', currentTime: 120, duration: 2400, updatedAt: 1700000300000, completed: false },
  { episodeId: animeId, title: 'Episódio QA', anime, currentTime: 300, duration: 1400, updatedAt: 1700000200000, completed: false },
  { episodeId: 'demo', title: 'Demonstração QA', currentTime: 10, duration: 600, updatedAt: 1700000100000, completed: false },
];

async function seed(page: Page, entries: unknown[] = history) {
  await page.addInitScript(value => {
    if (!localStorage.getItem('hpmovies.library.v1')) localStorage.setItem('hpmovies.library.v1', JSON.stringify({ list: [], history: value }));
  }, entries);
}

async function fixtures(page: Page, options: { delayedPlayback?: boolean; delayedMetadata?: boolean; metadataUnavailable?: () => boolean; posterOnly?: boolean } = {}) {
  const requests: string[] = [];
  let release = () => {};
  const gate = options.delayedPlayback ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  let releaseMetadata = () => {};
  const metadataGate = options.delayedMetadata ? new Promise<void>(resolve => { releaseMetadata = resolve; }) : Promise.resolve();
  await page.route(`${asset}/**`, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#28594f"/><path d="M0 675L1200 0" stroke="#81e6cd" stroke-width="80"/></svg>' }));
  // Deliberately pending media. The resume case below explicitly synthesizes
  // metadata/time events and must never be interpreted as a decoding check.
  await page.route('**/qa-history-video.mp4', () => {});
  await page.route('**/api/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    requests.push(path);
    if (path === '/api/catalog/home') return route.fulfill({ json: { data: { trending: [], popular: [], airing: [], topRated: [], upcoming: [] } } });
    if (path.startsWith('/api/cinema/')) {
      await metadataGate;
      if (options.metadataUnavailable?.()) return route.fulfill({ status: 503, json: { message: 'Os metadados QA estão temporariamente indisponíveis.' } });
      if (path === `/api/cinema/movie/${movie.id}`) return route.fulfill({ json: { data: { ...movie, ...(options.posterOnly ? { background: undefined } : {}), episodes: [] } } });
      if (path === `/api/cinema/series/${series.id}`) return route.fulfill({ json: { data: { ...series, episodes } } });
    }
    if (path.startsWith('/api/streaming/episodes/')) {
      await gate;
      const id = path.slice('/api/streaming/episodes/'.length);
      return route.fulfill({ json: { data: {
        episode: { id, title: id === movieId ? 'Filme · tt27543632' : 'Episódio 3 · temporada 2', ...(id === seriesId ? { number: 3 } : {}) },
        sources: [{ url: '/qa-history-video.mp4', type: 'mp4', label: 'Vídeo pendente QA', subtitles: [] }], subtitles: [], audioLanguages: [], isDemo: false,
      } } });
    }
    return route.fulfill({ status: 404, json: { message: 'Recurso ausente nesta fixture.' } });
  });
  return { requests, release, releaseMetadata };
}

async function storedHistory(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('hpmovies.library.v1') || '{}').history as Array<Record<string, unknown>>);
}

test('legacy Continue Watching recovers cinema artwork and titles, keeps progress and exposes anime/series episodes', async ({ page }) => {
  await seed(page);
  const { requests } = await fixtures(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Continue de onde parou', exact: true })).toBeVisible();
  const movieCard = page.locator(`.history-card[href*="${movie.id}"]`);
  const seriesCard = page.locator(`.history-card[href*="${series.id}"]`);
  const animeCard = page.locator('.history-card[href*="170000"]');
  await expect(movieCard).toContainText(movie.title);
  await expect(seriesCard).toContainText(series.title);
  await expect(movieCard.locator('img')).toHaveAttribute('src', movie.background);
  await expect(seriesCard.locator('img')).toHaveAttribute('src', series.background);
  await expect(animeCard).toContainText('Episódio 7');
  await expect(seriesCard).toContainText(/Temporada 2.*Episódio 3/i);
  await expect(movieCard.locator('.history-demo-label')).toHaveCount(0);
  await expect(seriesCard.locator('.history-demo-label')).toHaveCount(0);
  await expect(animeCard.locator('.history-demo-label')).toHaveCount(0);
  await expect(page.locator('.history-demo-label')).toHaveCount(1);
  await expect.poll(async () => (await storedHistory(page)).filter(item => item.cinema).length).toBe(2);
  const stored = await storedHistory(page);
  expect(stored).toHaveLength(history.length);
  for (const previous of history) {
    expect(stored.find(entry => entry.episodeId === previous.episodeId)).toMatchObject({ currentTime: previous.currentTime, duration: previous.duration, updatedAt: previous.updatedAt, completed: previous.completed });
  }
  expect(requests.filter(path => path === `/api/cinema/movie/${movie.id}`)).toHaveLength(1);
  expect(requests.filter(path => path === `/api/cinema/series/${series.id}`)).toHaveLength(1);
  await page.reload();
  await expect(movieCard).toContainText(movie.title);
  await expect(animeCard).toContainText('Episódio 7');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('resuming a legacy movie shows cinema background before media, keeps its position and saves title/artwork on progress', async ({ page }) => {
  await seed(page, [history[0]]);
  const { requests, release } = await fixtures(page, { delayedPlayback: true });
  await page.goto('/');
  const card = page.locator(`.history-card[href*="${movie.id}"]`);
  await expect(card).toContainText(movie.title);
  await card.click();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(`/watch/${movieId}`);
  await expect(page.locator('.watch-backdrop img')).toHaveAttribute('src', movie.background);
  await expect(page.locator('.watch-transition img')).toHaveAttribute('src', movie.background);
  await expect(page.getByRole('heading', { name: movie.title, level: 1, exact: true })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  release();
  await page.locator('video').waitFor();
  // Synthetic metadata drives the real resume and persistence handlers only.
  await page.locator('video').evaluate(video => {
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 600 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    video.dispatchEvent(new Event('loadedmetadata'));
  });
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBe(30);
  await page.locator('video').evaluate(video => { video.currentTime = 37; video.dispatchEvent(new Event('timeupdate')); video.dispatchEvent(new Event('pause')); });
  await expect.poll(async () => (await storedHistory(page)).find(entry => entry.episodeId === movieId)?.currentTime).toBe(37);
  expect((await storedHistory(page)).find(entry => entry.episodeId === movieId)).toMatchObject({ title: movie.title, cinema: { id: movie.id, type: 'movie', title: movie.title }, isDemo: false });
  await page.reload();
  await expect(page.getByRole('heading', { name: movie.title, level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.watch-backdrop img')).toHaveAttribute('src', movie.background);
  expect(requests.some(path => path.startsWith('/api/catalog/anime/'))).toBe(false);
  await page.getByRole('link', { name: 'Voltar aos detalhes', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: movie.title, level: 1, exact: true })).toBeVisible();
  await page.goto('/');
  await expect(card).toContainText(movie.title);
  await expect(card.locator('.history-demo-label')).toHaveCount(0);
});

test('a direct movie URL without history or navigation state uses catalog poster as loading artwork', async ({ page }) => {
  const { requests } = await fixtures(page, { delayedPlayback: true, posterOnly: true });
  await page.goto(`/watch/${encodeURIComponent(movieId)}`);
  await expect(page.locator('.watch-backdrop img')).toHaveAttribute('src', movie.poster);
  await expect(page.locator('.watch-transition img')).toHaveAttribute('src', movie.poster);
  await expect(page.getByRole('heading', { name: movie.title, level: 1, exact: true })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  expect(requests).toContain(`/api/cinema/movie/${movie.id}`);
  expect(requests.some(path => path.startsWith('/api/catalog/anime/'))).toBe(false);
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('movie metadata arriving after playback repairs history without replacing the video or losing position', async ({ page }) => {
  await seed(page, [history[0]]);
  const { requests, releaseMetadata } = await fixtures(page, { delayedMetadata: true });
  await page.goto(`/watch/${encodeURIComponent(movieId)}?title=Título+temporário+QA`);
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await video.evaluate(element => {
    element.dataset.qaIdentity = 'before-metadata';
    Object.defineProperty(element, 'duration', { configurable: true, get: () => 600 });
    Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: 0 });
    element.dispatchEvent(new Event('loadedmetadata'));
  });
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(30);
  await video.evaluate(element => { element.currentTime = 37; element.dispatchEvent(new Event('timeupdate')); element.dispatchEvent(new Event('pause')); });
  releaseMetadata();
  await expect(page.getByRole('heading', { level: 1, name: movie.title, exact: true })).toBeVisible();
  await expect(page.locator('.watch-backdrop img')).toHaveAttribute('src', movie.background);
  await expect(video).toHaveAttribute('data-qa-identity', 'before-metadata');
  expect(await video.evaluate(element => element.currentTime)).toBe(37);
  await expect.poll(async () => (await storedHistory(page)).find(entry => entry.episodeId === movieId)).toMatchObject({ title: movie.title, currentTime: 37, cinema: { id: movie.id } });
  expect(requests.filter(path => path.startsWith('/api/streaming/episodes/'))).toHaveLength(1);
});

test('series resume retains season/episode and catalog background when opened directly after reload', async ({ page }) => {
  await seed(page, [history[1]]);
  await fixtures(page, { delayedPlayback: true });
  await page.goto('/library?tab=history');
  const card = page.locator(`.history-card[href*="${series.id}"]`);
  await expect(card).toContainText(series.title);
  await expect(card).toContainText(/Temporada 2.*Episódio 3/i);
  await card.click();
  await expect(page.locator('.watch-backdrop img')).toHaveAttribute('src', series.background);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(series.title);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Temporada 2.*episódio 3/i);
  await page.reload();
  await expect(page.locator('.watch-backdrop img')).toHaveAttribute('src', series.background);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Temporada 2.*episódio 3/i);
  await page.getByRole('link', { name: 'Voltar aos detalhes', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: series.title, level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Temporada', exact: true })).toHaveValue('2');
});

test('missing cinema metadata has a human fallback and recovers without clearing legacy progress', async ({ page }) => {
  await seed(page, [history[0]]);
  let failing = true;
  await fixtures(page, { metadataUnavailable: () => failing });
  await page.goto('/');
  const card = page.locator(`.history-card[href*="${movie.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).not.toContainText(movie.id);
  await expect(card.locator('.history-demo-label')).toHaveCount(0);
  expect((await storedHistory(page))[0]).toMatchObject({ currentTime: 30, duration: 600, updatedAt: history[0].updatedAt });
  failing = false;
  await page.reload();
  await expect(card).toContainText(movie.title);
  await expect(card.locator('img')).toHaveAttribute('src', movie.background);
  expect((await storedHistory(page))[0]).toMatchObject({ currentTime: 30, duration: 600, updatedAt: history[0].updatedAt });
});
