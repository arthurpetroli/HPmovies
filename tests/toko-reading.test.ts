import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/aniwatch-apis/src/config/apiError';
import { loadIntegrationsConfig } from '../src/aniwatch-apis/src/config/integrations';
import type { TokoConfig } from '../src/aniwatch-apis/src/config/integrations';
import { TokoHttpClient } from '../src/aniwatch-apis/src/providers/toko-http';
import { TokoReadingProvider } from '../src/aniwatch-apis/src/providers/toko-reading';

interface Payloads {
  chapters?: (url: URL) => unknown;
  pages?: unknown;
  text?: unknown;
}

const chapter = (provider: string, number: number, language = 'pt-br', extra: Record<string, unknown> = {}) => ({
  provider, chapterKey: `${provider}:chapter-${number}-${language}`, number, language, ...extra,
});

async function fixture(payloads: Payloads, run: (fixture: {
  config: TokoConfig;
  calls: URL[];
  provider: (overrides?: Partial<TokoConfig>) => TokoReadingProvider;
}) => Promise<void>): Promise<void> {
  const calls: URL[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    calls.push(url);
    let body: unknown;
    if (url.pathname.endsWith('/health')) body = { ok: true, toko: true, service: 'toko-api' };
    else if (url.pathname.endsWith('/chapters')) body = payloads.chapters?.(url) ?? { chapterCount: 1, chapters: [chapter('one', 1)] };
    else if (url.pathname.endsWith('/manga/pages')) body = payloads.pages ?? { pages: [{ pageNumber: 1, imageUrl: 'https://media.example.com/page-1.jpg' }] };
    else if (url.pathname.endsWith('/novel/content')) body = payloads.text ?? { provider: 'one', paragraphs: [{ index: 0, text: 'Primeiro parágrafo.' }] };
    else { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const config = loadIntegrationsConfig({
    TOKO_ENABLED: 'true', TOKO_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    TOKO_CONTENT_AUTHORIZED: 'true', TOKO_ALLOWED_PROVIDERS: 'one,two',
    TOKO_ALLOWED_MEDIA_HOSTS: 'media.example.com', TOKO_RETRIES: '0',
  }).toko;
  try {
    await run({ config, calls, provider: (overrides) => new TokoReadingProvider({ config: { ...config, ...overrides } }) });
  } finally {
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
}

describe('Toko reading HTTP adapter', () => {
  it('lists permitted providers with explicit languages, natural order and bounded public chapter identities', async () => {
    await fixture({ chapters: () => ({ chapterCount: 6, chapters: [
      chapter('one', 10), chapter('one', 2, 'pt-br', { scanlator: 'Equipe', translator: 'Equipe' }),
      chapter('two', 1, 'en'), chapter('one', 1, 'sub', { title: 'Legendado PT-BR' }),
      chapter('outside', 1), chapter('one', 2, 'pt-br'),
    ] }) }, async ({ provider }) => {
      const adapter = provider();
      expect(adapter.supports('manga', 'anilist:123')).toBe(true);
      expect(adapter.supports('novel', 'anilist:2147483647')).toBe(true);
      for (const id of ['123', 'mangadex:123', 'anilist:0', 'anilist:01', 'anilist:2147483648', 'anilist:https://evil.org']) expect(adapter.supports('manga', id)).toBe(false);
      const result = await adapter.chapters('manga', 'anilist:123');
      expect(result).toMatchObject({ available: true, state: 'available', languages: ['pt-BR', 'en', 'und'] });
      expect(result.chapters.map((row) => `${row.language}:${row.number}`)).toEqual(['pt-BR:2', 'pt-BR:10', 'en:1', 'und:1']);
      expect(result.chapters[0].credits).toEqual(['Equipe']);
      expect(result.chapters.every((row) => /^toko-[a-f0-9]{64}$/.test(row.id))).toBe(true);
      expect(result.chapters.find((row) => row.language === 'und')).toMatchObject({ title: 'Legendado PT-BR', language: 'und' });
      expect(result.chapters.some((row) => row.providerId === 'outside')).toBe(false);
      expect(result.diagnostics.map((row) => row.id)).toEqual(['toko:one', 'toko:two']);
      const filtered = await adapter.chapters('manga', 'anilist:123', { provider: 'one', language: 'pt-br' });
      expect(filtered.chapters.map((row) => row.number)).toEqual(['2', '10']);
      expect(filtered.languages).toEqual(['pt-BR', 'und']);
      await expect(adapter.chapters('manga', 'anilist:123', { language: 'sub' })).rejects.toMatchObject({ code: 'INVALID_READING_LANGUAGE' });
      await expect(adapter.chapters('manga', 'anilist:123', { provider: 'outside' })).rejects.toMatchObject({ code: 'INVALID_READING_PROVIDER' });
    });
  });

  it('reconstructs stable keys after process restart and navigates within provider and language only', async () => {
    await fixture({ chapters: (url) => ({ chapterCount: 5, chapters: [
      chapter('one', 10), chapter('one', 2), chapter('one', 1), chapter('two', 3), chapter('one', 3, 'en'),
    ].map((row) => ({ ...row, chapterKey: `${row.chapterKey}-work-${url.searchParams.get('anilistId')}` })) }),
    pages: { pages: [{ pageNumber: 2, imageUrl: 'https://media.example.com/2.jpg' }, { pageNumber: 1, imageUrl: 'https://media.example.com/1.jpg' }] },
    }, async ({ provider, calls }) => {
      const list = await provider().chapters('manga', 'anilist:42');
      const one = list.chapters.find((row) => row.providerId === 'one' && row.number === '1')!;
      const two = list.chapters.find((row) => row.providerId === 'one' && row.number === '2')!;
      const ten = list.chapters.find((row) => row.providerId === 'one' && row.number === '10')!;
      const restarted = provider();
      const result = await restarted.pages('anilist:42', two.id);
      expect(result).toMatchObject({ pages: ['https://media.example.com/1.jpg', 'https://media.example.com/2.jpg'], previousChapterId: one.id, nextChapterId: ten.id, isDemo: false });
      expect(calls.find((url) => url.pathname.endsWith('/manga/pages'))?.searchParams.get('chapterKey')).toBe('one:chapter-2-pt-br-work-42');
      expect((await provider().chapters('manga', 'anilist:42')).chapters.map((row) => row.id)).toEqual(list.chapters.map((row) => row.id));
      const differentKind = await provider().chapters('novel', 'anilist:42');
      expect(differentKind.chapters.some((row) => row.id === two.id)).toBe(false);
    });
  });

  it('rejects wrong-work, wrong-kind, unknown and raw URL chapter requests without fetching content', async () => {
    await fixture({}, async ({ provider, calls }) => {
      const adapter = provider();
      const list = await adapter.chapters('manga', 'anilist:1');
      const id = list.chapters[0].id;
      await expect(adapter.pages('anilist:2', id)).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
      await expect(provider().pages('anilist:2', id)).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
      await expect(provider().text('anilist:1', id)).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
      await expect(adapter.pages('anilist:1', `toko-${'0'.repeat(64)}`)).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
      await expect(adapter.pages('anilist:1', 'https://127.0.0.1/private')).rejects.toMatchObject({ code: 'INVALID_CHAPTER_ID' });
      await expect(adapter.pages('anilist:01', id)).rejects.toMatchObject({ code: 'INVALID_WORK_ID' });
      expect(calls.some((url) => url.pathname.endsWith('/manga/pages') || url.pathname.endsWith('/novel/content'))).toBe(false);
    });
  });

  it('keeps healthy provider results and separate diagnostics when another provider fails', async () => {
    await fixture({}, async ({ config }) => {
      const settings = { ...config, allowedProviders: ['one', 'broken'] };
      const client = new TokoHttpClient(settings);
      const original = client.chapters.bind(client);
      vi.spyOn(client, 'chapters').mockImplementation((kind, id, provider) => {
        if (provider === 'broken') return Promise.reject(new ApiError(504, 'TOKO_TIMEOUT', 'Falha da fonte broken.'));
        return original(kind, id, provider);
      });
      const adapter = new TokoReadingProvider({ client });
      expect(await adapter.chapters('novel', 'anilist:1')).toMatchObject({
        available: true, state: 'available', chapters: [{ providerId: 'one' }],
        diagnostics: [{ id: 'toko:one', state: 'available' }, { id: 'toko:broken', state: 'connection_error', message: 'Falha da fonte broken.' }],
      });
    });
  });

  it('deduplicates simultaneous provider listings instead of exceeding HTTP concurrency limits', async () => {
    const providers = ['one', 'two', 'three', 'four', 'five', 'six'];
    await fixture({ chapters: () => ({ chapterCount: providers.length, chapters: providers.map((provider) => chapter(provider, 1)) }) }, async ({ provider, calls }) => {
      const adapter = provider({ allowedProviders: providers });
      const [first, second] = await Promise.all([adapter.chapters('manga', 'anilist:1'), adapter.chapters('manga', 'anilist:1')]);
      expect(first.chapters).toHaveLength(providers.length);
      expect(second.chapters).toEqual(first.chapters);
      expect(first.diagnostics.every((item) => item.state === 'available')).toBe(true);
      expect(calls.filter((url) => url.pathname.endsWith('/chapters'))).toHaveLength(1);
    });
  });

  it('preserves upstream per-source failures and progressive partial results', async () => {
    await fixture({ chapters: () => ({
      chapterCount: 1, chapters: [chapter('one', 1)], partial: true,
      providerStatus: [{ provider: 'one', status: 'ok', resultCount: 1 }, { provider: 'two', status: 'error', error: 'upstream failed' }],
    }) }, async ({ provider }) => {
      const result = await provider().chapters('novel', 'anilist:1');
      expect(result).toMatchObject({ available: true, state: 'available', partial: true, chapters: [{ providerId: 'one' }] });
      expect(result.message).toContain('parcial');
      expect(result.diagnostics).toMatchObject([{ id: 'toko:one', state: 'available' }, { id: 'toko:two', state: 'connection_error', technicalAvailable: false }]);
    });
    await fixture({ chapters: () => ({ chapterCount: 0, chapters: [], partial: true }) }, async ({ provider }) => {
      expect(await provider().chapters('novel', 'anilist:1')).toMatchObject({ available: false, state: 'checking', partial: true, diagnostics: [{ state: 'checking' }, { state: 'checking' }] });
    });
  });

  it('does not fetch content when disabled or unconfigured and reports empty listings honestly', async () => {
    await fixture({ chapters: () => ({ chapterCount: 0, chapters: [] }) }, async ({ provider, calls }) => {
      expect(await provider({ enabled: false }).chapters('manga', 'anilist:1')).toMatchObject({ available: false, state: 'unavailable', chapters: [] });
      expect(calls).toHaveLength(0);
      expect(await provider({ contentAuthorized: false }).chapters('novel', 'anilist:1')).toMatchObject({ available: false, state: 'unauthorized', chapters: [] });
      expect(calls).toHaveLength(1);
      await expect(provider({ contentAuthorized: false }).text('anilist:1', `toko-${'0'.repeat(64)}`)).rejects.toMatchObject({ code: 'TOKO_UNAUTHORIZED' });
      expect(calls).toHaveLength(1);
      expect(await provider().chapters('novel', 'anilist:1')).toMatchObject({ available: false, state: 'empty', chapters: [] });
    });
  });

  it.each([
    [{ pages: [{ pageNumber: 1, imageUrl: 'https://media.example.com/a.jpg', headers: { Referer: 'https://source.example.com' } }] }, 'TOKO_REQUIRED_HEADERS_UNSUPPORTED'],
    [{ pages: [{ pageNumber: 1, imageUrl: 'https://outside.example.com/a.jpg' }] }, 'TOKO_MEDIA_NOT_PERMITTED'],
    [{ pages: [{ pageNumber: 1, imageUrl: 'https://media.example.com/a.jpg' }, { pageNumber: 2, imageUrl: 'http://media.example.com/b.jpg' }] }, 'TOKO_MEDIA_NOT_PERMITTED'],
    [{ pages: [{ pageNumber: 1, imageUrl: 'https://media.example.com/a.jpg' }, { pageNumber: 1, imageUrl: 'https://media.example.com/b.jpg' }] }, 'TOKO_INVALID_RESPONSE'],
    [{ pages: [{ pageNumber: 0, imageUrl: 'https://media.example.com/a.jpg' }] }, 'TOKO_INVALID_RESPONSE'],
    [{ pages: [] }, 'CHAPTER_UNAVAILABLE'],
  ])('refuses entire inaccessible or malformed manga chapters: %s', async (pages, code) => {
    await fixture({ pages }, async ({ provider }) => {
      const adapter = provider();
      const list = await adapter.chapters('manga', 'anilist:1');
      await expect(adapter.pages('anilist:1', list.chapters[0].id)).rejects.toMatchObject({ code });
    });
  });

  it('normalizes ordered novel paragraphs as plain text without requiring media hosts', async () => {
    await fixture({ text: { provider: 'one', paragraphs: [
      { index: 4, text: '  Último\u0000 parágrafo.\r\nOutra linha.  ' },
      { index: 2, text: '   ' }, { index: 0, text: '<script>text only</script>' },
    ] } }, async ({ provider }) => {
      const adapter = provider({ allowedMediaHosts: [] });
      const list = await adapter.chapters('novel', 'anilist:1');
      const text = await adapter.text('anilist:1', list.chapters[0].id);
      expect(text).toMatchObject({ paragraphs: ['<script>text only</script>', 'Último parágrafo.\nOutra linha.'], isDemo: false });
      expect(text.chapter.id).toBe(list.chapters[0].id);
    });
  });

  it.each([
    [{ provider: 'one', paragraphs: [{ index: 0, text: 'a' }, { index: 0, text: 'b' }] }, 'TOKO_INVALID_RESPONSE'],
    [{ provider: 'two', paragraphs: [{ index: 0, text: 'a' }] }, 'TOKO_INVALID_RESPONSE'],
    [{ provider: 'one', paragraphs: [{ index: -1, text: 'a' }] }, 'TOKO_INVALID_RESPONSE'],
    [{ provider: 'one', paragraphs: [{ index: 0, text: ' \u0000 ' }] }, 'CHAPTER_UNAVAILABLE'],
    [{ provider: 'one', paragraphs: [] }, 'CHAPTER_UNAVAILABLE'],
  ])('refuses malformed or empty novel content: %s', async (text, code) => {
    await fixture({ text }, async ({ provider }) => {
      const adapter = provider();
      const list = await adapter.chapters('novel', 'anilist:1');
      await expect(adapter.text('anilist:1', list.chapters[0].id)).rejects.toMatchObject({ code });
    });
  });

  it('namespaces stable identities independently for the Tatakai runtime', async () => {
    await fixture({}, async ({ config, provider }) => {
      const toko = await provider().chapters('manga', 'anilist:1');
      const tatakai = await new TokoReadingProvider({ config, id: 'tatakai', name: 'Tatakai local' }).chapters('manga', 'anilist:1');
      expect(tatakai.chapters[0].id).toMatch(/^tatakai-[a-f0-9]{64}$/);
      expect(tatakai.chapters[0].id.slice(8)).not.toBe(toko.chapters[0].id.slice(5));
      expect(tatakai.diagnostics[0]).toMatchObject({ id: 'tatakai:one', name: 'Tatakai local · one' });
    });
  });
});
