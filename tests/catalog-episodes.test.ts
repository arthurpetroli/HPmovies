import { describe, expect, it } from 'vitest';
import { CATALOG_EPISODES_NOTICE, catalogEpisodeList, withCatalogEpisodes } from '../src/frontend/services/catalogEpisodes';
import type { CatalogAnime, StreamingAvailability } from '../src/shared/providers';

// Catalog metadata only: these lists never claim that a video exists.
const anime = (patch: Partial<CatalogAnime> = {}): CatalogAnime => ({ id: '14075', title: 'Blast of Tempest', poster: '', genres: [], status: 'FINISHED', episodeCount: 24, ...patch });

describe('catalog episode fallback', () => {
  it('lists every episode of a finished title with the player ID format', () => {
    const list = catalogEpisodeList(anime());
    expect(list).toHaveLength(24);
    expect(list[0]).toEqual({ id: 'tatakai:14075:1', number: 1, title: 'Episódio 1' });
    expect(list.at(-1)).toMatchObject({ id: 'tatakai:14075:24', number: 24 });
    expect(list.every(episode => episode.available === undefined)).toBe(true);
  });

  it('lists only aired episodes while releasing and nothing for upcoming or unknown counts', () => {
    expect(catalogEpisodeList(anime({ status: 'RELEASING', episodeCount: 12, airedEpisodes: 8 }))).toHaveLength(8);
    expect(catalogEpisodeList(anime({ status: 'RELEASING', episodeCount: 12 }))).toEqual([]);
    expect(catalogEpisodeList(anime({ status: 'NOT_YET_RELEASED' }))).toEqual([]);
    expect(catalogEpisodeList(anime({ episodeCount: undefined }))).toEqual([]);
    expect(catalogEpisodeList(anime({ id: 'demo' }))).toEqual([]);
    expect(catalogEpisodeList(anime({ episodeCount: 9_999 }))).toEqual([]);
    expect(catalogEpisodeList(undefined)).toEqual([]);
  });

  it('keeps a real source index and replaces only an empty or failed one, flagged as catalog', () => {
    const indexed: StreamingAvailability = { available: true, episodes: [{ id: 'tatakai:14075:1', title: 'Real', number: 1 }] };
    expect(withCatalogEpisodes(indexed, anime())).toBe(indexed);
    const empty: StreamingAvailability = { available: false, episodes: [], state: 'connection_error', message: 'Índice fora do ar' };
    const fallback = withCatalogEpisodes(empty, anime());
    expect(fallback).toMatchObject({ available: false, catalogFallback: true, message: CATALOG_EPISODES_NOTICE });
    expect(fallback?.episodes).toHaveLength(24);
    expect(withCatalogEpisodes(null, anime())?.episodes).toHaveLength(24);
    expect(withCatalogEpisodes(empty, anime({ status: 'NOT_YET_RELEASED' }))).toBe(empty);
  });

  it('adds exact thumbnails and titles without exposing unaired or differently identified chapters', () => {
    const indexed: StreamingAvailability = { available: false, catalogFallback: true, episodes: [
      { id: 'tatakai:14075:1', number: 1, title: 'Primeiro', thumbnail: 'https://example.com/1.jpg' },
      { id: 'tatakai:999:2', number: 2, title: 'Outra obra' },
      { id: 'tatakai:14075:3', number: 3, title: 'Ainda não lançado' },
    ] };
    const current = withCatalogEpisodes(indexed, anime({ status: 'RELEASING', airedEpisodes: 2 }));
    expect(current?.episodes).toEqual([
      indexed.episodes[0], { id: 'tatakai:14075:2', number: 2, title: 'Episódio 2' },
    ]);
    expect(withCatalogEpisodes(indexed, anime({ status: 'NOT_YET_RELEASED' }))?.episodes).toEqual([]);
  });
});
