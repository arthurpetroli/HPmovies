import { expect, test } from '@playwright/test';

// UI fixtures only. They do not validate the media delivered by any live host.
test('an anime without a legacy index can request its video and show additional servers', async ({ page }) => {
  const id = '24681';
  const episodeId = `tatakai:${id}:1`;
  const requests: string[] = [];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()); requests.push(url.pathname);
    if (url.pathname === `/api/catalog/anime/${id}`) return route.fulfill({ json: { data: { id, title: 'Anime QA com fontes extras', poster: '', format: 'TV', status: 'FINISHED', genres: [] } } });
    if (url.pathname === `/api/streaming/anime/${id}/episodes`) return route.fulfill({ json: { data: { available: false, state: 'empty', episodes: [], message: 'O índice QA está indisponível.' } } });
    if (url.pathname === `/api/content/anime/${id}/episodes/1` || url.pathname === `/api/streaming/episodes/${episodeId}`) return route.fulfill({ json: { data: {
      episode: { id: episodeId, number: 1, title: 'Episódio 1' }, isDemo: false, subtitles: [], audioLanguages: [], sources: [
        { type: 'mp4', url: '/qa-native-one.mp4', label: 'BingeBang · Yildun QA', subtitles: [] },
        { type: 'mp4', url: '/qa-native-two.mp4', label: 'BingeBang · Wezen QA', subtitles: [] },
      ],
    } } });
    return route.fulfill({ status: 404, json: { message: 'Recurso ausente na fixture.' } });
  });
  // Keep synthetic video requests pending: this scenario checks navigation and
  // source choices, while real decoding is verified by the separate live checker.
  await page.route('**/qa-native-*.mp4', () => {});
  await page.goto(`/anime/${id}`);
  await page.getByRole('link', { name: 'Consultar fontes e assistir', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' }).locator('option')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' })).toContainText('Yildun');
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(`/watch/${episodeId}`);
  expect(requests.some(path => path.startsWith('/api/cinema/'))).toBe(false);
  await page.getByRole('combobox', { name: 'Fonte de vídeo' }).selectOption('/qa-native-two.mp4');
  await expect(page.getByRole('combobox', { name: 'Fonte de vídeo' })).toHaveValue('/qa-native-two.mp4');
});
