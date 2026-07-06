/**
 * import/parsers/unzip.js
 *
 * Minimal zero-dependency ZIP reader — the inverse of export/formats/zip.js.
 * Reads the End-Of-Central-Directory record, walks the central directory, and
 * inflates each entry (STORE or DEFLATE) with Node's built-in zlib. Enough to
 * open the .xlsx files this app writes and the ones Excel/Matrixify produce; no
 * Zip64, no encryption, no data-descriptor-only streams.
 */

/* global Buffer */
import zlib from "zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * Read a ZIP buffer into a map of entry name → uncompressed Buffer.
 *
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}
 */
export function unzip(buffer) {
  const eocd = findEOCD(buffer);
  if (eocd < 0) throw new Error("Not a ZIP file (no end-of-central-directory record).");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16); // central directory offset

  const files = new Map();

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(ptr) !== CEN_SIG) break;

    const method       = buffer.readUInt16LE(ptr + 10);
    const compSize      = buffer.readUInt32LE(ptr + 20);
    const nameLen      = buffer.readUInt16LE(ptr + 28);
    const extraLen     = buffer.readUInt16LE(ptr + 30);
    const commentLen   = buffer.readUInt16LE(ptr + 32);
    const localOffset  = buffer.readUInt32LE(ptr + 42);
    const name         = buffer.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    if (!name.endsWith("/")) {
      files.set(name, inflateEntry(buffer, localOffset, method, compSize));
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

/**
 * Inflate a single entry given its local-header offset. The local header
 * repeats name/extra lengths (which may differ from the central copy), so we
 * re-read them here to locate the compressed data.
 */
function inflateEntry(buffer, localOffset, method, compSize) {
  if (buffer.readUInt32LE(localOffset) !== LOC_SIG) {
    throw new Error("Corrupt ZIP: bad local file header.");
  }
  const nameLen  = buffer.readUInt16LE(localOffset + 26);
  const extraLen = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compressed = buffer.subarray(dataStart, dataStart + compSize);

  if (method === 0) return Buffer.from(compressed); // STORE
  if (method === 8) return zlib.inflateRawSync(compressed); // DEFLATE
  throw new Error(`Unsupported ZIP compression method: ${method}`);
}

/** Scan backwards for the EOCD signature (allowing for a trailing comment). */
function findEOCD(buffer) {
  const minPos = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= minPos; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
