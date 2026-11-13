import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The catalog and episode indexes below are synthetic, with no playback claim.
const movie = { id: 'tt1234567', type: 'movie', title: 'Filme QA', year: '2020', genres: ['Drama'], description: 'Sinopse da fixture de cinema.' };
const series = { id: 'tt7654321', type: 'series', title: 'Série QA', year: '2021', genres: ['Mystery'] };
const episodes = [
  { id: `${series.id}:1:1`, season: 1, episode: 1, title: 'Primeiro episódio QA', released: '2021-01-01T00:00:00.000Z' },
  { id: `${series.id}:2:3`, season: 2, episode: 3, title: 'Terceiro episódio QA', released: '2022-01-01T00:00:00.000Z' },
  { id: `${series.id}:2:4`, season: 2, episode: 4, title: 'Episódio futuro QA', released: '2099-01-01T00:00:00.000Z' },
];
const filterFixture = { providers: [
  { id: 'nfx', label: 'Netflix', regions: ['BR', 'US'] },
  { id: 'dnp', label: 'Disney+', regions: ['BR', 'US'] },
  { id: 'hlu', label: 'Hulu', regions: ['US'] },
], regions: [{ id: 'BR', label: 'Brasil' }, { id: 'US', label: 'Estados Unidos' }] };

async function cinemaFixtures(page: Page) {
  const requests: URL[] = [];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.pathname === '/api/cinema/filters') return route.fulfill({ json: { data: filterFixture } });
    if (url.pathname === '/api/cinema/catalog') {
      const item = url.searchParams.get('type') === 'series' ? series : movie;
      return route.fulfill({ json: { data: { items: [item], page: Number(url.searchParams.get('page')), hasNextPage: url.searchParams.get('page') === '1', notice: 'Seleção inicial de QA; não indica tendências.' } } });
    }
    if (url.pathname === `/api/cinema/movie/${movie.id}`) return route.fulfill({ json: { data: { ...movie, episodes: [] } } });
    if (url.pathname === `/api/cinema/series/${series.id}`) return route.fulfill({ json: { data: { ...series, episodes } } });
    return route.fulfill({ status: 404, json: { message: 'Nenhuma fonte QA retornou vídeo para esta consulta.' } });
  });
  return requests;
}

test('catalog search, type and page survive details; exact season opens and returns after reload', async ({ page }) => {
  const requests = await cinemaFixtures(page);
  await page.goto('/cinema?provider=nfx&region=BR');
  await expect(page.getByRole('link', { name: 'Ver Filme QA', exact: true })).toBeVisible();
  await expect(page.getByText('Seleção inicial de QA; não indica tendências.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar filmes e séries' }).fill('História QA');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('combobox', { name: 'Catálogo', exact: true }).selectOption('series');
  await expect(page.getByRole('link', { name: 'Ver Série QA', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Ver Série QA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Série QA', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('combobox', { name: 'Temporada', exact: true }).selectOption('2');
  await expect(page.getByText('Episódio futuro QA', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: /Assistir.*Episódio futuro QA/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Assistir temporada 2, episódio 3: Terceiro episódio QA' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Nenhuma fonte QA' })).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe('/watch/stremio:all:tt7654321:2:3');
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Nenhuma fonte QA' })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar aos detalhes', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Temporada', exact: true })).toHaveValue('2');
  await page.getByRole('link', { name: 'Voltar a filmes e séries', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar filmes e séries' })).toHaveValue('História QA');
  await expect(page.getByRole('combobox', { name: 'Catálogo', exact: true })).toHaveValue('series');
  await expect(page.getByRole('combobox', { name: 'Streaming', exact: true })).toHaveValue('nfx');
  await expect(page.getByRole('combobox', { name: 'Região', exact: true })).toHaveValue('BR');
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(requests.some(url => url.pathname.startsWith('/api/catalog/anime/'))).toBe(false);
  expect(requests.filter(url => url.pathname === '/api/cinema/catalog').some(url => url.searchParams.get('search') === 'História QA')).toBe(true);
});

test('a type change before the submitted search renders keeps the latest query', async ({ page }) => {
  await cinemaFixtures(page);
  await page.goto('/cinema?provider=nfx&region=BR');
  await expect(page.getByRole('link', { name: 'Ver Filme QA', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar filmes e séries' }).fill('História QA');
  // Simulate two fast interactions before the Router transition renders its new query.
  await page.evaluate(() => {
    document.querySelector<HTMLFormElement>('#main-content form[role="search"]')!.requestSubmit();
    const catalog = document.querySelector<HTMLSelectElement>('#main-content select')!;
    catalog.value = 'series';
    catalog.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('link', { name: 'Ver Série QA', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar filmes e séries' })).toHaveValue('História QA');
  const params = new URL(page.url()).searchParams;
  expect(params.get('q')).toBe('História QA');
  expect(params.get('type')).toBe('series');
  expect(params.get('provider')).toBe('nfx');
  expect(params.get('region')).toBe('BR');
});

test('the full catalog pages beyond eight titles and streaming regions reset pagination', async ({ page }) => {
  await cinemaFixtures(page);
  const requests: URL[] = [];
  await page.route('**/api/cinema/catalog?**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    const pageNumber = Number(url.searchParams.get('page'));
    const start = (pageNumber - 1) * 50;
    const items = Array.from({ length: 50 }, (_, index) => ({ ...movie, id: `tt${9000000 + start + index}`, title: `Filme paginado QA ${start + index + 1}` }));
    return route.fulfill({ json: { data: { items, page: pageNumber, hasNextPage: true } } });
  });
  await page.goto('/cinema');
  await expect(page.getByRole('link', { name: /^Ver Filme paginado QA/ })).toHaveCount(50);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Ver Filme paginado QA 51', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  await page.getByRole('combobox', { name: 'Streaming', exact: true }).selectOption('nfx');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await expect(page.getByRole('link', { name: 'Ver Filme paginado QA 1', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Streaming', exact: true }).locator('option[value="hlu"]')).toHaveAttribute('disabled', '');
  await page.getByRole('combobox', { name: 'Região', exact: true }).selectOption('US');
  await page.getByRole('combobox', { name: 'Streaming', exact: true }).selectOption('hlu');
  await expect(page.getByRole('combobox', { name: 'Streaming', exact: true })).toHaveValue('hlu');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Streaming', exact: true })).toHaveValue('hlu');
  await expect(page.getByRole('combobox', { name: 'Região', exact: true })).toHaveValue('US');
  expect(requests.some(url => url.searchParams.get('provider') === 'hlu' && url.searchParams.get('region') === 'US')).toBe(true);
  await page.getByRole('combobox', { name: 'Região', exact: true }).selectOption('BR');
  await expect(page.getByRole('combobox', { name: 'Streaming', exact: true })).toHaveValue('');
  expect(new URL(page.url()).searchParams.has('provider')).toBe(false);
});

test('movie opens as movie, retains its title and returns to details without an episode index', async ({ page }) => {
  const requests = await cinemaFixtures(page);
  await page.goto(`/cinema/movie/${movie.id}`);
  await page.getByRole('link', { name: 'Consultar fontes e assistir' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Nenhuma fonte QA' })).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe('/watch/stremio:all:movie:tt1234567');
  await expect(page.getByRole('heading', { name: 'Filme QA', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Filme completo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Episódios', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Voltar aos detalhes', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Filme QA', exact: true })).toBeVisible();
  expect(requests.some(url => url.pathname.includes('/streaming/anime/'))).toBe(false);
});

test('catalog failure retries and an empty search remains in its own catalog', async ({ page }) => {
  let failing = true;
  await page.route('**/api/cinema/catalog?**', route => failing
    ? route.fulfill({ status: 503, json: { message: 'O catálogo QA está indisponível.' } })
    : route.fulfill({ json: { data: { items: [], page: 1, hasNextPage: false } } }));
  await page.goto('/cinema?type=series&q=ausente');
  await expect(page.getByRole('alert')).toContainText('O catálogo QA está indisponível.');
  failing = false;
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum título encontrado' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar filmes e séries' })).toHaveValue('ausente');
  await expect(page.locator('video')).toHaveCount(0);
});

test('catalog and series details fit at 320px and reject invalid deep links', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const requests = await cinemaFixtures(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/cinema?type=series');
  await expect(page.getByRole('link', { name: 'Ver Série QA', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Ver Série QA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Série QA', exact: true, level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`/cinema/movie/${movie.id}`);
  await expect(page.getByRole('heading', { name: 'Filme QA', exact: true, level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/cinema/unknown/not-an-id');
  await expect(page.getByRole('heading', { name: 'Título inválido' })).toBeVisible();
  expect(requests.some(url => url.pathname.includes('/unknown/') || url.pathname.includes('not-an-id'))).toBe(false);
  expect(errors).toEqual([]);
});

for (const fixture of [
  { format: 'TV', title: 'Anime de série QA', titleOriginal: 'Original Series QA', expectedType: 'series', expectedSearch: 'Anime de série QA' },
  { format: 'MOVIE', title: 'Anime filme QA', titleOriginal: '', expectedType: 'movie', expectedSearch: 'Anime filme QA' },
]) {
  test(`anime ${fixture.format} searches other sources without guessing its IMDb identity`, async ({ page }) => {
    const requests = await cinemaFixtures(page);
    await page.route('**/api/catalog/anime/24680', route => route.fulfill({ json: { data: {
      id: '24680', title: fixture.title, titleOriginal: fixture.titleOriginal, format: fixture.format, poster: '', genres: [],
    } } }));
    await page.goto('/anime/24680');
    await expect(page.getByRole('heading', { name: fixture.title, level: 1 })).toBeVisible();
    const link = page.getByRole('link', { name: 'Buscar em outras fontes', exact: true });
    const target = new URL(await link.getAttribute('href') || '', page.url());
    expect(target.pathname).toBe('/cinema');
    expect(target.searchParams.get('type')).toBe(fixture.expectedType);
    expect(target.searchParams.get('q')).toBe(fixture.expectedSearch);
    expect(target.searchParams.has('imdb')).toBe(false);
    await link.click();
    await expect(page.getByRole('searchbox', { name: 'Buscar filmes e séries' })).toHaveValue(fixture.expectedSearch);
    await expect(page.getByRole('combobox', { name: 'Catálogo', exact: true })).toHaveValue(fixture.expectedType);
    await expect(page.getByRole('link', { name: fixture.expectedType === 'movie' ? 'Ver Filme QA' : 'Ver Série QA', exact: true })).toBeVisible();
    expect(requests.some(url => url.pathname.startsWith('/api/streaming/episodes/stremio'))).toBe(false);
    expect(new URL(page.url()).pathname).toBe('/cinema');
  });
}
