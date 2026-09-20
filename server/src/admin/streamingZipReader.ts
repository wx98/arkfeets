import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm, type FileHandle } from "node:fs/promises";
import { Readable, type Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { once } from "node:events";
import { finishZipCrc, updateZipCrc } from "./streamingZipWriter.js";

export interface StreamingZipEntry {
  entryName: string;
  isDirectory: boolean;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export class StreamingZipReader {
  private constructor(
    private readonly filePath: string,
    private readonly handle: FileHandle,
    readonly entries: StreamingZipEntry[],
  ) {}

  static async open(filePath: string): Promise<StreamingZipReader> {
    const handle = await open(filePath, "r");
    try {
      const stats = await handle.stat();
      const tailSize = Math.min(stats.size, 65_557);
      const tail = Buffer.alloc(tailSize);
      await readExactly(handle, tail, stats.size - tailSize);
      const eocdOffset = findSignatureBackwards(tail, 0x06054b50);
      if (eocdOffset < 0) throw new Error("ZIP 缺少中央目录结束标记");
      const entryCount = tail.readUInt16LE(eocdOffset + 10);
      const centralSize = tail.readUInt32LE(eocdOffset + 12);
      const centralOffset = tail.readUInt32LE(eocdOffset + 16);
      if (entryCount === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) {
        throw new Error("暂不支持 ZIP64 资源包");
      }
      if (entryCount > 20_000 || centralSize > 128 * 1024 * 1024) throw new Error("ZIP 文件条目数量或中央目录过大");
      const central = Buffer.alloc(centralSize);
      await readExactly(handle, central, centralOffset);
      const entries: StreamingZipEntry[] = [];
      let offset = 0;
      while (offset < central.length) {
        if (central.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
        const flags = central.readUInt16LE(offset + 8);
        if (flags & 1) throw new Error("不支持加密 ZIP 资源包");
        const method = central.readUInt16LE(offset + 10);
        if (method !== 0 && method !== 8) throw new Error(`ZIP 包含不支持的压缩方式：${method}`);
        const nameLength = central.readUInt16LE(offset + 28);
        const extraLength = central.readUInt16LE(offset + 30);
        const commentLength = central.readUInt16LE(offset + 32);
        const end = offset + 46 + nameLength + extraLength + commentLength;
        if (end > central.length) throw new Error("ZIP 中央目录条目越界");
        const entryName = central.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
        entries.push({
          entryName,
          isDirectory: entryName.endsWith("/"),
          method,
          crc: central.readUInt32LE(offset + 16),
          compressedSize: central.readUInt32LE(offset + 20),
          size: central.readUInt32LE(offset + 24),
          localOffset: central.readUInt32LE(offset + 42),
        });
        offset = end;
      }
      if (entries.length !== entryCount) throw new Error("ZIP 中央目录条目数量不一致");
      return new StreamingZipReader(filePath, handle, entries);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async readEntry(entry: StreamingZipEntry, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
    if (entry.size > maxBytes) throw new Error(`ZIP 条目过大：${entry.entryName}`);
    const chunks: Buffer[] = [];
    await this.consumeEntry(entry, async (chunk) => { chunks.push(Buffer.from(chunk)); });
    return Buffer.concat(chunks);
  }

  async writeEntry(entry: StreamingZipEntry, targetPath: string): Promise<void> {
    const temporaryPath = `${targetPath}.${process.pid}.importing`;
    const output = createWriteStream(temporaryPath, { flags: "wx" });
    try {
      await once(output, "open");
      await this.consumeEntry(entry, async (chunk) => writeChunk(output, chunk));
      output.end();
      await finished(output);
      await rename(temporaryPath, targetPath);
    } catch (error) {
      output.destroy();
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  private async consumeEntry(entry: StreamingZipEntry, consume: (chunk: Buffer) => Promise<void>): Promise<void> {
    const localHeader = Buffer.alloc(30);
    await readExactly(this.handle, localHeader, entry.localOffset);
    if (localHeader.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP 本地条目损坏：${entry.entryName}`);
    const nameLength = localHeader.readUInt16LE(26);
    const extraLength = localHeader.readUInt16LE(28);
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
    let source: Readable = entry.compressedSize
      ? createReadStream(this.filePath, { start: dataOffset, end: dataOffset + entry.compressedSize - 1 })
      : Readable.from([]);
    if (entry.method === 8) source = source.pipe(createInflateRaw());
    let crc = 0xffff_ffff;
    let size = 0;
    for await (const rawChunk of source) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      crc = updateZipCrc(crc, chunk);
      size += chunk.length;
      if (size > entry.size) throw new Error(`ZIP 条目解压尺寸异常：${entry.entryName}`);
      await consume(chunk);
    }
    if (size !== entry.size || finishZipCrc(crc) !== entry.crc) throw new Error(`ZIP 条目校验失败：${entry.entryName}`);
  }
}

async function readExactly(handle: FileHandle, target: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < target.length) {
    const { bytesRead } = await handle.read(target, offset, target.length - offset, position + offset);
    if (!bytesRead) throw new Error("ZIP 文件意外结束");
    offset += bytesRead;
  }
}

function findSignatureBackwards(buffer: Buffer, signature: number): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

async function writeChunk(output: Writable, chunk: Buffer): Promise<void> {
  if (!output.write(chunk)) await once(output, "drain");
}
