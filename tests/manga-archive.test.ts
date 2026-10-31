import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MangaArchiveJobs } from '../src/aniwatch-apis/src/providers/manga-archive';
import type { MangaArchiveJob } from '../src/shared/mangaArchive';
import type { MangaChapter, MangaChapterPage, MangaChapterPages, MangaTitle } from '../src/shared/manga';

// Synthetic source contracts. These cases do not validate live catalogs or translations.
const mangaId = '11111111-1111-4111-8111-111111111111';
const imageId = '22222222-2222-4222-8222-222222222222';
const manga: MangaTitle = { id: mangaId, title: 'História / QA', poster: '', contentRating: 'safe', availableLanguages: ['pt-br'], authors: [], tags: [], sourceUrl: `https://provider.example/title/${mangaId}`, status: 'completed' };
const chapter = (id: string, number: string | null, volume: string | null = '1', overrides: Partial<MangaChapter> = {}): MangaChapter => ({ id, mangaId, title: `Edição ${number ?? 'extra'}`, chapter: number, volume, language: 'pt-br', groups: ['Grupo QA'], pages: 1, ...overrides });
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 3, 2, 1]);
function source(chapters: MangaChapter[] = [chapter('chapter-1', '1')]) {
  return {
    home: vi.fn(), search: vi.fn(), tags: vi.fn(),
    details: vi.fn(async () => manga),
    chapters: vi.fn(async (_id: string, language = 'pt-br', page = 1): Promise<MangaChapterPage> => ({ items: chapters, page, language, total: chapters.length, hasNextPage: false })),
    pages: vi.fn(async (id: string): Promise<MangaChapterPages> => ({ chapter: chapters.find(chapter => chapter.id === id)!, pages: [`/api/manga/image/${imageId}`], sourceUrl: 'https://provider.example/chapter/1?secret=fixture' })),
    image: vi.fn(async () => ({ bytes: png, contentType: 'image/png', cacheControl: 'private' })),
  };
}
const directories: string[] = [];
const services: MangaArchiveJobs[] = [];
async function setup(provider = source(), options: Partial<ConstructorParameters<typeof MangaArchiveJobs>[0]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hpmovies-archive-test-')); directories.push(directory);
  const service = new MangaArchiveJobs({ provider, directory, ...options }); services.push(service);
  return { service, provider, directory };
}
async function settled(service: MangaArchiveJobs, id: string): Promise<MangaArchiveJob> {
  await vi.waitFor(() => expect(['ready', 'failed', 'cancelled']).toContain(service.status(id).state), { timeout: 3000, interval: 10 });
  return service.status(id);
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function unzip(path: string) {
  const bytes = await readFile(path); const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10); let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    expect(bytes.readUInt16LE(offset + 10)).toBe(0);
    const size = bytes.readUInt32LE(offset + 24); const nameSize = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString(); const local = bytes.readUInt32LE(offset + 42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const content = bytes.subarray(start, start + size);
    expect(crc32(content)).toBe(bytes.readUInt32LE(offset + 16));
    expect(entries.has(name)).toBe(false); entries.set(name, content);
    offset += 46 + nameSize + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  expect(offset).toBe(end);
  return entries;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('complete manga and volume archives', () => {
  afterEach(async () => {
    for (const service of services.splice(0)) await service.dispose();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });
  it('fetches all index pages and writes ordered volume/chapter folders with original images and credits', async () => {
    const chapters = [chapter('chapter-10', '10', '2'), chapter('chapter-2', '2', '1'), chapter('chapter-1', '1', '1'), chapter('chapter-extra', null, null)];
    const provider = source(chapters);
    provider.chapters.mockImplementation(async (_id, language, page = 1) => ({ items: page === 1 ? chapters.slice(0, 2) : chapters.slice(2), page, language: language!, total: 4, hasNextPage: page === 1 }));
    const { service } = await setup(provider);
    const plan = await service.preview(mangaId, 'pt-br');
    expect(plan.chapters.map(chapter => chapter.id)).toEqual(['chapter-1', 'chapter-2', 'chapter-10', 'chapter-extra']);
    expect(plan.volumes).toEqual([{ volume: '1', chapters: 2 }, { volume: '2', chapters: 1 }, { volume: null, chapters: 1 }]);
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    const done = await settled(service, job.id);
    expect(done).toMatchObject({ state: 'ready', totalChapters: 4, completedChapters: 4, completedPages: 4 });
    expect(done.fileUrl).toBe(`/api/manga/archives/${job.id}/file`);
    const file = await service.file(job.id); expect(file.filename).toBe('História - QA - pt-br.zip');
    const entries = await unzip(file.path);
    expect([...entries.keys()].filter(name => name.endsWith('.png'))).toEqual([
      'História - QA/Volume 001/Capítulo 001 - Edição 1/001.png',
      'História - QA/Volume 001/Capítulo 002 - Edição 2/001.png',
      'História - QA/Volume 002/Capítulo 010 - Edição 10/001.png',
      'História - QA/Volume não informado/Capítulo extra - Edição extra/001.png',
    ]);
    expect(entries.get('História - QA/Volume 001/Capítulo 001 - Edição 1/001.png')).toEqual(Buffer.from(png));
    const metadata = entries.get('História - QA/Volume 001/Capítulo 001 - Edição 1/creditos.json')!.toString();
    expect(JSON.parse(metadata)).toMatchObject({ volume: '1', chapter: '1', language: 'pt-br', credits: ['Grupo QA'] });
    expect(metadata).not.toContain('secret'); expect(file.size).toBe((await readFile(file.path)).length);
  });
  it('downloads only the selected volume and retains chapters without volume as their own selection', async () => {
    const { service, provider } = await setup(source([chapter('one', '1', '1'), chapter('two', '2', '2'), chapter('extra', null, null)]));
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'volume', volume: null });
    expect((await settled(service, job.id)).state).toBe('ready');
    expect(provider.pages.mock.calls.map(([id]) => id)).toEqual(['extra']);
    const file = await service.file(job.id); expect(file.filename).toContain('Volume não informado');
    const entries = await unzip(file.path); expect([...entries.keys()].every(name => name.includes('Volume não informado') || name.endsWith('LEIA-ME.txt'))).toBe(true);
  });
  it('produces ZIP64 records that Python zipfile opens and validates without loading a large work', async () => {
    const { service } = await setup(source(), { zip64: true });
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('ready');
    const file = await service.file(job.id);
    const bytes = await readFile(file.path);
    expect(bytes.readUInt32LE(bytes.length - 42)).toBe(0x07064b50);
    expect(bytes.readUInt16LE(bytes.length - 12)).toBe(65535);
    const result = await promisify(execFile)('python3', ['-c', 'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n print(json.dumps({"entries":z.namelist(),"valid":z.testzip() is None,"image":list(z.read(z.namelist()[0]))}))', file.path]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.image).toEqual([...png]);
  });
  it('selects one edition per numbered chapter deterministically and supports an explicit translation group', async () => {
    const chapters = [chapter('a-1', '1', '1', { groups: ['A'] }), chapter('b-1', '1', '1', { groups: ['B'] }), chapter('b-2', '2', '1', { groups: ['B'] })];
    const { service, provider } = await setup(source(chapters));
    const plan = await service.preview(mangaId, 'pt-br');
    expect(plan.chapters.map(chapter => chapter.id)).toEqual(['b-1', 'b-2']);
    expect(plan.warnings.join(' ')).toContain('1 edições alternativas');
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all', group: 'A' });
    expect((await settled(service, job.id)).state).toBe('ready');
    expect(provider.pages.mock.calls.map(([id]) => id)).toEqual(['a-1']);
  });
  it('preserves distinct extras with colliding titles and sanitizes every archive path segment', async () => {
    const chapters = [chapter('extra-a', null, '../1', { title: '../../Especial\\QA' }), chapter('extra-b', null, '../1', { title: '../../Especial\\QA' })];
    const { service } = await setup(source(chapters));
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('ready');
    const entries = await unzip((await service.file(job.id)).path);
    const images = [...entries.keys()].filter(name => name.endsWith('.png'));
    expect(images).toHaveLength(2);
    expect(images[0]).not.toBe(images[1]); expect(images[1]).toContain('(2)');
    for (const name of entries.keys()) {
      expect(name).not.toContain('..'); expect(name).not.toContain('\\'); expect(name).not.toMatch(/^\//);
    }
  });
  it('skips external editions with an explicit warning and resolves unknown page counts', async () => {
    const { service } = await setup(source([chapter('external', '1', '1', { pages: 0, externalUrl: 'https://publisher.example/1' }), chapter('unknown', '2', '1', { pages: 0 })]));
    const plan = await service.preview(mangaId, 'pt-br'); expect(plan.externalChapters).toBe(1); expect(plan.chapters.map(chapter => chapter.id)).toEqual(['unknown']);
    expect(plan.warnings.join(' ')).toContain('externas');
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('ready');
  });
  it('skips MangaDex chapters whose authoritative page count is zero and explains the omission', async () => {
    const { service, provider } = await setup(source([chapter('empty', '1', '1', { pages: 0 }), chapter('available', '2')]));
    provider.details.mockResolvedValue({ ...manga, providerId: 'mangadex' });
    const plan = await service.preview(mangaId, 'pt-br');
    expect(plan.chapters.map(chapter => chapter.id)).toEqual(['available']);
    expect(plan.warnings.join(' ')).toContain('1 capítulos informados sem páginas pelo MangaDex');
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('ready');
    expect(provider.pages.mock.calls.map(([id]) => id)).toEqual(['available']);
  });
  it('rejects wrong work, wrong language and incomplete or repeated index pagination', async () => {
    const { service, provider } = await setup(source([chapter('bad', '1', '1', { mangaId: 'another-work' })]));
    await expect(service.preview(mangaId, 'pt-br')).rejects.toMatchObject({ code: 'MANGA_ARCHIVE_IDENTITY' });
    provider.chapters.mockResolvedValue({ items: [chapter('bad', '1', '1', { language: 'en' })], language: 'pt-br', page: 1, total: 1, hasNextPage: false });
    await expect(service.preview(mangaId, 'pt-br')).rejects.toMatchObject({ code: 'MANGA_ARCHIVE_IDENTITY' });
    provider.chapters.mockImplementation(async (_id, language, page = 1) => ({ items: [chapter('repeated', '1')], language: language!, page, total: 2, hasNextPage: true }));
    await expect(service.preview(mangaId, 'pt-br')).rejects.toMatchObject({ code: 'MANGA_ARCHIVE_INDEX' });
  });
  it('does not offer a partial archive when chapter resolution returns another edition', async () => {
    const { service, provider, directory } = await setup();
    provider.pages.mockResolvedValue({ chapter: chapter('wrong-id', '1'), pages: [`/api/manga/image/${imageId}`], sourceUrl: 'https://provider.example/1' });
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('failed');
    await expect(service.file(job.id)).rejects.toMatchObject({ code: 'MANGA_ARCHIVE_NOT_READY' });
    expect(provider.image).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual([]);
  });
  it.each(['https://attacker.example/image.png', '/api/content/image/not-a-ticket', '/api/manga/image/not-a-ticket'])('rejects unissued or arbitrary image path %s', async page => {
    const { service, provider } = await setup();
    provider.pages.mockResolvedValue({ chapter: chapter('chapter-1', '1'), pages: [page], sourceUrl: 'https://provider.example/1' });
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('failed'); expect(provider.image).not.toHaveBeenCalled();
  });
  it('rejects non-image payloads and respects byte and page limits', async () => {
    const { service, provider } = await setup(source(), { maxBytes: 100 });
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('failed');
    const limited = await setup(source(), { maxPages: 0 });
    const tooMany = await limited.service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(limited.service, tooMany.id)).state).toBe('failed'); expect(limited.provider.pages).not.toHaveBeenCalled();
    provider.image.mockResolvedValue({ bytes: Buffer.from('<html>bad</html>'), contentType: 'image/png', cacheControl: '' });
    const invalid = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, invalid.id)).state).toBe('failed');
  });
  it('cancels immediately while an image is pending, discards its late response and releases its job slot', async () => {
    const pending = deferred<Awaited<ReturnType<ReturnType<typeof source>['image']>>>();
    const { service, provider, directory } = await setup(source([chapter('one', '1'), chapter('two', '2')]), { maxJobs: 1 });
    provider.image.mockReturnValueOnce(pending.promise);
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    await vi.waitFor(() => expect(provider.image).toHaveBeenCalledOnce());
    expect(service.cancel(job.id).state).toBe('cancelled');
    await expect(service.file(job.id)).rejects.toMatchObject({ code: 'MANGA_ARCHIVE_NOT_READY' });
    pending.resolve({ bytes: png, contentType: 'image/png', cacheControl: '' });
    await vi.waitFor(() => expect(provider.pages).toHaveBeenCalledTimes(1));
    const next = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, next.id)).state).toBe('ready');
    expect((await readdir(directory)).length).toBe(1);
  });
  it('enforces concurrent job slots and rejects broad language or unknown jobs', async () => {
    const pending = deferred<MangaTitle>(); const provider = source(); provider.details.mockReturnValue(pending.promise);
    const { service } = await setup(provider, { maxJobs: 1 });
    const outcomes = await Promise.allSettled([service.start({ mangaId, language: 'pt-br', scope: 'all' }), service.start({ mangaId, language: 'pt-br', scope: 'all' })]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(() => service.status('../../etc/passwd')).toThrow('expirou');
    await expect(service.preview(mangaId, 'all')).rejects.toMatchObject({ code: 'MANGA_ARCHIVE_LANGUAGE' });
    pending.resolve(manga);
  });
  it('expires prepared files and cleans temporary directories on disposal', async () => {
    const { service, directory } = await setup(source(), { ttlMs: 150 });
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    expect((await settled(service, job.id)).state).toBe('ready');
    await vi.waitFor(() => expect(() => service.status(job.id)).toThrow('expirou'), { timeout: 1000 });
    await vi.waitFor(async () => expect(await readdir(directory)).toEqual([]), { timeout: 1000 });
    await service.dispose();
    await expect(service.start({ mangaId, language: 'pt-br', scope: 'all' })).rejects.toMatchObject({ code: 'MANGA_ARCHIVE_UNAVAILABLE' });
  });
  it('renews inactivity expiry as pages arrive so an active work may take longer than one TTL', async () => {
    const { service, provider } = await setup(source(), { ttlMs: 300 });
    provider.pages.mockResolvedValue({ chapter: chapter('chapter-1', '1', '1', { pages: 6 }), pages: Array.from({ length: 6 }, () => `/api/manga/image/${imageId}`), sourceUrl: 'https://provider.example/1' });
    provider.image.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return { bytes: png, contentType: 'image/png', cacheControl: 'private' };
    });
    const started = Date.now();
    const job = await service.start({ mangaId, language: 'pt-br', scope: 'all' });
    const done = await settled(service, job.id);
    expect(Date.now() - started).toBeGreaterThan(300);
    expect(done).toMatchObject({ state: 'ready', completedPages: 6 });
    expect((await service.file(job.id)).size).toBeGreaterThan(0);
  });
});
