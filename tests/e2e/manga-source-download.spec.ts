import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';

// Synthetic connected-source contracts and PNGs. These checks do not prove that
// a real provider offers the work, chapter or translation represented below.
const workId = '765432';
const title = 'História das fontes QA';
const chapterId = 'toko-qa-reader-one';
const chapter = {
  id: chapterId, workId: `anilist:${workId}`, providerId: 'qa-reader', providerName: 'Provedor sintético QA',
  number: '1', title: 'Capítulo da fonte 1', language: 'pt-BR', credits: ['Tradução sintética QA'], available: true,
};
const sourceUrl = 'https://provider.example/qa/chapter-one';
const imageIds = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4pKv7HwAFLQIsQvHIzQAAAABJRU5ErkJggg==', 'base64');
const pagesPath = `/api/content/manga/${workId}/chapters/${chapterId}/pages`;
const query = (language = 'pt-BR') => new URLSearchParams({ title, source: 'toko', provider: chapter.providerId, language });
const sourcePath = () => `/sources?${new URLSearchParams({ ...Object.fromEntries(query()), kind: 'manga', id: workId, open: '1' })}`;
const readerPath = (language = 'pt-BR') => `/sources/manga/${workId}/read/${chapterId}?${query(language)}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixtures(page: Page, options: { chapterOverride?: Partial<typeof chapter>; waitForMetadata?: Promise<void>; metadataRequested?: () => void } = {}) {
  const pageRequests: URL[] = [];
  let imageRequests = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (imageIds.some(id => url.pathname === `/api/content/image/${id}`)) {
      imageRequests++;
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    if (url.pathname === `/api/content/manga/${workId}/chapters`) {
      return route.fulfill({ json: { data: { available: true, state: 'available', message: 'Capítulo sintético recebido.', chapters: [chapter], languages: ['pt-BR'], diagnostics: [] } } });
    }
    if (url.pathname === pagesPath) {
      pageRequests.push(url);
      options.metadataRequested?.();
      if (options.waitForMetadata) await options.waitForMetadata;
      return route.fulfill({ json: { data: { chapter: { ...chapter, ...options.chapterOverride }, pages: imageIds.map(id => `/api/content/image/${id}`), sourceUrl, attribution: 'Provedor sintético QA' } } }).catch(() => undefined);
    }
    return route.fulfill({ status: 404, json: { message: 'Nenhuma fixture sintética para este endereço.' } });
  });
  return { pageRequests, imageRequests: () => imageRequests };
}

async function checkDownload(download: Download) {
  expect(download.suggestedFilename()).toBe(`${title} - ${chapter.title} - pt-BR.cbz`);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile((await download.path())!);
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.toString('utf8')).toContain('ComicInfo.xml');
  expect(bytes.toString('utf8')).toContain(sourceUrl);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 375, height: 812 });
});

test('synthetic connected manga downloads from the source list and keeps its reader provider link', async ({ page }) => {
  const { pageRequests } = await fixtures(page);
  await page.goto(sourcePath());
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Baixar .*CBZ$/ }).click();
  await checkDownload(await started);
  expect(pageRequests).toHaveLength(1);
  expect(pageRequests[0].searchParams.get('source')).toBe('toko');
  expect(pageRequests[0].searchParams.get('provider')).toBe(chapter.providerId);
  expect(pageRequests[0].searchParams.get('language')).toBe('pt-BR');
  expect(pageRequests[0].searchParams.get('title')).toBe(title);
  await noOverflow(page);
  await page.getByRole('link', { name: new RegExp(chapter.title) }).click();
  await expect(page.getByAltText('Página 1', { exact: true })).toBeVisible();
  expect(await page.getByAltText('Página 1', { exact: true }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  const provider = page.getByRole('link', { name: 'Abrir no provedor', exact: true });
  await expect(provider).toHaveAttribute('href', sourceUrl);
  await expect(provider).toHaveAttribute('target', '_blank');
  await expect(provider).toHaveAttribute('rel', /noopener noreferrer/);
  const readerDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Baixar .*CBZ$/ }).click();
  await checkDownload(await readerDownload);
  await noOverflow(page);
});

test('synthetic wrong work identity prevents both a source download and reader provider links', async ({ page }) => {
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  const state = await fixtures(page, { chapterOverride: { workId: 'anilist:999999' } });
  await page.goto(sourcePath());
  await page.getByRole('button', { name: /^Baixar .*CBZ$/ }).click();
  await expect(page.getByRole('alert')).toContainText('A fonte retornou outra edição');
  expect(downloads).toHaveLength(0);
  expect(state.imageRequests()).toBe(0);
  await page.getByRole('link', { name: new RegExp(chapter.title) }).click();
  await expect(page.getByRole('alert')).toContainText('Este capítulo não corresponde à edição escolhida');
  await expect(page.getByRole('button', { name: /^Baixar .*CBZ$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir no provedor', exact: true })).toHaveCount(0);
  await expect(page.getByAltText('Página 1', { exact: true })).toHaveCount(0);
  expect(state.imageRequests()).toBe(0);
});

test('synthetic reader rejects English when the selected connected edition is Brazilian Portuguese', async ({ page }) => {
  const state = await fixtures(page, { chapterOverride: { language: 'en' } });
  await page.goto(readerPath());
  await expect(page.getByRole('alert')).toContainText('edição escolhida');
  await expect(page.getByRole('button', { name: /^Baixar .*CBZ$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir no provedor', exact: true })).toHaveCount(0);
  expect(state.imageRequests()).toBe(0);
});

test('synthetic reader accepts a Brazilian Portuguese edition for the all-Portuguese filter', async ({ page }) => {
  await fixtures(page);
  await page.goto(readerPath('pt'));
  await expect(page.getByAltText('Página 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir no provedor', exact: true })).toHaveAttribute('href', sourceUrl);
  await noOverflow(page);
});

test('synthetic connected download cancels immediately while chapter metadata is pending', async ({ page }) => {
  const requested = deferred();
  const release = deferred();
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  const state = await fixtures(page, { waitForMetadata: release.promise, metadataRequested: requested.resolve });
  await page.goto(sourcePath());
  const button = page.getByRole('button', { name: /^Baixar .*CBZ$/ });
  await button.click();
  await requested.promise;
  await page.getByRole('button', { name: 'Cancelar download', exact: true }).click();
  // The metadata response remains blocked during these assertions.
  await expect(button).toBeEnabled({ timeout: 1000 });
  await expect(page.getByRole('status').filter({ hasText: 'Download cancelado.' })).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole('button', { name: 'Cancelar download', exact: true })).toHaveCount(0);
  expect(state.imageRequests()).toBe(0);
  expect(downloads).toHaveLength(0);
  const completed = page.waitForResponse(response => new URL(response.url()).pathname === pagesPath);
  release.resolve();
  await completed;
  const restarted = page.waitForEvent('download');
  await button.click();
  await checkDownload(await restarted);
  expect(downloads).toHaveLength(1);
});
