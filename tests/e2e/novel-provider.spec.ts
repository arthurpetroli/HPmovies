import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { NovelReadingResult, NovelTitle } from '../../src/shared/novel';

// Browser-only synthetic contracts. These tests do not prove the availability,
// identity or translation of any real Novel Mania work or chapter.
const novelId = 'novelmania:historia-qa';
const firstId = `${novelId}/volume-1-capitulo-1`;
const secondId = `${novelId}/volume-1-capitulo-2`;
const foreignId = 'novelmania:outra-historia/volume-1-capitulo-1';
const detailsPath = `/novel/${encodeURIComponent(novelId)}`;
const readerPath = (chapterId = firstId) => `${detailsPath}/read/${encodeURIComponent(chapterId)}`;
const sourceUrl = 'https://novelmania.com.br/novels/historia-qa';
const chapterSource = `${sourceUrl}/capitulos/volume-1-capitulo-1`;
const cover = 'https://qa-novels.hpmovies.invalid/cover.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4pKv7HwAFLQIsQvHIzQAAAABJRU5ErkJggg==', 'base64');
const novel: NovelTitle = {
  id: novelId, title: 'História sintética da biblioteca QA', poster: cover,
  description: 'Sinopse sintética exclusiva destes testes de navegador.', genres: ['Fantasia'],
  providerId: 'novelmania', providerName: 'Novel Mania', availableLanguages: ['pt-br'], sourceUrl,
};
const chapters = [
  { id: firstId, number: 1, title: 'A porta sintética', language: 'pt-br' },
  { id: secondId, number: 2, title: 'O caminho sintético', language: 'pt-br' },
];
const paragraphs = Array.from({ length: 18 }, (_, index) => `Parágrafo sintético ${index + 1}. Esta história foi escrita apenas para verificar leitura, preferências e retomada no navegador. O leitor conserva as palavras e a ordem dos parágrafos ao mudar a fonte, o tema ou o tamanho da tela.`);
function reading(chapterId: string): NovelReadingResult {
  const second = chapterId === secondId;
  return {
    available: true, status: 'available', providerId: 'novelmania', message: 'Texto sintético recebido da fonte de teste.',
    novel, chapter: second ? chapters[1] : chapters[0], paragraphs,
    sourceUrl: second ? `${sourceUrl}/capitulos/volume-1-capitulo-2` : chapterSource,
    attribution: 'Novel Mania · Tradução sintética QA', isDemo: false,
    previousChapterId: second ? firstId : undefined, nextChapterId: second ? undefined : secondId,
  };
}

async function fixtures(page: Page, options: { content?: (content: NovelReadingResult) => NovelReadingResult; unavailable?: () => boolean } = {}) {
  const requests: URL[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://qa-novels.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); requests.push(url);
    const segments = url.pathname.split('/').map(segment => decodeURIComponent(segment));
    let data: unknown;
    if (url.pathname === '/api/novels/search') data = {
      items: url.searchParams.get('provider') === 'anilist' ? [{ ...novel, id: '12345', title: 'Metadado AniList QA', providerId: 'anilist', providerName: 'AniList', sourceUrl: 'https://anilist.co/manga/12345' }] : [novel],
      page: Number(url.searchParams.get('page') || 1), total: 1, hasNextPage: false,
    };
    else if (url.pathname === '/api/novels/genres') data = ['Fantasia', 'Aventura'];
    else if (segments[3] === novelId && segments.length === 4) data = novel;
    else if (segments[3] === novelId && segments[4] === 'chapters' && segments.length === 5) data = {
      available: true, status: 'available', providerId: 'novelmania', message: 'Capítulos sintéticos em português.', chapters,
    };
    else if (segments[3] === novelId && segments[4] === 'chapters' && segments[6] === 'content') {
      if (options.unavailable?.()) return route.fulfill({ status: 503, json: { error: 'QA_NOVEL_SOURCE_UNAVAILABLE', message: 'Fonte sintética indisponível. Tente novamente.' } });
      const content = reading(segments[5]); data = options.content ? options.content(content) : content;
    } else return route.fulfill({ status: 404, json: { message: 'Nenhuma fixture sintética foi definida para esta rota.' } });
    return route.fulfill({ json: { data } });
  });
  return { requests, errors };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function safeSource(page: Page, name: string, href: string) {
  const link = page.getByRole('link', { name, exact: true });
  await expect(link).toHaveAttribute('href', href);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/); await expect(link).toHaveAttribute('rel', /noreferrer/);
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 375, height: 812 });
});

test('synthetic Portuguese novel discovery keeps provider filters and opens qualified chapter IDs in the native reader', async ({ page }, testInfo) => {
  const { requests, errors } = await fixtures(page);
  await page.goto('/novels');
  await expect(page.getByRole('combobox', { name: 'Provedor', exact: true })).toHaveValue('novelmania');
  await expect(page.getByRole('link', { name: `Ver ${novel.title}`, exact: true })).toHaveAttribute('href', detailsPath);
  await expect(page.getByRole('spinbutton', { name: 'Ano', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Ordenar por', exact: true }).locator('option[value="score"],option[value="trending"]')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Pesquisar light novels', exact: true }).fill('História QA');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('combobox', { name: 'Gênero', exact: true }).selectOption('Fantasia');
  await page.getByRole('combobox', { name: 'Ordenar por', exact: true }).selectOption('newest');
  await expect.poll(() => requests.filter(url => url.pathname === '/api/novels/search').at(-1)?.searchParams.get('sort')).toBe('newest');
  const search = requests.filter(url => url.pathname === '/api/novels/search').at(-1)!;
  expect(search.searchParams.get('provider')).toBe('novelmania');
  expect(search.searchParams.get('search')).toBe('História QA'); expect(search.searchParams.get('genre')).toBe('Fantasia');
  expect(search.searchParams.has('year')).toBe(false); expect(search.searchParams.has('status')).toBe(false);
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-novel-provider-${testInfo.project.name}-home.png` });
  await page.getByRole('link', { name: `Ver ${novel.title}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(novelId)}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(novel.title);
  await expect(page.locator('.details-top-meta').getByText('Português brasileiro', { exact: true })).toBeVisible();
  await safeSource(page, 'Abrir obra na fonte', sourceUrl);
  await expect(page.getByRole('link', { name: 'Começar leitura', exact: true })).toHaveAttribute('href', readerPath());
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-novel-provider-${testInfo.project.name}-details.png` });
  await page.getByRole('link', { name: 'Começar leitura', exact: true }).click();
  await expect(page.getByRole('article')).toContainText(paragraphs[0]);
  await expect(page.locator('main.novel-reader')).toHaveAttribute('lang', 'pt-br');
  await expect(page.locator('.novel-original-note')).toHaveCount(0);
  await expect(page.locator('.novel-reader-attribution')).toContainText('Tradução sintética QA');
  await safeSource(page, 'Abrir capítulo na fonte', chapterSource);
  for (const link of await page.getByRole('link', { name: 'Capítulos', exact: true }).all()) await expect(link).toHaveAttribute('href', detailsPath);
  const contentRequest = requests.find(url => url.pathname.endsWith('/content'))!;
  expect(contentRequest.pathname).toContain(encodeURIComponent(novelId));
  expect(contentRequest.pathname).toContain(encodeURIComponent(firstId));
  expect(contentRequest.searchParams.has('source')).toBe(false);
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-novel-provider-${testInfo.project.name}-reader.png` });
  expect(errors).toEqual([]);
});

test('synthetic native novel favorites, paragraph progress, preferences and adjacent chapters survive reload and library navigation', async ({ page }) => {
  await fixtures(page);
  await page.goto(detailsPath);
  await page.getByRole('button', { name: 'Favoritar', exact: true }).click();
  await page.getByRole('link', { name: 'Começar leitura', exact: true }).click();
  await expect(page.getByRole('article')).toBeVisible();
  await page.getByRole('button', { name: 'Ajustar leitura', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tema', exact: true }).selectOption('sepia');
  await page.getByRole('combobox', { name: 'Fonte', exact: true }).selectOption('sans');
  await page.getByRole('button', { name: 'Ajustar leitura', exact: true }).click();
  const position = page.getByRole('slider', { name: 'Posição no capítulo', exact: true });
  await position.fill('5');
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('hpmovies.novels.v1') || '{}').history?.find((entry: { novel: { id: string }; chapterId: string; position: number }) => entry.novel.id === id)?.position, novelId)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('main.novel-reader')).toHaveClass(/novel-theme-sepia/);
  await expect(page.getByRole('article')).toHaveClass(/novel-font-sans/);
  await expect(position).not.toHaveValue('0');
  await page.getByRole('article').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(secondId)}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(chapters[1].title);
  await page.getByRole('article').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(firstId)}$`));
  await page.getByRole('link', { name: 'Próximo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(secondId)}$`));
  await page.getByRole('link', { name: 'Anterior', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(firstId)}$`));
  await page.goto('/library?tab=favorites&format=novel');
  await expect(page.getByRole('heading', { name: novel.title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: novel.title, exact: true })).toHaveAttribute('href', detailsPath);
  await page.goto('/library?tab=history&format=novel');
  const resume = page.getByRole('link').filter({ has: page.getByRole('heading', { name: novel.title, exact: true }) }).filter({ hasText: chapters[0].title });
  await expect(resume).toHaveAttribute('href', readerPath());
  await resume.click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(firstId)}$`));
  await expect(page.getByRole('article')).toContainText(paragraphs[0]);
  await page.getByRole('link', { name: 'Capítulos', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(novelId)}$`));
  expect(new URL(page.url()).pathname).not.toContain('/sources');
  await noOverflow(page);
});

const wrongContent: { name: string; change: (content: NovelReadingResult) => NovelReadingResult }[] = [
  { name: 'work', change: content => ({ ...content, novel: { ...novel, id: 'novelmania:outra-historia' } }) },
  { name: 'chapter', change: content => ({ ...content, chapter: chapters[1] }) },
  { name: 'language', change: content => ({ ...content, chapter: { ...chapters[0], language: 'en' } }) },
  { name: 'navigation', change: content => ({ ...content, nextChapterId: foreignId }) },
  { name: 'demo', change: content => ({ ...content, isDemo: true }) },
  { name: 'provider', change: content => ({ ...content, providerId: 'anilist' }) },
];
for (const mismatch of wrongContent) test(`synthetic native novel rejects a mismatched ${mismatch.name} before displaying text or source links`, async ({ page }) => {
  await fixtures(page, { content: mismatch.change });
  await page.goto(readerPath());
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir capítulo na fonte', exact: true })).toHaveCount(0);
  await expect(page.locator('.novel-original-note')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(firstId)}$`));
  await noOverflow(page);
});

test('synthetic native novel source outage keeps an honest error and recovers with retry without substituting demo text', async ({ page }) => {
  let fail = true;
  const { requests } = await fixtures(page, { unavailable: () => fail });
  await page.goto(readerPath());
  await expect(page.getByRole('alert')).toContainText('Fonte sintética indisponível');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.locator('.novel-original-note')).toHaveCount(0);
  expect(requests.some(url => url.pathname.includes('/demo'))).toBe(false);
  await expect(page.getByRole('link', { name: 'Voltar aos capítulos', exact: true })).toHaveAttribute('href', detailsPath);
  fail = false;
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('article')).toContainText(paragraphs[0]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await safeSource(page, 'Abrir capítulo na fonte', chapterSource);
  expect(requests.filter(url => url.pathname.endsWith('/content'))).toHaveLength(2);
  await noOverflow(page);
});
