import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StreamSubtitle } from '../../src/shared/providers';

const demo = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const pt = 'Fala original de teste em português';
const en = 'Original English test caption';
const vtt = (text: string) => `WEBVTT\n\n00:00:00.000 --> 00:10:00.000\n${text}\n`;

async function playback(page: Page, subtitles: StreamSubtitle[]) {
  await page.route('**/api/streaming/episodes/subtitle-loading', route => route.fulfill({ json: { data: {
    episode: { id: 'subtitle-loading', title: 'Teste de carregamento de legendas' },
    sources: [{ url: demo, type: 'hls' }], subtitles, audioLanguages: [], isDemo: true,
  } } }));
}

async function play(page: Page) {
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 30000 }).toBeGreaterThan(0);
}

test('switching from English to delayed Portuguese mounts no empty track and persists only Portuguese', async ({ page }) => {
  test.setTimeout(70000);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let englishRequests = 0, portugueseRequests = 0, unusedRequests = 0;
  await playback(page, [
    { id: 'en-vtt', url: '/qa-loading-en.vtt', language: 'en', label: 'English QA', format: 'vtt' },
    { id: 'pt-srt', url: '/qa-loading-pt.srt', language: 'pt-BR', label: 'Português QA', format: 'srt' },
    { id: 'pt-unused', url: '/qa-loading-unused.ass', language: 'pt-BR', label: 'Outra faixa QA', format: 'ass' },
  ]);
  await page.route('**/qa-loading-en.vtt', route => { englishRequests++; return route.fulfill({ contentType: 'text/vtt', body: vtt(en) }); });
  await page.route('**/qa-loading-pt.srt', async route => {
    portugueseRequests++;
    await pending;
    return route.fulfill({ contentType: 'application/x-subrip', body: `1\n00:00:00,000 --> 00:10:00,000\n${pt}\n` });
  });
  await page.route('**/qa-loading-unused.ass', route => { unusedRequests++; return route.fulfill({ status: 503 }); });
  await page.addInitScript(() => {
    if (!localStorage.getItem('hpmovies.captions.v1')) localStorage.setItem('hpmovies.captions.v1', JSON.stringify({ language: 'en', offset: 0, size: 'medium', background: true }));
  });
  await page.goto('/watch/subtitle-loading');
  await play(page);
  await expect(page.getByText(en, { exact: true })).toBeVisible();
  const oldTrack = await page.locator('video track').elementHandle();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('pt-srt');
  await expect.poll(() => portugueseRequests).toBe(1);
  await expect(page.locator('video track')).toHaveCount(0);
  await expect(page.getByText(en, { exact: true })).toHaveCount(0);
  // A late error belonging to the removed English element cannot hide PT-BR.
  await oldTrack!.evaluate(element => element.dispatchEvent(new Event('error')));
  await expect(page.getByRole('alert')).toHaveCount(0);
  release();
  await expect(page.getByText(pt, { exact: true })).toBeVisible();
  await expect(page.locator('video track')).toHaveCount(1);
  await expect(page.locator('video track')).toHaveAttribute('src', /^blob:/);
  expect(unusedRequests).toBe(0);
  const loadedEnglishRequests = englishRequests;
  const loadedPortugueseRequests = portugueseRequests;
  await page.reload();
  // Vite development StrictMode can abort and repeat the initial fetch.
  await expect.poll(() => portugueseRequests).toBeGreaterThan(loadedPortugueseRequests);
  await expect(page.locator('video track')).toHaveAttribute('srclang', 'pt-BR');
  await expect.poll(() => page.locator('video track').evaluate(element => (element as HTMLTrackElement).readyState)).toBe(2);
  expect(englishRequests).toBe(loadedEnglishRequests);
  expect(portugueseRequests).toBeLessThanOrEqual(loadedPortugueseRequests + 2);
  expect(unusedRequests).toBe(0);
});

test('Portuguese VTT failures stay visible with settings closed and manual retry loads the selected track', async ({ page }) => {
  let requests = 0;
  await playback(page, [
    { id: 'pt-vtt', url: '/qa-loading-retry.vtt', language: 'pt-BR', label: 'Português QA', format: 'vtt' },
    { id: 'en-vtt', url: '/qa-loading-never-en.vtt', language: 'en', label: 'English QA', format: 'vtt' },
  ]);
  let englishRequests = 0;
  await page.route('**/qa-loading-never-en.vtt', route => { englishRequests++; return route.fulfill({ contentType: 'text/vtt', body: vtt(en) }); });
  await page.route('**/qa-loading-retry.vtt', route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503, headers: { 'cache-control': 'no-store' }, body: 'QA unavailable' }) : route.fulfill({ contentType: 'text/vtt', body: vtt(pt) });
  });
  await page.goto('/watch/subtitle-loading');
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a faixa Português QA.');
  await expect(page.getByLabel('Configurações do vídeo')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar legenda novamente' }).click();
  await play(page);
  await expect(page.getByText(pt, { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(requests).toBe(2);
  expect(englishRequests).toBe(0);
  await expect(page.locator('video track')).toHaveAttribute('id', 'pt-vtt');
});

test('a successful native load clears an earlier caption error and immediately restores active Portuguese cues', async ({ page }) => {
  await playback(page, [{ id: 'pt-vtt', url: '/qa-loading-recover.vtt', language: 'pt-BR', label: 'Português QA', format: 'vtt' }]);
  await page.route('**/qa-loading-recover.vtt', route => route.fulfill({ contentType: 'text/vtt', body: vtt(pt) }));
  await page.goto('/watch/subtitle-loading');
  await play(page);
  await expect(page.getByText(pt, { exact: true })).toBeVisible();
  await page.locator('video track').evaluate(element => element.dispatchEvent(new Event('error')));
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar');
  await expect(page.getByText(pt, { exact: true })).toHaveCount(0);
  await page.locator('video track').evaluate(element => element.dispatchEvent(new Event('load')));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(pt, { exact: true })).toBeVisible();
});

test('automatic Portuguese shows its notice only in Sua experiência while that track is selected', async ({ page }) => {
  const automaticText = 'Fala de teste com tradução automática';
  const automaticLabel = 'Tradução automática · PT-BR · Overgeared — episódio 2 · SubDL';
  await playback(page, [
    { id: 'pt-human', url: '/qa-loading-human.vtt', language: 'pt', label: 'Português QA', format: 'vtt' },
    { id: 'pt-automatic', url: '/qa-loading-automatic.vtt', language: 'pt-BR', label: automaticLabel, format: 'vtt', machineTranslated: true },
  ]);
  await page.route('**/qa-loading-human.vtt', route => route.fulfill({ contentType: 'text/vtt', body: vtt(pt) }));
  await page.route('**/qa-loading-automatic.vtt', route => route.fulfill({ contentType: 'text/vtt', body: vtt(automaticText) }));
  await page.goto('/watch/subtitle-loading');
  await play(page);
  await expect(page.getByText(pt, { exact: true })).toBeVisible();
  const notice = page.getByRole('complementary', { name: 'Sua experiência' }).getByText('Tradução automática: pode conter erros.', { exact: true });
  const playerNotice = page.getByRole('region', { name: 'Player de vídeo' }).getByText('Tradução automática: pode conter erros.', { exact: true });
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('combobox', { name: 'Idioma das legendas' })).toContainText(automaticLabel);
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('pt-automatic');
  await page.getByRole('button', { name: 'Fechar configurações' }).click();
  await expect(page.getByLabel('Configurações do vídeo')).toHaveCount(0);
  await expect(notice).toBeVisible();
  await expect(playerNotice).toHaveCount(0);
  await expect(page.getByText(automaticText, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('pt-human');
  await expect(notice).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('pt-automatic');
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Fechar configurações' }).click();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('combobox', { name: 'Idioma das legendas' }).selectOption('off');
  await page.getByRole('button', { name: 'Fechar configurações' }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByText(automaticText, { exact: true })).toHaveCount(0);
});

test('outlined captions use the larger size scale and retain the optional black background after reload', async ({ page, isMobile }) => {
  await playback(page, [{ id: 'pt-style', url: '/qa-caption-style.vtt', language: 'pt-BR', label: 'Português QA', format: 'vtt' }]);
  await page.route('**/qa-caption-style.vtt', route => route.fulfill({ contentType: 'text/vtt', body: vtt(pt) }));
  await page.addInitScript(() => {
    // A viewer arriving from the old presentation gets the new default once.
    localStorage.setItem('hpmovies.captions.v1', JSON.stringify({ language: 'pt-br', size: 'medium', background: true, offset: 0 }));
  });
  await page.goto('/watch/subtitle-loading');
  await play(page);
  const caption = page.locator('.player-caption-text');
  await expect(caption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(caption).toHaveCSS('font-size', isMobile ? '20px' : '30px');
  await expect(caption).toHaveCSS('font-weight', '700');
  await expect(caption).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(caption).toHaveCSS('-webkit-text-stroke-color', 'rgb(0, 0, 0)');
  await expect(caption).toHaveCSS('paint-order', 'stroke');
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  const size = page.getByRole('combobox', { name: 'Tamanho da legenda' });
  await size.selectOption('small');
  await expect(caption).toHaveCSS('font-size', isMobile ? '16px' : '24px');
  await size.selectOption('large');
  await expect(caption).toHaveCSS('font-size', isMobile ? '24px' : '36px');
  const background = page.getByRole('checkbox', { name: 'Fundo preto da legenda' });
  await expect(background).not.toBeChecked();
  await background.check();
  await expect(caption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.85)');
  await page.reload();
  await play(page);
  await expect(caption).toHaveCSS('font-size', isMobile ? '24px' : '36px');
  await expect(caption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.85)');
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('checkbox', { name: 'Fundo preto da legenda' }).uncheck();
  await expect(caption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('large multiline captions stay centered inside the video and scale in fullscreen', async ({ page, isMobile }) => {
  const dialogue = 'A próxima aventura começa agora.\nVamos proteger nossos amigos!';
  await playback(page, [{ id: 'pt-wrap', url: '/qa-caption-wrap.vtt', language: 'pt-BR', label: 'Português QA', format: 'vtt' }]);
  await page.route('**/qa-caption-wrap.vtt', route => route.fulfill({ contentType: 'text/vtt', body: vtt(dialogue) }));
  await page.goto('/watch/subtitle-loading');
  await play(page);
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('combobox', { name: 'Tamanho da legenda' }).selectOption('large');
  await page.getByRole('button', { name: 'Fechar configurações' }).click();
  await page.getByRole('heading', { name: 'Teste de carregamento de legendas' }).click();
  await expect(page.locator('.player-captions')).toHaveAttribute('data-controls-visible', 'false');
  const geometry = () => page.locator('.player-caption-text').evaluate(element => {
    const player = element.closest('.video-player')!.getBoundingClientRect();
    const text = element.getBoundingClientRect();
    return { inside: text.left >= player.left && text.right <= player.right && text.top >= player.top && text.bottom <= player.bottom,
      centered: Math.abs((text.left + text.right) / 2 - (player.left + player.right) / 2) < 1,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  expect(await geometry()).toMatchObject({ inside: true, centered: true, overflow: false });
  if (isMobile) {
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 851 });
      await page.getByRole('region', { name: 'Player de vídeo' }).focus();
      await expect(page.locator('.player-captions')).toHaveAttribute('data-controls-visible', 'true');
      expect(await geometry()).toMatchObject({ inside: true, centered: true, overflow: false });
    }
  }
  if (!isMobile) {
    const embedded = await geometry();
    await page.getByRole('region', { name: 'Player de vídeo' }).focus();
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    expect((await geometry()).fontSize).toBeGreaterThan(embedded.fontSize);
    expect(await geometry()).toMatchObject({ inside: true, centered: true });
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  }
});
