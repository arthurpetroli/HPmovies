import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// Synthetic catalog and artwork exercise browser interactions only.
// These fixtures do not validate live catalog artwork or video availability.
const animes = Array.from({ length: 8 }, (_, index) => ({
  id: String(800 + index),
  title: `Jornada de teste ${index + 1}`,
  titleOriginal: `Discover fixture ${index + 1}`,
  poster: `https://qa.hpmovies.invalid/discover-${index + 1}.svg`,
  banner: `https://qa.hpmovies.invalid/discover-banner-${index + 1}.svg`,
  description: `Sinopse exclusiva da jornada ${index + 1}: uma equipe atravessa mundos desconhecidos para reencontrar sua cidade.`,
  genres: ['Action', 'Fantasy'],
  year: 2026,
  score: 89 - index,
  format: 'TV',
  status: 'RELEASING',
  episodeCount: 12 + index,
}));
const first = animes[0];

async function catalogFixtures(page: Page) {
  await page.route('https://qa.hpmovies.invalid/**', route => {
    const banner = route.request().url().includes('banner');
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${banner ? 1920 : 900}" height="${banner ? 1080 : 1350}"><defs><linearGradient id="art" x2="1" y2="1"><stop stop-color="#0d4b61"/><stop offset="1" stop-color="#cd672f"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#art)"/><circle cx="70%" cy="35%" r="180" fill="#f4c183" opacity=".65"/><path d="M0 1050 450 390 900 1080Z" fill="#122d43"/><text x="8%" y="85%" fill="white" font-family="sans-serif" font-size="45">Arte sintética de teste</text></svg>`,
    });
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname === '/api/catalog/home') {
      data = { trending: animes, popular: animes, airing: animes, topRated: animes, upcoming: animes };
    } else if (url.pathname === '/api/catalog/genres') {
      data = ['Action', 'Fantasy'];
    } else if (url.pathname === '/api/catalog/search') {
      data = { items: animes, page: 1, hasNextPage: false, total: animes.length };
    } else if (url.pathname.startsWith('/api/catalog/anime/')) {
      data = animes.find(anime => url.pathname.endsWith(`/${anime.id}`));
    } else if (/^\/api\/streaming\/anime\/\d+\/episodes$/.test(url.pathname)) {
      data = { available: false, episodes: [], state: 'empty', message: 'Índice vazio exclusivo deste teste de interface.' };
    } else {
      return route.fulfill({ status: 404, json: { message: 'Rota fora da fixture de design.' } });
    }
    return route.fulfill({ json: { data } });
  });
}

function trendingRow(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Em alta agora', exact: true }) });
}

function firstCard(page: Page) {
  return trendingRow(page).getByRole('article').first();
}

async function previewIsVisible(card: Locator) {
  // Playwright's visibility matcher accepts opacity: 0; verify rendered visibility too.
  const synopsis = card.getByText(first.description, { exact: true });
  await expect(synopsis).toBeVisible();
  await expect.poll(() => synopsis.evaluate(element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))).toBe(true);
  await expect(card.getByText('8.9', { exact: true }).last()).toBeVisible();
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await catalogFixtures(page);
});

test('featured anime controls update title, artwork and detail navigation', async ({ page }) => {
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Anime em destaque', exact: true });
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(first.title);
  await expect(hero.getByRole('button', { name: 'Destaque 1', exact: true })).toHaveAttribute('aria-current', 'true');
  await hero.getByRole('button', { name: 'Próximo destaque', exact: true }).click();
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(animes[1].title);
  await expect(hero.locator('img').first()).toHaveAttribute('src', animes[1].banner);
  await hero.getByRole('button', { name: 'Destaque anterior', exact: true }).click();
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(first.title);
  await hero.getByRole('button', { name: 'Destaque 3', exact: true }).click();
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(animes[2].title);
  await noPageOverflow(page);
  await hero.getByRole('link', { name: 'Explorar anime', exact: true }).click();
  await expect(page).toHaveURL(`/anime/${animes[2].id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(animes[2].title);
});

test('card preview exposes real fixture synopsis and rating, and saves persistently', async ({ page, isMobile }) => {
  await page.goto('/');
  const card = firstCard(page);
  await card.scrollIntoViewIfNeeded();
  if (isMobile) {
    await card.getByRole('button', { name: `Ver prévia de ${first.title}`, exact: true }).tap();
  } else {
    await card.hover();
  }
  await previewIsVisible(card);
  await noPageOverflow(page);
  const save = card.getByRole('button', { name: `Adicionar ${first.title} à lista`, exact: true });
  await save.click();
  await expect(page).toHaveURL('/');
  await expect(card.getByRole('button', { name: `Remover ${first.title} da lista`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/library?format=anime');
  await expect(page.getByRole('link', { name: first.title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: first.title, exact: true })).toBeVisible();
  await noPageOverflow(page);
});

test('keyboard focus reveals preview, Escape dismisses it and details remain reachable', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard preview is covered on desktop; mobile uses an explicit touch control.');
  await page.goto('/');
  const card = firstCard(page);
  await card.getByRole('link', { name: first.title, exact: true }).focus();
  await previewIsVisible(card);
  await page.keyboard.press('Escape');
  await expect(card.getByRole('button', { name: `Ver prévia de ${first.title}`, exact: true })).toBeFocused();
  await expect(card.getByRole('button', { name: `Ver prévia de ${first.title}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await previewIsVisible(card);
  await card.getByRole('link', { name: first.title, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/anime/${first.id}`);
});

test('header navigation and keyboard search work across viewport sizes', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  if (isMobile) {
    await page.getByRole('button', { name: 'Abrir menu', exact: true }).tap();
    await page.getByRole('navigation', { name: 'Principal no celular', exact: true }).getByRole('link', { name: 'Animes', exact: true }).tap();
    await expect(page.getByRole('navigation', { name: 'Principal no celular', exact: true })).toHaveCount(0);
  } else {
    await page.getByRole('navigation', { name: 'Principal', exact: true }).getByRole('link', { name: 'Animes', exact: true }).click();
  }
  await expect(page).toHaveURL('/explore');
  await noPageOverflow(page);
  await page.getByRole('button', { name: 'Buscar animes', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Buscar animes', exact: true });
  await expect(search).toBeFocused();
  await search.fill('Jornada');
  await expect(page.getByRole('option').first()).toContainText(first.title);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL(`/anime/${first.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
  await expect(page.getByRole('combobox', { name: 'Buscar animes', exact: true })).toHaveCount(0);
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});

test('narrow mobile cards expose preview without hover or document overflow', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Small touch viewport regression.');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const card = firstCard(page);
  const preview = card.getByRole('button', { name: `Ver prévia de ${first.title}`, exact: true });
  await preview.scrollIntoViewIfNeeded();
  await preview.tap();
  await previewIsVisible(card);
  await noPageOverflow(page);
  await card.getByText(first.description, { exact: true }).tap();
  await expect(page).toHaveURL(`/anime/${first.id}`);
  await noPageOverflow(page);
});

test('the whole card opens the anime, including synopsis and empty preview space', async ({ page, isMobile }) => {
  await page.goto('/');
  let card = firstCard(page);
  await card.scrollIntoViewIfNeeded();
  if (isMobile) await card.getByRole('button', { name: `Ver prévia de ${first.title}`, exact: true }).tap();
  else await card.hover();
  await previewIsVisible(card);
  await expect(card.getByRole('link')).toHaveCount(1);
  await expect(card.locator('a button, a a')).toHaveCount(0);
  await card.getByText(first.description, { exact: true }).click();
  await expect(page).toHaveURL(`/anime/${first.id}`);

  await page.goto('/');
  card = firstCard(page);
  const link = card.getByRole('link', { name: first.title, exact: true });
  await link.scrollIntoViewIfNeeded();
  if (isMobile) await card.getByRole('button', { name: `Ver prévia de ${first.title}`, exact: true }).tap();
  else await card.hover();
  await previewIsVisible(card);
  const box = await link.boundingBox();
  expect(box).not.toBeNull();
  await link.click({ position: { x: 6, y: box!.height - 6 } });
  await expect(page).toHaveURL(`/anime/${first.id}`);
});
