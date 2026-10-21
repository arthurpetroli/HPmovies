import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Browser-only source contracts; production never imports these fixtures.
const id = '12345';
const title = 'História exclusiva do teste de fontes';
const chapterId = 'tatakai-fixture-one';
const nextChapterId = 'tatakai-fixture-two';
const chapter = { id: chapterId, workId: `anilist:${id}`, providerId: 'fixture', providerName: 'Fonte QA', number: '1', title: 'Primeiro capítulo QA', language: 'pt-BR', credits: ['Crédito QA'], available: true };

async function mockSources(page: Page) {
  const requests: URL[] = [];
  const catalogRequests: string[] = [];
  await page.route('https://qa-source.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#194b40"/></svg>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname.startsWith('/api/catalog/') || url.pathname.startsWith('/api/manga/')) {
      catalogRequests.push(url.pathname);
      return route.fulfill({ status: 503, json: { message: 'Catálogo indisponível no teste.' } });
    }
    if (url.pathname === `/api/content/manga/${id}/chapters` || url.pathname === `/api/content/novel/${id}/chapters`) {
      return route.fulfill({ json: { data: { available: true, state: 'available', message: 'Capítulos recebidos da fonte de teste.', chapters: [chapter, { ...chapter, id: nextChapterId, number: '2', title: 'Segundo capítulo QA' }], languages: ['pt-BR'], diagnostics: [] } } });
    }
    if (url.pathname.startsWith(`/api/content/manga/${id}/chapters/`)) {
      const next = url.pathname.includes(nextChapterId);
      return route.fulfill({ json: { data: { chapter: { ...chapter, id: next ? nextChapterId : chapterId }, pages: ['https://qa-source.hpmovies.invalid/1.svg', 'https://qa-source.hpmovies.invalid/2.svg'], nextChapterId: next ? undefined : nextChapterId, attribution: 'Crédito QA' } } });
    }
    if (url.pathname.startsWith(`/api/novels/${id}/chapters/`)) {
      const next = url.pathname.includes(nextChapterId);
      return route.fulfill({ json: { data: { available: true, status: 'available', providerId: 'tatakai', message: 'Texto recebido.', novel: { id, title, poster: '', genres: [] }, chapter: { id: next ? nextChapterId : chapterId, title: next ? 'Segundo capítulo QA' : chapter.title, number: next ? 2 : 1, language: 'pt-BR' }, paragraphs: ['Texto original exclusivo do teste de navegador.', 'Segundo parágrafo para verificar a leitura.'], nextChapterId: next ? undefined : nextChapterId, isDemo: false } } });
    }
    if (url.pathname.startsWith('/api/content/anime/')) return route.fulfill({ status: 503, json: { error: 'STREAM_UNAVAILABLE', message: 'A fonte conectada não retornou vídeo para este episódio.' } });
    return route.continue();
  });
  return { requests, catalogRequests };
}

test('manual source manga uses the existing reader and preserves title, progress and next chapter', async ({ page }) => {
  const { requests, catalogRequests } = await mockSources(page);
  await page.goto('/sources?kind=manga');
  await page.getByRole('textbox', { name: 'ID no AniList' }).fill(id);
  await page.getByRole('textbox', { name: 'Título da obra' }).fill(title);
  await page.getByRole('combobox', { name: 'Fonte', exact: true }).selectOption('tatakai');
  await page.getByRole('button', { name: 'Consultar fontes' }).click();
  await page.getByRole('link', { name: /Primeiro capítulo QA/ }).click();
  await expect(page.getByAltText('Página 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preferências de leitura' }).click();
  await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('single');
  await page.getByRole('button', { name: 'Fechar preferências' }).click();
  await page.getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(page.getByAltText('Página 2', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hpmovies.source-manga:12345:tatakai:fixture'))).toContain('"page":1');
  await page.reload();
  await expect(page.getByAltText('Página 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Próximo capítulo', exact: false }).click();
  await expect(page).toHaveURL(new RegExp(nextChapterId));
  expect(new URL(page.url()).searchParams.get('title')).toBe(title);
  expect(requests.filter(url => url.pathname.includes('/pages')).every(url => url.searchParams.get('title') === title)).toBe(true);
  expect(catalogRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('source novel opens the existing text reader and keeps source hints after reload and next chapter', async ({ page }) => {
  const { requests, catalogRequests } = await mockSources(page);
  await page.goto(`/sources?${new URLSearchParams({ kind: 'novel', id, title, source: 'tatakai', open: '1' })}`);
  await page.getByRole('link', { name: /Primeiro capítulo QA/ }).click();
  await expect(page.getByRole('article')).toContainText('Texto original exclusivo do teste');
  await page.reload();
  await expect(page.getByRole('article')).toContainText('Segundo parágrafo');
  await page.getByRole('link', { name: 'Próximo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Segundo capítulo QA' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('title')).toBe(title);
  expect(requests.filter(url => url.pathname.endsWith('/content')).every(url => url.searchParams.get('title') === title)).toBe(true);
  expect(catalogRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('a source without a stream shows its real failure without opening a demo', async ({ page }) => {
  await mockSources(page);
  await page.goto(`/sources?${new URLSearchParams({ kind: 'anime', id, title, source: 'tatakai', episode: '1', open: '1' })}`);
  await expect(page.getByText('A fonte conectada não retornou vídeo para este episódio.')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/sources');
  await expect(page.locator('video')).toHaveCount(0);
});

test('resolved anime opens the existing player and returns to its source form without a redirect loop', async ({ page }) => {
  await mockSources(page);
  const episodeId = `tatakai:${id}:1`;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/content/anime/') && !url.pathname.startsWith('/api/streaming/episodes/')) return route.fallback();
    expect(url.searchParams.get('title') ?? url.searchParams.get('titles[]')).toBe(title);
    return route.fulfill({ json: { data: { episode: { id: episodeId, title: 'Episódio da fonte QA', available: true, number: 1 }, sources: [{ url: 'https://qa-source.hpmovies.invalid/video.mp4', type: 'mp4', label: 'Fonte QA' }], subtitles: [], audioLanguages: [], isDemo: false } } });
  });
  await page.goto(`/sources?${new URLSearchParams({ kind: 'anime', id, title, source: 'tatakai', episode: '1', open: '1' })}`);
  await expect(page.getByRole('heading', { name: 'Episódio da fonte QA' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Episódio da fonte QA' })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar às fontes' }).click();
  await expect(page.getByRole('textbox', { name: 'ID no AniList' })).toHaveValue(id);
  await expect(page.getByRole('textbox', { name: 'Título da obra' })).toHaveValue(title);
  await expect(page.locator('video')).toHaveCount(0);
});
