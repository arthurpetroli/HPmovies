import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { ApiError } from '../config/apiError.js';
import type { TokoConfig } from '../config/integrations.js';
import { permittedContentHeaders, permittedContentUrl, pinnedRequest, publicImageAddress } from './content-image.js';
import type { ImageRequest, ImageResponse } from './content-image.js';

type MediaKind = 'hls' | 'mp4' | 'subtitle' | 'segment' | 'key' | 'encrypted-segment';
interface SegmentEncryption { keyToken: string; iv: Uint8Array }
interface Ticket {
  source: string; kind: MediaKind; provider: string; headers: Record<string, string>;
  config: TokoConfig; expiresAt: number; key: string;
  encryption?: SegmentEncryption;
}
interface GatewayOptions {
  resolver?: (host: string) => Promise<LookupAddress[]>;
  transport?: (input: ImageRequest) => Promise<ImageResponse>;
  timeoutMs?: number;
}
export interface StreamMedia { bytes: Uint8Array; status: 200 | 206; headers: Record<string, string> }
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANGE_BYTES = 8_000_000;
const BINARY_MEDIA_MIME = new Set(['video/mp2t', 'video/mp4', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'application/octet-stream', 'text/vtt']);
const denied = () => new ApiError(503, 'STREAM_MEDIA_NOT_PERMITTED', 'A mídia exige um domínio ou cabeçalhos não permitidos para esta fonte.');
const unavailable = () => new ApiError(502, 'STREAM_MEDIA_UNAVAILABLE', 'A fonte não disponibilizou esta mídia. Escolha outra fonte ou tente novamente.');
const unsupportedEncryption = () => new ApiError(502, 'ENCRYPTED_MEDIA_UNSUPPORTED', 'Esta fonte usa um formato de criptografia não compatível com a reprodução local. Escolha outra fonte.');
interface HlsKey { uri: string; iv?: Uint8Array }
/** Only the public identity AES-128 method is supported, never DRM key systems. */
function hlsKey(line: string): HlsKey | null {
  if (!line.startsWith('#EXT-X-KEY:')) throw unsupportedEncryption();
  const input = line.slice('#EXT-X-KEY:'.length);
  const attributes = new Map<string, { value: string; quoted: boolean }>();
  let cursor = 0;
  while (cursor < input.length) {
    const match = /^([A-Z][A-Z0-9-]*)=(?:"([^"\r\n]*)"|([^,\s"]+))(?:,|$)/.exec(input.slice(cursor));
    if (!match || attributes.has(match[1]) || !['METHOD', 'URI', 'IV', 'KEYFORMAT', 'KEYFORMATVERSIONS'].includes(match[1])) throw unsupportedEncryption();
    attributes.set(match[1], { value: match[2] ?? match[3], quoted: match[2] !== undefined });
    cursor += match[0].length;
    if (cursor === input.length && match[0].endsWith(',')) throw unsupportedEncryption();
  }
  const method = attributes.get('METHOD');
  if (!method || method.quoted) throw unsupportedEncryption();
  if (method.value === 'NONE' && attributes.size === 1) return null;
  const uri = attributes.get('URI'), iv = attributes.get('IV'), format = attributes.get('KEYFORMAT'), version = attributes.get('KEYFORMATVERSIONS');
  if (method.value !== 'AES-128' || !uri?.quoted || !uri.value || format && (!format.quoted || format.value !== 'identity')
    || version && (!version.quoted || version.value !== '1') || iv && (iv.quoted || !/^0x[0-9a-f]{1,32}$/i.test(iv.value))) throw unsupportedEncryption();
  return { uri: uri.value, ...(iv ? { iv: Buffer.from(iv.value.slice(2).padStart(32, '0'), 'hex') } : {}) };
}
const mediaError = (error: unknown): unknown => error instanceof ApiError && error.code === 'CONTENT_IMAGE_NOT_PERMITTED' ? denied() : error;
/** Operator-approved CDN domains apply only to streaming, never image tickets. */
export function permittedStreamUrl(source: string, config: TokoConfig): URL {
  let url: URL;
  try { url = new URL(source); } catch { throw denied(); }
  const domainAllowed = (config.allowedStreamDomains ?? []).some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  try {
    return permittedContentUrl(source, domainAllowed ? { ...config, allowedMediaHosts: [...config.allowedMediaHosts, url.hostname] } : config);
  } catch (error) { throw mediaError(error); }
}
const isTransportStream = (bytes: Uint8Array): boolean => bytes.length >= 188 * 3 && bytes.length % 188 === 0
  && bytes.every((value, index) => index % 188 !== 0 || value === 0x47);
const isMp4 = (bytes: Uint8Array, fragment = false): boolean => {
  if (bytes.length < 12) return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const type = new TextDecoder().decode(bytes.subarray(4, 8));
  return size >= 8 && (type === 'ftyp' || fragment && ['styp', 'moof'].includes(type));
};

/** A browser user agent is never impersonated. Cookies and authentication headers are refused. */
export function streamRequestHeaders(input: Record<string, string>, config: TokoConfig): Record<string, string> {
  const filtered = Object.fromEntries(Object.entries(input).filter(([key]) => key.toLowerCase() !== 'user-agent'));
  try { return permittedContentHeaders(filtered, config); } catch (error) { throw mediaError(error); }
}

/** Only source results and descendants of a verified HLS playlist can issue these tickets. */
export class StreamMediaGateway {
  private readonly tickets = new Map<string, Ticket>();
  private readonly sources = new Map<string, string>();
  private readonly pending = new Map<string, Promise<StreamMedia>>();
  private readonly cache = new Map<string, { value: StreamMedia; expiresAt: number }>();
  private cacheBytes = 0;
  private readonly probes = new Map<string, { expiresAt: number; error?: unknown }>();
  private readonly pendingProbes = new Map<string, Promise<void>>();
  private readonly resolver: NonNullable<GatewayOptions['resolver']>;
  private readonly transport: NonNullable<GatewayOptions['transport']>;
  private readonly timeoutMs: number;
  constructor(options: GatewayOptions = {}) {
    this.resolver = options.resolver ?? (host => lookup(host, { all: true, verbatim: true }));
    this.transport = options.transport ?? pinnedRequest;
    this.timeoutMs = options.timeoutMs ?? 18000;
  }
  issue(config: TokoConfig, provider: string, source: string, kind: MediaKind, inputHeaders: Record<string, string> = {}, expiresAt = Date.now() + 2 * 60 * 60_000, encryption?: SegmentEncryption): string {
    if (!config.enabled || !config.contentAuthorized || !config.allowedProviders.includes(provider)) throw denied();
    let url: URL;
    try { url = permittedStreamUrl(source, config); } catch (error) { throw mediaError(error); }
    const headers = streamRequestHeaders(inputHeaders, config);
    if (kind === 'encrypted-segment' && !encryption) throw denied();
    const key = createHash('sha256').update(JSON.stringify([provider, url.href, kind, headers, config.allowedMediaHosts, config.allowedStreamDomains, config.allowedRequestOrigins,
      encryption?.keyToken, encryption && Buffer.from(encryption.iv).toString('hex')])).digest('hex');
    const previous = this.sources.get(key); const remembered = previous && this.tickets.get(previous);
    if (previous && remembered && remembered.expiresAt > Date.now() + 30_000) return `/api/streaming/media/${previous}`;
    for (const [token, ticket] of this.tickets) if (ticket.expiresAt <= Date.now()) this.remove(token, ticket);
    while (this.tickets.size >= 8192) {
      const first = this.tickets.entries().next().value;
      if (!first) break;
      this.remove(first[0], first[1]);
    }
    const token = randomUUID();
    this.tickets.set(token, { source: url.href, config, provider, kind, headers, expiresAt, key, encryption });
    this.sources.set(key, token); return `/api/streaming/media/${token}`;
  }
  private remove(token: string, ticket: Ticket) {
    this.tickets.delete(token);
    if (this.sources.get(ticket.key) === token) this.sources.delete(ticket.key);
  }
  private range(kind: MediaKind, value?: string): string | undefined {
    if (kind !== 'mp4' && kind !== 'segment') {
      if (value) throw new ApiError(416, 'INVALID_MEDIA_RANGE', 'Esta mídia não aceita intervalos de bytes.');
      return undefined;
    }
    if (!value) return kind === 'mp4' ? `bytes=0-${RANGE_BYTES - 1}` : undefined;
    const match = /^bytes=(\d{1,15})-(\d{0,15})$/.exec(value);
    const suffix = /^bytes=-(\d{1,8})$/.exec(value);
    if (suffix && Number(suffix[1]) > 0 && Number(suffix[1]) <= RANGE_BYTES) return value;
    if (!match) throw new ApiError(416, 'INVALID_MEDIA_RANGE', 'Informe um único intervalo de bytes válido.');
    const start = Number(match[1]); const end = match[2] ? Number(match[2]) : start + RANGE_BYTES - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) throw new ApiError(416, 'INVALID_MEDIA_RANGE', 'Intervalo de bytes inválido.');
    return `bytes=${start}-${Math.min(end, start + RANGE_BYTES - 1)}`;
  }
  media(token: string, requestedRange?: string, signal?: AbortSignal): Promise<StreamMedia> {
    const ticket = TOKEN.test(token) && this.tickets.get(token);
    if (!ticket || ticket.expiresAt <= Date.now()) {
      if (ticket) this.remove(token, ticket);
      return Promise.reject(new ApiError(404, 'STREAM_MEDIA_EXPIRED', 'Esta fonte expirou. Reabra o episódio.'));
    }
    let range: string | undefined;
    try {
      if (!ticket.config.enabled || !ticket.config.contentAuthorized || !ticket.config.allowedProviders.includes(ticket.provider)) throw denied();
      permittedStreamUrl(ticket.source, ticket.config); streamRequestHeaders(ticket.headers, ticket.config);
      range = this.range(ticket.kind, requestedRange);
    } catch (error) { return Promise.reject(mediaError(error)); }
    const key = `${token}:${range ?? ''}`; const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    const existing = this.pending.get(key); if (existing) return existing;
    if (this.pending.size >= 12) return Promise.reject(new ApiError(503, 'STREAM_MEDIA_BUSY', 'Há muitas mídias carregando. Tente novamente em instantes.'));
    const task = this.load(ticket, range, signal).then(value => {
      const current = this.cache.get(key);
      if (current) { this.cacheBytes -= current.value.bytes.byteLength; this.cache.delete(key); }
      while (this.cache.size >= 24 || this.cacheBytes + value.bytes.byteLength > 32_000_000) {
        const first = this.cache.entries().next().value;
        if (!first) break;
        this.cacheBytes -= first[1].value.bytes.byteLength; this.cache.delete(first[0]);
      }
      this.cache.set(key, { value, expiresAt: Date.now() + (ticket.kind === 'hls' ? 5_000 : 60_000) });
      this.cacheBytes += value.bytes.byteLength; return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  /** Verify actual media, rather than treating a returned URL or master as playable. */
  probe(path: string, signal?: AbortSignal): Promise<void> {
    const match = /^\/api\/streaming\/media\/([^/?#]+)$/.exec(path);
    const token = match?.[1]; const ticket = token && TOKEN.test(token) && this.tickets.get(token);
    if (!ticket || ticket.expiresAt <= Date.now() || !['hls', 'mp4'].includes(ticket.kind)) return Promise.reject(unavailable());
    try {
      if (!ticket.config.enabled || !ticket.config.contentAuthorized || !ticket.config.allowedProviders.includes(ticket.provider)) throw denied();
      permittedStreamUrl(ticket.source, ticket.config); streamRequestHeaders(ticket.headers, ticket.config);
    } catch (error) { return Promise.reject(mediaError(error)); }
    const probeKey = JSON.stringify([path, ticket.config.allowedMediaHosts, ticket.config.allowedStreamDomains,
      ticket.config.allowedRequestOrigins, ticket.config.allowedProviders]);
    const cached = this.probes.get(probeKey);
    if (cached && cached.expiresAt > Date.now()) return cached.error ? Promise.reject(cached.error) : Promise.resolve();
    const pending = this.pendingProbes.get(probeKey); if (pending) return pending;
    if (this.pendingProbes.size >= 12) return Promise.reject(new ApiError(503, 'STREAM_MEDIA_BUSY', 'Há muitas fontes sendo verificadas. Tente novamente em instantes.'));
    if (signal?.aborted) return Promise.reject(unavailable());
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, 8_000);
    const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true }));
    const task = Promise.race([this.probeTicket(token!, ticket.kind === 'mp4', controller.signal), aborted]).then(() => {
      this.probes.set(probeKey, { expiresAt: Math.min(ticket.expiresAt, Date.now() + 30_000) });
    }, error => {
      this.probes.set(probeKey, { expiresAt: Date.now() + 5_000, error }); throw error;
    }).finally(() => {
      clearTimeout(deadline); signal?.removeEventListener('abort', abort); this.pendingProbes.delete(probeKey);
      while (this.probes.size > 512) this.probes.delete(this.probes.keys().next().value!);
    });
    this.pendingProbes.set(probeKey, task); return task;
  }
  private async probeTicket(token: string, mp4: boolean, signal: AbortSignal): Promise<void> {
    if (mp4) {
      const content = await this.media(token, 'bytes=0-65535', signal);
      if (!isMp4(content.bytes)) throw unavailable();
      return;
    }
    for (let depth = 0; depth < 4; depth++) {
      if (signal.aborted) throw unavailable();
      const content = await this.media(token, undefined, signal);
      const lines = new TextDecoder().decode(content.bytes).split(/\r?\n/).map(line => line.trim());
      const reference = lines.find(line => line && !line.startsWith('#'));
      const child = reference && /^\/api\/streaming\/media\/([^/?#]+)$/.exec(reference)?.[1];
      const ticket = child && this.tickets.get(child);
      if (!ticket) throw unavailable();
      if (ticket.kind === 'hls') { token = child!; continue; }
      if (!['segment', 'encrypted-segment'].includes(ticket.kind) || !lines.some(line => line.startsWith('#EXTINF:'))) throw unavailable();
      const init = lines.find(line => line.startsWith('#EXT-X-MAP:'))?.match(/URI="\/api\/streaming\/media\/([^"/?#]+)"/)?.[1];
      if (ticket.kind === 'encrypted-segment') {
        if (init || !ticket.encryption) throw unsupportedEncryption();
        const key = (await this.media(ticket.encryption.keyToken, undefined, signal)).bytes;
        const encrypted = (await this.media(child!, undefined, signal)).bytes;
        try {
          const decipher = createDecipheriv('aes-128-cbc', key, ticket.encryption.iv);
          const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
          if (!isTransportStream(plain)) throw unavailable();
        } catch { throw unavailable(); }
        return;
      }
      if (init && !isMp4((await this.media(init, undefined, signal)).bytes)) throw unavailable();
      const segment = (await this.media(child!, undefined, signal)).bytes;
      if (!isTransportStream(segment) && !(init && isMp4(segment, true))) throw unavailable();
      return;
    }
    throw unavailable();
  }
  private playlist(text: string, ticket: Ticket): string {
    if (!text.replace(/^\uFEFF/, '').startsWith('#EXTM3U') || text.length > 1_000_000 || /\0/.test(text)) throw unavailable();
    let nextIsManifest = false;
    let references = 0;
    let encryption: { keyToken: string; iv?: Uint8Array } | null = null;
    let sequence = 0n, sequenceSeen = false, segmentSeen = false;
    const descendant = (raw: string, kind: MediaKind, cipher?: SegmentEncryption): string => {
      if (++references > 4096 || !raw || raw.length > 8192 || /[\r\n\0]/.test(raw)) throw unavailable();
      return this.issue(ticket.config, ticket.provider, new URL(raw, ticket.source).href, kind, ticket.headers, ticket.expiresAt, cipher);
    };
    return text.split(/\r?\n/).map(line => {
      const value = line.trim();
      if (/^#EXT-X-(?:SESSION-)?KEY\b/i.test(value)) {
        const parsed = hlsKey(value);
        if (!parsed) { encryption = null; return value; }
        if (/(?:^|\r?\n)\s*#EXT-X-(?:MAP|BYTERANGE):/.test(text)) throw unsupportedEncryption();
        const path = descendant(parsed.uri, 'key');
        encryption = { keyToken: path.split('/').at(-1)!, iv: parsed.iv };
        const rewritten = value.replace(/\bURI="[^"\r\n]*"/, `URI="${path}"`);
        // HLS.js preserves an explicit hexadecimal IV's byte length. Expand
        // short values, including zero, so WebCrypto receives all 16 bytes.
        return parsed.iv ? rewritten.replace(/\bIV=0x[0-9a-f]{1,32}(?=,|$)/i, `IV=0x${Buffer.from(parsed.iv).toString('hex')}`) : rewritten;
      }
      if (value.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        const number = value.slice('#EXT-X-MEDIA-SEQUENCE:'.length);
        if (sequenceSeen || segmentSeen || !/^\d{1,20}$/.test(number) || BigInt(number) > 0xffffffffffffffffn) throw unavailable();
        sequence = BigInt(number); sequenceSeen = true;
      }
      if (!value || value.startsWith('#') && !value.includes('URI=')) {
        if (value.startsWith('#EXT-X-STREAM-INF:')) nextIsManifest = true;
        return line;
      }
      if (!value.startsWith('#')) {
        const kind = nextIsManifest || /\.m3u8(?:[?#]|$)/i.test(value) ? 'hls' : 'segment';
        nextIsManifest = false;
        if (kind === 'hls') { if (encryption) throw unsupportedEncryption(); return descendant(value, kind); }
        segmentSeen = true;
        // HLS.js derives an omitted IV from only the low 32 sequence bits.
        // Refuse that unsupported case instead of verifying with a different IV.
        if (encryption && !encryption.iv && sequence > 0xffffffffn) throw unsupportedEncryption();
        const cipher = encryption && { keyToken: encryption.keyToken, iv: encryption.iv ?? Buffer.from(sequence.toString(16).padStart(32, '0'), 'hex') };
        if (sequence > 0xffffffffffffffffn) throw unavailable();
        sequence++;
        return descendant(value, cipher ? 'encrypted-segment' : kind, cipher || undefined);
      }
      const kind: MediaKind = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/.test(value) ? 'hls' : 'segment';
      let replaced = 0;
      const rewritten = line.replace(/\bURI="([^"\r\n]*)"/g, (_match, uri: string) => { replaced++; return `URI="${descendant(uri, kind)}"`; });
      if (!replaced || /\bURI=(?!")/.test(rewritten)) throw unavailable();
      return rewritten;
    }).join('\n');
  }
  private async load(ticket: Ticket, range?: string, signal?: AbortSignal): Promise<StreamMedia> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let response: ImageResponse | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) reject(new Error('timeout'));
        else controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      });
      const url = permittedStreamUrl(ticket.source, ticket.config);
      const records = await Promise.race([this.resolver(url.hostname), aborted]);
      if (!records.length || records.length > 32 || records.some(row => !publicImageAddress(row.address) || row.family !== isIP(row.address))) throw denied();
      const target = records.find(row => row.family === 4) ?? records[0];
      response = await Promise.race([this.transport({ url, address: target.address, family: target.family as 4 | 6,
        headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'HPmovies/2.0 (local media client)', ...ticket.headers, ...(range ? { Range: range } : {}) }, signal: controller.signal }), aborted]);
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      const length = Number(response.headers.get('content-length') ?? 0);
      const explicitRange = range && /^bytes=(\d+)-(\d+)$/.exec(range);
      const maxBytes = ticket.kind === 'key' ? 16 : ticket.kind === 'hls' ? 1_000_000 : ticket.kind === 'subtitle' ? 4_000_000
        : ticket.kind === 'mp4' ? Math.min(RANGE_BYTES, explicitRange ? Number(explicitRange[2]) - Number(explicitRange[1]) + 1 : RANGE_BYTES) : 12_000_000;
      const goodMime = ticket.kind === 'hls' ? ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl', 'text/plain', 'application/octet-stream'].includes(mime)
        : ticket.kind === 'key' ? ['application/octet-stream', 'binary/octet-stream', 'application/binary'].includes(mime)
        : ticket.kind === 'encrypted-segment' ? ['application/octet-stream', 'video/mp2t'].includes(mime)
        : ticket.kind === 'subtitle' ? ['text/vtt', 'application/x-subrip', 'text/plain', 'application/octet-stream', 'text/srt'].includes(mime)
          : BINARY_MEDIA_MIME.has(mime) || ticket.kind === 'segment';
      if ((response.status !== 200 && !(range && response.status === 206)) || !goodMime || !Number.isFinite(length) || length < 0 || length > maxBytes) throw unavailable();
      const headers: Record<string, string> = { 'Content-Type': mime, 'Cache-Control': 'private, max-age=30', 'X-Content-Type-Options': 'nosniff' };
      if (response.status === 206) {
        const contentRange = response.headers.get('content-range');
        const parsed = contentRange && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
        if (!parsed || Number(parsed[2]) < Number(parsed[1]) || Number(parsed[2]) - Number(parsed[1]) + 1 > maxBytes || Number(parsed[3]) <= Number(parsed[2])) throw unavailable();
        const requested = range && /^bytes=(\d+)-(\d+)$/.exec(range);
        if (requested && (parsed[1] !== requested[1] || Number(parsed[2]) > Number(requested[2]))) throw unavailable();
        headers['Content-Range'] = contentRange!; headers['Accept-Ranges'] = 'bytes';
      }
      const chunks: Uint8Array[] = []; let bytes = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      while (true) {
        const part = await Promise.race([iterator.next(), aborted]); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) throw unavailable(); chunks.push(part.value);
      }
      if (!bytes || length > 0 && bytes !== length) throw unavailable();
      let result = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      if (ticket.kind === 'key' && result.byteLength !== 16 || ticket.kind === 'encrypted-segment' && (result.byteLength < 16 || result.byteLength % 16 !== 0)) throw unavailable();
      // Some HLS CDNs attach unrelated MIME labels to individual TS segments.
      // Validate the complete packet sequence before correcting the type. Actual
      // HTML, scripts, stylesheets and images never pass this media sniff.
      if (ticket.kind === 'segment' && !BINARY_MEDIA_MIME.has(mime)) {
        if (result.length < 188 * 3 || result.length % 188 !== 0) throw unavailable();
        for (let position = 0; position < result.length; position += 188) if (result[position] !== 0x47) throw unavailable();
        headers['Content-Type'] = 'video/mp2t';
      }
      if (response.status === 206) {
        const expected = /^bytes (\d+)-(\d+)\//.exec(headers['Content-Range']);
        if (!expected || bytes !== Number(expected[2]) - Number(expected[1]) + 1) throw unavailable();
      }
      if (ticket.kind === 'hls') {
        result = new TextEncoder().encode(this.playlist(new TextDecoder('utf-8', { fatal: true }).decode(result), ticket));
        headers['Content-Type'] = 'application/vnd.apple.mpegurl';
      } else if (ticket.kind === 'subtitle') {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(result);
        if (!/^\uFEFF?WEBVTT(?:\s|$)/.test(text) && !/^\s*\d+\s*\r?\n\d\d:\d\d:\d\d[,.]\d{3}\s*-->/.test(text)) throw unavailable();
        headers['Content-Type'] = /^\uFEFF?WEBVTT/.test(text) ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8';
      }
      headers['Content-Length'] = String(result.byteLength);
      return { bytes: result, status: response.status as 200 | 206, headers };
    } catch (error) {
      response?.cancel();
      if (error instanceof ApiError) throw mediaError(error);
      throw new ApiError(controller.signal.aborted ? 504 : 503, 'STREAM_MEDIA_UNAVAILABLE', 'Não foi possível carregar a mídia da fonte. Escolha outra fonte ou tente novamente.');
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
}

export const streamMediaGateway = new StreamMediaGateway();
