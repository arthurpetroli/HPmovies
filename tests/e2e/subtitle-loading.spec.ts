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
