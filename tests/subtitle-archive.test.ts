import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractSubtitleArchive, MAX_SUBTITLE_ARCHIVE_BYTES, MAX_SUBTITLE_ARCHIVE_OUTPUT_BYTES } from '../src/aniwatch-apis/src/providers/subtitle-archive';
import { subtitleToVtt } from '../src/shared/subtitles';

const srt = '1\n00:00:01,000 --> 00:00:03,000\nLegenda original de teste em português.\n';

function checksum(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface FixtureEntry {
  name?: string;
  body?: string | Buffer;
  method?: number;
  flags?: number;
  extra?: Buffer;
  declaredSize?: number;
  attributes?: number;
  descriptor?: boolean;
}

/** ZIPs contain only original test text, generated without external fixtures. */
function archive(files: FixtureEntry[] = [{}]): Buffer {
  const localParts: Buffer[] = [], centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.from(file.body ?? srt), name = Buffer.from(file.name ?? 'legenda.srt'), extra = file.extra ?? Buffer.alloc(0);
    const method = file.method ?? 8, flags = (file.flags ?? 0x800) | (file.descriptor ? 8 : 0);
    const compressed = method === 0 ? raw : deflateRawSync(raw), crc = checksum(raw), declaredSize = file.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!file.descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declaredSize, 22); }
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
    const descriptor = Buffer.alloc(file.descriptor ? 16 : 0);
    if (file.descriptor) { descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(declaredSize, 12); }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(file.attributes ?? 0, 38); central.writeUInt32LE(offset, 42);
    const localPartsForFile = [local, name, extra, compressed, descriptor];
    localParts.push(...localPartsForFile); centralParts.push(central, name, extra);
    offset += localPartsForFile.reduce((total, part) => total + part.length, 0);
  }
  const directory = Buffer.concat(centralParts), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

const centralOffset = (bytes: Buffer) => bytes.readUInt32LE(bytes.length - 6);

describe('bounded in-memory subtitle ZIP extraction', () => {
  it.each([0, 8])('extracts method %s and preserves UTF-8 text ready for native WebVTT conversion', method => {
    const file = extractSubtitleArchive(archive([{ method, name: 'legendas/Português.srt' }]));
    expect(file).toMatchObject({ name: 'legendas/Português.srt', format: 'srt' });
    expect(new TextDecoder().decode(file.bytes)).toBe(srt);
    expect(subtitleToVtt(new TextDecoder().decode(file.bytes), file.format)).toContain('00:00:01.000 --> 00:00:03.000\nLegenda original');
  });
  it('accepts bounded directory/readme entries and a verified streaming data descriptor', () => {
    const file = extractSubtitleArchive(archive([
      { name: 'legendas/', body: '', method: 0 },
      { name: 'legendas/README.txt', body: 'Créditos originais de teste.' },
      { name: 'legendas/pt-BR.vtt', body: subtitleToVtt(srt, 'srt'), descriptor: true },
    ]));
    expect(file.format).toBe('vtt'); expect(new TextDecoder().decode(file.bytes)).toMatch(/^WEBVTT/);
  });
  it.each(['../legenda.srt', 'pasta/../legenda.srt', '/legenda.srt', 'C:/legenda.srt', 'pasta\\legenda.srt', './legenda.srt', 'pasta//legenda.srt', 'legenda\0.srt'])('rejects unsafe member name %j even without filesystem extraction', name => {
    expect(() => extractSubtitleArchive(archive([{ name }]))).toThrow();
  });
  it('rejects multiple subtitle candidates rather than guessing the desired language or release', () => {
    expect(() => extractSubtitleArchive(archive([{ name: 'pt.srt' }, { name: 'en.srt' }]))).toThrow();
    expect(() => extractSubtitleArchive(archive([{ name: 'README.txt' }]))).toThrow();
  });
  it('rejects symbolic links and unsupported or encrypted members', () => {
    expect(() => extractSubtitleArchive(archive([{ attributes: 0xa1ff0000 }]))).toThrow();
    expect(() => extractSubtitleArchive(archive([{ method: 9 }]))).toThrow();
    expect(() => extractSubtitleArchive(archive([{ flags: 1 }]))).toThrow();
  });
  it('rejects ZIP64 fields, sentinel lengths, split disks and inconsistent entry counts', () => {
    expect(() => extractSubtitleArchive(archive([{ extra: Buffer.from([1, 0, 0, 0]) }]))).toThrow();
    const sentinel = archive(); sentinel.writeUInt32LE(0xffffffff, centralOffset(sentinel) + 24);
    expect(() => extractSubtitleArchive(sentinel)).toThrow();
    const split = archive(); split.writeUInt16LE(1, split.length - 18);
    expect(() => extractSubtitleArchive(split)).toThrow();
    const count = archive(); count.writeUInt16LE(2, count.length - 12);
    expect(() => extractSubtitleArchive(count)).toThrow();
  });
  it('rejects CRC damage in subtitle and ignored readme entries', () => {
    const damaged = archive([{ method: 0 }]); damaged[30 + Buffer.byteLength('legenda.srt') + 3] ^= 1;
    expect(() => extractSubtitleArchive(damaged)).toThrow();
    const readme = archive([{ name: 'README.txt', method: 0, body: 'Créditos.' }, {}]); readme[30 + Buffer.byteLength('README.txt')] ^= 1;
    expect(() => extractSubtitleArchive(readme)).toThrow();
  });
  it('rejects mismatched local headers, corrupted descriptors and overlapping members', () => {
    const mismatch = archive(); mismatch.writeUInt16LE(0, 8);
    expect(() => extractSubtitleArchive(mismatch)).toThrow();
    const descriptor = archive([{ descriptor: true }]); descriptor[centralOffset(descriptor) - 8] ^= 1;
    expect(() => extractSubtitleArchive(descriptor)).toThrow();
    const overlap = archive([{ name: 'README.txt' }, {}]);
    const secondCentral = centralOffset(overlap) + 46 + Buffer.byteLength('README.txt'); overlap.writeUInt32LE(0, secondCentral + 42);
    expect(() => extractSubtitleArchive(overlap)).toThrow();
  });
  it('rejects oversized archives, declared bombs and compressed data that lies about output size', () => {
    expect(() => extractSubtitleArchive(Buffer.alloc(MAX_SUBTITLE_ARCHIVE_BYTES + 1))).toThrow();
    expect(() => extractSubtitleArchive(archive([{ declaredSize: MAX_SUBTITLE_ARCHIVE_OUTPUT_BYTES + 1 }]))).toThrow();
    const bomb = Buffer.alloc(MAX_SUBTITLE_ARCHIVE_OUTPUT_BYTES + 1, 0x41);
    expect(() => extractSubtitleArchive(archive([{ body: bomb, declaredSize: 1 }]))).toThrow();
    expect(() => extractSubtitleArchive(archive([{ body: Buffer.alloc(2_000_001) }, { name: 'README.txt', body: Buffer.alloc(2_000_000) }]))).toThrow();
  });
  it('rejects truncated directories, trailing junk, self-extracting prefixes and excessive members', () => {
    const good = archive();
    for (const bytes of [good.subarray(0, good.length - 1), good.subarray(0, 20), Buffer.concat([good, Buffer.from('junk')]), Buffer.concat([Buffer.from('MZ'), good])]) {
      expect(() => extractSubtitleArchive(bytes)).toThrow();
    }
    expect(() => extractSubtitleArchive(archive(Array.from({ length: 33 }, (_, index) => ({ name: index ? `readme${index}.txt` : 'legenda.srt' }))))).toThrow();
  });
});
