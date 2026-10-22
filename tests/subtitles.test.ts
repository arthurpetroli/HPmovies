import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConvertedSubtitle, normalizeCaptionPreferences, readCaptionPreferences, saveCaptionPreferences, subtitleToVtt } from '../src/frontend/components/player/subtitles';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('subtitle normalization', () => {
  it('converts SRT timestamps and keeps multiline cues', () => {
    expect(subtitleToVtt('1\r\n00:00:01,250 --> 00:00:03,000\r\nOlá!\r\nBrasil.\r\n', 'srt')).toBe('WEBVTT\n\n00:00:01.250 --> 00:00:03.000\nOlá!\nBrasil.\n');
  });
  it('extracts plain ASS dialogue without rendering styles or markup', () => {
    const ass = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.20,0:00:04.50,Default,,0,0,0,,{\\an8}Olá, mundo\\N<b>Texto</b>';
    expect(subtitleToVtt(ass, 'ass')).toContain('00:00:01.200 --> 00:00:04.500\nOlá, mundo\n&lt;b&gt;Texto&lt;/b&gt;');
  });
  it('rejects invalid times, empty files and excessive contents', () => {
    expect(() => subtitleToVtt('1\n00:99:01,000 --> 00:00:03,000\nTexto', 'srt')).toThrow();
    expect(() => subtitleToVtt('[Events]', 'ass')).toThrow('Nenhuma fala');
    expect(() => subtitleToVtt('a'.repeat(2_000_001), 'srt')).toThrow('limite');
    expect(() => subtitleToVtt('á'.repeat(1_000_001), 'srt')).toThrow('limite');
  });
  it('rejects zero duration or backwards intervals instead of emitting cues browsers discard', () => {
    for (const end of ['00:00:01,000', '00:00:00,999']) expect(() => subtitleToVtt(`1\n00:00:01,000 --> ${end}\nTexto`, 'srt')).toThrow('posterior');
    expect(() => subtitleToVtt('[Events]\nDialogue: 0,0:00:03.00,0:00:02.00,Default,,0,0,0,,Texto', 'ass')).toThrow('posterior');
    expect(subtitleToVtt('1\n00:59:59,999 --> 01:00:00,000\nTexto', 'srt')).toContain('00:59:59.999 --> 01:00:00.000');
  });
  it('validates the VTT header and skips unsupported ASS drawings', () => {
    expect(subtitleToVtt('\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nOlá', 'vtt')).toContain('WEBVTT\n\n');
    expect(() => subtitleToVtt('WEBVTTevil\n\n', 'vtt')).toThrow('WebVTT');
    const ass = '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 20 20\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Fala';
    const output = subtitleToVtt(ass, 'ass');
    expect(output).toContain('Fala'); expect(output).not.toContain('m 0 0');
  });
});

describe('caption preferences', () => {
  const defaults = { language: 'pt-br', size: 'medium', background: true, offset: 0 };
  it('validates stored types, bounds sync, and keeps actual language subtags', () => {
    expect(normalizeCaptionPreferences({ size: 'huge', background: 'false', offset: '3', language: '<script>' })).toMatchObject(defaults);
    expect(normalizeCaptionPreferences({ size: 'large', background: false, offset: 400, language: ' PT_BR ' })).toEqual({ size: 'large', background: false, offset: 10, language: 'pt-br' });
    expect(normalizeCaptionPreferences({ offset: -400, language: 'es-419' })).toMatchObject({ offset: -10, language: 'es-419' });
    expect(normalizeCaptionPreferences({ offset: NaN })).toMatchObject({ offset: 0 });
    expect(normalizeCaptionPreferences(null)).toEqual(defaults);
    expect(normalizeCaptionPreferences([])).toEqual(defaults);
  });
  it('recovers from corrupt, oversized or blocked storage', () => {
    const getItem = vi.fn().mockReturnValue('{broken');
    vi.stubGlobal('localStorage', { getItem });
    expect(readCaptionPreferences()).toEqual(defaults);
    getItem.mockReturnValue(JSON.stringify({ size: 'large', unexpected: 'x'.repeat(2048) }));
    expect(readCaptionPreferences()).toEqual(defaults);
    getItem.mockImplementation(() => { throw new Error('Blocked'); });
    expect(readCaptionPreferences()).toEqual(defaults);
  });
  it('persists a bounded validated record and tolerates quota failures', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    saveCaptionPreferences({ size: 'small', background: false, offset: Infinity, language: 'x'.repeat(5000) });
    const [key, raw] = setItem.mock.calls[0];
    expect(key).toBe('hpmovies.captions.v1');
    expect(JSON.parse(raw)).toEqual({ language: 'pt-br', size: 'small', background: false, offset: 0 });
    expect(raw.length).toBeLessThan(200);
    setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(() => saveCaptionPreferences({ size: 'medium', background: true, offset: 1.5, language: 'off' })).not.toThrow();
  });
});

describe('subtitle loading limits', () => {
  const configureWindow = () => vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
  it('uses credentialless fetch and rejects unsafe URLs without a request', async () => {
    configureWindow(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const url of ['javascript:alert(1)', 'https://user:secret@example.org/sub.srt']) await expect(loadConvertedSubtitle(url, 'srt', new AbortController().signal)).rejects.toThrow('URL');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(new Response('1\n00:00:01,000 --> 00:00:02,000\nOlá'));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:converted');
    const controller = new AbortController();
    expect(await loadConvertedSubtitle('/captions.srt', 'srt', controller.signal)).toBe('blob:converted');
    expect(fetcher).toHaveBeenCalledWith(new URL('http://localhost:5173/captions.srt'), { signal: controller.signal, credentials: 'omit', redirect: 'error' });
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
  it('cancels chunked oversized bodies even when content-length is absent', async () => {
    configureWindow(); const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    await expect(loadConvertedSubtitle('/too-large.srt', 'srt', new AbortController().signal)).rejects.toThrow('limite');
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
  });
  it('aborts stalled bodies and releases the reader', async () => {
    configureWindow(); const controller = new AbortController(), cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const pending = loadConvertedSubtitle('/stalled.srt', 'srt', controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); controller.abort(); await rejection;
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
  });
});
