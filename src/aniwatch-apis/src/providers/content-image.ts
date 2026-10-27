import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { ApiError } from '../config/apiError.js';
import type { TokoConfig } from '../config/integrations.js';

export interface ContentImage { bytes: Uint8Array; contentType: string; cacheControl: string }
export interface ImageRequest {
  url: URL; address: string; family: 4 | 6; headers: Record<string, string>; signal: AbortSignal;
}
export interface ImageResponse {
  status: number; headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array>; cancel(): void;
}
interface GatewayOptions {
  resolver?: (host: string) => Promise<LookupAddress[]>;
  transport?: (request: ImageRequest) => Promise<ImageResponse>;
  timeoutMs?: number;
}
interface ImageTicket {
  source: string; headers: Record<string, string>; provider: string; config: TokoConfig; expiresAt: number; key: string;
}
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 12_000_000;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const denied = () => new ApiError(503, 'CONTENT_IMAGE_NOT_PERMITTED', 'A imagem exige um domínio ou cabeçalhos que não estão permitidos para esta fonte.');

/** Accept public unicast addresses only; DNS results are pinned into the TLS connection. */
export function publicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
      && !(a === 192 && b === 0 && (c === 0 || c === 2)) && !(a === 192 && b === 88 && c === 99)
      && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
      && !(a === 203 && b === 0 && c === 113);
  }
  if (family !== 6) return false;
  // Current global unicast allocation; reject mapped/local/transition/documentation addresses.
  const value = address.toLowerCase();
  const [first, second] = value.split(':').map(part => Number.parseInt(part || '0', 16));
  return /^[23][0-9a-f]{3}:/.test(value) && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    && first !== 0x2002 && first !== 0x3fff;
}

function sourceUrl(source: string, config: TokoConfig): URL {
  let url: URL;
  try { url = new URL(source); } catch { throw denied(); }
  if (source.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !config.allowedMediaHosts.includes(url.hostname)
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)) throw denied();
  return url;
}

function permittedHeaders(input: Record<string, string>, config: TokoConfig): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (!['referer', 'origin'].includes(key) || key in result || typeof value !== 'string' || value.length > 2048 || /[\r\n\0]/.test(value)) throw denied();
    let url: URL;
    try { url = new URL(value); } catch { throw denied(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || !(config.allowedRequestOrigins ?? []).includes(url.origin) || key === 'origin' && value !== url.origin) throw denied();
    result[key] = url.href;
    if (key === 'origin') result[key] = url.origin;
  }
  return result;
}

function pinnedRequest(input: ImageRequest): Promise<ImageResponse> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = ((_hostname, options, callback) => {
      if (typeof options === 'object' && options.all) callback(null, [{ address: input.address, family: input.family }]);
      else callback(null, input.address, input.family);
    }) as LookupFunction;
    const outgoing = request(input.url, {
      method: 'GET', agent: false, lookup: pinnedLookup, signal: input.signal,
      headers: input.headers, servername: input.url.hostname,
    }, response => resolve({
      status: response.statusCode ?? 0,
      headers: { get: name => { const value = response.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(',') : value ?? null; } },
      body: response,
      cancel: () => response.destroy(),
    }));
    outgoing.once('error', reject); outgoing.end();
  });
}

export { sourceUrl as permittedContentUrl, permittedHeaders as permittedContentHeaders, pinnedRequest };

/** Images can only be issued while resolving a chapter from a configured reading provider. */
export class ContentImageGateway {
  private readonly tickets = new Map<string, ImageTicket>();
  private readonly sources = new Map<string, string>();
  private readonly pending = new Map<string, Promise<ContentImage>>();
  private readonly cached = new Map<string, { image: ContentImage; expiresAt: number }>();
  private cachedBytes = 0;
  private readonly resolver: NonNullable<GatewayOptions['resolver']>;
  private readonly transport: NonNullable<GatewayOptions['transport']>;
  private readonly timeoutMs: number;
  constructor(options: GatewayOptions = {}) {
    this.resolver = options.resolver ?? (host => lookup(host, { all: true, verbatim: true }));
    this.transport = options.transport ?? pinnedRequest;
    this.timeoutMs = options.timeoutMs ?? 14000;
  }

  issue(config: TokoConfig, provider: string, source: string, inputHeaders: Record<string, string>): string {
    if (!config.enabled || !config.contentAuthorized || !config.allowedProviders.includes(provider)) throw denied();
    const url = sourceUrl(source, config); const headers = permittedHeaders(inputHeaders, config);
    const key = createHash('sha256').update(JSON.stringify([provider, url.href, headers, config.allowedMediaHosts, config.allowedRequestOrigins])).digest('hex');
    const existing = this.sources.get(key); const remembered = existing && this.tickets.get(existing);
    if (existing && remembered && remembered.expiresAt > Date.now() + 30000) return `/api/content/image/${existing}`;
    for (const [token, ticket] of this.tickets) if (ticket.expiresAt <= Date.now()) this.remove(token, ticket);
    while (this.tickets.size >= 4096) {
      const first = this.tickets.entries().next().value;
      if (!first) break;
      this.remove(first[0], first[1]);
    }
    const token = randomUUID();
    this.tickets.set(token, { source: url.href, provider, config, headers, expiresAt: Date.now() + 15 * 60_000, key });
    this.sources.set(key, token); return `/api/content/image/${token}`;
  }
  private remove(token: string, ticket: ImageTicket) {
    this.tickets.delete(token);
    if (this.sources.get(ticket.key) === token) this.sources.delete(ticket.key);
    this.dropCached(token);
  }
  private dropCached(token: string) {
    const old = this.cached.get(token);
    if (old) { this.cachedBytes -= old.image.bytes.byteLength; this.cached.delete(token); }
  }
  image(token: string): Promise<ContentImage> {
    const ticket = TOKEN.test(token) && this.tickets.get(token);
    if (!ticket || ticket.expiresAt <= Date.now()) {
      if (ticket) this.remove(token, ticket);
      return Promise.reject(new ApiError(404, 'CONTENT_IMAGE_EXPIRED', 'A imagem expirou. Atualize o capítulo.'));
    }
    if (!ticket.config.enabled || !ticket.config.contentAuthorized || !ticket.config.allowedProviders.includes(ticket.provider)) return Promise.reject(denied());
    try { sourceUrl(ticket.source, ticket.config); permittedHeaders(ticket.headers, ticket.config); }
    catch (error) { return Promise.reject(error); }
    const cached = this.cached.get(token);
    if (cached && cached.expiresAt > Date.now()) { this.cached.delete(token); this.cached.set(token, cached); return Promise.resolve(cached.image); }
    this.dropCached(token);
    const existing = this.pending.get(token); if (existing) return existing;
    if (this.pending.size >= 8) return Promise.reject(new ApiError(503, 'CONTENT_IMAGES_BUSY', 'Há muitas imagens carregando. Tente novamente em instantes.'));
    const task = this.load(ticket).then(image => {
      while (this.cached.size >= 16 || this.cachedBytes + image.bytes.byteLength > 24_000_000) {
        const first = this.cached.keys().next().value;
        if (!first) break;
        this.dropCached(first);
      }
      this.cached.set(token, { image, expiresAt: Date.now() + 60000 }); this.cachedBytes += image.bytes.byteLength;
      return image;
    }).finally(() => this.pending.delete(token));
    this.pending.set(token, task); return task;
  }
  private async load(ticket: ImageTicket): Promise<ContentImage> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: ImageResponse | undefined;
    try {
      const url = sourceUrl(ticket.source, ticket.config);
      const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
      const records = await Promise.race([this.resolver(url.hostname), aborted]);
      if (!records.length || records.length > 32 || records.some(row => !publicImageAddress(row.address) || row.family !== isIP(row.address))) throw denied();
      const target = records.find(row => row.family === 4) ?? records[0];
      response = await Promise.race([this.transport({ url, address: target.address, family: target.family as 4 | 6,
        headers: { Accept: [...MIME].join(','), 'User-Agent': 'HPmovies/2.0 (local chapter image client)', ...ticket.headers }, signal: controller.signal }), aborted]);
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      const length = Number(response.headers.get('content-length'));
      if (response.status !== 200 || !MIME.has(mime) || !Number.isFinite(length) || length < 0 || length > MAX_BYTES) throw new ApiError(502, 'CONTENT_IMAGE_UNAVAILABLE', 'A fonte não disponibilizou esta imagem de capítulo.');
      const chunks: Uint8Array[] = []; let bytes = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      while (true) {
        const part = await Promise.race([iterator.next(), aborted]); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) throw new ApiError(502, 'CONTENT_IMAGE_TOO_LARGE', 'A imagem excede o limite de leitura.');
        chunks.push(part.value);
      }
      if (!bytes) throw new ApiError(502, 'CONTENT_IMAGE_UNAVAILABLE', 'A fonte não disponibilizou esta imagem de capítulo.');
      const result = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes: result, contentType: mime, cacheControl: 'private, max-age=60' };
    } catch (error) {
      response?.cancel();
      if (error instanceof ApiError) throw error;
      throw new ApiError(controller.signal.aborted ? 504 : 503, 'CONTENT_IMAGE_UNAVAILABLE', 'Não foi possível carregar a imagem da fonte. Atualize o capítulo e tente novamente.');
    } finally { clearTimeout(timeout); }
  }
}
