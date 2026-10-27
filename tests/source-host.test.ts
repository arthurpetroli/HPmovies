import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { startSourceHost } = createRequire(import.meta.url)('../src/aniwatch-apis/src/providers/tatakai-runtime/local-server.cjs');
const quiet = { info() {}, warn() {}, error() {} };
const directories: string[] = [];
const hosts: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function prepareExtensions(names = ['fixture']) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hpmovies-host-test-'));
  directories.push(directory);
  const extensions = [];
  for (const name of names) {
    const bundle = `module.exports = {
      async streamAll(opts, onChunk) { await new Promise(resolve => setTimeout(resolve, 2)); onChunk({results:[{url:'https://media.example.test/${name}/'+encodeURIComponent(opts.titles[0]||'none')+'.m3u8',type:'hls',providerName:'${name}',headers:{Referer:'https://origin.example.test/'}}],diagnostic:{provider:'${name}',status:'ok'}}); },
      listProviders() { return [{name:'${name}',kind:'stream'}]; },
      async getWebsiteEpisodeIndex(params) { return {provider:'${name}',episodeCount:2,episodes:[{number:1,title:params.titles[0]||'First'},{number:2}]}; },
      async getMangaChapters() { return [{number:1,title:'First',sources:[{provider:'${name}',chapterKey:'manga:1',providerChapterId:'upstream-1',language:'pt-BR'}]}]; },
      async getMangaPages(params) { return [{pageNumber:1,imageUrl:'https://media.example.test/page.jpg',headers:{Referer:'https://origin.example.test/'+params.providerChapterId},width:800,height:1200}]; },
      async getNovelChapters() { return [{number:2,title:'Second',sources:[{provider:'${name}',chapterKey:'novel:2',translator:'Fixture translator'}]}]; },
      async getNovelContent(params) { return {number:2,title:params.chapterKey,paragraphs:[{index:0,text:'A test paragraph.'}]}; }
    };`;
    const manifest = { id: name, capabilities: ['streaming', 'manga', 'novel'], apiServer: { namespace: name, contract: 'streaming-sources-v3', routes: ['stream'] } };
    await writeFile(path.join(directory, `${name}.cjs`), bundle);
    await writeFile(path.join(directory, `${name}.json`), JSON.stringify(manifest));
    extensions.push({ trusted: true, sha256: createHash('sha256').update(bundle).digest('hex'), manifestPath: `${name}.json`, bundlePath: `${name}.cjs` });
  }
  const configFile = path.join(directory, 'sources.json');
  await writeFile(configFile, JSON.stringify({ version: 1, extensions }));
  return { directory, configFile, extensions };
}

async function start(extensionsFile?: string) {
  const host = await startSourceHost({ extensionsFile, port: 0, logger: quiet });
  hosts.push(host);
  return host as { baseUrl: string; stop(): Promise<void> };
}

describe('explicit local Tatakai source host', () => {
  it('runs a healthy empty host without downloading or loading a bundle', async () => {
    const host = await start();
    expect(await (await fetch(`${host.baseUrl}/health`)).json()).toEqual({ ok: true, service: 'extension-api-host', namespaces: [] });
    expect((await fetch(`${host.baseUrl}/api/v3/missing/stream?stream=0`)).status).toBe(404);
  });

  it('serves the upstream streaming, manga, and novel contracts from verified local bytes', async () => {
    const { configFile, directory } = await prepareExtensions();
    const host = await start(configFile);
    // Editing an operator's original file after startup cannot replace the pinned staged bytes.
    await writeFile(path.join(directory, 'fixture.cjs'), 'throw new Error("unverified replacement executed")');
    const health = await (await fetch(`${host.baseUrl}/health`)).json();
    expect(health.namespaces[0]).toMatchObject({ namespace: 'fixture', extensionId: 'fixture', capabilities: ['streaming', 'manga', 'novel'] });
    const streams = await (await fetch(`${host.baseUrl}/api/v3/fixture/stream?stream=0&titles[]=First`)).json();
    expect(streams.sources[0]).toMatchObject({ url: 'https://media.example.test/fixture/First.m3u8', type: 'hls', headers: { Referer: 'https://origin.example.test/' } });
    const episodes = await (await fetch(`${host.baseUrl}/api/v3/fixture/index/episodes?anilistId=21&titles[]=Original`)).json();
    expect(episodes).toEqual({ provider: 'fixture', episodeCount: 2, episodes: [{ number: 1, title: 'Original' }, { number: 2 }] });
    expect((await fetch(`${host.baseUrl}/api/v3/fixture/index/episodes?anilistId=https://example.com`)).status).toBe(400);
    expect((await fetch(`${host.baseUrl}/api/v3/fixture/index/episodes?anilistId=21&titles[]=%00bad`)).status).toBe(400);
    const manga = await (await fetch(`${host.baseUrl}/api/v3/fixture/manga/chapters?title=First`)).json();
    expect(manga.chapters[0]).toMatchObject({ chapterKey: 'manga:1', provider: 'fixture', providerChapterId: 'upstream-1' });
    const pages = await (await fetch(`${host.baseUrl}/api/v3/fixture/manga/pages?chapterKey=manga:1&providerChapterId=upstream-1`)).json();
    expect(pages.pages[0]).toMatchObject({ imageUrl: 'https://media.example.test/page.jpg', headers: { Referer: 'https://origin.example.test/upstream-1' } });
    const novel = await (await fetch(`${host.baseUrl}/api/v3/fixture/novel/chapters?title=Novel`)).json();
    expect(novel.chapters[0]).toMatchObject({ chapterKey: 'novel:2', translator: 'Fixture translator' });
    const text = await (await fetch(`${host.baseUrl}/api/v3/fixture/novel/content?chapterKey=novel:2`)).json();
    expect(text.paragraphs).toEqual([{ index: 0, text: 'A test paragraph.' }]);
  });

  it('keeps streaming caches isolated across namespaces and caller titles', async () => {
    const { configFile } = await prepareExtensions(['first', 'second']);
    const host = await start(configFile);
    for (const [namespace, title] of [['first', 'Alpha'], ['second', 'Alpha'], ['first', 'Beta']]) {
      const result = await (await fetch(`${host.baseUrl}/api/v3/${namespace}/stream?stream=0&titles[]=${title}`)).json();
      expect(result.sources[0].url).toBe(`https://media.example.test/${namespace}/${title}.m3u8`);
    }
    const cached = await (await fetch(`${host.baseUrl}/api/v3/first/stream?stream=0&titles[]=Alpha`)).json();
    expect(cached.cached).toBe(true);
  });

  it('rejects altered hashes and entries without explicit local trust', async () => {
    const { configFile, extensions } = await prepareExtensions();
    await writeFile(configFile, JSON.stringify({ version: 1, extensions: [{ ...extensions[0], trusted: false }] }));
    await expect(startSourceHost({ extensionsFile: configFile, port: 0, logger: quiet })).rejects.toThrow('trusted: true');
    await writeFile(configFile, JSON.stringify({ version: 1, extensions: [{ ...extensions[0], sha256: '0'.repeat(64) }] }));
    await expect(startSourceHost({ extensionsFile: configFile, port: 0, logger: quiet })).rejects.toThrow('sha256 mismatch');
  });

  it('rejects Electron browser bundles and remote bundle URLs before execution', async () => {
    const { directory, configFile, extensions } = await prepareExtensions();
    const manifestFile = path.join(directory, 'fixture.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    await writeFile(manifestFile, JSON.stringify({ ...manifest, browserDomains: ['example.test'] }));
    await expect(startSourceHost({ extensionsFile: configFile, port: 0, logger: quiet })).rejects.toThrow('requires Electron');
    await writeFile(configFile, JSON.stringify({ version: 1, extensions: [{ ...extensions[0], bundlePath: 'https://example.test/bundle.cjs' }] }));
    await writeFile(manifestFile, JSON.stringify(manifest));
    await expect(startSourceHost({ extensionsFile: configFile, port: 0, logger: quiet })).rejects.toThrow('must name a local file');
  });

  it('runs optional browser bundles with HTTP only and limits every exported registry before invocation', async () => {
    const { directory, configFile } = await prepareExtensions();
    const bundle = `
      const allowed={name:'allowed',kind:'novel'};
      const forbidden={name:'forbidden',kind:'stream'};
      const manga={name:'comic',kind:'manga',async getChapters(){return [{number:1,sources:[{provider:'comic',chapterKey:'comic:1'}]}];}};
      const STREAM_PROVIDERS=[forbidden],TORRENT_PROVIDERS=[forbidden],MANGA_PROVIDERS=[manga,forbidden],NOVEL_PROVIDERS=[allowed,forbidden];
      module.exports={STREAM_PROVIDERS,TORRENT_PROVIDERS,MANGA_PROVIDERS,NOVEL_PROVIDERS,default:class {
        configureBrowserRuntime(){throw new Error('browser must not be configured');}
        listProviders(){return [...STREAM_PROVIDERS,...TORRENT_PROVIDERS,...MANGA_PROVIDERS,...NOVEL_PROVIDERS];}
        getMangaChapters(){return [];}
        getNovelChapters(){
          if(process.env.CF_BYPASS_ENABLED!=='false'||process.env.CF_BYPASS_AUTO_INSTALL!=='false')throw new Error('bypass must be disabled');
          return NOVEL_PROVIDERS.map(p=>({number:1,sources:[{provider:p.name,chapterKey:p.name+':1'}]}));
        }
      }};`;
    await writeFile(path.join(directory, 'fixture.cjs'), bundle);
    await writeFile(path.join(directory, 'fixture.json'), JSON.stringify({ id: 'fixture', browserDomains: ['example.test'], apiServer: { namespace: 'fixture', contract: 'streaming-sources-v3' } }));
    const entry = { trusted: true, manifestPath: 'fixture.json', bundlePath: 'fixture.cjs', sha256: createHash('sha256').update(bundle).digest('hex'), browserMode: 'disabled', providers: ['allowed', 'comic'], mangaTimeoutMs: 1000 };
    await writeFile(configFile, JSON.stringify({ version: 1, extensions: [entry] }));
    const host = await start(configFile);
    const inventory = await (await fetch(`${host.baseUrl}/api/v3/fixture/providers`)).json();
    expect(inventory.providers).toEqual([{ name: 'comic', kind: 'manga' }, { name: 'allowed', kind: 'novel' }]);
    const chapters = await (await fetch(`${host.baseUrl}/api/v3/fixture/novel/chapters?title=Work`)).json();
    expect(chapters.chapters).toEqual([expect.objectContaining({ provider: 'allowed' })]);
    const comic = await (await fetch(`${host.baseUrl}/api/v3/fixture/manga/chapters?title=Work`)).json();
    expect(comic.chapters).toEqual([expect.objectContaining({ provider: 'comic', chapterKey: 'comic:1' })]);
    expect(comic.providerStatus).toEqual([expect.objectContaining({ provider: 'comic', status: 'ok' })]);
    await writeFile(configFile, JSON.stringify({ version: 1, extensions: [{ ...entry, providers: ['unknown'] }] }));
    const invalidHost = await start(configFile);
    expect((await fetch(`${invalidHost.baseUrl}/api/v3/fixture/providers`)).status).toBe(502);
    await writeFile(configFile, JSON.stringify({ version: 1, extensions: [{ ...entry, browserMode: 'enabled' }] }));
    await expect(startSourceHost({ extensionsFile: configFile, port: 0, logger: quiet })).rejects.toThrow('browserMode only supports disabled');
  });

  it('does not expose arbitrary URL probing or permit external web origins', async () => {
    const host = await start();
    expect((await fetch(`${host.baseUrl}/api/v3/probe?url=http://169.254.169.254`)).status).toBe(404);
    expect((await fetch(`${host.baseUrl}/health`, { headers: { Origin: 'https://outside.example' } })).status).toBe(403);
    expect((await fetch(`${host.baseUrl}/health`, { method: 'POST' })).status).toBe(405);
  });
});
