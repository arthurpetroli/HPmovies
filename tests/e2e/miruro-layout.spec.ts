import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// UI contracts only: synthetic artwork/catalog and intentionally unavailable media.
const anime = { id: '21', title: 'Anime do teste de navegação', poster: 'https://qa.hpmovies.invalid/layout.svg', banner: 'https://qa.hpmovies.invalid/layout.svg', genres: ['Action'], year: 2026 };
async function fixture(page: Page) {
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#396c70"/></svg>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/catalog/home') return route.fulfill({ json: { data: { trending: [anime], popular: [anime], airing: [anime], topRated: [anime], upcoming: [] } } });
    if (path === '/api/catalog/genres') return route.fulfill({ json: { data: ['Action'] } });
    if (path === '/api/catalog/anime/21') return route.fulfill({ json: { data: anime } });
    if (path === '/api/streaming/anime/21/episodes') return route.fulfill({ json: { data: { available: true, episodes: [{ id: 'tatakai:21:1', number: 1, title: 'Episódio da fixture' }] } } });
    if (path === '/api/catalog/search') return route.fulfill({ json: { data: { items: [anime], page: 1, hasNextPage: false } } });
    return route.fulfill({ status: 503, json: { message: 'Mídia propositalmente indisponível neste teste de layout.' } });
  });
}

test('navigation exposes working destinations and a keyboard-accessible search', async ({ page }) => {
  await fixture(page);
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Navegação lateral' });
  await expect(rail.getByRole('link', { name: 'Início', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.navigation-rail')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Expandir navegação', exact: true }).click();
  await expect(page.locator('.navigation-rail')).toHaveClass(/is-expanded/);
  await page.getByRole('button', { name: 'Recolher navegação', exact: true }).click();
  await rail.getByRole('link', { name: 'Explorar animes', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar animes', exact: true }).click();
  await expect(page).toHaveURL('/explore');
  await expect(page.getByRole('combobox', { name: 'Buscar animes', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});

test('settings trap focus, close with Escape and persist the ambient preference', async ({ page }) => {
  await fixture(page);
  await page.goto('/watch/anime/21?title=Teste');
  await expect(page.locator('.watch-backdrop')).toBeVisible();
  const open = page.getByRole('button', { name: 'Configurações', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Sua experiência' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Fundo com arte do anime/ }).uncheck();
  await expect(page.locator('.watch-backdrop')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await page.reload();
  await expect(page.locator('.watch-backdrop')).not.toBeVisible();
  await open.click();
  await expect(dialog.getByRole('checkbox', { name: /Fundo com arte do anime/ })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Fechar configurações', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});

test('compact search gains a backdrop only after scrolling and preserves the query', async ({ page, isMobile }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const header = page.locator('.search-header');
  const input = page.getByRole('combobox', { name: 'Buscar animes', exact: true });
  const backdropOpacity = () => header.evaluate(element => getComputedStyle(element, '::before').opacity);
  await expect(header).toHaveAttribute('data-scrolled', 'false');
  expect(await backdropOpacity()).toBe('0');
  const initialBounds = (await input.boundingBox())!;
  expect(initialBounds.height).toBe(36);
  if (!isMobile) expect(initialBounds.width).toBe(440);
  expect((await page.getByRole('button', { name: 'Ver resultados', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await input.fill('navegação');
  await expect(page.getByRole('option').first()).toBeVisible();
  await input.evaluate(element => (element as HTMLInputElement).blur());
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: test.info().outputPath('search-at-top.png') });

  await page.evaluate(() => window.scrollTo(0, 650));
  await expect(header).toHaveAttribute('data-scrolled', 'true');
  expect(await backdropOpacity()).toBe('1');
  await expect(input).toHaveValue('navegação');
  expect((await input.boundingBox())!.y).toBe(initialBounds.y);
  await input.evaluate(element => (element as HTMLInputElement).blur());
  await expect(input).not.toBeFocused();
  // The extra padding keeps a 44px touch area around the smaller visual field.
  await page.locator('.floating-search form').click({ position: { x: 20, y: 1 } });
  await expect(input).toBeFocused();
  await input.evaluate(element => (element as HTMLInputElement).blur());
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: test.info().outputPath('search-after-scroll.png') });

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header).toHaveAttribute('data-scrolled', 'false');
  expect(await backdropOpacity()).toBe('0');
  await expect(input).toHaveValue('navegação');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});
