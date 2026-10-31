import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNovel, novelService } from '../src/frontend/services/novels';
import { isNovelWorkId, nativeNovelChapterBelongsTo, novelDetailsPath, novelReaderPath } from '../src/shared/novelIdentity';

const id = 'novelmania:historia_qa';
const chapterId = `${id}/volume-1-capitulo-1`;
const novel = { id, title: 'História QA', poster: '', genres: ['Aventura'], providerId: 'novelmania', availableLanguages: ['pt-br'], sourceUrl: 'https://novelmania.com.br/novels/historia_qa' };
const chapter = { id: chapterId, title: 'Volume 1 Capítulo 1', number: 1, language: 'pt-br' };
const content = { available: true, status: 'available', providerId: 'novelmania', message: 'Texto de fixture.', novel, chapter, paragraphs: ['Parágrafo sintético.'], sourceUrl: 'https://novelmania.com.br/novels/historia_qa/capitulos/volume-1-capitulo-1' };

describe('novel frontend source identities', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts direct source identities and encodes qualified chapter routes', () => {
    expect(isNovelWorkId(id)).toBe(true); expect(isNovel(novel)).toBe(true); expect(nativeNovelChapterBelongsTo(chapterId, id)).toBe(true);
    expect(novelDetailsPath(id)).toBe('/novel/novelmania%3Ahistoria_qa');
    expect(novelReaderPath(id, chapterId)).toBe('/novel/novelmania%3Ahistoria_qa/read/novelmania%3Ahistoria_qa%2Fvolume-1-capitulo-1');
    expect(isNovel({ ...novel, providerId: 'anilist' })).toBe(false);
    expect(isNovel({ ...novel, sourceUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isNovel({ ...novel, poster: 'https://user:secret@example.org/a.jpg' })).toBe(false);
  });

  it('resolves direct source content without storing fuzzy AniList title hints', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }; vi.stubGlobal('localStorage', storage);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: content })));
    vi.stubGlobal('fetch', fetcher);
    const result = await novelService.content(id, chapterId, { language: 'pt-br', titles: ['Hint not persisted for native identity'] });
    expect(result.chapter?.id).toBe(chapterId); expect(storage.setItem).not.toHaveBeenCalled();
    expect(String(fetcher.mock.calls[0][0])).toContain(encodeURIComponent(chapterId));
  });

  it('rejects native reading that switches work, language, provider or navigation', async () => {
    for (const mismatch of [{ novel: { ...novel, id: 'novelmania:other' } }, { chapter: { ...chapter, language: 'en' } }, { providerId: 'tatakai' }, { nextChapterId: 'novelmania:other/capitulo-2' }, { isDemo: true }]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { ...content, ...mismatch } }))));
      await expect(novelService.content(id, chapterId)).rejects.toThrow();
    }
  });

  it('rejects a native chapter feed for another work before displaying it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { available: true, status: 'available', providerId: 'novelmania', message: 'Wrong fixture.', chapters: [{ ...chapter, id: 'novelmania:other/capitulo-1' }] } }))));
    await expect(novelService.chapters(id)).rejects.toThrow('outra obra');
  });
});
