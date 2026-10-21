export interface CaptionPreferences {
  language?: string;
  size: 'small' | 'medium' | 'large';
  background: boolean;
  offset: number;
}

const KEY = 'hpmovies.captions.v1';
const MAX_SUBTITLE_BYTES = 2_000_000;

export function normalizeCaptionPreferences(input: unknown): CaptionPreferences {
  const defaults: CaptionPreferences = { size: 'medium', background: true, offset: 0 };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;
  const value = input as Record<string, unknown>;
  const language = typeof value.language === 'string' ? value.language.trim().replace(/_/g, '-').toLowerCase() : '';
  return {
    language: language.length <= 39 && /^(?:off|[a-z]{2,8}(?:-[a-z0-9]{1,8})*)$/.test(language) ? language : undefined,
    size: value.size === 'small' || value.size === 'large' ? value.size : defaults.size,
    background: typeof value.background === 'boolean' ? value.background : true,
    offset: typeof value.offset === 'number' && Number.isFinite(value.offset) ? Math.max(-10, Math.min(10, value.offset)) : 0,
  };
}

export function readCaptionPreferences(): CaptionPreferences {
  try {
    const raw = localStorage.getItem(KEY) || '{}';
    return normalizeCaptionPreferences(raw.length <= 2048 ? JSON.parse(raw) : null);
  } catch { return normalizeCaptionPreferences(null); }
}

export function saveCaptionPreferences(value: CaptionPreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(normalizeCaptionPreferences(value))); } catch { /* Controls remain usable without storage. */ }
}

function timestamp(value: string): { text: string; milliseconds: number } {
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!match || +match[2] > 59 || +match[3] > 59) throw new Error('Tempo de legenda inválido.');
  const fraction = match[4].padEnd(3, '0');
  return {
    text: `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${fraction}`,
    milliseconds: ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(fraction),
  };
}

function cueInterval(start: string, end: string): string {
  const from = timestamp(start), to = timestamp(end);
  if (to.milliseconds <= from.milliseconds) throw new Error('O fim da legenda deve ser posterior ao início.');
  return `${from.text} --> ${to.text}`;
}

/** Plain ASS dialogue is supported; typesetting, karaoke and attachments are not rendered. */
export function subtitleToVtt(input: string, format: 'srt' | 'ass' | 'vtt'): string {
  if (input.length > MAX_SUBTITLE_BYTES || new TextEncoder().encode(input).byteLength > MAX_SUBTITLE_BYTES) throw new Error('A legenda excede o limite de tamanho.');
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (format === 'vtt') {
    if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(text) || text.split('\n', 1)[0].includes('-->')) throw new Error('Arquivo WebVTT inválido.');
    return text;
  }
  const cues: string[] = [];
  if (format === 'srt') {
    for (const block of text.trim().split(/\n\s*\n/)) {
      const lines = block.split('\n');
      if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
      const interval = lines.shift()?.trim().match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
      if (!interval || !lines.length) continue;
      cues.push(`${cueInterval(interval[1], interval[2])}\n${lines.join('\n')}`);
    }
  } else {
    let inEvents = false;
    let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    for (const line of text.split('\n')) {
      if (/^\[/.test(line)) inEvents = /^\[Events\]$/i.test(line.trim());
      if (!inEvents) continue;
      if (/^Format:/i.test(line)) fields = line.slice(line.indexOf(':') + 1).split(',').map(field => field.trim().toLowerCase());
      if (!/^Dialogue:/i.test(line)) continue;
      const values = line.slice(line.indexOf(':') + 1).trim().split(',');
      const textIndex = fields.indexOf('text');
      if (textIndex !== fields.length - 1 || values.length < fields.length) continue;
      const rawDialogue = values.slice(textIndex).join(',');
      // ASS vector drawings have no equivalent in the deliberately textual renderer.
      if (/\{[^}]*\\p[1-9]\d*[^}]*\}/i.test(rawDialogue)) continue;
      const dialogue = rawDialogue.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
      if (!dialogue.trim()) continue;
      const escaped = dialogue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      cues.push(`${cueInterval(values[fields.indexOf('start')] || '', values[fields.indexOf('end')] || '')}\n${escaped}`);
    }
  }
  if (!cues.length) throw new Error('Nenhuma fala válida encontrada na legenda.');
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export async function loadConvertedSubtitle(url: string, format: 'srt' | 'ass', signal: AbortSignal): Promise<string> {
  const parsed = new URL(url, window.location.origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('URL de legenda inválida.');
  signal.throwIfAborted();
  const response = await fetch(parsed, { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_SUBTITLE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Não foi possível carregar esta legenda.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Legenda sem conteúdo.');
  const decoder = new TextDecoder();
  let contents = '', bytes = 0;
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((resolve, reject) => { void resolve; rejectAbort = reject; });
  const abort = () => rejectAbort(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SUBTITLE_BYTES) throw new Error('A legenda excede o limite de tamanho.');
      contents += decoder.decode(value, { stream: true });
    }
    contents += decoder.decode();
    signal.throwIfAborted();
    return URL.createObjectURL(new Blob([subtitleToVtt(contents, format)], { type: 'text/vtt' }));
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
