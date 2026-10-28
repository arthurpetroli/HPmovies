import { describe, expect, it, vi } from 'vitest';
import type { Playback, StreamSubtitle } from '../src/shared/providers';
import { AutomaticSubtitleJobs } from '../src/aniwatch-apis/src/providers/automatic-subtitle-jobs';
import { AutomaticSubtitleProvider } from '../src/aniwatch-apis/src/providers/automatic-subtitles';
import { createApp } from '../src/aniwatch-apis/src/app';

const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nOriginal test caption\n';
const translated: StreamSubtitle = { id: 'automatic-test', language: 'pt', label: 'Português automático', url: '/api/subtitles/automatic/file/generated', machineTranslated: true, format: 'vtt' };
const en: StreamSubtitle = { id: 'en', language: 'en', label: 'English', url: '/api/streaming/media/source-caption', format: 'vtt' };
const playback = (): Playback => ({ episode: { id: 'tatakai:1:1', number: 1, title: 'Episode 1' }, sources: [{ url: '/video-primary.mp4', type: 'mp4', subtitles: [en] }, { url: '/video-mirror.mp4', type: 'mp4', subtitles: [] }], subtitles: [en], audioLanguages: ['ja'], isDemo: false });
function setup() {
  const translator = new AutomaticSubtitleProvider({ enabled: true });
  vi.spyOn(translator, 'availability').mockResolvedValue({ available: true, sourceLanguages: ['en'], message: 'Available' });
  vi.spyOn(translator, 'translate').mockResolvedValue(translated);
  vi.spyOn(translator, 'file').mockReturnValue({ bytes: new TextEncoder().encode(vtt), contentType: 'text/vtt', cacheControl: 'private' });
  const load = vi.fn(async () => new TextEncoder().encode(vtt));
  const jobs = new AutomaticSubtitleJobs({ translator, load });
  return { jobs, translator, load };
}

describe('automatic subtitle offers and jobs', () => {
  it('issues only supported local caption offers and preserves source ownership', async () => {
    const { jobs } = setup();
    const input = playback();
    input.subtitles.push({ ...en, id: 'pt', language: 'pt' }, { ...en, id: 'remote', url: 'https://example.com/captions.vtt' }, { ...en, id: 'ja', language: 'ja' }, { ...en, id: 'forced', label: 'English (Forced)' });
    const offered = await jobs.offer(input);
    const token = offered.subtitles[0].translationToken;
    expect(token).toBeTruthy();
    expect(offered.sources[0].subtitles![0].translationToken).toBe(token);
    expect(offered.sources[1].subtitles).toEqual([]);
    expect(offered.subtitles.slice(1).every(track => !track.translationToken)).toBe(true);
    expect(input.subtitles[0].translationToken).toBeUndefined();
  });

  it('loads exactly the issued caption, deduplicates clicks and polls completed Portuguese', async () => {
    const { jobs, translator, load } = setup();
    const offered = await jobs.offer(playback());
    const token = offered.subtitles[0].translationToken!;
    const started = jobs.start(token);
    expect(jobs.start(token)).toEqual(started);
    expect(started.state).toBe('pending');
    await vi.waitFor(() => expect(jobs.status(started.id).state).toBe('complete'));
    expect(load).toHaveBeenCalledExactlyOnceWith(en.url);
    expect(translator.translate).toHaveBeenCalledExactlyOnceWith(vtt, 'en');
    expect(jobs.status(started.id).subtitle).toEqual(translated);
  });

  it('expires offers and rejects arbitrary destinations without fetching', async () => {
    const { translator, load } = setup();
    let now = 0;
    const jobs = new AutomaticSubtitleJobs({ translator, load, now: () => now });
    const offered = await jobs.offer(playback());
    now = 61 * 60_000;
    expect(() => jobs.start(offered.subtitles[0].translationToken!)).toThrow('expirou');
    expect(() => jobs.start('https://example.com')).toThrow('expirou');
    expect(load).not.toHaveBeenCalled();
  });

  it('reuses offers across repeated playback requests and keeps capacity for another episode', async () => {
    const { jobs } = setup();
    const first = await jobs.offer(playback());
    for (let index = 0; index < 2050; index++) expect((await jobs.offer(playback())).subtitles[0].translationToken).toBe(first.subtitles[0].translationToken);
    const other = playback(); other.episode.id = 'tatakai:1:2';
    const second = await jobs.offer(other);
    expect(second.subtitles[0].translationToken).toBeTruthy();
    expect(second.subtitles[0].translationToken).not.toBe(first.subtitles[0].translationToken);
  });

  it('recreates a completed translation if the underlying file expires or is evicted', async () => {
    const { jobs, translator } = setup();
    const token = (await jobs.offer(playback())).subtitles[0].translationToken!;
    const first = jobs.start(token);
    await vi.waitFor(() => expect(jobs.status(first.id).state).toBe('complete'));
    vi.mocked(translator.file).mockImplementationOnce(() => { throw new Error('Expired'); });
    const retried = jobs.start(token);
    expect(retried.id).not.toBe(first.id);
    await vi.waitFor(() => expect(jobs.status(retried.id).state).toBe('complete'));
    expect(translator.translate).toHaveBeenCalledTimes(2);
  });

  it('isolates a failed translation and allows retry without changing playback', async () => {
    const { jobs, load } = setup();
    load.mockRejectedValueOnce(new Error('private upstream details'));
    const offered = await jobs.offer(playback());
    const token = offered.subtitles[0].translationToken!;
    const first = jobs.start(token);
    await vi.waitFor(() => expect(jobs.status(first.id).state).toBe('failed'));
    expect(jobs.status(first.id).message).not.toContain('private');
    const second = jobs.start(token);
    expect(second.id).not.toBe(first.id);
    await vi.waitFor(() => expect(jobs.status(second.id).state).toBe('complete'));
    expect(offered.sources).toHaveLength(2);
  });

  it('hides offers when local translation is unavailable', async () => {
    const { jobs, translator } = setup();
    vi.mocked(translator.availability).mockResolvedValue({ available: false, sourceLanguages: [], message: 'Unavailable' });
    const input = playback();
    expect(await jobs.offer(input)).toBe(input);
  });

  it('rejects cross-origin POST and invalid requests before starting a job', async () => {
    const { jobs } = setup();
    const app = createApp({ automaticSubtitles: jobs });
    const start = vi.spyOn(jobs, 'start');
    expect((await app.request('/api/subtitles/automatic/fake', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' } })).status).toBe(403);
    expect((await app.request('/api/subtitles/automatic/fake', { method: 'POST' })).status).toBe(400);
    expect((await app.request('/api/subtitles/automatic/fake?url=https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
    expect(start).not.toHaveBeenCalled();
  });
});
