import { inflateRawSync } from 'node:zlib';

export const MAX_SUBTITLE_ARCHIVE_BYTES = 2_000_000;
export const MAX_SUBTITLE_ARCHIVE_OUTPUT_BYTES = 4_000_000;
const MAX_ENTRIES = 32;
const invalid = () => new Error('O arquivo compactado de legendas é inválido ou excede os limites.');

export interface ArchivedSubtitle {
  bytes: Uint8Array;
  format: 'srt' | 'ass' | 'vtt';
  name: string;
}

interface Entry {
  name: string;
  rawName: Buffer;
  format?: ArchivedSubtitle['format'];
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  uncompressed: number;
  offset: number;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function checkExtra(data: Buffer): void {
  let offset = 0;
  while (offset < data.length) {
    if (offset + 4 > data.length) throw invalid();
    const id = data.readUInt16LE(offset), size = data.readUInt16LE(offset + 2);
    if (id === 1 || offset + 4 + size > data.length) throw invalid(); // ZIP64 is deliberately unsupported.
    offset += 4 + size;
  }
}

function entryName(bytes: Buffer, flags: number): string {
  let name: string;
  try { name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252', { fatal: true }).decode(bytes); }
  catch { throw invalid(); }
  if (!name || bytes.length > 512 || /[\\:]/.test(name) || name.startsWith('/')
    || Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw invalid();
  const components = name.replace(/\/$/, '').split('/');
  if (components.some(component => !component || component === '.' || component === '..')) throw invalid();
  return name;
}

/** Extracts one unambiguous subtitle in memory; never creates paths or files. */
export function extractSubtitleArchive(input: Uint8Array): ArchivedSubtitle {
  if (input.byteLength < 22 || input.byteLength > MAX_SUBTITLE_ARCHIVE_BYTES) throw invalid();
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 22 - 65535); offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50 && offset + 22 + data.readUInt16LE(offset + 20) === data.length) { end = offset; break; }
  }
  if (end < 0) throw invalid();
  const count = data.readUInt16LE(end + 10), centralSize = data.readUInt32LE(end + 12), centralStart = data.readUInt32LE(end + 16);
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || data.readUInt16LE(end + 8) !== count
    || !count || count > MAX_ENTRIES || centralStart === 0xffffffff || centralSize === 0xffffffff
    || centralStart + centralSize !== end) throw invalid();

  const entries: Entry[] = [];
  let offset = centralStart, totalOutput = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const needed = data.readUInt16LE(offset + 6), flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10);
    const crc = data.readUInt32LE(offset + 16), compressed = data.readUInt32LE(offset + 20), uncompressed = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28), extraLength = data.readUInt16LE(offset + 30), commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42), next = offset + 46 + nameLength + extraLength + commentLength;
    if (needed > 20 || flags & ~0x808 || ![0, 8].includes(method) || data.readUInt16LE(offset + 34)
      || compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff
      || next > end || localOffset >= centralStart || compressed > MAX_SUBTITLE_ARCHIVE_BYTES
      || (totalOutput += uncompressed) > MAX_SUBTITLE_ARCHIVE_OUTPUT_BYTES) throw invalid();
    const rawName = data.subarray(offset + 46, offset + 46 + nameLength), name = entryName(rawName, flags);
    const unixType = (data.readUInt32LE(offset + 38) >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw invalid();
    checkExtra(data.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
    const extension = name.toLowerCase().match(/\.(srt|ass|vtt)$/)?.[1] as ArchivedSubtitle['format'] | undefined;
    entries.push({ name, rawName, format: extension, flags, method, crc, compressed, uncompressed, offset: localOffset });
    offset = next;
  }
  if (offset !== end || entries.filter(entry => entry.format).length !== 1) throw invalid();

  let previousEnd = 0;
  let selected: ArchivedSubtitle | undefined;
  for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
    const start = entry.offset;
    if (start !== previousEnd || start + 30 > centralStart || data.readUInt32LE(start) !== 0x04034b50
      || data.readUInt16LE(start + 4) > 20 || data.readUInt16LE(start + 6) !== entry.flags || data.readUInt16LE(start + 8) !== entry.method) throw invalid();
    const nameLength = data.readUInt16LE(start + 26), extraLength = data.readUInt16LE(start + 28), bodyStart = start + 30 + nameLength + extraLength;
    let bodyEnd = bodyStart + entry.compressed;
    if (bodyEnd > centralStart || !data.subarray(start + 30, start + 30 + nameLength).equals(entry.rawName)) throw invalid();
    checkExtra(data.subarray(start + 30 + nameLength, bodyStart));
    const localCrc = data.readUInt32LE(start + 14), localCompressed = data.readUInt32LE(start + 18), localUncompressed = data.readUInt32LE(start + 22);
    if (entry.flags & 8) {
      if ((localCrc && localCrc !== entry.crc) || (localCompressed && localCompressed !== entry.compressed)
        || (localUncompressed && localUncompressed !== entry.uncompressed)) throw invalid();
      if (bodyEnd + 12 > centralStart) throw invalid();
      if (data.readUInt32LE(bodyEnd) === 0x08074b50) bodyEnd += 4;
      if (bodyEnd + 12 > centralStart || data.readUInt32LE(bodyEnd) !== entry.crc
        || data.readUInt32LE(bodyEnd + 4) !== entry.compressed || data.readUInt32LE(bodyEnd + 8) !== entry.uncompressed) throw invalid();
      bodyEnd += 12;
    } else if (localCrc !== entry.crc || localCompressed !== entry.compressed || localUncompressed !== entry.uncompressed) throw invalid();

    let bytes: Uint8Array;
    const compressedBytes = data.subarray(bodyStart, bodyStart + entry.compressed);
    try {
      if (entry.method === 0) bytes = Buffer.from(compressedBytes);
      else {
        // Node returns the engine with info:true; older @types/node versions
        // still declare only the default Buffer result for this option.
        const inflated = inflateRawSync(compressedBytes, { maxOutputLength: MAX_SUBTITLE_ARCHIVE_OUTPUT_BYTES, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (inflated.engine.bytesWritten !== compressedBytes.length) throw invalid();
        bytes = inflated.buffer;
      }
    } catch { throw invalid(); }
    if (bytes.byteLength !== entry.uncompressed || crc32(bytes) !== entry.crc) throw invalid();
    if (entry.format) selected = { bytes, format: entry.format, name: entry.name };
    previousEnd = bodyEnd;
  }
  if (previousEnd !== centralStart || !selected?.bytes.length) throw invalid();
  return selected;
}
