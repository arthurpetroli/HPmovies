import { describe, expect, it } from 'vitest';
import { hasValidIntro, orderedPlaybackSources, orderedSubtitles, preferredSubtitleId, subtitlesForSource } from '../src/frontend/components/player/playbackUtils';
import type { Playback, StreamSubtitle } from '../src/shared/providers';

const subtitle = (id: string, language: string, label = id): StreamSubtitle => ({ id, language, label, url: `/${id}.vtt` });

describe('subtitle language verification', () => {
  it('prefers verified PT-BR over the first track and normalizes region notation', () => {
    expect(preferredSubtitleId([subtitle('english', 'en'), subtitle('brazilian', 'PT_br')])).toBe('brazilian');
  });
  it('falls back to declared Portuguese without claiming it is Brazilian', () => {
    expect(preferredSubtitleId([subtitle('sub', 'en', 'Português Brasileiro'), subtitle('portuguese', 'pt'), subtitle('european', 'pt-PT')])).toBe('portuguese');
    expect(preferredSubtitleId([subtitle('sub', 'en', 'Português Brasileiro')])).toBe('off');
    expect(preferredSubtitleId([subtitle('european', 'pt-PT')])).toBe('european');
  });
  it('keeps explicit caption preferences and accepts declared ISO aliases', () => {
    const tracks = [subtitle('english', 'en'), subtitle('portuguese', 'por'), subtitle('brazilian', 'pob')];
    expect(preferredSubtitleId(tracks, 'pt_br')).toBe('brazilian');
    expect(preferredSubtitleId(tracks, 'en')).toBe('english');
    expect(preferredSubtitleId(tracks, 'off')).toBe('off');
    expect(orderedSubtitles(tracks).map(track => track.id)).toEqual(['brazilian', 'portuguese', 'english']);
    expect(tracks[0].id).toBe('english');
  });
  it('prioritizes source-specific Portuguese captions without copying another mirror tracks', () => {
    const playback = { episode: { id: 'qa', title: 'QA', available: true }, isDemo: false, audioLanguages: [],
      subtitles: [subtitle('english', 'en')], sources: [
        { url: 'https://first.example/video.mp4', type: 'mp4' },
        { url: 'https://empty.example/video.mp4', type: 'mp4' },
        { url: 'https://pt.example/video.mp4', type: 'mp4', subtitles: [subtitle('portuguese', 'pt')] },
        { url: 'https://br.example/video.mp4', type: 'mp4', subtitles: [subtitle('brazilian', 'pt-BR')] },
      ] } satisfies Playback;
    expect(orderedPlaybackSources(playback).map(source => source.url)).toEqual([playback.sources[3].url, playback.sources[2].url, playback.sources[0].url, playback.sources[1].url]);
    expect(subtitlesForSource(playback, playback.sources[1])).toEqual([]);
    expect(subtitlesForSource(playback, playback.sources[0])).toEqual(playback.subtitles);
  });
  it('keeps captions disabled when no tracks exist', () => {
    expect(preferredSubtitleId([])).toBe('off');
  });
});

describe('intro skip metadata', () => {
  it('allows only a real interval within the playable duration', () => {
    expect(hasValidIntro({ start: 12, end: 80 }, 120)).toBe(true);
    expect(hasValidIntro({ start: 0, end: 120 }, 120)).toBe(true);
  });
  it('rejects missing, reversed, negative and out-of-bounds intervals', () => {
    expect(hasValidIntro(undefined, 120)).toBe(false);
    expect(hasValidIntro({ start: 80, end: 12 }, 120)).toBe(false);
    expect(hasValidIntro({ start: -1, end: 12 }, 120)).toBe(false);
    expect(hasValidIntro({ start: 12, end: 130 }, 120)).toBe(false);
  });
  it('does not show a skip control before finite duration is available', () => {
    expect(hasValidIntro({ start: 0, end: 90 }, 0)).toBe(false);
    expect(hasValidIntro({ start: 0, end: 90 }, Infinity)).toBe(false);
    expect(hasValidIntro({ start: NaN, end: 90 }, 120)).toBe(false);
  });
});
