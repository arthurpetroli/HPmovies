import { API_BASE_URL } from './http';

export interface MangaDownloadInput {
  title: string;
  chapterTitle: string;
  language: string;
  pages: string[];
  sourceUrl?: string;
  credits?: string[];
}
export interface MangaDownloadProgress { completed: number; total: number }
interface MangaDownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MangaDownloadProgress) => void;
  fetcher?: typeof fetch;
}
interface ArchiveEntry { name: string; chunks: Uint8Array<ArrayBuffer>[]; size: number; crc: number }

// Bound retained chapter data on mobile. ZIP uses stored entries, preserving original image bytes.
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const MAX_CHAPTER_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 500;
const PAGE_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
const updateCrc = (crc: number, bytes: Uint8Array): number => {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return crc >>> 0;
};
const aborted = () => new DOMException('Download cancelado.', 'AbortError');
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => undefined); return Promise.reject(aborted()); }
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener('abort', cancel, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

function pageUrl(value: string): string {
  const ticket = '(?:manga|content)/image/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
  const local = new RegExp(`^/api/${ticket}$`, 'i');
  if (local.test(value)) return `${API_BASE_URL}${value.slice(4)}`;
  const apiTicket = value.startsWith(`${API_BASE_URL}/`) && new RegExp(`^${ticket}$`, 'i').test(value.slice(API_BASE_URL.length + 1));
  if (apiTicket) return value;
  if (value.startsWith(`${API_BASE_URL}/`)) throw new Error('O capítulo contém um endereço de página não permitido. Atualize o capítulo.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('O capítulo contém um endereço de página inválido. Atualize o capítulo.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname)) {
    throw new Error('O capítulo contém um endereço de página não permitido. Atualize o capítulo.');
  }
  return url.href;
}
const xmlEscape = (value: string) => Array.from(value).filter(character => { const code = character.charCodeAt(0); return code >= 32 || code === 9 || code === 10 || code === 13; }).join('').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
function publicSource(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    // Provider links can contain private playback credentials; never persist their query or fragment.
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return undefined; }
}
function comicInfo(input: MangaDownloadInput): Uint8Array<ArrayBuffer> {
  const source = publicSource(input.sourceUrl);
  return encoder.encode(`<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n  <Title>${xmlEscape(input.chapterTitle)}</Title>\n  <Series>${xmlEscape(input.title)}</Series>\n  <LanguageISO>${xmlEscape(input.language)}</LanguageISO>\n  <PageCount>${input.pages.length}</PageCount>${input.credits?.length ? `\n  <Translator>${xmlEscape(input.credits.join(', '))}</Translator>` : ''}${source ? `\n  <Web>${xmlEscape(source)}</Web>` : ''}\n</ComicInfo>\n`);
}
function filename(input: MangaDownloadInput): string {
  const clean = (value: string) => value.normalize('NFC').replace(/\p{Cc}/gu, '-').replace(/[/\\<>:"|?*]/g, '-').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80);
  let name = [clean(input.title), clean(input.chapterTitle), clean(input.language)].filter(Boolean).join(' - ') || 'Capítulo';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `Mangá - ${name}`;
  return `${name}.cbz`;
}
function imageMatches(mime: string, header: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...header.slice(start, end));
  if (mime === 'image/png') return header.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  if (mime === 'image/jpeg') return header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'image/avif') return ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 32));
  return false;
}
async function readPage(url: string, index: number, remaining: number, fetcher: typeof fetch, signal?: AbortSignal): Promise<ArchiveEntry> {
  checkAbort(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, PAGE_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // Every page already comes from a reading provider. Never follow a page into another endpoint.
    const response = await abortable(fetcher(url, { signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: Object.keys(extensions).join(',') } }), controller.signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`Não foi possível baixar a página ${index + 1} (${response.status}). Tente novamente.`);
    }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!extensions[mime]) { void response.body?.cancel().catch(() => undefined); throw new Error(`A página ${index + 1} não contém uma imagem compatível. Atualize o capítulo.`); }
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_PAGE_BYTES || Number(declared) > remaining)) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error('O capítulo excede o limite de download: 20 MB por página e 200 MB por capítulo.');
    }
    if (!response.body) throw new Error(`A página ${index + 1} está vazia. Tente novamente.`);
    reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = []; const header = new Uint8Array(32);
    let size = 0; let crc = 0xffffffff; let buffer = new Uint8Array(64 * 1024); let buffered = 0;
    while (true) {
      const part = await abortable(reader.read(), controller.signal);
      if (part.done) break;
      if (size + part.value.byteLength > MAX_PAGE_BYTES || size + part.value.byteLength > remaining) throw new Error('O capítulo excede o limite de download: 20 MB por página e 200 MB por capítulo.');
      if (size < header.length) header.set(part.value.subarray(0, header.length - size), size);
      size += part.value.byteLength;
      crc = updateCrc(crc, part.value);
      // Coalesce small stream chunks so byte limits also bound retained allocation overhead.
      let copied = 0;
      while (copied < part.value.length) {
        const length = Math.min(buffer.length - buffered, part.value.length - copied);
        buffer.set(part.value.subarray(copied, copied + length), buffered); buffered += length; copied += length;
        if (buffered === buffer.length) { chunks.push(buffer); buffer = new Uint8Array(64 * 1024); buffered = 0; }
      }
    }
    if (!size) throw new Error(`A página ${index + 1} está vazia. Tente novamente.`);
    if (!imageMatches(mime, header.subarray(0, Math.min(size, header.length)))) throw new Error(`A página ${index + 1} não contém uma imagem válida. Atualize o capítulo.`);
    checkAbort(signal);
    if (buffered) chunks.push(buffer.slice(0, buffered));
    return { name: `${String(index + 1).padStart(3, '0')}.${extensions[mime]}`, chunks, size, crc: (crc ^ 0xffffffff) >>> 0 };
  } catch (error) {
    if (signal?.aborted) throw aborted();
    if (controller.signal.aborted) throw new Error(`A página ${index + 1} demorou para responder. Tente novamente.`);
    if (error instanceof TypeError) throw new Error(`Não foi possível baixar a página ${index + 1}. Confira sua conexão e tente novamente.`);
    throw error;
  } finally {
    void reader?.cancel().catch(() => undefined);
    clearTimeout(timeout); signal?.removeEventListener('abort', cancel);
  }
}
function archive(entries: ArchiveEntry[]): Blob {
  const parts: BlobPart[] = []; const central: Uint8Array<ArrayBuffer>[] = []; let offset = 0; let centralSize = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name); const local = new Uint8Array(30 + name.length); const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 0x21, true); view.setUint32(14, entry.crc, true); view.setUint32(18, entry.size, true); view.setUint32(22, entry.size, true); view.setUint16(26, name.length, true); local.set(name, 30);
    parts.push(local, ...entry.chunks);
    const directory = new Uint8Array(46 + name.length); const descriptor = new DataView(directory.buffer);
    descriptor.setUint32(0, 0x02014b50, true); descriptor.setUint16(4, 20, true); descriptor.setUint16(6, 20, true); descriptor.setUint16(8, 0x800, true);
    descriptor.setUint16(14, 0x21, true); descriptor.setUint32(16, entry.crc, true); descriptor.setUint32(20, entry.size, true); descriptor.setUint32(24, entry.size, true); descriptor.setUint16(28, name.length, true); descriptor.setUint32(42, offset, true); directory.set(name, 46);
    central.push(directory); centralSize += directory.length; offset += local.length + entry.size;
  }
  const end = new Uint8Array(22); const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.comicbook+zip' });
}

/** Create a complete CBZ only after every page succeeds; callers decide when to offer the file. */
export async function createMangaArchive(input: MangaDownloadInput, options: MangaDownloadOptions = {}): Promise<{ blob: Blob; filename: string }> {
  checkAbort(options.signal);
  if (!input.pages.length) throw new Error('Este capítulo não tem páginas disponíveis para download.');
  if (input.pages.length > MAX_PAGES) throw new Error('Este capítulo excede o limite de 500 páginas por download.');
  const urls = input.pages.map(pageUrl); const entries: ArchiveEntry[] = [];
  let size = 0;
  options.onProgress?.({ completed: 0, total: urls.length });
  for (let index = 0; index < urls.length; index++) {
    const entry = await readPage(urls[index], index, MAX_CHAPTER_BYTES - size, options.fetcher ?? fetch, options.signal);
    entries.push(entry); size += entry.size;
    options.onProgress?.({ completed: index + 1, total: urls.length });
  }
  checkAbort(options.signal);
  const metadata = comicInfo(input);
  entries.push({ name: 'ComicInfo.xml', chunks: [metadata], size: metadata.length, crc: (updateCrc(0xffffffff, metadata) ^ 0xffffffff) >>> 0 });
  return { blob: archive(entries), filename: filename(input) };
}
