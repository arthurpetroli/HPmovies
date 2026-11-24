import { describe, expect, it } from 'vitest';
import { depictsMinors, isBlockedTag, minorCharacterAge } from '../src/aniwatch-apis/src/providers/adult-safety';
import { blockedAdultMedia } from '../src/aniwatch-apis/src/providers/anilist-adult';

const media = (overrides: Record<string, unknown> = {}) => ({
  id: 1, type: 'ANIME', isAdult: true, title: { romaji: 'Office Affair', english: null, native: null }, synonyms: [],
  description: 'Two coworkers start an affair after the office party.', tags: [{ name: 'Large Breasts' }],
  characters: { nodes: [{ age: '27' }, { age: null }] }, ...overrides,
});

describe('adult minors filter', () => {
  it.each([
    ['AniList teen cast', { tags: ['Primarily Teen Cast'] }],
    ['AniList child cast', { tags: ['Primarily Child Cast'] }],
    ['school setting', { tags: ['School'] }],
    ['HAnime loli tag', { tags: ['loli'] }],
    ['HentaiHaven shota genre', { tags: ['Shota'] }],
    ['school girl tag', { tags: ['School Girl'] }],
    ['high school synopsis', { texts: ['A high school student and her teacher.'] }],
    ['child body synopsis', { texts: ['The landlady has the small body of a child.'] }],
    ['childlike synopsis', { texts: ['Her childlike appearance hides a secret.'] }],
    ['JK abbreviation', { texts: ['JK no Himitsu'] }],
    ['teenage synopsis', { texts: ['A teenage girl moves to the city.'] }],
    ['young girl synopsis', { texts: ['A young girl is sold to the circus.'] }],
  ])('blocks %s', (_name, input) => {
    expect(depictsMinors(input)).toBe(true);
  });

  it.each([
    ['age gap between adults', { tags: ['Age Gap', 'MILF'] }],
    ['flat chest body type', { tags: ['Flat Chest'] }],
    ["Teens' Love audience tag", { tags: ["Teens' Love", 'Office Lady'] }],
    ['Shoujo demographic tag', { tags: ['Shoujo', 'Josei'] }],
    ['wanting children', { texts: ['A doctor who is eager to have children.'] }],
    ['childhood backstory', { texts: ["They haven't seen each other since they were kids."] }],
    ['childhood friend', { texts: ['Her childhood friend returns from Tokyo.'] }],
    ['young wife', { texts: ['A young wife and her neighbor.'] }],
  ])('allows %s', (_name, input) => {
    expect(depictsMinors(input)).toBe(false);
  });

  it('treats any listed character age below 18 as a minor', () => {
    expect(minorCharacterAge(['24', '16-17'])).toBe(true);
    expect(minorCharacterAge(['~15'])).toBe(true);
    expect(minorCharacterAge(['20s', '1000+', null, undefined])).toBe(false);
  });

  it('refuses blocked tags as filters', () => {
    expect(isBlockedTag('School')).toBe(true);
    expect(isBlockedTag('Tentacles')).toBe(false);
  });

  it('checks AniList entries and fails closed without a tag list', () => {
    expect(blockedAdultMedia(media())).toBe(false);
    expect(blockedAdultMedia(media({ tags: undefined }))).toBe(true);
    expect(blockedAdultMedia(media({ tags: [{ name: 'Rape' }, null] }))).toBe(true);
    expect(blockedAdultMedia(media({ characters: { nodes: [{ age: '14' }] } }))).toBe(true);
    expect(blockedAdultMedia(media({ synonyms: ['Loli Paradise'] }))).toBe(true);
    expect(blockedAdultMedia(media({ tags: [{ name: 'Age Gap' }, { name: 'MILF' }] }))).toBe(false);
  });
});
