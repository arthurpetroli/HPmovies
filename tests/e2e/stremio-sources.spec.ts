import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic HTTP contracts only. These cases do not validate external media.
async function unavailableSources(page: Page) {
  const paths: string[] = [];
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    paths.push(path);
    return route.fulfill({ status: 404, json: { message: 'A fonte QA não retornou mídia para este vídeo.' } });
  });
  return paths;
}

test('IMDb form opens exact series identity and preserves its values after reload and return', async ({ page }) => {
  const paths = await unavailableSources(page);
  await page.goto('/sources');
  await page.getByRole('link', { name: 'Consultar filme, série ou anime pelo IMDb' }).click();
  await page.getByRole('textbox', { name: 'ID no IMDb' }).fill('tt1234567');
  await page.getByRole('textbox', { name: 'Título (opcional)' }).fill('Série QA');
  await page.getByRole('spinbutton', { name: 'Temporada', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Episódio', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Consultar e abrir player' }).click();
  await expect(page.getByLabel('Área de reprodução').getByRole('alert')).toContainText('A fonte QA não retornou mídia');
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe('/watch/stremio:all:tt1234567:2:3');
  await expect(page.locator('video')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Área de reprodução').getByRole('alert')).toContainText('A fonte QA não retornou mídia');
  await page.getByRole('link', { name: 'Voltar às fontes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'ID no IMDb' })).toHaveValue('tt1234567');
  await expect(page.getByRole('textbox', { name: 'Título (opcional)' })).toHaveValue('Série QA');
  await expect(page.getByRole('spinbutton', { name: 'Temporada', exact: true })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: 'Episódio', exact: true })).toHaveValue('3');
  expect(paths.filter(path => path.startsWith('/api/streaming/episodes/'))).toEqual([
    '/api/streaming/episodes/stremio:all:tt1234567:2:3', '/api/streaming/episodes/stremio:all:tt1234567:2:3',
  ]);
  expect(paths.some(path => path.startsWith('/api/catalog/'))).toBe(false);
});

test('movie choice removes episode fields and rejects an AniList number before navigation', async ({ page }) => {
  const paths = await unavailableSources(page);
  await page.goto('/sources?kind=stremio');
  await page.getByRole('combobox', { name: 'Tipo de vídeo' }).selectOption('movie');
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'ID no IMDb' }).fill('123456');
  await page.getByRole('button', { name: 'Consultar e abrir player' }).click();
  expect(new URL(page.url()).pathname).toBe('/sources');
  expect(paths).toHaveLength(0);
  await page.getByRole('textbox', { name: 'ID no IMDb' }).fill('tt1234567');
  await page.getByRole('textbox', { name: 'Título (opcional)' }).fill('Filme QA');
  await page.getByRole('button', { name: 'Consultar e abrir player' }).click();
  await expect(page.getByLabel('Área de reprodução').getByRole('alert')).toContainText('A fonte QA não retornou mídia');
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe('/watch/stremio:all:movie:tt1234567');
  await page.getByRole('link', { name: 'Voltar às fontes', exact: true }).first().click();
  await expect(page.getByRole('combobox', { name: 'Tipo de vídeo' })).toHaveValue('movie');
  await expect(page.getByRole('textbox', { name: 'ID no IMDb' })).toHaveValue('tt1234567');
});

test('320px form fits and keyboard submission keeps integer episode validation', async ({ page }) => {
  await unavailableSources(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/sources?kind=stremio');
  await page.getByRole('textbox', { name: 'ID no IMDb' }).fill('tt1234567');
  await page.getByRole('spinbutton', { name: 'Episódio', exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Consultar e abrir player' }).click();
  expect(new URL(page.url()).pathname).toBe('/sources');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('spinbutton', { name: 'Episódio', exact: true }).fill('1');
  await page.getByRole('spinbutton', { name: 'Episódio', exact: true }).press('Enter');
  await expect(page.getByLabel('Área de reprodução').getByRole('alert')).toContainText('A fonte QA não retornou mídia');
});
