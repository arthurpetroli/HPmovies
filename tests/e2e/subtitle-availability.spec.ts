import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Playback, StreamSource } from '../../src/shared/providers';

// Synthetic sources exercise availability and recovery. Public demo video does
// not establish the identity, language or timing of any real anime episode.
const demo = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const portuguese = { id: 'availability-pt', url: '/qa-availability-pt.vtt', language: 'pt-BR', label: 'Português QA', format: 'vtt' as const };
const english = { id: 'availability-en', url: '/qa-availability-en.vtt', language: 'en', label: 'English QA', format: 'vtt' as const };

async function fixture(page: Page, loadSources: () => StreamSource[]) {
  await page.route('**/api/streaming/episodes/subtitle-availability', route => route.fulfill({ json: { data: {
    episode: { id: 'subtitle-availability', title: 'Disponibilidade sintética de legendas' },
    sources: loadSources(), subtitles: [], audioLanguages: ['ja', 'en'], isDemo: false,
  } satisfies Playback } }));
  await page.route('**/qa-availability-*.vtt', route => route.fulfill({
    contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:10:00.000\nLegenda sintética de disponibilidade\n',
  }));
}

test('missing captions explain the limit and retry discovers a newly available Portuguese track', async ({ page }) => {
  let requests = 0;
  await fixture(page, () => [{ url: demo, type: 'hls', audioLanguage: 'ja', subtitles: ++requests === 1 ? [] : [portuguese] }]);
  await page.goto('/watch/subtitle-availability');
  const availability = page.getByRole('region', { name: 'Disponibilidade de legendas' });
  await expect(availability).toContainText('Esta fonte não forneceu legendas para este episódio.');
  await expect(availability).toContainText('A tradução automática precisa de uma legenda de origem.');
  await expect(page.getByRole('button', { name: 'Gerar legenda em português', exact: true })).toHaveCount(0);
  await availability.getByRole('button', { name: 'Buscar fontes e legendas novamente' }).click();
  await expect(availability).toHaveCount(0);
  await expect(page.locator('video track')).toHaveAttribute('srclang', 'pt-BR');
  expect(requests).toBe(2);
  await expect(page.getByText('Áudio desta fonte: Japonês', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('Portuguese priority reports the actual audio and another source can recover captions without overriding off', async ({ page }) => {
  const japanese = `${demo}?qa-source=japanese`;
  const dubbed = `${demo}?qa-source=english`;
  await fixture(page, () => [
    { url: japanese, type: 'hls', label: 'Fonte QA · ja', audioLanguage: 'ja', subtitles: [english] },
    { url: dubbed, type: 'hls', label: 'Fonte QA · en', audioLanguage: 'en', subtitles: [portuguese] },
  ]);
  await page.addInitScript(() => localStorage.setItem('hpmovies.captions.v2', JSON.stringify({ language: 'off', size: 'small', offset: 0, background: false })));
  await page.goto('/watch/subtitle-availability');
  const sources = page.getByRole('combobox', { name: 'Fonte de vídeo' });
  await expect(sources).toHaveValue(dubbed);
  await expect(page.getByText('Áudio desta fonte: Inglês', { exact: true })).toBeVisible();
  await sources.selectOption(japanese);
  const availability = page.getByRole('region', { name: 'Disponibilidade de legendas' });
  await expect(availability).toContainText('Esta fonte não tem legenda em português.');
  await expect(availability).toContainText('A troca também pode mudar o idioma do áudio.');
  await expect(page.getByText('Áudio desta fonte: Japonês', { exact: true })).toBeVisible();
  await availability.getByRole('button', { name: 'Usar fonte com legenda em português' }).click();
  await expect(sources).toHaveValue(dubbed);
  await expect(availability).toHaveCount(0);
  await expect(page.locator('video track')).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('combobox', { name: 'Idioma das legendas' })).toHaveValue('off');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('refreshing subtitle availability preserves the current position and play intent', async ({ page }) => {
  test.setTimeout(60000);
  let requests = 0;
  await fixture(page, () => [{ url: demo, type: 'hls', audioLanguage: 'ja', subtitles: ++requests === 1 ? [] : [portuguese] }]);
  await page.goto('/watch/subtitle-availability');
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime), { timeout: 30000 }).toBeGreaterThan(1);
  await page.getByRole('region', { name: 'Player de vídeo' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(10);
  const position = await page.locator('video').evaluate(video => video.currentTime);
  await page.getByRole('button', { name: 'Buscar fontes e legendas novamente' }).click();
  await expect(page.locator('video track')).toHaveAttribute('srclang', 'pt-BR');
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime), { timeout: 30000 }).toBeGreaterThan(position);
  await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(false);
  expect(requests).toBe(2);
});
