import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMangaArchive } from '../src/frontend/services/mangaDownload';
import type { MangaDownloadInput } from '../src/frontend/services/mangaDownload';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const jpeg = Uint8Array.from([255, 216, 255, 224, 4, 5, 6]);
const input: MangaDownloadInput = {
  title: 'Ação & aventura', chapterTitle: 'Capítulo <1>', language: 'pt-br',
  pages: ['https://images.example.org/page-two', 'https://images.example.org/page-one'],
  sourceUrl: 'https://provider.example.org/chapter/1?token=private#fragment', credits: ['Tradução "QA"'],
};
const image = (body = png, mime = 'image/png') => new Response(body, { headers: { 'Content-Type': mime } });
const decoder = new TextDecoder();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function unzip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  expect(view.getUint32(end + 12, true) + centralOffset).toBe(end);
  let offset = centralOffset;
  const entries: { name: string; bytes: Uint8Array }[] = [];
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(view.getUint16(offset + 10, true)).toBe(0);
    expect(view.getUint16(offset + 8, true)).toBe(0x800);
    const length = view.getUint16(offset + 28, true); const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + length));
    const size = view.getUint32(offset + 24, true); const local = view.getUint32(offset + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 18, true)).toBe(size);
    expect(view.getUint32(offset + 20, true)).toBe(size);
    const localNameSize = view.getUint16(local + 26, true);
    expect(decoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize))).toBe(name);
    const start = local + 30 + localNameSize; const body = bytes.subarray(start, start + size);
    expect(view.getUint32(local + 14, true)).toBe(crc32(body));
    expect(view.getUint32(offset + 16, true)).toBe(crc32(body));
    entries.push({ name, bytes: body }); offset += 46 + length;
  }
  expect(offset).toBe(end);
  return entries;
}

describe('manga CBZ download', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });
  it('preserves page bytes and chapter order in a valid ZIP with credits and source metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(image()).mockResolvedValueOnce(image(jpeg, 'image/jpeg; charset=binary'));
    const progress = vi.fn();
    const result = await createMangaArchive(input, { fetcher, onProgress: progress });
    expect(result.blob.type).toBe('application/vnd.comicbook+zip');
    const entries = await unzip(result.blob);
    expect(entries.map(entry => entry.name)).toEqual(['001.png', '002.jpg', 'ComicInfo.xml']);
    expect(entries[0].bytes).toEqual(png); expect(entries[1].bytes).toEqual(jpeg);
    const metadata = decoder.decode(entries[2].bytes);
    expect(metadata).toContain('<Title>Capítulo &lt;1&gt;</Title>');
    expect(metadata).toContain('<Series>Ação &amp; aventura</Series>');
    expect(metadata).toContain('<LanguageISO>pt-br</LanguageISO>');
    expect(metadata).toContain('<Translator>Tradução &quot;QA&quot;</Translator>');
    expect(metadata).toContain('<Web>https://provider.example.org/chapter/1</Web>');
    expect(metadata).not.toContain('private');
    expect(result.filename).toBe('Ação & aventura - Capítulo -1- - pt-br.cbz');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(input.pages);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([{ completed: 0, total: 2 }, { completed: 1, total: 2 }, { completed: 2, total: 2 }]);
  });
  it('verifies signatures across stream chunks and preserves sequential fetch order', async () => {
    let active = false;
    const fetcher = vi.fn<typeof fetch>(async () => {
      expect(active).toBe(false); active = true;
      let count = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (count === 0) controller.enqueue(png.slice(0, 3));
        else if (count === 1) controller.enqueue(png.slice(3));
        else { active = false; controller.close(); }
        count++;
      } }), { headers: { 'Content-Type': 'image/png' } });
    });
    const archive = await createMangaArchive(input, { fetcher });
    expect((await unzip(archive.blob))[0].bytes).toEqual(png);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['text/html', '<html>Not an image</html>', 'imagem compatível'],
    ['image/svg+xml', '<svg/>', 'imagem compatível'],
    ['image/png', '<html>Incorrect content type</html>', 'imagem válida'],
    ['image/jpeg', '', 'está vazia'],
  ])('rejects %s responses containing %s', async (mime, body, message) => {
    await expect(createMangaArchive({ ...input, pages: input.pages.slice(0, 1) }, { fetcher: vi.fn(async () => new Response(body, { headers: { 'Content-Type': mime } })) })).rejects.toThrow(message);
  });
  it('rejects failed HTTP pages and never returns a partial archive', async () => {
    const cancel = vi.fn();
    const failedBody = new ReadableStream({ cancel });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(image()).mockResolvedValueOnce(new Response(failedBody, { status: 503 }));
    const progress = vi.fn();
    await expect(createMangaArchive(input, { fetcher, onProgress: progress })).rejects.toThrow('página 2 (503)');
    expect(progress.mock.calls.at(-1)?.[0]).toEqual({ completed: 1, total: 2 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects empty and excessively long chapters before requesting pages', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createMangaArchive({ ...input, pages: [] }, { fetcher })).rejects.toThrow('não tem páginas');
    await expect(createMangaArchive({ ...input, pages: Array.from({ length: 501 }, () => input.pages[0]) }, { fetcher })).rejects.toThrow('500 páginas');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('stops oversized declared images before reading their body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(20 * 1024 * 1024 + 1) } }));
    await expect(createMangaArchive(input, { fetcher })).rejects.toThrow('20 MB por página');
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('bounds streamed images even when Content-Length is missing', async () => {
    let chunk = 0; const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ pull(controller) {
      const bytes = chunk++ ? new Uint8Array(1) : new Uint8Array(20 * 1024 * 1024);
      if (bytes.length > 8) bytes.set(png); controller.enqueue(bytes);
    }, cancel }), { headers: { 'Content-Type': 'image/png' } }));
    await expect(createMangaArchive(input, { fetcher })).rejects.toThrow('20 MB por página');
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('cancels a chapter without downloading further pages', async () => {
    const controller = new AbortController(); const fetcher = vi.fn<typeof fetch>(async () => image());
    await expect(createMangaArchive(input, { fetcher, signal: controller.signal, onProgress(progress) { if (progress.completed === 1) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(createMangaArchive(input, { fetcher, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('cancels an active body read promptly', async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/png' } }));
    const pending = createMangaArchive(input, { fetcher, signal: controller.signal });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('times out a stalled image and never starts the next request', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const pending = expect(createMangaArchive(input, { fetcher })).rejects.toThrow('página 1 demorou');
    await vi.advanceTimersByTimeAsync(30_000); await pending;
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['/admin/private', 'javascript:alert(1)', 'http://images.example.org/a.png', 'https://127.0.0.1/private', 'https://localhost/private', 'https://media.local/private', 'https://user:secret@images.example.org/a.png'])('rejects unsafe image address %s before fetching', async url => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createMangaArchive({ ...input, pages: [url] }, { fetcher })).rejects.toThrow(/endereço de página/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts scoped tickets on a separately configured local backend', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4000'); vi.resetModules();
    const { createMangaArchive: configured } = await import('../src/frontend/services/mangaDownload');
    const token = '11111111-1111-4111-8111-111111111111';
    const fetcher = vi.fn<typeof fetch>(async () => image());
    await configured({ ...input, pages: [`/api/manga/image/${token}`, `http://localhost:4000/api/content/image/${token}`] }, { fetcher });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`http://localhost:4000/api/manga/image/${token}`, `http://localhost:4000/api/content/image/${token}`]);
    await expect(configured({ ...input, pages: [`http://localhost:4001/api/content/image/${token}`] }, { fetcher })).rejects.toThrow('não permitido');
  });
  it('sanitizes filenames and excludes executable source links from metadata', async () => {
    const result = await createMangaArchive({ ...input, title: '../Ação/../../CON', chapterTitle: '\u0000<Capítulo>: "1"', sourceUrl: 'javascript:alert(1)' }, { fetcher: vi.fn(async () => image()) });
    expect(result.filename).not.toMatch(/\p{Cc}/u); expect(result.filename).not.toMatch(/[/\\<>:"|?*]/); expect(result.filename).not.toContain('..'); expect(result.filename).toContain('Ação');
    const entries = await unzip(result.blob);
    expect(decoder.decode(entries.at(-1)!.bytes)).not.toContain('<Web>');
  });
});
