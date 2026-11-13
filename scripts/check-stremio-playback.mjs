import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Opt-in live checks. No fixtures, request interception, demo media or saved signed URLs.
const samples = [
  { type: 'series', imdb: 'tt0903747', title: 'Breaking Bad', season: 1, episode: 1, min: 45 * 60, max: 65 * 60 },
  { type: 'series', imdb: 'tt2560140', title: 'Attack on Titan', season: 1, episode: 1, min: 20 * 60, max: 30 * 60 },
  { type: 'movie', imdb: 'tt1375666', title: 'Inception', min: 140 * 60, max: 155 * 60 },
];
const progressive = process.argv.includes('--mp4');
const selected = process.argv.slice(2).filter(value => value !== '--mp4');
if (selected.some(id => !samples.some(sample => sample.imdb === id))) throw new Error('Use tt0903747, tt2560140 ou tt1375666.');
const origin = new URL(process.env.STREAM_CHECK_ORIGIN || 'http://127.0.0.1:5173');
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error('Origem de verificação inválida.');
const directory = join(tmpdir(), `hpmovies-stremio-live-${Date.now()}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
const results = [];
try {
  for (const sample of samples.filter(sample => !selected.length || selected.includes(sample.imdb))) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const result = { imdb: sample.imdb, title: sample.title, type: sample.type, season: sample.season, episode: sample.episode,
      passed: false, pageErrorCount: 0, failedRequestHosts: [], mediaStatuses: [], fixture: false, audiovisualIdentityManuallyVerified: false,
      requestedTransport: progressive ? 'mp4' : 'default' };
    page.on('pageerror', () => result.pageErrorCount++);
    page.on('requestfailed', request => {
      if (!request.failure()?.errorText.includes('ERR_ABORTED')) result.failedRequestHosts.push(new URL(request.url()).hostname);
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.port === '7010' && /\/hls-relay\//.test(url.pathname)) result.mediaStatuses.push(response.status());
    });
    try {
      await page.goto(new URL(`/cinema/${sample.type}/${sample.imdb}`, origin).href);
      if (sample.type === 'movie') await page.getByRole('link', { name: 'Consultar fontes e assistir', exact: true }).click({ timeout: 30_000 });
      else await page.getByRole('link', { name: new RegExp(`^Assistir temporada ${sample.season}, episódio ${sample.episode}:`) }).click({ timeout: 30_000 });
      await page.locator('video').waitFor({ timeout: 75_000 });
      if (progressive) {
        const selector = page.getByRole('combobox', { name: 'Fonte de vídeo' });
        const option = (await selector.locator('option').allTextContents()).find(label => label.includes('Wezen'));
        if (!option) throw new Error('Fonte progressiva da amostra ausente.');
        await selector.selectOption({ label: option });
      }
      await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 60_000 });
      result.selectedSource = await page.getByRole('combobox', { name: 'Fonte de vídeo' }).locator('option:checked').textContent();
      result.sourceCount = await page.getByRole('combobox', { name: 'Fonte de vídeo' }).locator('option').count();
      if (await page.locator('video').evaluate(video => video.paused)) await page.getByRole('button', { name: 'Reproduzir', exact: true }).click();
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && video.currentTime >= 8 && video.videoWidth > 0 && video.getVideoPlaybackQuality().totalVideoFrames > 0;
      }, null, { timeout: 45_000 });
      result.beforeSeek = await page.locator('video').evaluate(video => ({
        time: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight,
        frames: video.getVideoPlaybackQuality().totalVideoFrames, decodedAudioBytes: video.webkitAudioDecodedByteCount ?? null,
        subtitleLanguages: [...video.textTracks].map(track => track.language),
      }));
      result.durationMatchesSample = result.beforeSeek.duration >= sample.min && result.beforeSeek.duration <= sample.max;
      await page.locator('video').evaluate(video => { video.currentTime = 90; });
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && video.currentTime >= 94 && !video.seeking && !video.paused && video.readyState >= 2;
      }, null, { timeout: 45_000 });
      result.afterSeek = await page.locator('video').evaluate(video => ({ time: video.currentTime, error: video.error?.code ?? null }));
      await page.locator('video').evaluate(video => video.pause());
      await page.screenshot({ path: join(directory, `${sample.imdb}-desktop.png`) });
      await page.setViewportSize({ width: 320, height: 851 });
      result.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await page.screenshot({ path: join(directory, `${sample.imdb}-mobile.png`), fullPage: true });
      result.alerts = await page.getByRole('alert').allTextContents();
      result.passed = result.durationMatchesSample && result.beforeSeek.frames > 0 && result.beforeSeek.decodedAudioBytes > 0
        && !result.afterSeek.error && !result.mobileOverflow && !result.pageErrorCount;
    } catch (error) {
      // Error text from network/players can contain signed URLs. Keep a bounded stage result.
      result.failure = error instanceof Error ? error.name : 'UnknownError';
      result.alerts = await page.getByRole('alert').allTextContents();
      result.playerState = await page.locator('video').evaluateAll(videos => videos.map(video => ({ time: video.currentTime, readyState: video.readyState, error: video.error?.code ?? null })));
      await page.screenshot({ path: join(directory, `${sample.imdb}-failure.png`) });
    } finally { await context.close(); }
    result.failedRequestHosts = [...new Set(result.failedRequestHosts)];
    results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(join(directory, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  }
} finally { await browser.close(); }
console.log(`Evidências locais: ${directory}`);
if (results.some(result => !result.passed)) process.exitCode = 1;
