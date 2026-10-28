import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const anime = {
  id: '21', title: 'Anime de teste dos episódios', titleOriginal: 'Título original dos episódios',
  poster: 'https://qa.hpmovies.invalid/episodes.svg', genres: ['Action'], episodeCount: 1200,
  description: 'Sinopse exclusiva para teste de navegação entre episódios.',
};
const episode = (number: number) => ({ id: `tatakai:21:${number}`, number, title: `Aventura de teste ${number}` });

async function catalog(page: Page, onDetails?: () => void) {
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#164b40"/></svg>' }));
  await page.route('**/api/catalog/anime/21', async route => {
    onDetails?.();
    // The episode request must wait for these titles rather than racing the catalog.
    await new Promise(resolve => setTimeout(resolve, 100));
    return route.fulfill({ json: { data: anime } });
  });
}

test('real episode index is paginated and searchable with title hints preserved', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await catalog(page);
  const episodeRequests: URL[] = [];
  await page.route('**/api/streaming/anime/21/episodes**', route => {
    episodeRequests.push(new URL(route.request().url()));
    // An index can exist before any individual video has been resolved.
    return route.fulfill({ json: { data: { available: false, episodes: [...Array.from({ length: 105 }, (_, index) => episode(index + 1)), episode(1000)] } } });
  });
  const playbackRequests: URL[] = [];
  await page.route('**/api/streaming/episodes/**', route => {
    playbackRequests.push(new URL(route.request().url()));
    return route.fulfill({ status: 503, json: { message: 'Falha sintética de reprodução no teste.' } });
  });
  await page.goto('/anime/21');
  const section = page.getByRole('region', { name: 'Episódios', exact: true });
  await expect(section.getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(24);
  await expect(section.getByText('106 episódios', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Episódios e disponibilidade' })).toHaveCount(0);
  expect(episodeRequests).toHaveLength(1);
  expect(episodeRequests[0].searchParams.getAll('titles[]')).toEqual([anime.title, anime.titleOriginal]);
  await page.getByRole('button', { name: 'Próxima página de episódios' }).click();
  await expect(section.getByRole('link', { name: 'Assistir episódio 25 — Aventura de teste 25', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Intervalo de episódios' }).selectOption('2');
  await expect(section.getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(5);
  await page.getByRole('searchbox', { name: 'Buscar episódio por número ou título' }).fill('1000');
  await expect(section.getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'Intervalo de episódios' })).toHaveValue('all');
  await section.getByRole('link', { name: 'Assistir episódio 1000 — Aventura de teste 1000' }).click();
  await expect(page).toHaveURL(/watch\/tatakai%3A21%3A1000\?/);
  expect(new URL(page.url()).searchParams.getAll('title')).toEqual([anime.title, anime.titleOriginal]);
  await expect.poll(() => playbackRequests.length).toBe(1);
  expect(playbackRequests[0].searchParams.getAll('titles[]')).toEqual([anime.title, anime.titleOriginal]);
  await page.reload();
  await expect.poll(() => playbackRequests.length).toBe(2);
  expect(playbackRequests[1].searchParams.getAll('titles[]')).toEqual([anime.title, anime.titleOriginal]);
  await expect(page.getByRole('link', { name: 'Ver anime', exact: true })).toHaveAttribute('href', '/anime/21');
  await page.getByRole('link', { name: 'Ver anime', exact: true }).click();
  await expect(section.getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(24);
  expect(errors).toEqual([]);
});

test('missing index is honest and retry reloads only episodes', async ({ page }) => {
  let detailsRequests = 0;
  let episodeRequests = 0;
  await catalog(page, () => detailsRequests++);
  await page.route('**/api/streaming/anime/21/episodes**', route => {
    episodeRequests++;
    return route.fulfill({ json: { data: episodeRequests === 1
      ? { available: false, episodes: [], state: 'empty', message: 'O índice não encontrou episódios deste título.' }
      : { available: true, episodes: [episode(1)] } } });
  });
  await page.goto('/anime/21');
  await expect(page.getByRole('heading', { name: 'Nenhum episódio encontrado para este anime' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Assistir episódio/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Episódios', exact: true }).getByRole('link', { name: /Consultar episódio nas fontes|Conhecer o player/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Buscar episódios novamente' }).click();
  await expect(page.getByRole('link', { name: 'Assistir episódio 1 — Aventura de teste 1' })).toBeVisible();
  expect(episodeRequests).toBe(2);
  expect(detailsRequests).toBe(1);
});

test('episode connection failure keeps anime details and never reports a catalog outage', async ({ page }) => {
  await catalog(page);
  await page.route('**/api/streaming/anime/21/episodes**', route => route.fulfill({ status: 503, json: { message: 'Não foi possível conectar às fontes de vídeo.' } }));
  await page.goto('/anime/21');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(anime.title);
  await expect(page.getByRole('heading', { name: 'Não foi possível carregar os episódios' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'O catálogo está fora de alcance' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Buscar episódios novamente' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
