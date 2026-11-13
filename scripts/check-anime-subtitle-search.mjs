import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Explicit live-source workflow: no fixtures, route interception or demo fallback.
const directory = join(tmpdir(), `hpmovies-anime-subtitles-${Date.now()}`);
await mkdir(directory, { recursive: true });
const result = { date: '2026-11-07', animeId: '16498', episode: 1, fixture: false, passed: false, pageErrorCount: 0 };
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', () => result.pageErrorCount++);
try {
  await page.goto('http://127.0.0.1:5173/anime/16498');
  await page.getByRole('heading', { name: 'Episódios', exact: true }).waitFor({ timeout: 75000 });
  await page.getByRole('link', { name: /^Assistir episódio 1 — / }).click({ timeout: 75000 });
  const selector = page.getByRole('combobox', { name: 'Fonte de vídeo' });
  await selector.waitFor({ timeout: 75000 });
  result.episodeIdPreserved = decodeURIComponent(new URL(page.url()).pathname).includes('tatakai:16498:1');
  const options = await selector.locator('option').allTextContents();
  result.totalSources = options.length;
  result.newServerLabels = options.filter(label => /BingeBang|MovieNerds|cineruv/i.test(label));
  const chosen = options.find(label => /BingeBang.*Wezen/i.test(label)) || options.find(label => /BingeBang/i.test(label));
  if (!chosen) throw new Error('AdditionalSourceMissing');
  await selector.selectOption({ label: chosen });
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, { timeout: 60000 });
  result.selectedSource = chosen;
  if (await page.locator('video').evaluate(video => video.paused)) await page.getByRole('button', { name: 'Reproduzir', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 8, null, { timeout: 45000 });
  result.video = await page.locator('video').evaluate(video => ({ time: video.currentTime, duration: video.duration, width: video.videoWidth,
    height: video.videoHeight, frames: video.getVideoPlaybackQuality().totalVideoFrames, audioBytes: video.webkitAudioDecodedByteCount ?? null }));
  await page.locator('video').evaluate(video => { video.pause(); video.dataset.liveSubtitleCheck = 'same-video'; });
  const position = await page.locator('video').evaluate(video => video.currentTime);
  await page.getByRole('region', { name: 'Player de vídeo' }).hover();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('button', { name: 'Buscar no OpenSubtitles', exact: true }).click();
  await page.getByRole('dialog', { name: 'OpenSubtitles' }).waitFor();
  await page.getByRole('button', { name: 'Inglês', exact: true }).click();
  const versions = page.getByRole('list', { name: 'Versões de legenda' }).getByRole('button');
  await versions.first().waitFor({ timeout: 45000 });
  result.englishVersions = await versions.count();
  await page.screenshot({ path: join(directory, 'opensubtitles-versions.png') });
  await versions.first().click();
  result.videoElementPreserved = await page.locator('video').getAttribute('data-live-subtitle-check') === 'same-video';
  result.positionPreserved = await page.locator('video').evaluate(video => video.currentTime) >= position - 0.5;
  await page.locator('video track').waitFor({ state: 'attached' });
  result.selectedLanguage = await page.locator('video track').getAttribute('srclang');
  await page.getByRole('button', { name: 'Gerar legenda em português', exact: true }).click();
  await page.getByText('Tradução automática: pode conter erros.', { exact: true }).waitFor({ timeout: 360000 });
  await page.waitForFunction(() => [...(document.querySelector('video')?.textTracks || [])].some(track => track.cues?.length > 0 && /^pt/.test(track.language)), null, { timeout: 30000 });
  result.translation = await page.locator('video').evaluate(video => [...video.textTracks].filter(track => /^pt/.test(track.language)).map(track => ({ language: track.language, cues: track.cues?.length ?? 0 })));
  await page.locator('video').evaluate(video => {
    const track = [...video.textTracks].find(track => /^pt/.test(track.language) && track.cues?.length);
    const cue = [...track.cues].find(cue => cue.startTime > 30 && cue.endTime - cue.startTime > 1);
    video.currentTime = cue.startTime + 0.2;
  });
  await page.locator('.player-caption-text').waitFor({ timeout: 15000 });
  result.captionVisible = await page.locator('.player-caption-text').isVisible();
  await page.getByRole('region', { name: 'Player de vídeo' }).hover();
  const settings = page.getByRole('button', { name: 'Fechar configurações' });
  if (await settings.isVisible()) await settings.click();
  await page.screenshot({ path: join(directory, 'anime-translated-desktop.png') });
  await page.setViewportSize({ width: 320, height: 851 });
  result.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await page.screenshot({ path: join(directory, 'anime-translated-mobile.png'), fullPage: true });
  result.passed = result.episodeIdPreserved && result.newServerLabels.length > 0 && result.video.frames > 0 && result.video.audioBytes > 0
    && result.video.duration > 20 * 60 && result.video.duration < 30 * 60 && result.videoElementPreserved && result.positionPreserved
    && result.selectedLanguage === 'en' && result.captionVisible && !result.mobileOverflow && !result.pageErrorCount;
} catch (error) {
  result.failure = error instanceof Error ? error.name : 'UnknownError';
  result.alerts = await page.getByRole('alert').allTextContents();
  await page.screenshot({ path: join(directory, 'failure.png') });
} finally { await browser.close(); }
await writeFile(join(directory, 'results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
console.log(`Evidências locais: ${directory}`);
if (!result.passed) process.exitCode = 1;
