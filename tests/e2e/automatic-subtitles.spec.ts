import { expect, test } from '@playwright/test';

// Isolated UI contract: these captions and job responses are fixtures, not anime evidence.
test('generates Portuguese with progress, selects it and keeps the video position', async ({ page }) => {
  const text = 'Legenda automática de teste';
  await page.route('**/api/streaming/episodes/automatic-fixture', route => route.fulfill({ json: { data: {
    episode: { id: 'automatic-fixture', title: 'Fixture de tradução' }, isDemo: false, audioLanguages: ['en'],
    sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' }],
    subtitles: [{ id: 'en', language: 'en', label: 'English fixture', format: 'vtt', url: '/fixture-english.vtt', translationToken: 'offer' }],
  } } }));
  await page.route('**/fixture-english.vtt', route => route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:30:00.000\nEnglish fixture\n' }));
  await page.route('**/api/subtitles/automatic/offer', route => route.fulfill({ status: 202, json: { data: { id: 'job', state: 'pending' } } }));
  let polls = 0;
  await page.route('**/api/subtitles/automatic/jobs/job', route => {
    polls++;
    return route.fulfill({ json: { data: polls < 2 ? { id: 'job', state: 'pending' } : { id: 'job', state: 'complete', subtitle: { id: 'automatic-pt', language: 'pt', label: 'Português automático fixture', machineTranslated: true, format: 'vtt', url: '/api/subtitles/automatic/file/caption' } } } });
  });
  await page.route('**/api/subtitles/automatic/file/caption', route => route.fulfill({ contentType: 'text/vtt', body: `WEBVTT\n\n00:00:00.000 --> 00:30:00.000\n${text}\n` }));
  await page.goto('/watch/automatic-fixture');
  await page.getByRole('button', { name: 'Reproduzir vídeo', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(1);
  const position = await page.locator('video').evaluate(video => video.currentTime);
  await page.getByRole('button', { name: 'Gerar legenda em português' }).click();
  await expect(page.getByRole('button', { name: 'Traduzindo legenda…' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Você pode continuar assistindo');
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('complementary', { name: 'Sua experiência' }).getByText('Tradução automática: pode conter erros.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Player de vídeo' }).getByText('Tradução automática: pode conter erros.', { exact: true })).toHaveCount(0);
  expect(await page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(position);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});

test('translation failure leaves the video usable and permits another attempt', async ({ page }) => {
  await page.route('**/api/streaming/episodes/automatic-error', route => route.fulfill({ json: { data: {
    episode: { id: 'automatic-error', title: 'Fixture de falha' }, isDemo: false, audioLanguages: [],
    sources: [{ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' }],
    subtitles: [{ id: 'en', language: 'en', label: 'English fixture', url: '/fixture-english.vtt', translationToken: 'offer' }],
  } } }));
  await page.route('**/api/subtitles/automatic/offer', route => route.fulfill({ status: 503, json: { message: 'Tradutor ocupado. Tente novamente.' } }));
  await page.goto('/watch/automatic-error');
  await page.getByRole('button', { name: 'Gerar legenda em português' }).click();
  await expect(page.getByRole('alert')).toContainText('Tradutor ocupado');
  await expect(page.getByRole('button', { name: 'Gerar legenda em português' })).toBeEnabled();
  await expect(page.locator('video')).toHaveCount(1);
});
