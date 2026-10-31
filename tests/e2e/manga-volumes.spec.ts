import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';

// Synthetic browser contracts. Real Mangá Livre availability and image content
// are checked separately; production never imports these fixtures.
const mangaId = 'mangalivre:historia-qa';
const chapterId = `${mangaId}/capitulo-1`;
const imageId = '40000000-0000-4000-8000-000000000001';
const secondImageId = '40000000-0000-4000-8000-000000000002';
const jobId = '40000000-0000-4000-8000-000000000003';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4pKv7HwAFLQIsQvHIzQAAAABJRU5ErkJggg==', 'base64');
const manga = {
  id: mangaId, title: 'História dos volumes QA', poster: `/api/manga/image/${imageId}`,
  description: 'Obra sintética dos testes de provedor e volumes.', status: 'ongoing', year: 2026,
  availableLanguages: ['pt-br'], tags: [{ id: 'mangalivre:tag:acao', name: 'Ação' }], authors: ['Autor QA'],
  contentRating: 'safe', providerId: 'mangalivre', providerName: 'Mangá Livre (.to)',
  sourceUrl: 'https://mangalivre.to/manga/historia-qa/',
};
const chapters = [
  { id: chapterId, mangaId, title: 'Capítulo sintético 1', chapter: '1', volume: '1', language: 'pt-br', groups: ['Grupo QA'], pages: 0 },
  { id: `${mangaId}/capitulo-2`, mangaId, title: 'Capítulo sintético 2', chapter: '2', volume: '1', language: 'pt-br', groups: ['Grupo QA'], pages: 0 },
  { id: `${mangaId}/extra`, mangaId, title: 'Extra sintético', chapter: null, volume: null, language: 'pt-br', groups: ['Grupo QA'], pages: 0 },
];
const detailPath = `/manga/${encodeURIComponent(mangaId)}`;
const readerPath = `${detailPath}/read/${encodeURIComponent(chapterId)}`;
const chapterSource = 'https://mangalivre.to/manga/historia-qa/capitulo-1/';

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Small stored ZIP fixture with real directory paths; no archive dependency.
function fixtureZip() {
  const entries = [
    { name: 'História QA/Volume 001/Capítulo 001/001.png', bytes: png },
    { name: 'História QA/Volume 001/Capítulo 002/001.png', bytes: png },
    { name: 'História QA/Volume não informado/Capítulo extra/001.png', bytes: png },
  ];
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const crc = crc32(entry.bytes);
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(entry.bytes.length, 18); header.writeUInt32LE(entry.bytes.length, 22); header.writeUInt16LE(name.length, 26); name.copy(header, 30);
    const directory = Buffer.alloc(46 + name.length);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(entry.bytes.length, 20); directory.writeUInt32LE(entry.bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42); name.copy(directory, 46);
    local.push(header, entry.bytes); central.push(directory); offset += header.length + entry.bytes.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.reduce((sum, part) => sum + part.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

async function verifyZip(download: Download) {
  expect(download.suggestedFilename()).toBe('historia-qa-volumes.zip');
  expect(await download.failure()).toBeNull();
  const bytes = await readFile((await download.path())!);
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  let offset = bytes.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let entry = 0; entry < bytes.readUInt16LE(end + 10); entry++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const length = bytes.readUInt16LE(offset + 28);
    names.push(bytes.subarray(offset + 46, offset + 46 + length).toString('utf8'));
    offset += 46 + length;
  }
  expect(names).toEqual([
    'História QA/Volume 001/Capítulo 001/001.png',
    'História QA/Volume 001/Capítulo 002/001.png',
    'História QA/Volume não informado/Capítulo extra/001.png',
  ]);
}

interface FixtureOptions { failureOnFirstStart?: boolean; stayDownloading?: boolean }
async function fixtures(page: Page, options: FixtureOptions = {}) {
  const state = { starts: [] as Record<string, unknown>[], cancels: 0, polls: 0, requests: [] as URL[] };
  const currentJobId = () => state.starts.length > 1 ? '40000000-0000-4000-8000-000000000004' : jobId;
  const job = (status: 'queued' | 'downloading' | 'ready' | 'failed' | 'cancelled') => ({
    id: currentJobId(), state: status, title: manga.title, completedChapters: status === 'ready' ? 3 : status === 'downloading' ? 1 : 0,
    totalChapters: 3, completedPages: status === 'ready' ? 6 : status === 'downloading' ? 2 : 0, bytes: status === 'ready' ? fixtureZip().length : 128,
    message: status === 'failed' ? 'A fonte sintética falhou. Tente novamente.' : status === 'cancelled' ? 'Download do mangá cancelado.' : status === 'ready' ? 'ZIP pronto para salvar.' : 'Preparando capítulos sintéticos…',
    ...(status === 'ready' ? { fileUrl: `/api/manga/archives/${currentJobId()}/file` } : {}),
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); state.requests.push(url);
    const path = decodeURIComponent(url.pathname);
    if ([imageId, secondImageId].some(id => path === `/api/manga/image/${id}`)) return route.fulfill({ contentType: 'image/png', body: png });
    if (/^\/api\/manga\/archives\/[0-9a-f-]{36}\/file$/.test(path)) return route.fulfill({ contentType: 'application/zip', headers: { 'Content-Disposition': 'attachment; filename="historia-qa-volumes.zip"' }, body: fixtureZip() });
    let data: unknown;
    if (path === '/api/manga/home') data = { popular: [manga], topRated: [], ongoing: [], latest: [], warnings: [] };
    else if (path === '/api/manga/search') data = { items: [manga], page: 1, total: 1, hasNextPage: false };
    else if (path === '/api/manga/tags') data = manga.tags;
    else if (path === `/api/manga/${mangaId}`) data = manga;
    else if (path === `/api/manga/${mangaId}/chapters`) data = { items: chapters, language: 'pt-br', page: 1, total: 3, hasNextPage: false };
    else if (path === `/api/manga/chapter/${chapterId}/pages`) data = {
      chapter: { ...chapters[0], pages: 2 }, pages: [imageId, secondImageId].map(id => `/api/manga/image/${id}`), sourceUrl: chapterSource, navigation: { nextId: chapters[1].id },
    };
    else if (path === `/api/manga/${mangaId}/archive-plan`) data = {
      mangaId, title: manga.title, language: 'pt-br', chapters, volumes: [{ volume: '1', chapters: 2 }, { volume: null, chapters: 1 }],
      externalChapters: 0, groups: ['Grupo QA'], warnings: ['Um capítulo não informa volume.'],
    };
    else if (path === '/api/manga/archives' && route.request().method() === 'POST') {
      state.starts.push(route.request().postDataJSON()); state.polls = 0;
      data = job('queued');
    } else if (/^\/api\/manga\/archives\/[0-9a-f-]{36}\/cancel$/.test(path) && route.request().method() === 'POST') {
      state.cancels++; data = job('cancelled');
    } else if (/^\/api\/manga\/archives\/[0-9a-f-]{36}$/.test(path)) {
      state.polls++;
      data = job(options.failureOnFirstStart && state.starts.length === 1 ? 'failed' : options.stayDownloading || state.polls === 1 ? 'downloading' : 'ready');
    } else return route.fulfill({ status: 404, json: { message: 'Nenhuma fixture sintética para este endereço.' } });
    return route.fulfill({ json: { data } });
  });
  return state;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function openPanel(page: Page) {
  await page.goto(detailPath);
  await page.getByRole('button', { name: 'Ver volumes e baixar mangá inteiro', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Volume para baixar', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 375, height: 812 });
});

test('synthetic Manga Livre keeps encoded navigation, chapter CBZ and persisted reading progress', async ({ page }) => {
  const state = await fixtures(page);
  await page.goto('/manga?provider=mangalivre');
  await expect(page.getByRole('combobox', { name: 'Provedor', exact: true })).toHaveValue('mangalivre');
  await page.getByRole('link', { name: manga.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${detailPath}(?:\\?|$)`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(manga.title);
  await expect(page.getByRole('link', { name: /Ver obra no/ })).toHaveAttribute('href', manga.sourceUrl);
  await expect(page.getByRole('link', { name: 'Começar a ler', exact: true })).toHaveAttribute('href', readerPath);
  const cbzStarted = page.waitForEvent('download');
  await page.getByRole('button', { name: `Baixar ${chapters[0].title} em CBZ`, exact: true }).click();
  expect((await cbzStarted).suggestedFilename()).toBe(`${manga.title} - ${chapters[0].title} - pt-br.cbz`);
  await page.getByRole('link', { name: 'Começar a ler', exact: true }).click();
  await expect(page).toHaveURL(readerPath);
  await expect(page.getByAltText('Página 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir no provedor', exact: true })).toHaveAttribute('href', chapterSource);
  await page.getByRole('button', { name: 'Preferências de leitura' }).click();
  await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('single');
  await page.getByRole('button', { name: 'Fechar preferências' }).click();
  await page.getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(page.getByAltText('Página 2', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hpmovies.manga.library.v1'))).toContain(chapterId);
  await page.reload();
  await expect(page.getByAltText('Página 2', { exact: true })).toBeVisible();
  expect(state.requests.filter(url => url.pathname.endsWith('/home')).every(url => url.searchParams.get('provider') === 'mangalivre')).toBe(true);
  await noOverflow(page);
});

test('synthetic whole manga ZIP retains volume and chapter folders including unknown volumes', async ({ page }) => {
  const state = await fixtures(page);
  await openPanel(page);
  const volume = page.getByRole('combobox', { name: 'Volume para baixar', exact: true });
  await expect(volume.locator('option')).toHaveText(['Volume 1 · 2 capítulos', 'Volume não informado · 1 capítulos']);
  await page.getByRole('button', { name: 'Baixar mangá inteiro', exact: true }).click();
  await expect(page.locator('.manga-archive-progress')).toContainText('1 de 3 capítulos');
  const save = page.getByRole('link', { name: 'Salvar ZIP com volumes', exact: true });
  await expect(save).toBeVisible();
  expect(state.starts[0]).toEqual({ mangaId, language: 'pt-br', scope: 'all' });
  await expect(save).toHaveAttribute('href', `/api/manga/archives/${jobId}/file`);
  await expect(save).toHaveAttribute('download', '');
  // Chromium sends native <a download> transfers outside Playwright routing.
  // Use the attachment response to download the synthetic ZIP through routing;
  // the real-provider check separately exercises the native download attribute.
  await save.evaluate(link => link.removeAttribute('download'));
  const downloaded = page.waitForEvent('download');
  await save.click();
  await verifyZip(await downloaded);
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-manga-volumes-${test.info().project.name}.png`, fullPage: true });
});

test('synthetic selected volume posts its exact identity without inventing an unknown volume number', async ({ page }) => {
  const state = await fixtures(page);
  await openPanel(page);
  await page.getByRole('combobox', { name: 'Volume para baixar', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Baixar volume', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Salvar ZIP com volumes', exact: true })).toBeVisible();
  expect(state.starts).toEqual([{ mangaId, language: 'pt-br', scope: 'volume', volume: null }]);
  await noOverflow(page);
});

test('synthetic whole manga download cancels and can be started again', async ({ page }) => {
  const state = await fixtures(page, { stayDownloading: true });
  await openPanel(page);
  await page.getByRole('button', { name: 'Baixar mangá inteiro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancelar download do mangá', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar download do mangá', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Download do mangá cancelado.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar mangá inteiro', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Salvar ZIP com volumes', exact: true })).toHaveCount(0);
  expect(state.cancels).toBe(1);
  expect(await page.evaluate(key => localStorage.getItem(key), `hpmovies.manga-archive:${mangaId}:pt-br`)).toBeNull();
  await page.getByRole('button', { name: 'Baixar mangá inteiro', exact: true }).click();
  await expect.poll(() => state.starts.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Cancelar download do mangá', exact: true })).toBeVisible();
  await noOverflow(page);
});

test('synthetic whole manga failure keeps the ZIP unavailable and allows a fresh retry', async ({ page }) => {
  const state = await fixtures(page, { failureOnFirstStart: true });
  await openPanel(page);
  await page.getByRole('button', { name: 'Baixar mangá inteiro', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'A fonte sintética falhou.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Salvar ZIP com volumes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Baixar mangá inteiro', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Baixar mangá inteiro', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Salvar ZIP com volumes', exact: true })).toBeVisible();
  expect(state.starts).toHaveLength(2);
  await noOverflow(page);
});
