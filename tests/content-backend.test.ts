import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/aniwatch-apis/src/app';
import { StreamingRegistry } from '../src/aniwatch-apis/src/providers/registry';
import { TatakaiStreamingProvider } from '../src/aniwatch-apis/src/providers/tatakai';
import { ContentRegistry } from '../src/aniwatch-apis/src/providers/content-registry';
import { NovelContentProvider } from '../src/aniwatch-apis/src/providers/novel-content';
import type { NovelProvider } from '../src/shared/novel';

const { startSourceHost } = createRequire(import.meta.url)('../src/aniwatch-apis/src/providers/tatakai-runtime/local-server.cjs');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function actualHost() {
  const directory = await mkdtemp(path.join(tmpdir(), 'hpmovies-content-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const bundle = `module.exports = {
    listProviders() { return [{name:'allowed',kind:'stream'}]; },
    async streamAll(opts,onChunk) {
      if (!opts.titles.includes('Obra de teste')) throw new Error('Caller title required during metadata outage');
      onChunk({results:[{url:'https://media.example.com/episode.mp4',type:'mp4',providerName:'allowed',providerKey:'allowed',audioLanguage:'ja'}],diagnostic:{provider:'allowed',status:'ok'}});
    },
    async getMangaChapters(opts) { if(opts.title!=='Obra de teste') throw new Error('title missing'); return [{number:1,title:'Manga chapter',sources:[{provider:'allowed',chapterKey:'opaque-chapter-1',providerChapterId:'upstream-1',language:'pt-BR',scanlator:'Grupo de teste'}]}]; },
    async getMangaPages(opts) { if(opts.providerChapterId!=='upstream-1') throw new Error('Provider chapter identity missing'); return [{pageNumber:1,imageUrl:'https://media.example.com/page.jpg'}]; },
    async getNovelChapters(opts) { if(opts.title!=='Obra de teste') throw new Error('title missing'); return [{number:1,title:'Novel chapter',sources:[{provider:'allowed',chapterKey:'opaque-text-1',providerChapterId:'text-1',language:'pt-BR',translator:'Tradutor de teste'}]}]; },
    async getNovelContent(opts) { if(opts.providerChapterId!=='text-1') throw new Error('Provider chapter identity missing'); return {paragraphs:[{index:0,text:'Texto original de teste do contrato.'}]}; }
  };`;
  const manifest = { id: 'fixture', capabilities: ['streaming', 'manga', 'novel'], apiServer: { namespace: 'fixture', contract: 'streaming-sources-v3', routes: ['stream'] } };
  await writeFile(path.join(directory, 'bundle.cjs'), bundle);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ version: 1, extensions: [{ trusted: true, sha256: createHash('sha256').update(bundle).digest('hex'), manifestPath: 'manifest.json', bundlePath: 'bundle.cjs' }] }));
  const host = await startSourceHost({ extensionsFile: path.join(directory, 'sources.json'), port: 0, logger: { info() {}, warn() {}, error() {} } });
  cleanup.push(() => host.stop());
  return host as { baseUrl: string; stop(): Promise<void> };
}

function backend(baseUrl: string) {
  const tatakai = new TatakaiStreamingProvider({ enabled: true, baseUrl, namespace: 'fixture', contentAuthorized: true, allowedProviders: ['allowed'], allowedMediaHosts: ['media.example.com'], retries: 0 });
  const registry = new StreamingRegistry({ tatakai });
  const content = new ContentRegistry(registry);
  return { app: createApp({ registry, content }), registry, content };
}

const hints = '?source=tatakai&title=Obra%20de%20teste';

describe('Tatakai local host through HPmovies content API', () => {
  it('resolves a real host stream without inventing an episode index', async () => {
    const host = await actualHost();
    const { app, registry } = backend(host.baseUrl);
    expect(await registry.tatakai.diagnostic()).toMatchObject({ state: 'available', technicalAvailable: true });
    const response = await app.request(`/api/content/anime/anilist:1/episodes/1${hints}`);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ episode: { id: 'tatakai:1:1' }, sources: [{ url: 'https://media.example.com/episode.mp4', type: 'mp4' }], isDemo: false });
    const playback = await app.request('/api/streaming/episodes/tatakai:1:1?title=Obra%20de%20teste');
    expect(playback.status).toBe(200);
  });

  it('lists PT-BR chapters and resolves provider-specific pages across a backend restart', async () => {
    const host = await actualHost();
    const first = backend(host.baseUrl);
    const response = await first.app.request(`/api/content/manga/anilist:1/chapters${hints}`);
    expect(response.status).toBe(200);
    const chapters = (await response.json()).data;
    expect(chapters).toMatchObject({ available: true, languages: ['pt-BR'], chapters: [{ credits: ['Grupo de teste'] }] });
    const id = chapters.chapters[0].id;
    expect(id).toMatch(/^tatakai-[a-f0-9]{64}$/);
    const restarted = backend(host.baseUrl);
    const pages = await restarted.app.request(`/api/content/manga/anilist:1/chapters/${id}/pages${hints}`);
    expect(pages.status).toBe(200);
    expect((await pages.json()).data.pages).toEqual(['https://media.example.com/page.jpg']);
    const foreign = await restarted.app.request(`/api/content/novel/anilist:1/chapters/${id}/content${hints}`);
    expect(foreign.status).toBe(404);
  });

  it('serves novel text through the normal reader API even when metadata is unavailable', async () => {
    const host = await actualHost();
    const { registry, content } = backend(host.baseUrl);
    const catalog: NovelProvider = { search: async () => { throw new Error('offline'); }, genres: async () => [], details: async () => { throw new Error('offline'); }, chapters: async () => { throw new Error('unused'); }, content: async () => { throw new Error('unused'); } };
    const novels = new NovelContentProvider(catalog, content);
    const app = createApp({ registry, content, novels });
    const list = await app.request(`/api/novels/1/chapters${hints}`);
    const chapters = (await list.json()).data;
    expect(chapters.available).toBe(true);
    const text = await app.request(`/api/novels/1/chapters/${chapters.chapters[0].id}/content${hints}`);
    expect(text.status).toBe(200);
    expect((await text.json()).data).toMatchObject({ available: true, novel: { id: '1', title: 'Obra de teste' }, paragraphs: ['Texto original de teste do contrato.'] });
  });

  it('rejects malformed source requests before consulting an extension', async () => {
    const app = createApp();
    for (const route of ['/api/content/manga/not-an-id/chapters', '/api/content/manga/1/chapters?source=arbitrary', '/api/content/manga/1/chapters?url=http://127.0.0.1', '/api/content/anime/1/episodes/-1', '/api/content/stremio/not-imdb/1/1']) expect((await app.request(route)).status).toBe(400);
  });
});
