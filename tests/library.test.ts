import { beforeEach, describe, expect, it, vi } from 'vitest';

const anime = { id: '1', title: 'Cowboy Bebop', poster: 'https://example.com/poster.jpg', genres: ['Sci-Fi'] };

async function setup(raw?: string) {
  vi.resetModules();
  const storage = new Map<string, string>();
  if (raw) storage.set('hpmovies.library.v1', raw);
  const events = new EventTarget();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    dispatchEvent: events.dispatchEvent.bind(events),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  const { libraryService } = await import('../src/frontend/services/library');
  return { libraryService, storage, events };
}

describe('local library', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('saves lists and favorites across module reloads', async () => {
    const { libraryService, storage } = await setup();
    libraryService.toggle(anime);
    expect(libraryService.has('1')).toBe(true);
    libraryService.toggleFavorite(anime);
    const saved = storage.get('hpmovies.library.v1');
    const reloaded = await setup(saved);
    expect(reloaded.libraryService.getList()).toMatchObject([{ anime, favorite: true }]);
    reloaded.libraryService.toggle(anime);
    expect(reloaded.libraryService.getList()).toEqual([]);
  });

  it('stores progress per episode and marks 95% completed', async () => {
    const { libraryService } = await setup();
    libraryService.saveProgress({ episodeId: 'a', title: 'A', currentTime: 42, duration: 100 });
    libraryService.saveProgress({ episodeId: 'b', title: 'B', currentTime: 98, duration: 100 });
    expect(libraryService.getProgress('a')?.currentTime).toBe(42);
    expect(libraryService.getProgress('a')?.completed).toBe(false);
    expect(libraryService.getProgress('b')?.completed).toBe(true);
    libraryService.saveProgress({ episodeId: 'a', title: 'A', currentTime: 62, duration: 100 });
    expect(libraryService.getHistory()).toHaveLength(2);
    expect(libraryService.getHistory()[0].episodeId).toBe('a');
  });

  it('ignores invalid timing and recovers from damaged storage', async () => {
    const { libraryService } = await setup('{invalid');
    expect(libraryService.getList()).toEqual([]);
    libraryService.saveProgress({ episodeId: 'a', title: 'A', currentTime: NaN, duration: 100 });
    libraryService.saveProgress({ episodeId: 'a', title: 'A', currentTime: 10, duration: 0 });
    expect(libraryService.getHistory()).toEqual([]);
    libraryService.toggleFavorite(anime);
    expect(libraryService.getList()[0].favorite).toBe(true);
  });

  it('notifies the interface after an edit and survives blocked storage', async () => {
    const { libraryService, events } = await setup();
    const listener = vi.fn();
    events.addEventListener('hpmovies:library', listener);
    window.localStorage.setItem = () => { throw new Error('Storage blocked'); };
    libraryService.toggle(anime);
    expect(listener).toHaveBeenCalledOnce();
    expect(libraryService.getList()).toHaveLength(1);
  });

  it('recovers after a temporary storage failure and stores only useful card metadata', async () => {
    const { libraryService, storage } = await setup();
    window.localStorage.setItem = () => { throw new Error('Temporary storage failure'); };
    libraryService.toggle({ ...anime, recommendations: [anime], description: 'Large description' });
    window.localStorage.setItem = (key, value) => { storage.set(key, value); };
    libraryService.toggleFavorite(anime);
    expect(libraryService.getList()[0].anime.recommendations).toBeUndefined();
    expect(libraryService.getList()[0].anime.description).toBeUndefined();
    storage.set('hpmovies.library.v1', JSON.stringify({ list: [], history: [] }));
    expect(libraryService.getList()).toEqual([]);
  });

  it('repairs legacy cinema metadata without changing timing, order or completion', async () => {
    const old = { episodeId: 'stremio:all:movie:tt27543632', title: 'Filme · tt27543632', currentTime: 42, duration: 600, updatedAt: 123, completed: false };
    const other = { ...old, episodeId: 'tatakai:1:7', title: 'Episódio 7', updatedAt: 124 };
    const { libraryService } = await setup(JSON.stringify({ list: [], history: [other, old] }));
    const cinema = { id: 'tt27543632', type: 'movie' as const, title: 'The Housemaid', genres: ['Drama'], poster: 'https://images.metahub.space/poster/img' };
    libraryService.updateCinemaMetadata(cinema.id, cinema.type, cinema);
    expect(libraryService.getHistory().map(item => item.episodeId)).toEqual([other.episodeId, old.episodeId]);
    expect(libraryService.getProgress(old.episodeId)).toMatchObject({ ...old, title: cinema.title, cinema });
    libraryService.updateCinemaMetadata('tt0903747', 'series', { ...cinema, id: 'tt0903747', type: 'series', title: 'Outra obra' });
    expect(libraryService.getProgress(old.episodeId)?.title).toBe('The Housemaid');
  });

  it('keeps cinema metadata when a later progress update arrives without it and drops large or private fields', async () => {
    const { libraryService, storage } = await setup();
    const episodeId = 'stremio:all:movie:tt27543632';
    const cinema = { id: 'tt27543632', type: 'movie' as const, title: 'The Housemaid', genres: ['Drama'], description: 'Large description',
      background: 'https://images.metahub.space/background/img', poster: 'https://images.metahub.space/poster/img?private=do-not-store', episodes: [{ id: 'unused' }] };
    libraryService.saveProgress({ episodeId, title: 'Título temporário', cinema, isDemo: false, currentTime: 30, duration: 600 });
    libraryService.saveProgress({ episodeId, title: 'Filme · tt27543632', currentTime: 45, duration: 600 });
    expect(libraryService.getProgress(episodeId)).toMatchObject({ title: 'The Housemaid', currentTime: 45, cinema: { id: cinema.id, background: cinema.background } });
    const serialized = storage.get('hpmovies.library.v1') || '';
    expect(serialized).not.toContain('Large description');
    expect(serialized).not.toContain('do-not-store');
    expect(serialized).not.toContain('episodes');
  });

  it('ignores invalid optional cinema metadata while retaining valid legacy progress', async () => {
    const old = { episodeId: 'stremio:all:movie:tt27543632', title: 'Filme', currentTime: 25, duration: 600, updatedAt: 123, completed: false,
      cinema: { id: 'tt0903747', type: 'series', title: 'Wrong identity', genres: [] }, episodeNumber: -3, season: -1 };
    const { libraryService } = await setup(JSON.stringify({ list: [], history: [old] }));
    expect(libraryService.getHistory()).toHaveLength(1);
    expect(libraryService.getHistory()[0].cinema).toBeUndefined();
    expect(libraryService.getHistory()[0].episodeNumber).toBeUndefined();
    expect(libraryService.getHistory()[0].currentTime).toBe(25);
  });
});
