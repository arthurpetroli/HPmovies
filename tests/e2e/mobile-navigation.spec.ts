import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Contratos de interface: catálogo e arte sintéticos; nenhuma mídia é reproduzida.
const animes = Array.from({ length: 5 }, (_, index) => ({
  id: String(900 + index),
  title: `Navegação móvel ${index + 1}`,
  poster: `https://qa.hpmovies.invalid/nav-${index + 1}.svg`,
  banner: `https://qa.hpmovies.invalid/nav-banner-${index + 1}.svg`,
  description: `Sinopse da navegação ${index + 1}.`,
  genres: ['Action', 'Fantasy'],
  year: 2026,
  score: 85,
  format: 'TV',
  status: 'RELEASING',
  episodeCount: 12,
}));

async function fixtures(page: Page) {
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="100%" height="100%" fill="#3b6a73"/></svg>',
  }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/catalog/home') data = { trending: animes, popular: animes, airing: animes, topRated: animes, upcoming: animes };
    else if (path === '/api/catalog/genres') data = ['Action', 'Fantasy'];
    else if (path === '/api/catalog/search') data = { items: animes, page: 1, hasNextPage: false, total: animes.length };
    else return route.fulfill({ status: 404, json: { message: 'Rota fora da fixture de navegação.' } });
    return route.fulfill({ json: { data } });
  });
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('a barra inferior concentra os atalhos principais e a gaveta abre o restante', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Barra inferior e gaveta existem apenas em telas estreitas.');
  await fixtures(page);
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Navegação lateral', exact: true });
  const viewport = page.viewportSize()!;

  for (const name of ['Início', 'Explorar animes', 'Minha lista']) await expect(rail.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Buscar animes', exact: true })).toBeVisible();
  await expect(rail.getByRole('link', { name: 'Mangás', exact: true })).toBeHidden();
  await expect(rail.getByRole('link', { name: 'Light novels', exact: true })).toBeHidden();
  const bar = (await page.locator('.navigation-rail').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height);
  expect(bar.y).toBeGreaterThan(viewport.height - 110);
  for (const button of await rail.locator('.rail-link:visible').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // A gaveta lista todos os destinos e fecha com Escape.
  const toggle = page.getByRole('button', { name: 'Expandir navegação', exact: true });
  await toggle.tap();
  await expect(page.locator('.navigation-rail')).toHaveClass(/is-expanded/);
  for (const name of ['Mangás', 'Light novels', 'Agenda de lançamentos', 'Histórico', 'Fontes e disponibilidade', 'Configurações']) {
    await expect(page.getByRole('link', { name, exact: true }).or(page.getByRole('button', { name, exact: true }))).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.navigation-rail')).not.toHaveClass(/is-expanded/);

  // A cortina fecha a gaveta sem acionar o conteúdo por baixo.
  await toggle.tap();
  await expect(page.locator('.rail-scrim')).toBeVisible();
  await page.locator('.rail-scrim').tap({ position: { x: viewport.width - 16, y: 240 } });
  await expect(page.locator('.navigation-rail')).not.toHaveClass(/is-expanded/);
  await expect(page).toHaveURL('/');

  // Seguir um link da gaveta navega e recolhe o menu.
  await toggle.tap();
  await page.getByRole('link', { name: 'Mangás', exact: true }).tap();
  await expect(page).toHaveURL(/\/manga/);
  await expect(page.locator('.navigation-rail')).not.toHaveClass(/is-expanded/);
  expect(await noOverflow(page)).toBe(true);
});

test('deslizar sobre o destaque troca o título e o seletor acompanha', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Gesto de toque.');
  await fixtures(page);
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Anime em destaque', exact: true });
  const title = hero.getByRole('heading', { level: 1 });
  await expect(title).toHaveText(animes[0].title);

  const swipe = (from: number, to: number) => hero.evaluate((element, [start, end]) => {
    const touch = (x: number) => new Touch({ identifier: 1, target: element, clientX: x, clientY: 320 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(start)], targetTouches: [touch(start)], changedTouches: [touch(start)] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], targetTouches: [], changedTouches: [touch(end)] }));
  }, [from, to]);

  await swipe(300, 90);
  await expect(title).toHaveText(animes[1].title);
  await expect(hero.getByRole('button', { name: 'Destaque 2', exact: true })).toHaveAttribute('aria-current', 'true');
  await swipe(90, 300);
  await expect(title).toHaveText(animes[0].title);
  // Um movimento curto ou vertical não troca o destaque.
  await swipe(200, 170);
  await expect(title).toHaveText(animes[0].title);
  expect(await noOverflow(page)).toBe(true);
});

test('no desktop o seletor mostra os pôsteres dos destaques e o dock expande', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Layout de desktop.');
  await fixtures(page);
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Anime em destaque', exact: true });
  await expect(hero.locator('.discover-hero__thumb img')).toHaveCount(animes.length);
  await hero.getByRole('button', { name: 'Destaque 4', exact: true }).click();
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(animes[3].title);
  await expect(hero.getByRole('button', { name: 'Destaque 4', exact: true })).toHaveAttribute('aria-current', 'true');

  const dock = page.locator('.navigation-rail');
  expect((await dock.boundingBox())!.width).toBe(64);
  await page.getByRole('button', { name: 'Expandir navegação', exact: true }).click();
  expect((await dock.boundingBox())!.width).toBe(232);
  await expect(dock.getByText('Light novels', { exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});
