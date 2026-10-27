import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Explicit live-source check: no route interception, fixtures or demo fallback.
const titles = new Map([[20, 'Naruto'], [1535, 'Death Note'], [1, 'Cowboy Bebop'], [16498, 'Shingeki no Kyojin'], [21, 'One Piece'],
  [127230, 'Chainsaw Man'], [154587, 'Sousou no Frieren'], [101922, 'Kimetsu no Yaiba'], [21087, 'One Punch Man'],
  [269, 'Bleach'], [813, 'Dragon Ball Z'], [164, 'Fullmetal Alchemist'], [113415, 'Jujutsu Kaisen'], [140960, 'SPY×FAMILY'],
  [151807, 'Solo Leveling'], [11061, 'Hunter x Hunter (2011)'], [21519, 'Kimi no Na wa.'], [199, 'Sen to Chihiro no Kamikakushi'],
  [11577, 'Steins;Gate: Fuka Ryouiki no Déjà vu'], [212888, 'Overgeared']]);
const selections = process.argv.slice(2).length ? process.argv.slice(2) : ['20', '1535', '1', '16498', '21'];
const requests = selections.map(value => {
  const match = /^([1-9]\d{0,8})(?::([1-9]\d{0,5}))?$/.exec(value);
  if (!match || !titles.has(Number(match[1])) || Number(match[2] ?? 1) > 100000) throw new Error(`Use ID ou ID:episódio. IDs aceitos: ${[...titles.keys()].join(', ')}.`);
  return { id: Number(match[1]), episode: Number(match[2] ?? 1) };
});
// A working media file can still be an upstream title mismatch. In the known
// Demon Slayer regression, episode 1 resolved to a 105-minute compilation.
const durationWindows = new Map([[101922, { minimum: 18 * 60, maximum: 35 * 60 }],
  [11577, { minimum: 80 * 60, maximum: 100 * 60 }], [212888, { minimum: 18 * 60, maximum: 30 * 60 }]]);
const origin = new URL(process.env.STREAM_CHECK_ORIGIN || 'http://127.0.0.1:5173');
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error('Informe uma origem HTTP válida.');
const directory = join(tmpdir(), `hpmovies-playback-${Date.now()}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
const results = [];
try {
  for (const { id, episode } of requests) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const result = { id, title: titles.get(id), episode, passed: false, pageErrors: [], failedRequests: [], mediaStatuses: [], subtitleStatuses: [] };
    page.on('pageerror', error => result.pageErrors.push(error.message));
    page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) result.failedRequests.push({ path: new URL(request.url()).pathname.replace(/[a-f0-9-]{36}/g, ':ticket'), reason: request.failure()?.errorText }); });
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith('/api/streaming/media/')) result.mediaStatuses.push(response.status());
      if (path.startsWith('/api/subtitles/file/')) result.subtitleStatuses.push(response.status());
    });
    try {
      const query = new URLSearchParams({ kind: 'anime', id: String(id), title: result.title, source: 'tatakai', episode: String(episode), open: '1' });
      await page.goto(new URL(`/sources?${query}`, origin).href);
      await page.locator('video').waitFor({ timeout: 75000 });
      await page.getByRole('button', { name: 'Reproduzir', exact: true }).click();
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && video.currentTime >= 10 && video.videoWidth > 0 && [...video.textTracks].some(track => track.language.toLowerCase() === 'pt-br' && track.mode === 'hidden' && track.cues?.length > 0);
      }, null, { timeout: 60000 });
      result.beforeSeek = await page.locator('video').evaluate(video => ({
        time: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight,
        decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames,
        decodedAudioBytes: video.webkitAudioDecodedByteCount ?? null,
        captionCues: [...video.textTracks].filter(track => track.mode === 'hidden').map(track => ({ language: track.language, count: track.cues?.length ?? 0 })),
      }));
      const durationWindow = durationWindows.get(id);
      result.durationMatchesExpectedEpisode = !durationWindow || result.beforeSeek.duration >= durationWindow.minimum && result.beforeSeek.duration <= durationWindow.maximum;
      await page.getByRole('region', { name: 'Player de vídeo' }).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(position => document.querySelector('video')?.currentTime >= position + 11, result.beforeSeek.time, { timeout: 30000 });
      result.afterSeek = await page.locator('video').evaluate(video => ({ time: video.currentTime, readyState: video.readyState, paused: video.paused, error: video.error?.code ?? null }));
      await page.locator('video').evaluate(video => {
        const track = [...video.textTracks].find(item => item.language.toLowerCase() === 'pt-br' && item.mode === 'hidden');
        const cue = [...(track?.cues ?? [])].find(item => item.endTime - item.startTime > 1 && item.startTime > 30);
        if (!cue) throw new Error('Nenhuma entrada PT-BR permite conferir a legenda visível.');
        video.currentTime = cue.startTime + 0.2;
      });
      await page.waitForFunction(() => {
        const caption = document.querySelector('[aria-live="off"]');
        return caption?.textContent?.trim().length > 0 && caption.getBoundingClientRect().height > 0;
      }, null, { timeout: 15000 });
      result.portugueseCaptionVisible = await page.locator('[aria-live="off"]').isVisible();
      result.machineTranslationWarningVisible = await page.getByText('Tradução automática: pode conter erros.', { exact: true }).isVisible();
      await page.locator('video').evaluate(video => video.pause());
      await page.screenshot({ path: join(directory, `${id}-${episode}-desktop.png`) });
      await page.setViewportSize({ width: 393, height: 851 });
      result.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await page.screenshot({ path: join(directory, `${id}-${episode}-mobile.png`) });
      result.alerts = await page.getByRole('alert').allTextContents();
      const expectedMachineTranslation = id === 212888 && episode === 2;
      result.passed = (!expectedMachineTranslation || result.machineTranslationWarningVisible) && result.durationMatchesExpectedEpisode && result.beforeSeek.decodedFrames > 0 && typeof result.beforeSeek.decodedAudioBytes === 'number' && result.beforeSeek.decodedAudioBytes > 0 && result.portugueseCaptionVisible && !result.afterSeek.error && !result.mobileOverflow && !result.pageErrors.length && !result.failedRequests.length && !result.alerts.length && result.mediaStatuses.every(status => status === 200 || status === 206);
    } catch (error) {
      result.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
      result.alerts = await page.getByRole('alert').allTextContents();
      result.playerState = await page.locator('video').evaluateAll(videos => videos.map(video => ({ time: video.currentTime, readyState: video.readyState, error: video.error?.code ?? null })));
      await page.screenshot({ path: join(directory, `${id}-${episode}-failure.png`) });
    } finally { await context.close(); }
    results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(join(directory, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  }
} finally { await browser.close(); }
console.log(`Evidências: ${directory}`);
if (results.some(result => !result.passed)) process.exitCode = 1;
