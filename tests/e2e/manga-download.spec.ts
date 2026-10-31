import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type { Download, Page, Route } from '@playwright/test';

// All manga metadata and PNGs below are synthetic browser fixtures. These tests
// validate the download contract, not the availability or contents of live sources.
const mangaId = '10000000-0000-0000-0000-000000000001';
const chapterId = '10000000-0000-0000-0000-000000000002';
const externalChapterId = '10000000-0000-0000-0000-000000000003';
const imageIds = ['10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005'];
const pngs = [
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4pKv7HwAFLQIsQvHIzQAAAABJRU5ErkJggg==', 'base64'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQbbr0HwAE4gKBWNQRSwAAAABJRU5ErkJggg==', 'base64'),
];
const manga = {
  id: mangaId, title: 'Mangá de download QA', poster: 'https://qa.hpmovies.invalid/manga-cover.png',
  description: 'Obra sintética exclusiva dos testes de download.', status: 'ongoing', year: 2026,
  availableLanguages: ['pt-br'], tags: [], authors: ['Autor sintético'], contentRating: 'safe',
  sourceUrl: `https://mangadex.org/title/${mangaId}`,
};
const chapter = {
  id: chapterId, mangaId, title: 'Capítulo sintético 1', chapter: '1', volume: '1',
  language: 'pt-br', groups: ['Grupo sintético QA'], pages: 2,
};
const externalChapter = {
  ...chapter, id: externalChapterId, title: 'Capítulo externo sintético', chapter: '2', pages: 0,
  externalUrl: 'https://publisher.example/qa/chapter-2',
};
const chapterSource = `https://mangadex.org/chapter/${chapterId}`;
const archiveFilename = `${manga.title} - ${chapter.title} - pt-br.cbz`;

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 375, height: 812 });
});

async function fixtures(page: Page, imageHandler?: (route: Route, index: number) => Promise<void>) {
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/png', body: pngs[0] }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const index = imageIds.findIndex(id => url.pathname === `/api/manga/image/${id}`);
    if (index >= 0) {
      if (imageHandler && route.request().resourceType() === 'fetch') return imageHandler(route, index);
      return route.fulfill({ contentType: 'image/png', body: pngs[index] });
    }
    let data: unknown;
    if (url.pathname === `/api/manga/${mangaId}`) data = manga;
    else if (url.pathname === `/api/manga/${mangaId}/chapters`) data = {
      items: [chapter, externalChapter], language: 'pt-br', page: 1, total: 2, hasNextPage: false,
    };
    else if (url.pathname === `/api/manga/chapter/${chapterId}/pages`) data = {
      chapter, pages: imageIds.map(id => `/api/manga/image/${id}`), sourceUrl: chapterSource,
    };
    else return route.fulfill({ status: 404, json: { message: 'No synthetic fixture for this request.' } });
    return route.fulfill({ json: { data } });
  });
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function archiveEntries(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let entry = 0; entry < count; entry++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    expect(bytes.readUInt16LE(offset + 10)).toBe(0); // Stored ZIP entries preserve the original image bytes.
    const length = bytes.readUInt32LE(offset + 20);
    expect(bytes.readUInt32LE(offset + 24)).toBe(length);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    expect(name).not.toMatch(/(^\/|\.\.|\\)/);
    const local = bytes.readUInt32LE(offset + 42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + length);
    expect(crc32(body)).toBe(bytes.readUInt32LE(offset + 16));
    expect(entries.has(name)).toBe(false);
    entries.set(name, body);
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  expect(entries.size).toBe(3);
  const images = [...entries].filter(([name]) => name.endsWith('.png'));
  expect(images).toHaveLength(2);
  expect(images.map(([name]) => name)).toEqual([...images.map(([name]) => name)].sort());
  for (let index = 0; index < images.length; index++) {
    expect(images[index][0]).toMatch(new RegExp(`^0*${index + 1}\\.png$`));
    expect(images[index][1].equals(pngs[index])).toBe(true);
  }
  const info = entries.get('ComicInfo.xml')?.toString('utf8');
  expect(info).toContain('<ComicInfo');
  expect(info).toContain(chapter.title);
  expect(info).toContain(manga.title);
  expect(info).toContain(chapterSource);
  return entries;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function expectSafeLink(page: Page, name: string, href: string) {
  const link = page.getByRole('link', { name, exact: true });
  await expect(link).toHaveAttribute('href', href);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveAttribute('rel', /noreferrer/);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve: () => resolve() };
}

test('synthetic manga details keep reading and provider links while downloading an ordered CBZ', async ({ page }, testInfo) => {
  await fixtures(page);
  await page.goto(`/manga/${mangaId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(manga.title);
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue('pt-br');
  await expect(page.getByRole('link', { name: 'Começar a ler', exact: true })).toHaveAttribute('href', `/manga/${mangaId}/read/${chapterId}`);
  await expectSafeLink(page, `Abrir ${chapter.title} no MangaDex`, chapterSource);
  const external = page.locator('a.manga-chapter-item').filter({ hasText: externalChapter.title });
  await expect(external).toHaveAttribute('href', externalChapter.externalUrl);
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', /noopener/);
  await expect(page.getByRole('button', { name: `Baixar ${externalChapter.title} em CBZ`, exact: true })).toHaveCount(0);
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: `Baixar ${chapter.title} em CBZ`, exact: true }).click();
  const download = await started;
  expect(download.suggestedFilename()).toBe(archiveFilename);
  expect(download.suggestedFilename()).not.toMatch(/[\\/]/);
  await archiveEntries(download);
  await expect(page.getByRole('status').filter({ hasText: /Download iniciado/i })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-manga-download-${testInfo.project.name}-details.png`, fullPage: true });
  await page.getByRole('link', { name: 'Começar a ler', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/read/${chapterId}$`));
  await expect(page.getByAltText('Página 1', { exact: true })).toBeVisible();
});

test('synthetic manga reader downloads original PNGs and links to its provider on desktop and mobile', async ({ page }, testInfo) => {
  await fixtures(page);
  await page.goto(`/manga/${mangaId}/read/${chapterId}`);
  await expect(page.getByAltText('Página 1', { exact: true })).toBeVisible();
  expect(await page.getByAltText('Página 1', { exact: true }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await expectSafeLink(page, 'Abrir no provedor', chapterSource);
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar CBZ', exact: true }).click();
  const download = await started;
  expect(download.suggestedFilename()).toBe(archiveFilename);
  await archiveEntries(download);
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-manga-download-${testInfo.project.name}-reader.png`, fullPage: true });
});

test('synthetic manga download can be cancelled without creating a partial file', async ({ page }) => {
  const requested = deferred();
  const release = deferred();
  let hold = true;
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  await fixtures(page, async (route, index) => {
    if (hold) {
      requested.resolve();
      await release.promise;
    }
    await route.fulfill({ contentType: 'image/png', body: pngs[index] }).catch(() => undefined);
  });
  await page.goto(`/manga/${mangaId}`);
  const button = page.getByRole('button', { name: `Baixar ${chapter.title} em CBZ`, exact: true });
  await button.click();
  await requested.promise;
  await expect(page.getByRole('status').filter({ hasText: /Baixando páginas:.*de 2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar download', exact: true }).click();
  hold = false;
  release.resolve();
  await expect(button).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancelar download', exact: true })).toHaveCount(0);
  expect(downloads).toHaveLength(0);
  await noOverflow(page);
  const started = page.waitForEvent('download');
  await button.click();
  await archiveEntries(await started);
  expect(downloads).toHaveLength(1);
});

test('synthetic manga HTTP failure keeps the file incomplete and allows a fresh retry', async ({ page }) => {
  let fail = true;
  const downloads: Download[] = [];
  page.on('download', download => downloads.push(download));
  await fixtures(page, async (route, index) => {
    if (fail && index === 1) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic unavailable page' });
    return route.fulfill({ contentType: 'image/png', body: pngs[index] });
  });
  await page.goto(`/manga/${mangaId}`);
  const button = page.getByRole('button', { name: `Baixar ${chapter.title} em CBZ`, exact: true });
  await button.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(button).toBeEnabled();
  expect(downloads).toHaveLength(0);
  await noOverflow(page);
  fail = false;
  const started = page.waitForEvent('download');
  await button.click();
  await archiveEntries(await started);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(downloads).toHaveLength(1);
});
