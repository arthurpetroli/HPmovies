import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Browser-only fixtures exercise contracts while public APIs are unavailable.
// No fixture data is imported by application code or served in production.
const mangaId = '00000000-0000-0000-0000-000000000001';
const chapterId = '00000000-0000-0000-0000-000000000002';
const nextChapterId = '00000000-0000-0000-0000-000000000003';
const tagId = '00000000-0000-0000-0000-000000000004';
const cover = 'https://qa.hpmovies.invalid/cover.svg';
const anime = { id: '1', title: 'Anime de teste QA', titleOriginal: 'Título alternativo QA', poster: cover, banner: cover, genres: ['Action'], year: 2026, score: 88, format: 'TV', episodeCount: 12, description: 'Uma sinopse de teste usada exclusivamente pela suíte de navegador.', characters: [{ id: '1', name: 'Personagem de teste', image: cover, role: 'MAIN' }] };
const manga = { id: mangaId, title: 'Mangá de teste QA', poster: cover, description: 'Conteúdo sintético exclusivo de teste.', availableLanguages: ['pt-br', 'en'], tags: [{ id: tagId, name: 'Aventura' }], authors: ['Autor QA'], contentRating: 'safe', status: 'ongoing', year: 2026, sourceUrl: `https://mangadex.org/title/${mangaId}` };
const chapter = { id: chapterId, mangaId, title: 'Capítulo de teste 1', chapter: '1', volume: '1', language: 'pt-br', groups: ['Grupo QA'], pages: 5 };

async function fixtures(page: Page) {
  await page.route('https://qa.hpmovies.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#194b40"/><text x="50" y="200" font-size="48" fill="white">Página de teste QA</text></svg>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown;
    if (path === '/api/catalog/home') data = { trending: [anime], popular: [anime], airing: [anime], topRated: [anime], upcoming: [anime] };
    else if (path === '/api/catalog/genres') data = ['Action', 'Fantasy'];
    else if (path === '/api/catalog/search') data = { items: url.searchParams.get('search') === 'inexistente' ? [] : [anime], page: Number(url.searchParams.get('page') || 1), hasNextPage: true, total: 30 };
    else if (path === '/api/catalog/anime/1') data = anime;
    else if (path === '/api/streaming/anime/1/episodes') data = { available: false, episodes: [], message: 'Nenhuma fonte autorizada neste teste.' };
    else if (path === '/api/manga/home') data = { popular: [manga], topRated: [manga], ongoing: [manga], latest: [manga], warnings: [] };
    else if (path === '/api/manga/tags') data = manga.tags;
    else if (path === '/api/manga/search') data = { items: [manga], page: 1, total: 1, hasNextPage: false };
    else if (path === `/api/manga/${mangaId}`) data = manga;
    else if (path === `/api/manga/${mangaId}/chapters`) data = { items: [chapter, { ...chapter, id: nextChapterId, title: 'Capítulo de teste 2', chapter: '2' }], language: url.searchParams.get('language') || 'pt-br', page: 1, total: 2, hasNextPage: false };
    else if (path === `/api/manga/chapter/${chapterId}/pages` || path === `/api/manga/chapter/${nextChapterId}/pages`) data = { chapter: { ...chapter, id: path.includes(nextChapterId) ? nextChapterId : chapterId }, pages: Array.from({ length: 5 }, (_, i) => `https://qa.hpmovies.invalid/page-${i}.svg`), sourceUrl: `https://mangadex.org/chapter/${chapterId}`, navigation: { nextId: nextChapterId } };
    else return route.continue();
    return route.fulfill({ json: { data } });
  });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('anime discovery, filters, details and persistent unified library', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await fixtures(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(anime.title);
  await page.goto('/explore');
  const mobile = await page.getByRole('button', { name: 'Filtros', exact: true }).isVisible();
  if (mobile) await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByRole('combobox', { name: 'Temporada', exact: true }).selectOption('FALL');
  if (mobile) await page.getByRole('button', { name: 'Mostrar animes' }).click();
  await expect(page).toHaveURL(/season=FALL/);
  await page.getByRole('searchbox', { name: 'Pesquisar no catálogo' }).fill('inexistente');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum anime por aqui' })).toBeVisible();
  await page.goto('/anime/1');
  await expect(page.getByRole('heading', { name: 'Personagem de teste' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Assistir', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await page.getByRole('button', { name: 'Favoritar', exact: true }).click();
  await page.goto('/library?tab=favorites');
  await expect(page.getByRole('link', { name: anime.title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: anime.title, exact: true })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('manga PT-BR chapter, reader modes, progress and next chapter', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await fixtures(page);
  await page.goto(`/manga/${mangaId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(manga.title);
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue('pt-br');
  await page.getByRole('button', { name: 'Minha lista', exact: true }).click();
  await page.getByRole('link', { name: 'Começar a ler' }).click();
  await expect(page.getByAltText('Página 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preferências de leitura' }).click();
  await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('single');
  await page.getByRole('button', { name: 'Fechar preferências' }).click();
  await page.getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(page.getByAltText('Página 2', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByAltText('Página 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Próximo capítulo', exact: false }).click();
  await expect(page).toHaveURL(new RegExp(nextChapterId));
  await page.goto('/library?format=manga');
  await expect(page.getByRole('heading', { name: manga.title })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('original novel reader preferences and resume use real local backend', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/novel/demo/read/1');
  await expect(page.getByRole('article')).toBeVisible();
  await page.getByRole('button', { name: 'Ajustar leitura' }).click();
  await page.getByRole('combobox', { name: 'Tema', exact: true }).selectOption('sepia');
  const progress = page.getByRole('slider', { name: 'Posição no capítulo' });
  await progress.fill('3');
  await page.reload();
  await expect(page.locator('main')).toHaveClass(/novel-theme-sepia/);
  await expect(progress).not.toHaveValue('0');
  await page.getByRole('link', { name: 'Próximo', exact: true }).click();
  await expect(page).toHaveURL('/novel/demo/read/2');
  await page.goto('/library?tab=history&format=novel');
  await expect(page.getByRole('heading', { name: 'Continuar lendo novels' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('HLS playback uses real demo media, subtitles, quality and progress', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/watch/demo');
  await expect(page.getByRole('heading', { name: 'Big Buck Bunny · demonstração' })).toBeVisible();
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime), { timeout: 45000 }).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('combobox', { name: 'Qualidade do vídeo' }).locator('option')).not.toHaveCount(1);
  await page.getByRole('combobox', { name: 'Qualidade do vídeo' }).selectOption({ label: '720p' });
  await page.getByRole('combobox', { name: 'Velocidade de reprodução' }).selectOption('1.25');
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('off');
  await page.getByRole('button', { name: 'Fechar configurações' }).click();
  await page.getByRole('region', { name: 'Player de vídeo' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(10);
  await page.goto('/watch/demo');
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime), { timeout: 30000 }).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('combobox', { name: 'Idioma das legendas' })).toHaveValue('off');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('captions load on demand, recover after a failed track and preserve sync', async ({ page }) => {
  let brokenRequests = 0;
  await page.route('**/api/streaming/episodes/demo', route => route.fulfill({ json: { data: {
    episode: { id: 'demo', title: 'Teste de conversão de legendas' },
    sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' }],
    subtitles: [
      { id: 'pt-srt', url: '/qa-captions.srt', language: 'pt-BR', label: 'Português de teste', format: 'srt' },
      { id: 'en-broken', url: '/qa-broken.ass', language: 'en', label: 'Faixa indisponível de teste', format: 'ass' },
    ], audioLanguages: [], isDemo: true,
  } } }));
  await page.route('**/qa-captions.srt', route => route.fulfill({ contentType: 'text/plain', body: '1\n00:00:00,000 --> 00:01:00,000\nLegenda SRT de teste\n\n2\n00:01:01,000 --> 00:01:01,000\nEntrada inválida de teste\n' }));
  await page.route('**/qa-broken.ass', route => { brokenRequests++; return route.fulfill({ status: 503, body: 'unavailable' }); });
  await page.goto('/watch/demo');
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect(page.getByText('Legenda SRT de teste', { exact: true })).toBeVisible();
  expect(brokenRequests).toBe(0);
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('en-broken');
  await expect(page.getByRole('alert')).toContainText('Não foi possível converter');
  expect(brokenRequests).toBe(1);
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('pt-srt');
  await expect(page.getByText('Legenda SRT de teste', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('slider', { name: 'Sincronização da legenda' }).fill('1.5');
  await page.reload();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('slider', { name: 'Sincronização da legenda' })).toHaveValue('1.5');
});
