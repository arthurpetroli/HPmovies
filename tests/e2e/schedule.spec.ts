import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic airing identities and artwork test dates and navigation only.
// They do not assert episode availability, anime media identity or language.
const entries = [
  ['2101', 'Ontem pela manhã', '2026-10-27T12:00:00Z'],
  ['2102', 'Travessia noturna', '2026-10-28T02:30:00Z'],
  ['2103', 'Aurora de teste', '2026-10-28T12:00:00Z'],
  ['2104', 'Horizonte de teste', '2026-10-28T16:30:00Z'],
  ['2105', 'Luzes da noite', '2026-10-28T23:00:00Z'],
  ['2106', 'Amanhã em viagem', '2026-10-29T12:30:00Z'],
  ['2107', 'Segundo horizonte', '2026-10-28T17:00:00Z'],
].map(([id, title, time], index) => ({
  id: `airing-${id}`, airingAt: Date.parse(time) / 1000, episode: index + 1,
  anime: { id, title, titleOriginal: `Schedule fixture ${id}`, poster: `https://qa.hpmovies.invalid/schedule-${id}.svg`, banner: `https://qa.hpmovies.invalid/schedule-banner-${id}.svg`, genres: ['Action'] },
}));

function gate() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
}

async function fixture(page: Page, options: { pending?: ReturnType<typeof gate>; failures?: number; truncated?: boolean; empty?: boolean } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-28T15:00:00Z'));
  const requests: URL[] = [];
  let failures = options.failures || 0;
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#184c52"/><stop offset="1" stop-color="#926449"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/><circle cx="900" cy="250" r="190" fill="#d2af74"/><path d="M0 720 460 200 1000 720Z" fill="#18332f"/><text x="40" y="650" fill="white" font-size="36">Arte sintética da agenda</text></svg>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/catalog/schedule') return route.fulfill({ status: 404, json: { message: 'Rota fora da fixture da agenda.' } });
    requests.push(url);
    await options.pending?.pending;
    if (failures > 0) { failures--; return route.fulfill({ status: 503, json: { message: 'Agenda indisponível na fixture.' } }); }
    const start = Number(url.searchParams.get('start')), end = Number(url.searchParams.get('end'));
    return route.fulfill({ json: { data: { start, end, truncated: options.truncated, items: options.empty ? [] : entries.filter(item => item.airingAt >= start && item.airingAt < end) } } });
  });
  page.on('close', () => options.pending?.release());
  return requests;
}

const days = (page: Page) => page.getByRole('navigation', { name: 'Dias da semana', exact: true });
const cards = (page: Page) => page.locator('.schedule-card');
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

test('weekly agenda groups original airings by local day and period with counts, filters and direct watch links', async ({ page, isMobile }) => {
  const requests = await fixture(page);
  await page.goto('/schedule');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendário de lançamentos');
  await expect(cards(page)).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Manhã', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tarde', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Noite', exact: true })).toBeVisible();
  await expect(days(page).getByRole('button', { name: /^quarta-feira.*4 estreias.*hoje$/ })).toHaveAttribute('aria-pressed', 'true');
  expect(new Date(Number(requests[0].searchParams.get('start')) * 1000).toISOString()).toBe('2026-10-26T03:00:00.000Z');
  expect(new Date(Number(requests[0].searchParams.get('end')) * 1000).toISOString()).toBe('2026-11-02T03:00:00.000Z');
  if (!isMobile) {
    const afternoon = page.locator('.schedule-period').filter({ has: page.getByRole('heading', { name: 'Tarde', exact: true }) }).locator('.schedule-card');
    expect((await afternoon.nth(1).boundingBox())!.x).toBeGreaterThan((await afternoon.first().boundingBox())!.x);
  }
  await page.getByRole('button', { name: 'Planejados', exact: true }).click();
  await expect(cards(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Já lançados', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('Aurora de teste');
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar anime na agenda', exact: true }).fill('HORIZONTE');
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Manhã', exact: true })).toHaveCount(0);
  await expect(cards(page).first()).toHaveAttribute('href', /\/watch\/anime\/2104\?/);
  await expect(cards(page).first()).toHaveAttribute('href', /[?&]episode=4(?:&|$)/);
  await expect(page.locator('.schedule-source-note')).toContainText('exibição original');
  await noOverflow(page);
});

test('changing time zone moves an airing across local dates and week navigation remains bounded', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/schedule');
  await expect(cards(page)).toHaveCount(4);
  await days(page).getByRole('button', { name: /^terça-feira/ }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole('link', { name: /^Travessia noturna, episódio 2, 23:30$/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Fuso horário da agenda', exact: true }).selectOption('UTC');
  await expect(cards(page)).toHaveCount(5);
  await expect(page.getByRole('link', { name: /^Travessia noturna, episódio 2, 02:30$/ })).toBeVisible();
  expect(new Date(Number(requests.at(-1)!.searchParams.get('start')) * 1000).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  await page.getByRole('button', { name: 'Próxima semana', exact: true }).click();
  await expect(page).toHaveURL(/week=1/);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText('Não há exibições programadas para este dia no catálogo.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Esta semana', exact: true }).click();
  await expect(cards(page)).toHaveCount(5);
  await page.goto('/schedule?week=999');
  await expect(page.getByRole('button', { name: 'Próxima semana', exact: true })).toBeDisabled();
  await page.goto('/schedule?week=-999');
  await expect(page.getByRole('button', { name: 'Semana anterior', exact: true })).toBeDisabled();
  await noOverflow(page);
});

test('loading reserves the agenda layout and an upstream failure retries only the schedule', async ({ page }) => {
  const pending = gate();
  const requests = await fixture(page, { pending, failures: 1 });
  await page.goto('/schedule');
  await expect(page.getByLabel('Carregando estreias', { exact: true })).toBeVisible();
  await expect(days(page).getByRole('button')).toHaveCount(7);
  pending.release();
  await expect(page.getByRole('heading', { name: 'Não foi possível carregar a agenda', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Agenda indisponível na fixture.');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(cards(page)).toHaveCount(4);
  expect(requests).toHaveLength(2);
  expect(requests[1].search).toBe(requests[0].search);
  await noOverflow(page);
});

test('an upcoming episode keeps its requested number when no media is available instead of opening episode one', async ({ page }) => {
  await fixture(page);
  const requestedEpisodes: string[] = [];
  await page.route('**/api/content/anime/**/episodes/**', route => {
    requestedEpisodes.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, json: { message: 'Estreia fixture ainda não disponível nas fontes.' } });
  });
  await page.goto('/schedule');
  const upcoming = page.getByRole('link', { name: /^Luzes da noite, episódio 5, 20:00$/ });
  await expect(upcoming).toHaveAttribute('href', /[?&]episode=5(?:&|$)/);
  await upcoming.click();
  await expect(page).toHaveURL(/\/watch\/anime\/2105\?.*episode=5/);
  await expect(page.locator('.watch-stage')).toBeVisible();
  await expect(page.locator('.watch-stage').getByRole('alert')).toContainText('Estreia fixture ainda não disponível nas fontes.');
  expect(requestedEpisodes.length).toBeGreaterThan(0);
  expect(requestedEpisodes.every(path => path === '/api/content/anime/2105/episodes/5')).toBe(true);
});

test('a partial schedule warns about missing entries even when the selected day has no listed airings', async ({ page }) => {
  await fixture(page, { truncated: true, empty: true });
  await page.goto('/schedule');
  await expect(page.getByRole('status')).toContainText('Alguns horários podem não aparecer.');
  await expect(page.getByText('A agenda desta semana está parcial; outros horários podem não aparecer.', { exact: true })).toBeVisible();
  await expect(page.getByText('Não há exibições programadas para este dia no catálogo.', { exact: false })).toHaveCount(0);
});

test('the schedule supports keyboard day selection, small phones, landscape and reduced motion', async ({ page, isMobile }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/schedule');
  await expect(cards(page)).toHaveCount(4);
  if (!isMobile) {
    await page.screenshot({ path: test.info().outputPath('schedule-desktop.png'), fullPage: true });
    const thursday = days(page).getByRole('button', { name: /^quinta-feira/ });
    await thursday.focus();
    await page.keyboard.press('Enter');
    await expect(thursday).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(1);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('schedule-375.png'), fullPage: true });
  await page.setViewportSize({ width: 812, height: 375 });
  await noOverflow(page);
  await expect(page.getByRole('combobox', { name: 'Fuso horário da agenda', exact: true })).toBeVisible();
});
