import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/aniwatch-apis/src/app';
import { MangaArchiveJobs } from '../src/aniwatch-apis/src/providers/manga-archive';
import type { MangaArchiveJob } from '../src/shared/mangaArchive';
import type { MangaChapter, MangaChapterPage, MangaChapterPages, MangaTitle } from '../src/shared/manga';

// Synthetic local HTTP contracts; no live source, catalog or media is requested.
const mangaId = '81000000-0000-4000-8000-000000000001';
const imageId = '81000000-0000-4000-8000-000000000002';
const manga: MangaTitle = { id: mangaId, title: 'História das rotas QA', poster: '', sourceUrl: 'https://provider.example/qa', availableLanguages: ['pt-br'], authors: [], tags: [], contentRating: 'safe', status: 'completed' };
const chapter = (id: string, number: string, volume: string): MangaChapter => ({ id, mangaId, title: `Capítulo QA ${number}`, chapter: number, volume, language: 'pt-br', groups: ['Grupo QA'], pages: 1 });
const chapters = [chapter('81000000-0000-4000-8000-000000000003', '1', '1'), chapter('81000000-0000-4000-8000-000000000004', '2', '2')];
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const resources: { jobs: MangaArchiveJobs; directory: string }[] = [];
async function setup() {
  const provider = {
    home: vi.fn(), search: vi.fn(), tags: vi.fn(),
    details: vi.fn(async () => manga),
    chapters: vi.fn(async (_id: string, language = 'pt-br', page = 1): Promise<MangaChapterPage> => ({ items: [chapters[page - 1]], language, page, hasNextPage: page === 1, total: 2 })),
    pages: vi.fn(async (id: string): Promise<MangaChapterPages> => ({ chapter: chapters.find(chapter => chapter.id === id)!, pages: [`/api/manga/image/${imageId}`], sourceUrl: 'https://provider.example/qa/chapter?token=synthetic-private' })),
    image: vi.fn(async () => ({ bytes: png, contentType: 'image/png', cacheControl: 'private' })),
  };
  const directory = await mkdtemp(join(tmpdir(), 'hpmovies-archive-routes-'));
  const jobs = new MangaArchiveJobs({ provider, directory }); resources.push({ jobs, directory });
  const app = createApp({ manga: provider, mangaArchives: jobs, rateLimit: 10_000 });
  return { app, jobs, provider };
}
const requestBody = { mangaId, language: 'pt-br', scope: 'all' };
const post = (app: ReturnType<typeof createApp>, path = '/api/manga/archives', body: unknown = requestBody, origin?: string) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
async function ready(app: ReturnType<typeof createApp>, id: string): Promise<MangaArchiveJob> {
  let data!: MangaArchiveJob;
  await vi.waitFor(async () => {
    const response = await app.request(`/api/manga/archives/${id}`);
    expect(response.status).toBe(200);
    data = (await response.json()).data;
    expect(data.state).toBe('ready');
  }, { interval: 10, timeout: 3000 });
  return data;
}

describe('manga archive HTTP routes', () => {
  afterEach(async () => {
    for (const resource of resources.splice(0)) {
      await resource.jobs.dispose();
      await rm(resource.directory, { recursive: true, force: true });
    }
  });
  it('plans all index pages and exposes each real volume', async () => {
    const { app, provider } = await setup();
    const response = await app.request(`/api/manga/${mangaId}/archive-plan?language=pt-br`);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.chapters.map((chapter: MangaChapter) => chapter.id)).toEqual(chapters.map(chapter => chapter.id));
    expect(data.volumes).toEqual([{ volume: '1', chapters: 1 }, { volume: '2', chapters: 1 }]);
    expect(provider.chapters.mock.calls.map(call => call[2])).toEqual([1, 2]);
    expect(provider.pages).not.toHaveBeenCalled(); expect(provider.image).not.toHaveBeenCalled();
  });
  it('accepts a local request without Origin, polls a completed archive and streams a ZIP attachment with safe headers', async () => {
    const { app } = await setup();
    const started = await post(app);
    expect(started.status).toBe(202);
    const id = (await started.json()).data.id;
    const done = await ready(app, id);
    expect(done.completedChapters).toBe(2); expect(done.completedPages).toBe(2);
    const file = await app.request(done.fileUrl!);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('application/zip');
    expect(file.headers.get('Cache-Control')).toBe('no-store');
    expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(file.headers.get('Content-Disposition')).toContain('attachment;');
    expect(file.headers.get('Content-Disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('História das rotas QA - pt-br.zip')}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(Number(file.headers.get('Content-Length'))).toBe(bytes.length);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.toString()).toContain('Volume 001'); expect(bytes.toString()).toContain('Volume 002');
    expect(bytes.toString()).not.toContain('synthetic-private');
  });
  it('accepts a same-origin JSON request and cancels without exposing a partial file', async () => {
    const { app, provider } = await setup();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    provider.image.mockImplementation(async () => { await blocked; return { bytes: png, contentType: 'image/png', cacheControl: 'private' }; });
    const started = await post(app, '/api/manga/archives', requestBody, 'http://localhost');
    expect(started.status).toBe(202);
    const id = (await started.json()).data.id;
    await vi.waitFor(() => expect(provider.image).toHaveBeenCalledOnce());
    expect((await app.request(`/api/manga/archives/${id}/file`)).status).toBe(400);
    const cancelled = await post(app, `/api/manga/archives/${id}/cancel`, {}, 'http://localhost');
    expect(cancelled.status).toBe(200); expect((await cancelled.json()).data.state).toBe('cancelled');
    expect((await app.request(`/api/manga/archives/${id}/file`)).status).toBe(400);
    release();
  });
  it('blocks a foreign Origin before creating or cancelling any archive', async () => {
    const { app, provider } = await setup();
    const forbidden = await post(app, '/api/manga/archives', requestBody, 'https://attacker.example');
    expect(forbidden.status).toBe(403); expect((await forbidden.json()).error).toBe('INVALID_ORIGIN');
    expect(forbidden.headers.get('Access-Control-Allow-Origin')).not.toBe('https://attacker.example');
    expect(provider.details).not.toHaveBeenCalled();
    const cancelled = await post(app, '/api/manga/archives/81000000-0000-4000-8000-000000000099/cancel', {}, 'https://attacker.example');
    expect(cancelled.status).toBe(403);
  });
  it.each([
    { body: null }, { body: [] }, { body: {} }, { body: { ...requestBody, url: 'https://attacker.example/' } },
    { body: { ...requestBody, mangaId: '../../etc/passwd' } }, { body: { ...requestBody, scope: 'arbitrary' } },
    { body: { ...requestBody, group: 123 } }, { body: { ...requestBody, volume: {} } },
  ])('rejects an invalid archive body $body', async ({ body }) => {
    const { app, provider } = await setup(); const response = await post(app, '/api/manga/archives', body);
    expect(response.status).toBe(400); expect(provider.details).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON, wrong content type and oversized JSON before source requests', async () => {
    const { app, provider } = await setup();
    for (const init of [
      { headers: { 'Content-Type': 'application/json' }, body: '{broken' },
      { headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(requestBody) },
    ]) expect((await app.request('/api/manga/archives', { method: 'POST', ...init })).status).toBe(400);
    const large = await post(app, '/api/manga/archives', { ...requestBody, group: 'x'.repeat(3000) });
    expect(large.status).toBe(413); expect(provider.details).not.toHaveBeenCalled();
  });
  it('rejects arbitrary and duplicate query arguments on archive endpoints', async () => {
    const { app } = await setup();
    const started = await post(app); const id = (await started.json()).data.id;
    for (const path of [
      `/api/manga/${mangaId}/archive-plan?url=https://attacker.example`,
      `/api/manga/${mangaId}/archive-plan?language=pt-br&language=en`,
      `/api/manga/archives/${id}?url=https://attacker.example`,
      `/api/manga/archives/${id}/file?path=/etc/passwd`,
    ]) expect((await app.request(path)).status).toBe(400);
    expect((await post(app, '/api/manga/archives?url=https://attacker.example')).status).toBe(400);
    expect((await post(app, `/api/manga/archives/${id}/cancel?url=https://attacker.example`, {})).status).toBe(400);
  });
  it('requires an empty valid JSON object when cancelling a prepared archive', async () => {
    const { app } = await setup(); const started = await post(app); const id = (await started.json()).data.id;
    const path = `/api/manga/archives/${id}/cancel`;
    const malformed = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    expect(malformed.status).toBe(400);
    expect((await post(app, path, { url: 'https://attacker.example' })).status).toBe(400);
    expect((await post(app, path, [])).status).toBe(400);
  });
  it('returns 404 for unknown opaque jobs and invalid path identities', async () => {
    const { app } = await setup();
    for (const suffix of ['', '/file']) expect((await app.request(`/api/manga/archives/81000000-0000-4000-8000-000000000099${suffix}`)).status).toBe(404);
    expect((await app.request('/api/manga/archives/not-an-issued-id')).status).toBe(404);
  });
  it('disposes only its own archive service when the application lifecycle ends', async () => {
    const { app } = await setup(); const started = await post(app); const id = (await started.json()).data.id;
    await ready(app, id);
    await app.dispose();
    expect((await app.request(`/api/manga/archives/${id}`)).status).toBe(404);
    expect((await post(app)).status).toBe(503);
    const independent = await setup();
    expect((await post(independent.app)).status).toBe(202);
  });
});
