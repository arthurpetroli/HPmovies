import { beforeEach, describe, expect, it, vi } from 'vitest';

const novel = { id: 'demo', title: 'Texto original', poster: '', genres: ['Adventure'], isDemo: true };
async function setup(raw?: string) {
  vi.resetModules();
  const storage = new Map<string, string>();
  if (raw) storage.set('hpmovies.novels.v1', raw);
  const events = new EventTarget();
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    dispatchEvent: events.dispatchEvent.bind(events), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  });
  const { novelLibrary } = await import('../src/frontend/services/novelLibrary');
  return { novelLibrary, storage, events };
}

describe('novel reading library', () => {
  beforeEach(() => vi.unstubAllGlobals());
  it('persists favorites, completion, and preferences across reloads', async () => {
    const { novelLibrary, storage } = await setup();
    novelLibrary.toggleFavorite(novel);
    novelLibrary.markCompleted(novel.id);
    novelLibrary.setPreferences({ theme: 'sepia', fontSize: 26, lineHeight: 2.2, font: 'sans' });
    const reloaded = await setup(storage.get('hpmovies.novels.v1'));
    expect(reloaded.novelLibrary.getSaved()).toMatchObject([{ novel, favorite: true, completed: true }]);
    expect(reloaded.novelLibrary.getPreferences()).toMatchObject({ theme: 'sepia', fontSize: 26, lineHeight: 2.2, font: 'sans' });
    reloaded.novelLibrary.toggle(novel);
    expect(reloaded.novelLibrary.has(novel.id)).toBe(false);
  });

  it('preserves paragraph positions per novel and chapter and rejects corrupt progress', async () => {
    const { novelLibrary } = await setup();
    const first = { novel, chapterId: '1', chapterTitle: 'Um', position: 4, paragraphCount: 10 };
    novelLibrary.saveProgress(first);
    novelLibrary.saveProgress({ ...first, chapterId: '2', position: 9 });
    expect(novelLibrary.progress('demo', '1')?.position).toBe(4);
    expect(novelLibrary.progress('demo')?.chapterId).toBe('2');
    expect(novelLibrary.progress('demo', '2')?.completed).toBe(true);
    novelLibrary.saveProgress({ ...first, position: Infinity });
    novelLibrary.saveProgress({ ...first, position: 10 });
    expect(novelLibrary.getHistory()).toHaveLength(2);
    expect(novelLibrary.progress('demo', '1')?.position).toBe(4);
  });

  it('recovers from damaged storage, bounds preferences, and keeps session state on write failure', async () => {
    const { novelLibrary, events } = await setup('{broken');
    expect(novelLibrary.getSaved()).toEqual([]);
    novelLibrary.setPreferences({ fontSize: 400, lineHeight: 0 });
    expect(novelLibrary.getPreferences()).toMatchObject({ fontSize: 30, lineHeight: 1.4 });
    const listener = vi.fn(); events.addEventListener('hpmovies:novels', listener);
    window.localStorage.setItem = () => { throw new Error('Storage full'); };
    novelLibrary.toggle(novel);
    expect(novelLibrary.has('demo')).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });
});
