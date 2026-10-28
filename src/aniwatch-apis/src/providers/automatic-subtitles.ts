import { createHash, randomUUID } from 'node:crypto';
import type { StreamSubtitle } from '../../../shared/providers.js';
import { subtitleToVtt } from '../../../shared/subtitles.js';
import { ApiError } from '../config/apiError.js';

interface Options { enabled?: boolean; baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number; totalTimeoutMs?: number }
export interface AutomaticSubtitleAvailability { available: boolean; sourceLanguages: string[]; message: string }
interface Cue { interval: string; text: string }
interface SubtitleFile { bytes: Uint8Array; contentType: string; cacheControl: string }
interface CachedFile { track: StreamSubtitle; file: SubtitleFile; expires: number }

const unavailable = () => new ApiError(503, 'AUTOMATIC_SUBTITLE_UNAVAILABLE', 'A tradução automática local está indisponível.');
const invalid = () => new ApiError(502, 'AUTOMATIC_SUBTITLE_INVALID_RESPONSE', 'A tradução automática retornou uma legenda incompleta. Tente novamente.');
const unsupported = () => new ApiError(400, 'AUTOMATIC_SUBTITLE_UNSUPPORTED', 'Não há modelo local para traduzir o idioma desta legenda.');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const plainText = (input: string) => input.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp|quot|apos);|&#(?:\d+|x[0-9a-f]+);/gi, entity => {
  const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&apos;': "'" };
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
  const hex = entity[2]?.toLowerCase() === 'x';
  const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
// eslint-disable-next-line no-control-regex -- Deliberately remove subtitle control and bidi characters before translation.
}).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
const escapeVtt = (input: string) => input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Only cue dialogue is translated; source timing and order never come from a model. */
export function automaticSubtitleCues(input: string): Cue[] {
  if (Buffer.byteLength(input) > 500_000) throw new ApiError(400, 'AUTOMATIC_SUBTITLE_TOO_LARGE', 'A legenda excede o limite da tradução automática.');
  let normalized: string;
  try { normalized = subtitleToVtt(input, 'vtt'); } catch { throw new ApiError(400, 'AUTOMATIC_SUBTITLE_INVALID_SOURCE', 'A legenda de origem não contém falas válidas.'); }
  const cues: Cue[] = [];
  for (const block of normalized.trim().split(/\n\s*\n/).slice(1)) {
    const lines = block.split('\n');
    if (/^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[0])) continue;
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0 || index > 1 || !lines.slice(index + 1).length) throw new ApiError(400, 'AUTOMATIC_SUBTITLE_INVALID_SOURCE', 'A legenda de origem possui uma entrada inválida.');
    const interval = lines[index].trim();
    // Validate every interval, rather than relying on the first valid WebVTT cue.
    try { subtitleToVtt(`WEBVTT\n\n${interval}\nvalid\n`, 'vtt'); } catch { throw new ApiError(400, 'AUTOMATIC_SUBTITLE_INVALID_SOURCE', 'A legenda de origem possui um tempo inválido.'); }
    const text = plainText(lines.slice(index + 1).join(' '));
    if (text.length > 1500) throw new ApiError(400, 'AUTOMATIC_SUBTITLE_TOO_LARGE', 'Uma fala excede o limite da tradução automática.');
    if (text) cues.push({ interval, text });
  }
  if (!cues.length || cues.length > 4000) throw new ApiError(400, 'AUTOMATIC_SUBTITLE_INVALID_SOURCE', 'A legenda de origem possui uma quantidade de falas incompatível.');
  if (cues.reduce((size, cue) => size + cue.text.length, 0) > 200_000) throw new ApiError(400, 'AUTOMATIC_SUBTITLE_TOO_LARGE', 'A legenda excede o limite da tradução automática.');
  return cues;
}

/** Opt-in translation through a loopback-only LibreTranslate-compatible service. */
export class AutomaticSubtitleProvider {
  readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly totalTimeout: number;
  private status?: { value: AutomaticSubtitleAvailability; expires: number };
  private checking?: Promise<AutomaticSubtitleAvailability>;
  private readonly cached = new Map<string, CachedFile>();
  private readonly tokens = new Map<string, string>();
  private readonly pending = new Map<string, Promise<StreamSubtitle>>();
  private bytes = 0;

  constructor(options: Options = {}) {
    this.enabled = options.enabled ?? process.env.AUTOMATIC_SUBTITLES_ENABLED !== 'false';
    const url = new URL(options.baseUrl ?? process.env.AUTOMATIC_SUBTITLES_URL ?? 'http://127.0.0.1:5000');
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('AUTOMATIC_SUBTITLES_URL deve apontar para um serviço local sem credenciais ou parâmetros.');
    this.baseUrl = url.origin;
    this.fetcher = options.fetcher ?? fetch;
    this.timeout = options.timeoutMs ?? 45_000;
    this.totalTimeout = options.totalTimeoutMs ?? 5 * 60_000;
  }

  private async json(path: string, init: RequestInit = {}, timeout = this.timeout): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) { await response.body?.cancel(); throw unavailable(); }
    if (Number(response.headers.get('content-length')) > 100_000) { await response.body?.cancel(); throw invalid(); }
    const reader = response.body?.getReader(); if (!reader) throw invalid();
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        total += part.value.byteLength;
        if (total > 100_000) { await reader.cancel(); throw invalid(); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw invalid(); }
  }

  availability(): Promise<AutomaticSubtitleAvailability> {
    if (!this.enabled) return Promise.resolve({ available: false, sourceLanguages: [], message: 'A tradução automática está desativada.' });
    if (this.status && this.status.expires > Date.now()) return Promise.resolve(this.status.value);
    if (this.checking) return this.checking;
    this.checking = this.json('/languages', {}, 2000).then(value => {
      if (!Array.isArray(value) || value.length > 200) throw invalid();
      const sourceLanguages = value.filter(object).filter(row => typeof row.code === 'string' && /^[a-z]{2,3}$/.test(row.code)
        && Array.isArray(row.targets) && row.targets.includes('pt')).map(row => row.code as string).filter(code => code !== 'pt');
      return { available: sourceLanguages.length > 0, sourceLanguages, message: sourceLanguages.length ? 'Tradução automática local disponível.' : 'Nenhum modelo local de tradução para português está instalado.' };
    }).catch(() => ({ available: false, sourceLanguages: [], message: 'A tradução automática local está indisponível.' })).then(value => {
      this.status = { value, expires: Date.now() + 15_000 }; return value;
    }).finally(() => { this.checking = undefined; });
    return this.checking;
  }

  private prune() {
    for (const [key, entry] of this.cached) if (entry.expires <= Date.now()) {
      this.bytes -= entry.file.bytes.byteLength;
      this.tokens.delete(entry.track.url.split('/').at(-1)!); this.cached.delete(key);
    }
    while (this.cached.size >= 64 || this.bytes > 16_000_000) {
      const key = this.cached.keys().next().value; if (!key) break;
      const entry = this.cached.get(key)!; this.bytes -= entry.file.bytes.byteLength;
      this.tokens.delete(entry.track.url.split('/').at(-1)!); this.cached.delete(key);
    }
  }

  async translate(vtt: string, sourceLanguage: string): Promise<StreamSubtitle> {
    if (!this.enabled) throw unavailable();
    const language = sourceLanguage.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
    if (!/^[a-z]{2,3}$/.test(language) || language === 'pt') throw unsupported();
    const key = createHash('sha256').update(language).update('\0').update(vtt).digest('hex');
    this.prune();
    const cached = this.cached.get(key); if (cached) return cached.track;
    const pending = this.pending.get(key); if (pending) return pending;
    if (this.pending.size >= 2) throw new ApiError(503, 'AUTOMATIC_SUBTITLE_BUSY', 'A tradução automática já está ocupada. Tente novamente em instantes.', 15);
    const cues = automaticSubtitleCues(vtt);
    const task = this.generate(key, cues, language).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }

  private async generate(key: string, cues: Cue[], language: string): Promise<StreamSubtitle> {
    const availability = await this.availability();
    if (!availability.available) throw unavailable();
    if (!availability.sourceLanguages.includes(language)) throw unsupported();
    const texts = [...new Set(cues.map(cue => cue.text))], translated = new Map<string, string>();
    const deadline = Date.now() + this.totalTimeout;
    try {
      let offset = 0;
      while (offset < texts.length) {
        const batch: string[] = []; let size = 0;
        while (offset < texts.length && batch.length < 32 && (size + texts[offset].length <= 4000 || !batch.length)) { size += texts[offset].length; batch.push(texts[offset++]); }
        const remaining = deadline - Date.now(); if (remaining <= 0) throw unavailable();
        const result = await this.json('/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ q: batch, source: language, target: 'pt', format: 'text' }) }, Math.min(this.timeout, remaining));
        if (!object(result) || !Array.isArray(result.translatedText) || result.translatedText.length !== batch.length) throw invalid();
        for (let index = 0; index < batch.length; index++) {
          const value: unknown = result.translatedText[index];
          if (typeof value !== 'string' || !value.trim() || value.length > 6000) throw invalid();
          // Returned dialogue cannot create markup, cue identifiers or timing blocks.
          // eslint-disable-next-line no-control-regex -- Model output must not introduce subtitle control or bidi characters.
          const clean = value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
          if (!clean) throw invalid();
          translated.set(batch[index], escapeVtt(clean));
        }
      }
    } catch (error) { if (error instanceof ApiError) throw error; throw unavailable(); }
    const bytes = new TextEncoder().encode(`WEBVTT\n\n${cues.map(cue => `${cue.interval}\n${translated.get(cue.text)!}`).join('\n\n')}\n`);
    if (bytes.byteLength > 2_000_000) throw invalid();
    const token = randomUUID();
    const track: StreamSubtitle = { id: `automatic-${key.slice(0, 16)}`, url: `/api/subtitles/automatic/file/${token}`, label: 'Português · tradução automática local', language: 'pt', format: 'vtt', machineTranslated: true };
    this.cached.set(key, { track, file: { bytes, contentType: 'text/vtt; charset=utf-8', cacheControl: 'private, max-age=3600' }, expires: Date.now() + 60 * 60_000 });
    this.tokens.set(token, key); this.bytes += bytes.byteLength; this.prune();
    return track;
  }

  file(token: string): SubtitleFile {
    this.prune();
    const key = this.tokens.get(token), entry = key ? this.cached.get(key) : undefined;
    if (!entry) throw new ApiError(404, 'AUTOMATIC_SUBTITLE_EXPIRED', 'A legenda automática expirou. Gere a tradução novamente.');
    return entry.file;
  }
}
