import { randomUUID } from 'node:crypto';
import { open, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MangaArchiveJob, MangaArchivePlan, MangaArchiveRequest } from '../../../shared/mangaArchive.js';
import type { MangaCatalogProvider, MangaChapter, MangaChapterProvider, MangaImageProvider } from '../../../shared/manga.js';
import { ApiError } from '../config/apiError.js';

type Provider = MangaCatalogProvider & MangaChapterProvider & MangaImageProvider;
interface Options {
  provider: Provider;
  directory?: string;
  maxBytes?: number;
  maxPageBytes?: number;
  maxPages?: number;
  maxChapters?: number;
  maxJobs?: number;
  ttlMs?: number;
  /** Force ZIP64 records even for small archives, useful for compatibility checks. */
  zip64?: boolean;
}
interface InternalJob {
  view: MangaArchiveJob;
  directory: string;
  path: string;
  filename: string;
  controller: AbortController;
  expiresAt: number;
  task?: Promise<void>;
}
interface ZipEntry { name: Buffer; crc: number; size: number; offset: number }
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const IMAGE_TICKET = /^\/api\/manga\/image\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const UINT32 = 0xffffffff;
const natural = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const imageExtensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = byte & 1 ? 0xedb88320 ^ byte >>> 1 : byte >>> 1;
  return byte >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
const archiveError = (code: string, message: string, status: 400 | 404 | 502 | 503 = 400) => new ApiError(status, code, message);
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Download cancelado.', 'AbortError'); };
const clean = (value: string, fallback: string) => {
  let result = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '-').replace(/[/\\<>:"|?*]/g, '-').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100);
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `Mangá - ${result}`;
  return result || fallback;
};
const padded = (value: string) => /^\d+$/.test(value) ? value.padStart(3, '0') : value;
const volumePath = (volume: string | null) => volume === null ? 'Volume não informado' : `Volume ${clean(padded(volume), 'não informado')}`;
const chapterOrder = (a: MangaChapter, b: MangaChapter) => (a.volume === b.volume ? 0 : a.volume === null ? 1 : b.volume === null ? -1 : natural.compare(a.volume, b.volume)) || natural.compare(a.chapter ?? '', b.chapter ?? '') || natural.compare(a.title, b.title) || a.id.localeCompare(b.id);
function imageMatches(mime: string, bytes: Uint8Array) {
  const text = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString('ascii');
  if (mime === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(text(0, 6));
  if (mime === 'image/webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  return mime === 'image/avif' && text(4, 8) === 'ftyp' && /avif|avis/.test(text(8, 32));
}

/** Store entries sequentially on disk. ZIP64 central records support large complete works. */
class DiskZip {
  private readonly entries: ZipEntry[] = [];
  private offset = 0;
  constructor(private readonly file: FileHandle, private readonly maxBytes: number, private readonly forceZip64: boolean) {}
  private async write(bytes: Uint8Array) {
    if (this.offset + bytes.byteLength > this.maxBytes) throw archiveError('MANGA_ARCHIVE_LIMIT', 'O arquivo excede o limite de tamanho permitido para um download.');
    let written = 0;
    while (written < bytes.byteLength) {
      const result = await this.file.write(bytes, written, bytes.byteLength - written, this.offset);
      if (!result.bytesWritten) throw new Error('Arquivo temporário sem espaço para escrita.');
      written += result.bytesWritten;
      this.offset += result.bytesWritten;
    }
  }
  async add(path: string, bytes: Uint8Array) {
    const name = Buffer.from(path, 'utf8');
    if (name.length > 65535 || bytes.byteLength >= UINT32) throw archiveError('MANGA_ARCHIVE_LIMIT', 'Uma entrada excede o limite do arquivo.');
    const entry = { name, crc: crc32(bytes), size: bytes.byteLength, offset: this.offset };
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); header.writeUInt32LE(entry.crc, 14); header.writeUInt32LE(entry.size, 18); header.writeUInt32LE(entry.size, 22); header.writeUInt16LE(name.length, 26); name.copy(header, 30);
    await this.write(header); await this.write(bytes); this.entries.push(entry);
  }
  async finish() {
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      const largeOffset = this.forceZip64 || entry.offset >= UINT32;
      const extra = largeOffset ? Buffer.alloc(12) : Buffer.alloc(0);
      if (largeOffset) { extra.writeUInt16LE(1); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(entry.offset), 4); }
      const header = Buffer.alloc(46 + entry.name.length + extra.length);
      header.writeUInt32LE(0x02014b50); header.writeUInt16LE(largeOffset ? 45 : 20, 4); header.writeUInt16LE(largeOffset ? 45 : 20, 6); header.writeUInt16LE(0x800, 8);
      header.writeUInt16LE(0x21, 14); header.writeUInt32LE(entry.crc, 16); header.writeUInt32LE(entry.size, 20); header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28); header.writeUInt16LE(extra.length, 30); header.writeUInt32LE(largeOffset ? UINT32 : entry.offset, 42);
      entry.name.copy(header, 46); extra.copy(header, 46 + entry.name.length); await this.write(header);
    }
    const centralSize = this.offset - centralOffset;
    const zip64 = this.forceZip64 || this.entries.length >= 65535 || centralOffset >= UINT32 || centralSize >= UINT32;
    if (zip64) {
      const recordOffset = this.offset;
      const record = Buffer.alloc(56);
      record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
      record.writeBigUInt64LE(BigInt(this.entries.length), 24); record.writeBigUInt64LE(BigInt(this.entries.length), 32); record.writeBigUInt64LE(BigInt(centralSize), 40); record.writeBigUInt64LE(BigInt(centralOffset), 48);
      await this.write(record);
      const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(recordOffset), 8); locator.writeUInt32LE(1, 16); await this.write(locator);
    }
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(zip64 ? 65535 : this.entries.length, 8); end.writeUInt16LE(zip64 ? 65535 : this.entries.length, 10);
    end.writeUInt32LE(zip64 ? UINT32 : centralSize, 12); end.writeUInt32LE(zip64 ? UINT32 : centralOffset, 16); await this.write(end);
    return this.offset;
  }
}

export class MangaArchiveJobs {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly provider: Provider;
  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly maxPageBytes: number;
  private readonly maxPages: number;
  private readonly maxChapters: number;
  private readonly maxJobs: number;
  private readonly ttlMs: number;
  private readonly zip64: boolean;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private reservations = 0;
  constructor(options: Options) {
    this.provider = options.provider;
    this.directory = options.directory ?? tmpdir();
    this.maxBytes = options.maxBytes ?? 20 * 1024 ** 3;
    this.maxPageBytes = options.maxPageBytes ?? 20 * 1024 ** 2;
    this.maxPages = options.maxPages ?? 50_000;
    this.maxChapters = options.maxChapters ?? 10_000;
    this.maxJobs = options.maxJobs ?? 2;
    this.ttlMs = options.ttlMs ?? 60 * 60_000;
    this.zip64 = options.zip64 ?? false;
  }
  private ensureCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => { void this.cleanup(); }, Math.min(60_000, Math.max(100, this.ttlMs)));
    this.cleanupTimer.unref();
  }
  private language(value: string) {
    const language = value.toLowerCase();
    if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(language) || language === 'all' || language === 'pt') throw archiveError('MANGA_ARCHIVE_LANGUAGE', 'Escolha um idioma específico, como português brasileiro, para baixar a obra.');
    return language;
  }
  private async listing(mangaId: string, requestedLanguage: string, group?: string, signal?: AbortSignal, onActivity?: () => void): Promise<MangaArchivePlan> {
    if (signal) checkAbort(signal);
    const language = this.language(requestedLanguage);
    if (mangaId.length > 220 || !mangaId || /[\s/\\\0]/.test(mangaId)) throw archiveError('INVALID_MANGA_ID', 'Identificador de mangá inválido.');
    if (group !== undefined && (!group.trim() || group.length > 200 || /\p{Cc}/u.test(group))) throw archiveError('INVALID_MANGA_GROUP', 'Grupo de tradução inválido.');
    const manga = await this.provider.details(mangaId);
    if (signal) checkAbort(signal);
    onActivity?.();
    if (manga.id !== mangaId) throw archiveError('MANGA_ARCHIVE_IDENTITY', 'A fonte retornou outra obra.', 502);
    const all: MangaChapter[] = [];
    const ids = new Set<string>();
    for (let page = 1; page <= 1000; page++) {
      if (signal) checkAbort(signal);
      const listing = await this.provider.chapters(mangaId, language, page);
      if (signal) checkAbort(signal);
      onActivity?.();
      if (listing.page !== page || !Array.isArray(listing.items)) throw archiveError('MANGA_ARCHIVE_INDEX', 'A fonte não confirmou a paginação completa dos capítulos.', 502);
      let added = 0;
      for (const chapter of listing.items) {
        if (chapter.mangaId !== mangaId || chapter.language.toLowerCase() !== language) throw archiveError('MANGA_ARCHIVE_IDENTITY', 'A lista contém capítulos de outra obra ou idioma.', 502);
        if (ids.has(chapter.id)) continue;
        if (all.length >= this.maxChapters) throw archiveError('MANGA_ARCHIVE_LIMIT', 'A obra excede o limite de capítulos por download.');
        ids.add(chapter.id); all.push(chapter); added++;
      }
      if (!listing.hasNextPage) break;
      if (!added || page === 1000) throw archiveError('MANGA_ARCHIVE_INDEX', 'A fonte não confirmou a lista completa de capítulos. Tente novamente.', 502);
    }
    // MangaDex reports an authoritative page count. Other sources may only know
    // the count after resolving the chapter, so their zero means "not known yet".
    let knownPageCounts = manga.providerId === 'mangadex';
    try { knownPageCounts ||= new URL(manga.sourceUrl).hostname === 'mangadex.org'; } catch { /* Provider identity is enough when present. */ }
    const knownEmptyChapters = all.filter(chapter => !chapter.externalUrl && chapter.pages === 0 && knownPageCounts && (!group || chapter.groups.includes(group))).length;
    const candidates = all.filter(chapter => !chapter.externalUrl && (!knownPageCounts || chapter.pages > 0) && (!group || chapter.groups.includes(group)));
    const groupCounts = new Map<string, number>();
    for (const chapter of candidates) for (const credit of chapter.groups) groupCounts.set(credit, (groupCounts.get(credit) ?? 0) + 1);
    const groups = [...groupCounts.keys()].sort((a, b) => (groupCounts.get(b)! - groupCounts.get(a)!) || natural.compare(a, b));
    const preferred = group ?? groups[0];
    const selected = new Map<string, MangaChapter>();
    for (const chapter of candidates.sort((a, b) => Number(b.groups.includes(preferred)) - Number(a.groups.includes(preferred)) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.id.localeCompare(b.id))) {
      const key = chapter.chapter === null ? `extra:${chapter.id}` : JSON.stringify([chapter.volume, chapter.chapter]);
      if (!selected.has(key)) selected.set(key, chapter);
    }
    const chapters = [...selected.values()].sort(chapterOrder);
    const volumes = [...new Set(chapters.map(chapter => chapter.volume))].map(volume => ({ volume, chapters: chapters.filter(chapter => chapter.volume === volume).length }));
    const externalChapters = all.filter(chapter => !!chapter.externalUrl).length;
    const warnings: string[] = [];
    if (knownEmptyChapters) warnings.push(`${knownEmptyChapters} capítulos informados sem páginas pelo MangaDex não entram no ZIP.`);
    const alternateEditions = candidates.length - chapters.length;
    if (alternateEditions) warnings.push(`${alternateEditions} edições alternativas do mesmo número de capítulo não entram no ZIP. Mantemos uma edição por número e volume.`);
    if (preferred) warnings.push(group ? `Somente edições do grupo ${group}.` : `Uma edição por capítulo. Priorizamos ${preferred}; capítulos ausentes nesse grupo usam outra edição disponível, com os créditos preservados.`);
    if (externalChapters) warnings.push(`${externalChapters} edições externas abrem no provedor e não entram no ZIP.`);
    if (chapters.some(chapter => chapter.volume === null)) warnings.push('Capítulos sem volume informado ficam na pasta “Volume não informado”.');
    if (manga.status !== 'completed') warnings.push('O ZIP reúne os capítulos disponíveis agora. Novos capítulos publicados depois não são incluídos automaticamente.');
    return { mangaId, title: manga.title, language, chapters, volumes, externalChapters, groups, warnings };
  }
  preview(mangaId: string, language: string): Promise<MangaArchivePlan> { return this.listing(mangaId, language); }
  async start(request: MangaArchiveRequest): Promise<MangaArchiveJob> {
    if (this.disposed) throw archiveError('MANGA_ARCHIVE_UNAVAILABLE', 'O serviço de download foi encerrado.', 503);
    await this.cleanup();
    if (!['all', 'volume'].includes(request.scope) || request.scope === 'volume' && request.volume === undefined) throw archiveError('INVALID_MANGA_ARCHIVE', 'Escolha a obra inteira ou um volume.');
    if (request.volume !== undefined && request.volume !== null && (typeof request.volume !== 'string' || !request.volume.trim() || request.volume.length > 100)) throw archiveError('INVALID_MANGA_ARCHIVE', 'Volume inválido.');
    if (this.jobs.size + this.reservations >= this.maxJobs) throw archiveError('MANGA_ARCHIVE_BUSY', 'Há downloads preparados ou em andamento. Cancele um deles ou aguarde a expiração.', 503);
    this.reservations++;
    const id = randomUUID();
    try {
      await mkdir(this.directory, { recursive: true });
      const directory = await mkdtemp(join(this.directory, 'hpmovies-manga-'));
      if (this.disposed) { await rm(directory, { recursive: true, force: true }); throw archiveError('MANGA_ARCHIVE_UNAVAILABLE', 'O serviço de download foi encerrado.', 503); }
      const job: InternalJob = { view: { id, state: 'queued', title: '', completedChapters: 0, totalChapters: 0, completedPages: 0, bytes: 0, message: 'Buscando todos os capítulos…' }, directory, path: join(directory, 'archive.zip'), filename: 'Mangá.zip', controller: new AbortController(), expiresAt: Date.now() + this.ttlMs };
      this.jobs.set(id, job);
      this.ensureCleanupTimer();
      job.task = this.run(job, request);
      return { ...job.view };
    } finally { this.reservations--; }
  }
  status(id: string): MangaArchiveJob { return { ...this.get(id).view }; }
  cancel(id: string): MangaArchiveJob {
    const job = this.get(id); job.controller.abort();
    job.view.state = 'cancelled'; job.view.message = 'Download cancelado. Nenhum arquivo parcial foi disponibilizado.'; delete job.view.fileUrl;
    void rm(job.directory, { recursive: true, force: true }).catch(() => undefined);
    // Keep a short-lived status while freeing the bounded slot for a fresh request.
    job.expiresAt = Math.min(job.expiresAt, Date.now() + 30_000);
    return { ...job.view };
  }
  async file(id: string): Promise<{ path: string; filename: string; size: number }> {
    const job = this.get(id);
    if (job.view.state !== 'ready') throw archiveError('MANGA_ARCHIVE_NOT_READY', 'O arquivo completo ainda não está disponível.');
    const metadata = await stat(job.path).catch(() => { throw archiveError('MANGA_ARCHIVE_EXPIRED', 'O arquivo expirou. Prepare o download novamente.', 404); });
    return { path: job.path, filename: job.filename, size: metadata.size };
  }
  private get(id: string): InternalJob {
    const job = UUID.test(id) && this.jobs.get(id);
    if (!job || job.expiresAt <= Date.now()) throw archiveError('MANGA_ARCHIVE_EXPIRED', 'O download expirou ou não foi encontrado.', 404);
    return job;
  }
  private async cleanup() {
    for (const [id, job] of this.jobs) if (job.expiresAt <= Date.now() || job.view.state === 'cancelled' || job.view.state === 'failed') {
      job.controller.abort(); this.jobs.delete(id); await rm(job.directory, { recursive: true, force: true }).catch(() => undefined);
    }
    if (!this.jobs.size && !this.reservations && this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = undefined; }
  }
  private async run(job: InternalJob, request: MangaArchiveRequest) {
    let handle: FileHandle | undefined;
    const signal = job.controller.signal;
    const touch = () => { job.expiresAt = Date.now() + this.ttlMs; };
    try {
      const plan = await this.listing(request.mangaId, request.language, request.group, signal, touch); checkAbort(signal); touch();
      const chapters = request.scope === 'volume' ? plan.chapters.filter(chapter => chapter.volume === request.volume) : plan.chapters;
      if (!chapters.length) throw archiveError('MANGA_ARCHIVE_EMPTY', 'Nenhum capítulo com páginas está disponível nessa seleção.');
      if (chapters.reduce((count, chapter) => count + chapter.pages, 0) > this.maxPages) throw archiveError('MANGA_ARCHIVE_LIMIT', 'A seleção excede o limite de páginas por download.');
      job.view.title = plan.title; job.view.totalChapters = chapters.length; job.view.state = 'downloading';
      job.filename = `${clean(plan.title, 'Mangá')}${request.scope === 'volume' ? ` - ${volumePath(request.volume!)}` : ''} - ${plan.language}.zip`;
      handle = await open(job.path, 'wx'); const zip = new DiskZip(handle, this.maxBytes, this.zip64);
      const root = clean(plan.title, 'Mangá'); const paths = new Set<string>();
      for (const chapter of chapters) {
        checkAbort(signal);
        job.view.message = `Baixando ${chapter.title} (${job.view.completedChapters + 1} de ${chapters.length})…`;
        const content = await this.provider.pages(chapter.id); checkAbort(signal); touch();
        if (content.chapter.id !== chapter.id || content.chapter.mangaId !== plan.mangaId || content.chapter.language.toLowerCase() !== plan.language
          || content.chapter.volume !== chapter.volume || content.chapter.chapter !== chapter.chapter || content.chapter.externalUrl
          || request.group && !content.chapter.groups.includes(request.group)) throw archiveError('MANGA_ARCHIVE_IDENTITY', 'A fonte retornou outra edição de capítulo. Nenhum arquivo parcial foi disponibilizado.', 502);
        if (!content.pages.length) throw archiveError('MANGA_ARCHIVE_EMPTY', 'Um capítulo não disponibilizou suas páginas. Atualize a lista e tente novamente.', 502);
        if (job.view.completedPages + content.pages.length > this.maxPages) throw archiveError('MANGA_ARCHIVE_LIMIT', 'A seleção excede o limite de páginas por download.');
        const base = `${root}/${volumePath(chapter.volume)}/Capítulo ${clean(chapter.chapter === null ? 'extra' : padded(chapter.chapter), 'extra')} - ${clean(chapter.title, 'Sem título')}`;
        let path = base; let suffix = 2; while (paths.has(path.toLowerCase())) path = `${base} (${suffix++})`; paths.add(path.toLowerCase());
        for (let index = 0; index < content.pages.length; index++) {
          checkAbort(signal);
          const match = IMAGE_TICKET.exec(content.pages[index]);
          if (!match) throw archiveError('MANGA_ARCHIVE_IMAGE', 'A fonte retornou uma imagem fora do acesso permitido para download.', 502);
          const image = await this.provider.image(match[1]); checkAbort(signal); touch();
          const mime = image.contentType.split(';')[0].trim().toLowerCase();
          if (!imageExtensions[mime] || !image.bytes.byteLength || image.bytes.byteLength > this.maxPageBytes || !imageMatches(mime, image.bytes)) throw archiveError('MANGA_ARCHIVE_IMAGE', 'A fonte retornou uma imagem inválida ou acima do limite por página.', 502);
          await zip.add(`${path}/${String(index + 1).padStart(3, '0')}.${imageExtensions[mime]}`, image.bytes); checkAbort(signal);
          job.view.completedPages++; job.view.bytes += image.bytes.byteLength; touch();
        }
        const metadata = Buffer.from(JSON.stringify({ title: plan.title, chapterTitle: chapter.title, chapter: chapter.chapter, volume: chapter.volume, language: chapter.language, credits: content.chapter.groups, pages: content.pages.length }, null, 2));
        await zip.add(`${path}/creditos.json`, metadata); checkAbort(signal); job.view.completedChapters++; touch();
      }
      await zip.add(`${root}/LEIA-ME.txt`, Buffer.from(`Obra: ${plan.title}\nIdioma: ${plan.language}\nCapítulos: ${chapters.length}\nOrganização: Volume / Capítulo / páginas em ordem.\n\n${plan.warnings.join('\n')}\n`));
      const size = await zip.finish(); checkAbort(signal); await handle.close(); handle = undefined;
      job.view.bytes = size; job.view.state = 'ready'; job.view.message = 'ZIP completo preparado. Baixe o arquivo para salvar os volumes e capítulos.'; job.view.fileUrl = `/api/manga/archives/${job.view.id}/file`;
      job.expiresAt = Date.now() + this.ttlMs;
    } catch (error) {
      job.view.state = signal.aborted ? 'cancelled' : 'failed';
      job.view.message = signal.aborted ? 'Download cancelado. Nenhum arquivo parcial foi disponibilizado.' : error instanceof ApiError ? error.message : 'Não foi possível preparar o mangá completo. Confira a fonte e tente novamente.';
      delete job.view.fileUrl;
      await handle?.close().catch(() => undefined); handle = undefined;
      await rm(job.directory, { recursive: true, force: true }).catch(() => undefined);
    } finally { await handle?.close().catch(() => undefined); }
  }
  async dispose() {
    this.disposed = true; clearInterval(this.cleanupTimer);
    for (const job of this.jobs.values()) job.controller.abort();
    // Provider operations can be non-abortable. Their late results are discarded by run().
    await Promise.all([...this.jobs.values()].map(job => rm(job.directory, { recursive: true, force: true }).catch(() => undefined)));
    this.jobs.clear();
  }
}
