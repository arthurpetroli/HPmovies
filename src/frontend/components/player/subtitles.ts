import { MAX_SUBTITLE_BYTES, subtitleToVtt } from '../../../shared/subtitles';
export { subtitleToVtt } from '../../../shared/subtitles';

export interface CaptionPreferences {
  language?: string;
  size: 'small' | 'medium' | 'large';
  background: boolean;
  offset: number;
}

const KEY = 'hpmovies.captions.v1';

export function normalizeCaptionPreferences(input: unknown): CaptionPreferences {
  const defaults: CaptionPreferences = { language: 'pt-br', size: 'medium', background: true, offset: 0 };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;
  const value = input as Record<string, unknown>;
  const language = typeof value.language === 'string' ? value.language.trim().replace(/_/g, '-').toLowerCase() : '';
  return {
    language: language.length <= 39 && /^(?:off|[a-z]{2,8}(?:-[a-z0-9]{1,8})*)$/.test(language) ? language : defaults.language,
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
