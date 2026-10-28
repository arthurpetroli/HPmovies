import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomaticSubtitleProvider, automaticSubtitleCues } from '../src/aniwatch-apis/src/providers/automatic-subtitles';

const sample = 'WEBVTT\n\nopening\n00:00:01.000 --> 00:00:03.000 align:center\n<b>Hello</b> &amp; good morning.\n\n00:00:04.000 --> 00:00:06.000\nHello &amp; good morning.\n';
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const languages = [{ code: 'en', name: 'English', targets: ['pt'] }];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('automatic subtitle source normalization', () => {
  it('keeps exact cue intervals and dialogue while removing source formatting', () => {
    expect(automaticSubtitleCues(sample)).toEqual([
      { interval: '00:00:01.000 --> 00:00:03.000 align:center', text: 'Hello & good morning.' },
      { interval: '00:00:04.000 --> 00:00:06.000', text: 'Hello & good morning.' },
    ]);
    expect(automaticSubtitleCues('WEBVTT\n\nNOTE do not translate\ntext\n\n00:01.000 --> 00:03.000\n&#65; &#x26; &#x1f600;')).toEqual([{ interval: '00:01.000 --> 00:03.000', text: 'A & 😀' }]);
  });

  it('rejects a malformed cue even after a valid one and bounds work before translation', () => {
    expect(() => automaticSubtitleCues(`${sample}\n00:00:08.000 --> 00:00:07.000\nBad`)).toThrow('tempo inválido');
    expect(() => automaticSubtitleCues(`${sample}\ninvalid block`)).toThrow('entrada inválida');
    expect(() => automaticSubtitleCues('x'.repeat(500_001))).toThrow('limite');
    expect(() => automaticSubtitleCues(`WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${'a'.repeat(1501)}`)).toThrow('limite');
    expect(() => automaticSubtitleCues('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b></b>')).toThrow('quantidade');
  });
});

describe('local automatic subtitle provider', () => {
  it('deduplicates dialogue and concurrent jobs, preserves timings, caches and marks the result', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/languages') ? response(languages) : response({ translatedText: ['Olá & bom dia.'] }));
    const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher });
    const [a, b] = await Promise.all([provider.translate(sample, 'en-US'), provider.translate(sample, 'en-US')]);
    expect(a).toEqual(b); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(a).toMatchObject({ language: 'pt', machineTranslated: true, format: 'vtt' });
    const request = fetcher.mock.calls.find(([url]) => String(url).endsWith('/translate'))!;
    const call = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) => url.endsWith('/translate'))!;
    expect(request).toBeTruthy();
    expect(JSON.parse(call[1].body as string)).toEqual({ q: ['Hello & good morning.'], source: 'en', target: 'pt', format: 'text' });
    const file = provider.file(a.url.split('/').at(-1)!);
    expect(new TextDecoder().decode(file.bytes)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.000 align:center\nOlá &amp; bom dia.\n\n00:00:04.000 --> 00:00:06.000\nOlá &amp; bom dia.\n');
    expect(await provider.translate(sample, 'en')).toEqual(a); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(file.contentType).toBe('text/vtt; charset=utf-8');
  });

  it('does not allow a model response to create markup or another cue', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/languages') ? response(languages) : response({ translatedText: ['<script>\n\n00:09.000 --> 00:10.000\n\u202eOlá'] }));
    const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher });
    const track = await provider.translate(sample, 'en');
    const body = new TextDecoder().decode(provider.file(track.url.split('/').at(-1)!).bytes);
    expect(body.match(/^.* --> .*$/gm)).toHaveLength(2);
    expect(body).toContain('&lt;script&gt;'); expect(body).not.toContain('\u202e');
  });

  it('splits a whole episode into bounded ordered batches without losing cues', async () => {
    const batches: string[][] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/languages')) return response(languages);
      const q: string[] = JSON.parse(init!.body as string).q;
      batches.push(q); return response({ translatedText: q.map(text => `Tradução de ${text}`) });
    });
    const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher });
    const episode = `WEBVTT\n\n${Array.from({ length: 80 }, (_, index) => `00:00:01.000 --> 00:00:02.000\nDialogue ${index}`).join('\n\n')}\n`;
    const track = await provider.translate(episode, 'en');
    expect(batches.map(batch => batch.length)).toEqual([32, 32, 16]);
    expect(batches.every(batch => batch.join('').length <= 4000)).toBe(true);
    const body = new TextDecoder().decode(provider.file(track.url.split('/').at(-1)!).bytes);
    expect(body.match(/-->/g)).toHaveLength(80); expect(body).toContain('Tradução de Dialogue 79');
  });

  it('limits simultaneous jobs instead of growing an unbounded translation queue', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/languages') ? response(languages) : new Promise<Response>(resolve => resolvers.push(resolve)));
    const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher });
    const first = provider.translate(sample, 'en'), second = provider.translate(sample.replace(/Hello/g, 'Welcome'), 'en');
    await expect(provider.translate(sample.replace(/Hello/g, 'Goodbye'), 'en')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_BUSY' });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers.forEach(resolve => resolve(response({ translatedText: ['Olá.'] })));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('checks and memoizes local availability independently of playback', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(languages));
    const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher });
    const checks = await Promise.all([provider.availability(), provider.availability()]);
    expect(checks[0]).toMatchObject({ available: true, sourceLanguages: ['en'] });
    expect(await provider.availability()).toEqual(checks[0]); expect(fetcher).toHaveBeenCalledOnce();
    const down = new AutomaticSubtitleProvider({ enabled: true, fetcher: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(await down.availability()).toMatchObject({ available: false, sourceLanguages: [] });
    await expect(down.translate(sample, 'en')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_UNAVAILABLE' });
  });

  it('fails without emitting a partial file when a batch is missing or malformed', async () => {
    for (const output of [{ translatedText: [] }, { translatedText: [''] }, { translatedText: ['a'.repeat(6001)] }, { translatedText: 'translated' }]) {
      const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher: vi.fn(async url => String(url).endsWith('/languages') ? response(languages) : response(output)) });
      await expect(provider.translate(sample, 'en')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_INVALID_RESPONSE' });
      expect(() => provider.file('missing')).toThrow('expirou');
    }
  });

  it('bounds chunked response sizes and refuses redirects, unavailable HTTP and unsupported languages', async () => {
    const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher: vi.fn(async url => String(url).endsWith('/languages') ? response(languages) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100_001)); controller.close(); } }), { headers: { 'Content-Type': 'application/json' } })) });
    await expect(provider.translate(sample, 'en')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_INVALID_RESPONSE' });
    await expect(provider.translate(sample, 'ja')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_UNSUPPORTED' });
    await expect(provider.translate(sample, 'pt-BR')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_UNSUPPORTED' });
    const offline = new AutomaticSubtitleProvider({ enabled: true, fetcher: vi.fn(async url => String(url).endsWith('/languages') ? response(languages) : new Response('offline', { status: 503 })) });
    await expect(offline.translate(sample, 'en')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_UNAVAILABLE' });
  });

  it('expires cached files and never starts work when disabled', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/languages') ? response(languages) : response({ translatedText: ['Olá.'] }));
    const provider = new AutomaticSubtitleProvider({ enabled: true, fetcher });
    const track = await provider.translate(sample, 'en');
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expect(() => provider.file(track.url.split('/').at(-1)!)).toThrow('expirou');
    const disabled = new AutomaticSubtitleProvider({ enabled: false, fetcher });
    expect(await disabled.availability()).toMatchObject({ available: false });
    await expect(disabled.translate(sample, 'en')).rejects.toMatchObject({ code: 'AUTOMATIC_SUBTITLE_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('only connects to a configured loopback root URL without credentials', () => {
    for (const baseUrl of ['https://public.example', 'http://127.0.0.1:5000?key=secret', 'http://user:secret@localhost:5000', 'http://localhost:5000/translate', 'file:///tmp/service']) {
      expect(() => new AutomaticSubtitleProvider({ baseUrl })).toThrow('serviço local');
    }
    expect(() => new AutomaticSubtitleProvider({ baseUrl: 'http://[::1]:5000' })).not.toThrow();
  });
});
