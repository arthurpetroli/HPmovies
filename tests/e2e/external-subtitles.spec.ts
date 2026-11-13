import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// Isolated UI contracts. Search/job/track data is synthetic; the one decoding
// scenario uses authorized public demo HLS, never an episode from a live host.
const episodeId = 'stremio:all:tt1234567:1:1';
const nextId = 'stremio:all:tt1234567:1:2';
const demo = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const languages = [{ id: 'en', label: 'Inglês' }, { id: 'pt-BR', label: 'Português (Brasil)' }, { id: 'fr', label: 'Francês' }, { id: 'ja', label: 'Japonês' }];
const native = { id: 'native-pt', url: '/api/subtitles/file/nativept', language: 'pt-BR', label: 'Português nativo QA', format: 'vtt' };
const selected = { id: 'opensubtitles-123', url: '/api/subtitles/file/englishqa', language: 'en', label: 'OpenSubtitles · English QA', release: 'QA.S01E01.ENGLISH.Release.srt', sourceFormat: 'srt', format: 'vtt', downloads: 12345, provider: 'opensubtitles', translationToken: 'external-offer' };
const portuguese = { ...selected, id: 'opensubtitles-124', url: '/api/subtitles/file/portugueseqa', language: 'pt-BR', label: 'OpenSubtitles · PT-BR QA', release: 'QA.S01E01.PORTUGUESE.Release.srt', translationToken: undefined };
const french = { ...selected, id: 'opensubtitles-125', url: '/api/subtitles/file/frenchqa', language: 'fr', label: 'OpenSubtitles · Français QA', release: 'QA.S01E01.FRENCH.Release.srt', translationToken: 'french-offer' };

type SearchHandler = (route: Route, language: string) => Promise<void> | void;
async function fixture(page: Page, options: { realDemo?: boolean; search?: SearchHandler } = {}) {
  const requests: string[] = [];
  const first = options.realDemo ? `${demo}?qa-external=first` : '/qa-external-video-one.mp4';
  const second = options.realDemo ? `${demo}?qa-external=second` : '/qa-external-video-two.mp4';
  if (!options.realDemo) await page.route('**/qa-external-video-*.mp4', () => {});
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()); const path = decodeURIComponent(url.pathname);
    requests.push(path);
    if (path.startsWith('/api/streaming/episodes/')) {
      const next = path.endsWith(nextId);
      return route.fulfill({ json: { data: {
        episode: { id: next ? nextId : episodeId, title: next ? 'Episódio seguinte QA' : 'Legendas externas QA', number: next ? 2 : 1 },
        sources: [{ url: first, type: options.realDemo ? 'hls' : 'mp4', label: 'Primeira fonte QA', subtitles: [native] }, { url: second, type: options.realDemo ? 'hls' : 'mp4', label: 'Segunda fonte QA', subtitles: [] }],
        subtitles: [], audioLanguages: [], isDemo: false, nextEpisodeId: next ? undefined : nextId,
      } } });
    }
    if (path.startsWith('/api/subtitles/search/')) {
      const language = url.searchParams.get('language') || 'pt-BR';
      if (options.search) return options.search(route, language);
      return route.fulfill({ json: { data: { episodeId, language, languages, subtitles: language === 'en' ? [selected] : language === 'fr' ? [french] : language === 'ja' ? [] : [portuguese] } } });
    }
    if (path.startsWith('/api/subtitles/file/') || path.startsWith('/api/subtitles/automatic/file/')) return route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:30:00.000\nLegenda QA de contrato\n' });
    if (path.startsWith('/api/subtitles/automatic/') && route.request().method() === 'POST') return route.fulfill({ status: 202, json: { data: { id: 'external-job', state: 'complete', subtitle: { id: 'automatic-external', language: 'pt', label: 'Português automático QA', machineTranslated: true, format: 'vtt', url: '/api/subtitles/automatic/file/translatedqa' } } } });
    return route.fulfill({ status: 404, json: { message: 'Recurso ausente nesta fixture.' } });
  });
  await page.goto(`/watch/${encodeURIComponent(episodeId)}?title=Legendas+QA`);
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' })).toBeVisible();
  return { requests, first, second };
}

async function openPicker(page: Page) {
  await page.getByRole('region', { name: 'Player de vídeo' }).hover();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  const button = page.getByRole('button', { name: 'Buscar no OpenSubtitles', exact: true });
  await button.click();
  await expect(page.getByRole('dialog', { name: 'OpenSubtitles' })).toBeVisible();
  return button;
}

test('selects an external release without restarting demo playback, preserves it across mirrors and permits AI despite native Portuguese', async ({ page }) => {
  test.setTimeout(75000);
  const { requests, second } = await fixture(page, { realDemo: true });
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime), { timeout: 30000 }).toBeGreaterThan(1);
  await page.getByRole('region', { name: 'Player de vídeo' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(10);
  const position = await page.locator('video').evaluate(video => video.currentTime);
  await page.locator('video').evaluate(video => { video.dataset.externalTestIdentity = 'mounted'; });
  await openPicker(page);
  await page.getByRole('button', { name: 'Inglês', exact: true }).click();
  const release = page.getByRole('button', { name: /QA.S01E01.ENGLISH.Release.srt/ });
  await expect(release).toContainText('12.345 downloads');
  await release.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('video track')).toHaveAttribute('srclang', 'en');
  expect(await page.locator('video').getAttribute('data-external-test-identity')).toBe('mounted');
  expect(await page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(position);
  await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(false);
  await expect(page.getByRole('combobox', { name: 'Legenda de origem' })).toHaveValue(selected.id);
  await page.getByRole('button', { name: 'Gerar legenda em português', exact: true }).click();
  await expect(page.getByText('Tradução automática: pode conter erros.', { exact: true })).toBeVisible();
  await expect(page.locator('video track')).toHaveAttribute('srclang', 'pt');
  await page.getByRole('combobox', { name: 'Fonte de vídeo' }).selectOption(second);
  await expect(page.locator('video track')).toHaveAttribute('srclang', 'pt');
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime), { timeout: 30000 }).toBeGreaterThanOrEqual(position);
  expect(requests.some(path => path.endsWith('/external-offer'))).toBe(true);
  await openPicker(page);
  await page.getByRole('button', { name: 'Francês', exact: true }).click();
  await page.getByRole('button', { name: /QA.S01E01.FRENCH.Release.srt/ }).click();
  await expect(page.getByRole('combobox', { name: 'Legenda de origem' })).toHaveValue(french.id);
  await page.getByRole('button', { name: 'Gerar legenda em português', exact: true }).click();
  await expect.poll(() => requests.some(path => path.endsWith('/french-offer'))).toBe(true);
});

test('dialog fits 320px, traps keyboard focus and Escape restores the search control', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await fixture(page);
  const trigger = await openPicker(page);
  const dialog = page.getByRole('dialog', { name: 'OpenSubtitles' });
  await expect(dialog.getByRole('button').first()).toHaveAccessibleName('Fechar busca de legendas');
  await expect(dialog.getByRole('button', { name: 'Português (Brasil)', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('dialog li button')?.textContent)).toBe('Português (Brasil)');
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('dialog')?.contains(document.activeElement))).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('errors retry, empty languages stay clear and an obsolete language response cannot replace the current versions', async ({ page }) => {
  let attempts = 0;
  let releaseEnglish: (() => void) | undefined;
  const englishGate = new Promise<void>(resolve => { releaseEnglish = resolve; });
  await fixture(page, { search: async (route, language) => {
    if (language === 'en') await englishGate;
    if (language === 'pt-BR' && attempts++ === 0) return route.fulfill({ status: 503, json: { message: 'Busca QA indisponível.' } });
    return route.fulfill({ json: { data: { episodeId, language, languages, subtitles: language === 'en' ? [selected] : language === 'fr' ? [french] : [] } } });
  } });
  await openPicker(page);
  await page.getByRole('button', { name: 'Português (Brasil)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Busca QA indisponível.');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByText(/Nenhuma legenda em português/)).toBeVisible();
  await page.getByRole('button', { name: 'Escolher outro idioma' }).click();
  await page.getByRole('button', { name: 'Inglês', exact: true }).click();
  await expect(page.getByText('Buscando versões de legenda…')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar aos idiomas' }).click();
  await page.getByRole('button', { name: 'Francês', exact: true }).click();
  await expect(page.getByRole('button', { name: /QA.S01E01.FRENCH.Release.srt/ })).toBeVisible();
  releaseEnglish?.();
  await expect(page.getByRole('button', { name: /QA.S01E01.ENGLISH.Release.srt/ })).toHaveCount(0);
});

test('manual off survives a mirror change and external tracks do not leak into the next episode', async ({ page }) => {
  const { second } = await fixture(page);
  await openPicker(page);
  await page.getByRole('button', { name: 'Inglês', exact: true }).click();
  await page.getByRole('button', { name: /QA.S01E01.ENGLISH.Release.srt/ }).click();
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('off');
  await page.getByRole('combobox', { name: 'Fonte de vídeo' }).selectOption(second);
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('combobox', { name: 'Idioma das legendas' })).toHaveValue('off');
  await page.getByRole('link', { name: 'Próximo episódio', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Temporada 1, episódio 2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('combobox', { name: 'Idioma das legendas' }).locator('option')).not.toContainText([selected.label]);
});

test('the picker stays available inside fullscreen and explains a missing translation model', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The mobile browser emulation does not expose desktop fullscreen.');
  await fixture(page, { search: (route, language) => route.fulfill({ json: { data: { episodeId, language, languages,
    subtitles: language === 'en' ? [{ ...selected, translationToken: undefined, translationMessage: 'Nenhum modelo compatível com este idioma está disponível.' }] : [portuguese] } } }) });
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await openPicker(page);
  expect(await page.getByRole('dialog').evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
  await page.getByRole('button', { name: 'Inglês', exact: true }).click();
  await expect(page.getByRole('button', { name: /QA.S01E01.ENGLISH.Release.srt/ })).toContainText('Nenhum modelo compatível');
  await page.getByRole('button', { name: /QA.S01E01.ENGLISH.Release.srt/ }).click();
  await expect(page.getByRole('heading', { name: 'Tradução de legendas com IA' })).toBeVisible();
  await expect(page.getByText('Nenhum modelo compatível com este idioma está disponível.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerar legenda em português' })).toHaveCount(0);
});

test('a pending translation can stop monitoring without changing playback or pretending the local job was canceled', async ({ page }) => {
  await fixture(page);
  let polls = 0;
  await page.route('**/api/subtitles/automatic/external-offer', route => route.fulfill({ status: 202, json: { data: { id: 'pending-external', state: 'pending' } } }));
  await page.route('**/api/subtitles/automatic/jobs/pending-external', route => {
    polls++;
    return route.fulfill({ json: { data: { id: 'pending-external', state: 'pending' } } });
  });
  await openPicker(page);
  await page.getByRole('button', { name: 'Inglês', exact: true }).click();
  await page.getByRole('button', { name: /QA.S01E01.ENGLISH.Release.srt/ }).click();
  await page.locator('video').evaluate(video => { video.dataset.externalTestIdentity = 'still-mounted'; });
  const before = await page.locator('video').evaluate(video => ({ position: video.currentTime, paused: video.paused }));
  await page.getByRole('button', { name: 'Gerar legenda em português', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Parar acompanhamento', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Parar acompanhamento', exact: true }).click();
  await expect(page.getByText('O acompanhamento foi interrompido. A tradução já iniciada pode continuar no serviço local.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerar legenda em português', exact: true })).toBeEnabled();
  const pollsWhenStopped = polls;
  // Cross the scheduled poll boundary: cancellation must clear the timer.
  await page.waitForTimeout(2200);
  expect(polls).toBe(pollsWhenStopped);
  expect(await page.locator('video').getAttribute('data-external-test-identity')).toBe('still-mounted');
  expect(await page.locator('video').evaluate(video => ({ position: video.currentTime, paused: video.paused }))).toEqual(before);
});
