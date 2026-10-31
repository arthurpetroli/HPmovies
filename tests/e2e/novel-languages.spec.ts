import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { NovelReadingResult, NovelTitle } from '../../src/shared/novel';

// Synthetic browser fixtures verify language selection and reading identities.
// They do not establish availability or translation of a real provider's works.
const englishProvider = 'wuxiaworldsite';
const englishId = `${englishProvider}:historia-qa`;
const portugueseId = 'novelmania:historia-qa';
const detailsPath = (id = englishId) => `/novel/${encodeURIComponent(id)}`;
const chapterId = (id = englishId, number = 1) => `${id}/chapter-${number}`;
const readerPath = (id = englishId, number = 1) => `${detailsPath(id)}/read/${encodeURIComponent(chapterId(id, number))}`;
const englishSource = 'https://wuxiaworld.site/novel/historia-qa/';
const portugueseSource = 'https://novelmania.com.br/novels/historia-qa';
const unavailableLanguageMessage = 'A edição sintética desta fonte não existe no idioma solicitado.';
const englishNovel: NovelTitle = {
  id: englishId, title: 'English language QA story', poster: '', genres: ['Fantasy'],
  description: 'A synthetic English catalog and reader fixture.',
  providerId: englishProvider, providerName: 'WuxiaWorld.site', availableLanguages: ['en'], sourceUrl: englishSource,
};
const portugueseNovel: NovelTitle = {
  id: portugueseId, title: 'História em português QA', poster: '', genres: ['Fantasia'],
  description: 'Uma fixture sintética para verificar a retomada da leitura anterior.',
  providerId: 'novelmania', providerName: 'Novel Mania', availableLanguages: ['pt-br'], sourceUrl: portugueseSource,
};
const englishParagraphs = Array.from({ length: 18 }, (_, index) => `Synthetic English paragraph ${index + 1}. This story exists only in this browser test. The reader keeps the source language and the chapter order while preferences and screen sizes change. The same qualified work identity survives a reload and remains separate from the Portuguese story.`);
const portugueseParagraphs = Array.from({ length: 18 }, (_, index) => `Parágrafo português sintético ${index + 1}. Esta história existe apenas neste teste de navegador. A seleção de um catálogo em inglês conserva o progresso da obra em português e permite retomá-la pela biblioteca, sem substituir o texto salvo por outra edição.`);

function chapter(id: string, number: number) {
  const english = id === englishId;
  return { id: chapterId(id, number), number, title: english ? `Synthetic chapter ${number}` : `Capítulo sintético ${number}`, language: english ? 'en' : 'pt-br' };
}
function reading(id: string, number: number): NovelReadingResult {
  const english = id === englishId;
  return {
    available: true, status: 'available', providerId: english ? englishProvider : 'novelmania',
    message: 'Synthetic language fixture.', novel: english ? englishNovel : portugueseNovel,
    chapter: chapter(id, number), paragraphs: english ? englishParagraphs : portugueseParagraphs,
    previousChapterId: number === 2 ? chapterId(id, 1) : undefined,
    nextChapterId: number === 1 ? chapterId(id, 2) : undefined,
    sourceUrl: english ? `${englishSource}chapter-${number}/` : `${portugueseSource}/capitulos/chapter-${number}`,
    attribution: english ? 'WuxiaWorld.site · synthetic English QA' : 'Novel Mania · português sintético QA',
    isDemo: false,
  };
}
async function fixtures(page: Page, change?: (content: NovelReadingResult) => NovelReadingResult) {
  const requests: URL[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const segments = url.pathname.split('/').map(segment => decodeURIComponent(segment));
    let data: unknown;
    if (url.pathname === '/api/novels/search') {
      const provider = url.searchParams.get('provider');
      const item = provider === englishProvider ? englishNovel : provider === 'anilist'
        ? { ...englishNovel, id: '12345', providerId: 'anilist', providerName: 'AniList', availableLanguages: undefined, sourceUrl: 'https://anilist.co/manga/12345' }
        : portugueseNovel;
      data = { items: [item], page: Number(url.searchParams.get('page') || 1), hasNextPage: false, total: 1 };
    } else if (url.pathname === '/api/novels/genres') data = url.searchParams.get('provider') === englishProvider ? ['Fantasy', 'Adventure'] : ['Fantasia', 'Aventura'];
    else if ([englishId, portugueseId].includes(segments[3])) {
      const id = segments[3];
      const requestedLanguage = url.searchParams.get('language');
      const incompatibleLanguage = requestedLanguage !== null && requestedLanguage !== (id === englishId ? 'en' : 'pt-br');
      const providerId = id === englishId ? englishProvider : 'novelmania';
      if (segments.length === 4) data = id === englishId ? englishNovel : portugueseNovel;
      else if (segments[4] === 'chapters' && segments.length === 5) data = incompatibleLanguage ? {
        available: false, status: 'unavailable', providerId, message: unavailableLanguageMessage, chapters: [],
      } : {
        available: true, status: 'available', providerId,
        message: 'Synthetic chapters in their original fixture language.', chapters: [chapter(id, 1), chapter(id, 2)],
      };
      else if (segments[4] === 'chapters' && segments[6] === 'content') {
        const requestedProvider = url.searchParams.get('provider');
        if (requestedProvider && requestedProvider !== providerId) return route.fulfill({
          status: 400, json: { error: 'QA_NOVEL_PROVIDER_MISMATCH', message: 'A fonte sintética não corresponde ao provedor solicitado.' },
        });
        const content = reading(id, segments[5] === chapterId(id, 2) ? 2 : 1);
        data = incompatibleLanguage
          ? { available: false, status: 'unavailable', providerId, message: unavailableLanguageMessage, paragraphs: [] }
          : change ? change(content) : content;
      }
    }
    if (data === undefined) return route.fulfill({ status: 404, json: { message: 'No synthetic language fixture exists for this route.' } });
    return route.fulfill({ json: { data } });
  });
  return { requests, errors };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function catalogSelection(page: Page, provider: string, language: string) {
  await expect(page.getByRole('combobox', { name: 'Provedor', exact: true })).toHaveValue(provider);
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue(language);
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 375, height: 812 });
});

test('synthetic language changes preserve search, reset source filters and open English chapters without translating or substituting demo text', async ({ page }, testInfo) => {
  const { requests, errors } = await fixtures(page);
  await page.goto('/novels?provider=novelmania&language=pt-br&q=QA&genre=Fantasia&sort=newest&page=2');
  await catalogSelection(page, 'novelmania', 'pt-br');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await catalogSelection(page, englishProvider, 'en');
  await expect.poll(() => new URL(page.url()).searchParams.get('provider')).toBe(englishProvider);
  const params = new URL(page.url()).searchParams;
  expect(params.get('language')).toBe('en'); expect(params.get('q')).toBe('QA');
  for (const filter of ['genre', 'sort', 'page', 'year', 'status']) expect(params.has(filter)).toBe(false);
  await expect(page.getByRole('searchbox', { name: 'Pesquisar light novels', exact: true })).toHaveValue('QA');
  await expect.poll(() => requests.filter(url => url.pathname === '/api/novels/search').at(-1)?.searchParams.get('provider')).toBe(englishProvider);
  const search = requests.filter(url => url.pathname === '/api/novels/search').at(-1)!;
  expect(search.searchParams.get('language')).toBe('en'); expect(search.searchParams.get('search')).toBe('QA');
  expect(search.searchParams.has('genre')).toBe(false);
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-novel-languages-${testInfo.project.name}-catalog.png` });
  await page.getByRole('link', { name: `Ver ${englishNovel.title}`, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(englishNovel.title);
  await expect(page.locator('.details-top-meta')).toContainText('Inglês');
  await expect(page.getByRole('link', { name: 'Abrir obra na fonte', exact: true })).toHaveAttribute('href', englishSource);
  const back = page.getByRole('link', { name: 'Voltar às novels', exact: true });
  const backUrl = new URL((await back.getAttribute('href'))!, page.url());
  expect(backUrl.searchParams.get('provider')).toBe(englishProvider); expect(backUrl.searchParams.get('language')).toBe('en');
  await page.getByRole('link', { name: 'Começar leitura', exact: true }).click();
  await expect(page.locator('main.novel-reader')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('article')).toContainText(englishParagraphs[0]);
  await expect(page.getByRole('article')).not.toContainText(portugueseParagraphs[0]);
  await expect(page.locator('.novel-original-note')).toHaveCount(0);
  await expect(page.locator('.novel-reading-heading')).toContainText('Inglês');
  const source = page.getByRole('link', { name: 'Abrir capítulo na fonte', exact: true });
  await expect(source).toHaveAttribute('href', `${englishSource}chapter-1/`);
  await expect(source).toHaveAttribute('target', '_blank'); await expect(source).toHaveAttribute('rel', /noopener/);
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/hpmovies-novel-languages-${testInfo.project.name}-reader.png` });
  await page.getByRole('link', { name: 'Próximo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(chapterId(englishId, 2))}$`));
  await expect(page.locator('main.novel-reader')).toHaveAttribute('lang', 'en');
  const exploreUrl = new URL((await page.getByRole('link', { name: 'Explorar novels', exact: true }).getAttribute('href'))!, page.url());
  expect(exploreUrl.searchParams.get('provider')).toBe(englishProvider); expect(exploreUrl.searchParams.get('language')).toBe('en');
  await page.getByRole('link', { name: 'Capítulos', exact: true }).first().click();
  await page.getByRole('link', { name: 'Voltar às novels', exact: true }).click();
  await catalogSelection(page, englishProvider, 'en');
  expect(errors).toEqual([]);
});

test('synthetic provider and language choices stay synchronized through reload and browser back', async ({ page }) => {
  await fixtures(page);
  await page.goto('/novels?provider=novelmania&language=pt-br&q=retomada');
  await catalogSelection(page, 'novelmania', 'pt-br');
  await page.getByRole('combobox', { name: 'Provedor', exact: true }).selectOption(englishProvider);
  await catalogSelection(page, englishProvider, 'en');
  expect(new URL(page.url()).searchParams.get('language')).toBe('en');
  await page.reload();
  await catalogSelection(page, englishProvider, 'en');
  await expect(page.getByRole('searchbox', { name: 'Pesquisar light novels', exact: true })).toHaveValue('retomada');
  await page.goBack();
  await catalogSelection(page, 'novelmania', 'pt-br');
  await expect(page.getByRole('searchbox', { name: 'Pesquisar light novels', exact: true })).toHaveValue('retomada');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await page.getByRole('combobox', { name: 'Provedor', exact: true }).selectOption('novelmania');
  await catalogSelection(page, 'novelmania', 'pt-br');
  expect(new URL(page.url()).searchParams.get('language')).toBe('pt-br');
  await noOverflow(page);
});

test('synthetic clearing of search filters preserves the English catalog and language', async ({ page }) => {
  await fixtures(page);
  await page.goto(`/novels?provider=${englishProvider}&language=en&q=QA&genre=Fantasy&page=2`);
  await catalogSelection(page, englishProvider, 'en');
  await page.getByRole('button', { name: 'Limpar busca e filtros', exact: true }).click();
  await catalogSelection(page, englishProvider, 'en');
  const params = new URL(page.url()).searchParams;
  expect(params.get('provider')).toBe(englishProvider); expect(params.get('language')).toBe('en');
  expect(params.has('q')).toBe(false); expect(params.has('genre')).toBe(false); expect(params.has('page')).toBe(false);
  await page.reload();
  await catalogSelection(page, englishProvider, 'en');
  await page.goto('/novels');
  await catalogSelection(page, englishProvider, 'en');
  await noOverflow(page);
});

test('synthetic English reading preserves existing Portuguese history and resumes both works independently', async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(({ novel, firstChapter, paragraphs }) => {
    const key = 'hpmovies.novels.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      saved: [{ novel, favorite: true, completed: false, addedAt: 1 }],
      history: [{ novel, chapterId: firstChapter.id, chapterTitle: firstChapter.title, position: 3, paragraphCount: paragraphs, updatedAt: 1, completed: false }],
    }));
  }, { novel: portugueseNovel, firstChapter: chapter(portugueseId, 1), paragraphs: portugueseParagraphs.length });
  await page.goto(readerPath());
  await expect(page.getByRole('article')).toContainText(englishParagraphs[0]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hpmovies.novels.v1') || '{}').history?.length)).toBe(2);
  await page.goto('/library?tab=history&format=novel');
  const portugueseResume = page.getByRole('link').filter({ has: page.getByRole('heading', { name: portugueseNovel.title, exact: true }) });
  const englishResume = page.getByRole('link').filter({ has: page.getByRole('heading', { name: englishNovel.title, exact: true }) });
  await expect(portugueseResume).toHaveAttribute('href', readerPath(portugueseId));
  await expect(englishResume).toHaveAttribute('href', readerPath());
  await portugueseResume.click();
  await expect(page.locator('main.novel-reader')).toHaveAttribute('lang', 'pt-br');
  await expect(page.getByRole('article')).toContainText(portugueseParagraphs[0]);
  await expect(page.getByRole('slider', { name: 'Posição no capítulo', exact: true })).not.toHaveValue('0');
  await page.getByRole('link', { name: 'Capítulos', exact: true }).first().click();
  await page.getByRole('link', { name: 'Voltar às novels', exact: true }).click();
  await catalogSelection(page, 'novelmania', 'pt-br');
  await page.goto('/library?tab=history&format=novel');
  await page.reload();
  await englishResume.click();
  await expect(page.locator('main.novel-reader')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('article')).toContainText(englishParagraphs[0]);
  await noOverflow(page);
});

test('synthetic native English deep links forward an incompatible explicit language and keep an honest unavailable edition', async ({ page }) => {
  const { requests, errors } = await fixtures(page);
  await page.goto(`${readerPath()}?language=pt-br`);
  await expect(page.getByRole('heading', { name: 'Este texto ainda não está disponível', exact: true })).toBeVisible();
  await expect(page.getByText(unavailableLanguageMessage, { exact: true })).toBeVisible();
  const contentRequest = requests.find(url => url.pathname.endsWith('/content'))!;
  expect(contentRequest.searchParams.get('language')).toBe('pt-br');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir capítulo na fonte', exact: true })).toHaveCount(0);
  await expect(page.locator('.novel-original-note')).toHaveCount(0);
  expect(requests.some(url => url.pathname.includes('/demo'))).toBe(false);
  const back = page.getByRole('link', { name: 'Voltar aos capítulos', exact: true });
  await expect(back).toHaveAttribute('href', `${detailsPath()}?language=pt-br`);
  await back.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(englishNovel.title);
  await expect(page.getByRole('link', { name: 'Começar leitura', exact: true })).toHaveCount(0);
  await expect(page.locator('.availability-panel')).toContainText(unavailableLanguageMessage);
  const indexRequest = requests.find(url => decodeURIComponent(url.pathname).endsWith(`${englishId}/chapters`))!;
  expect(indexRequest.searchParams.get('language')).toBe('pt-br');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('synthetic native English deep links retain an explicit compatible language through adjacent chapters and return links', async ({ page }) => {
  const { requests, errors } = await fixtures(page);
  await page.goto(`${readerPath()}?language=en`);
  await expect(page.locator('main.novel-reader')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('article')).toContainText(englishParagraphs[0]);
  for (const link of await page.getByRole('link', { name: 'Capítulos', exact: true }).all()) {
    await expect(link).toHaveAttribute('href', `${detailsPath()}?language=en`);
  }
  const next = page.getByRole('link', { name: 'Próximo', exact: true });
  await expect(next).toHaveAttribute('href', `${readerPath(englishId, 2)}?language=en`);
  await next.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(chapter(englishId, 2).title);
  await expect(page.locator('main.novel-reader')).toHaveAttribute('lang', 'en');
  const contentRequests = requests.filter(url => url.pathname.endsWith('/content'));
  expect(contentRequests).toHaveLength(2);
  expect(contentRequests.map(url => url.searchParams.get('language'))).toEqual(['en', 'en']);
  await expect(page.getByRole('link', { name: 'Anterior', exact: true })).toHaveAttribute('href', `${readerPath()}?language=en`);
  await page.getByRole('link', { name: 'Capítulos', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(englishId)}\\?language=en$`));
  const backUrl = new URL((await page.getByRole('link', { name: 'Voltar às novels', exact: true }).getAttribute('href'))!, page.url());
  expect(backUrl.searchParams.get('provider')).toBe(englishProvider); expect(backUrl.searchParams.get('language')).toBe('en');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('synthetic native English deep links forward a contradictory explicit provider and expose an honest error', async ({ page }) => {
  const { requests, errors } = await fixtures(page);
  await page.goto(`${readerPath()}?provider=novelmania&language=en`);
  await expect(page.getByRole('alert')).toContainText('A fonte sintética não corresponde ao provedor solicitado.');
  const contentRequest = requests.find(url => url.pathname.endsWith('/content'))!;
  expect(contentRequest.searchParams.get('provider')).toBe('novelmania');
  expect(contentRequest.searchParams.get('language')).toBe('en');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir capítulo na fonte', exact: true })).toHaveCount(0);
  await expect(page.locator('.novel-original-note')).toHaveCount(0);
  expect(requests.some(url => url.pathname.includes('/demo'))).toBe(false);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('synthetic unread chapters start at the top after a long synopsis and after navigation from the previous chapter end', async ({ page }) => {
  const { errors } = await fixtures(page);
  const description = Array.from({ length: 80 }, (_, index) => `Synthetic synopsis section ${index + 1}. This long description exists only to place the reading action below the viewport and verify that a new chapter does not inherit the previous page scroll position.`).join(' ');
  await page.route(`**/api/novels/${encodeURIComponent(englishId)}`, route => route.fulfill({ json: { data: { ...englishNovel, description } } }));
  await page.goto(detailsPath());
  const start = page.getByRole('link', { name: 'Começar leitura', exact: true });
  await start.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
  await start.click();
  await expect(page.getByRole('article')).toContainText(englishParagraphs[0]);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole('slider', { name: 'Posição no capítulo', exact: true })).toHaveValue('0');
  const next = page.getByRole('link', { name: 'Próximo', exact: true });
  await next.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
  await next.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(chapter(englishId, 2).title);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole('slider', { name: 'Posição no capítulo', exact: true })).toHaveValue('0');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

for (const mismatch of ['language', 'provider'] as const) test(`synthetic English reader rejects a mismatched ${mismatch} before exposing text`, async ({ page }) => {
  await fixtures(page, content => mismatch === 'language'
    ? { ...content, chapter: { ...content.chapter!, language: 'pt-br' } }
    : { ...content, providerId: 'novelmania' });
  await page.goto(readerPath());
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir capítulo na fonte', exact: true })).toHaveCount(0);
  await expect(page.locator('.novel-original-note')).toHaveCount(0);
  await noOverflow(page);
});
