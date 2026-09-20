import { createReadStream, statSync } from "node:fs";
import { once } from "node:events";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";

export type StoredZipEntry =
  | { archivePath: string; data: Buffer }
  | { archivePath: string; sourcePath: string };

interface CompletedEntry {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  dosDate: number;
  dosTime: number;
}

const zip32Max = 0xffff_ffff;
const utf8WithDescriptor = 0x0808;
const crcTable = createCrcTable();

export function storedZipSourceSize(entries: StoredZipEntry[]): number {
  return entries.reduce((total, entry) => total + ("data" in entry ? entry.data.length : statSync(entry.sourcePath).size), 0);
}

export async function writeStoredZip(
  output: Writable,
  entries: StoredZipEntry[],
  onProgress?: (writtenSourceBytes: number) => void,
): Promise<void> {
  if (entries.length > 0xffff) throw new Error("导出文件数量超过 ZIP32 上限");
  const completed: CompletedEntry[] = [];
  let position = 0;
  let writtenSourceBytes = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.archivePath.replaceAll("\\", "/"), "utf8");
    const { dosDate, dosTime } = dosTimestamp(new Date());
    const offset = position;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8WithDescriptor, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt16LE(name.length, 26);
    await writeChunk(output, localHeader);
    await writeChunk(output, name);
    position += localHeader.length + name.length;

    let crc = 0xffff_ffff;
    let size = 0;
    const source = "data" in entry ? [entry.data] : createReadStream(entry.sourcePath);
    for await (const rawChunk of source) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      crc = updateZipCrc(crc, chunk);
      size += chunk.length;
      if (size > zip32Max) throw new Error(`单个导出文件超过 ZIP32 上限：${entry.archivePath}`);
      await writeChunk(output, chunk);
      position += chunk.length;
      writtenSourceBytes += chunk.length;
      onProgress?.(writtenSourceBytes);
    }
    crc = finishZipCrc(crc);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    await writeChunk(output, descriptor);
    position += descriptor.length;
    completed.push({ name, crc, size, offset, dosDate, dosTime });
  }

  const centralOffset = position;
  if (centralOffset > zip32Max) throw new Error("题库资源包超过 ZIP32 上限，请拆分原图后再导出");
  for (const entry of completed) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(utf8WithDescriptor, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(entry.dosTime, 12);
    header.writeUInt16LE(entry.dosDate, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    await writeChunk(output, header);
    await writeChunk(output, entry.name);
    position += header.length + entry.name.length;
  }
  const centralSize = position - centralOffset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(completed.length, 8);
  end.writeUInt16LE(completed.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  await writeChunk(output, end);
  output.end();
  await finished(output);
}

async function writeChunk(output: Writable, chunk: Buffer): Promise<void> {
  if (output.destroyed) throw new Error("导出连接已中断");
  if (!output.write(chunk)) {
    await Promise.race([
      once(output, "drain"),
      once(output, "close").then(() => { throw new Error("导出连接已中断"); }),
    ]);
  }
}

export function updateZipCrc(crc: number, chunk: Buffer): number {
  for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

export function finishZipCrc(crc: number): number {
  return (crc ^ 0xffff_ffff) >>> 0;
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

function dosTimestamp(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}
