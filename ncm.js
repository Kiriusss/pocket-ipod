/*
 * Browser-local NCM format interoperability, independently implemented from the
 * format documented by taurusxin/ncmdump (MIT):
 * https://github.com/taurusxin/ncmdump/blob/main/src/ncmcrypt.cpp
 *
 * Source format reference license:
 * MIT License
 * Copyright (c) [year] [fullname]
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const MAX_KEY_SIZE = 64 * 1024;
const MAX_META_SIZE = 2 * 1024 * 1024;
const MAX_ARTWORK_SIZE = 8 * 1024 * 1024;
const CHUNK_SIZE = 2 * 1024 * 1024;
const MAGIC = 'CTENFDAM';
const CORE_KEY_HEX = '687a4852416d736f356b496e62617857';
const META_KEY_HEX = '2331346c6a6b5f215c5d2630553c2728';
const decoder = new TextDecoder('utf-8', { fatal: true });

export class NcmError extends Error {
  constructor(message, code = 'invalid_ncm') { super(message); this.name = 'NcmError'; this.code = code; }
}

export function isNcmFile(file) {
  return Boolean(file && typeof file.name === 'string' && /\.ncm$/i.test(file.name));
}

function text(bytes) { return decoder.decode(bytes); }
function wordArray(bytes, crypto) {
  const words = [];
  for (let i = 0; i < bytes.length; i++) words[i >>> 2] = (words[i >>> 2] || 0) | (bytes[i] << (24 - (i & 3) * 8));
  return crypto.lib.WordArray.create(words, bytes.length);
}
function byteArray(value) {
  const bytes = new Uint8Array(value.sigBytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (value.words[i >>> 2] >>> (24 - (i & 3) * 8)) & 255;
  return bytes;
}

function decryptEcb(ciphertext, keyHex, crypto) {
  if (!ciphertext.length || ciphertext.length % 16) throw new NcmError('NCM 加密数据长度不完整。');
  const result = crypto.AES.decrypt({ ciphertext: wordArray(ciphertext, crypto) }, crypto.enc.Hex.parse(keyHex), {
    mode: crypto.mode.ECB, padding: crypto.pad.NoPadding,
  });
  const bytes = byteArray(result), padding = bytes.at(-1);
  if (!padding || padding > 16 || bytes.length < padding) throw new NcmError('NCM 密钥或加密数据无效。');
  for (let i = bytes.length - padding; i < bytes.length; i++) {
    if (bytes[i] !== padding) throw new NcmError('NCM 加密数据校验失败。');
  }
  return bytes.subarray(0, bytes.length - padding);
}

function keyStream(key) {
  const box = Uint8Array.from({ length: 256 }, (_, i) => i);
  let previous = 0;
  for (let i = 0; i < 256; i++) {
    const target = (box[i] + previous + key[i % key.length]) & 255;
    [box[i], box[target]] = [box[target], box[i]];
    previous = target;
  }
  const stream = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const j = (i + 1) & 255;
    stream[i] = box[(box[j] + box[(box[j] + j) & 255]) & 255];
  }
  return stream;
}

function clean(value, fallback = '') {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 1000) || fallback : fallback;
}

function readMetadata(bytes, crypto) {
  if (!bytes.length) return {};
  try {
    const value = text(bytes.map(byte => byte ^ 0x63));
    const prefix = "163 key(Don't modify):";
    if (!value.startsWith(prefix)) return {};
    const base64 = value.slice(prefix.length).replace(/\s/g, '');
    if (!base64.length || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return {};
    const ciphertext = byteArray(crypto.enc.Base64.parse(base64));
    const plaintext = text(decryptEcb(ciphertext, META_KEY_HEX, crypto));
    const colon = plaintext.indexOf(':');
    if (!['music', 'dj'].includes(plaintext.slice(0, colon))) return {};
    const parsed = JSON.parse(plaintext.slice(colon + 1));
    const metadata = parsed?.mainMusic && typeof parsed.mainMusic === 'object' ? parsed.mainMusic : parsed;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  } catch {
    // Corrupt or absent optional tags must not prevent valid audio recovery.
    return {};
  }
}

function pictureBlob(bytes) {
  if (!bytes.length || bytes.length > MAX_ARTWORK_SIZE) return null;
  let type;
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'image/jpeg';
  else if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) type = 'image/png';
  else if (bytes.length >= 6 && [71,73,70,56].every((n,i) => bytes[i] === n)) type = 'image/gif';
  else if (bytes.length >= 12 && [82,73,70,70].every((n,i) => bytes[i] === n) && [87,69,66,80].every((n,i) => bytes[i + 8] === n)) type = 'image/webp';
  return type ? new Blob([bytes], { type }) : null;
}

function audioFormat(bytes) {
  if (bytes.length >= 4 && bytes[0] === 102 && bytes[1] === 76 && bytes[2] === 97 && bytes[3] === 67) return 'flac';
  if (bytes.length >= 3 && bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) return 'mp3';
  // MP3 may start directly with a valid MPEG audio frame instead of ID3 tags.
  if (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 6) !== 0 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 0x0c) !== 0x0c) return 'mp3';
  throw new NcmError('NCM 中未找到可识别的 MP3 或 FLAC 音频，文件可能已损坏。', 'unsupported_audio');
}

function getMetadata(raw, originalName) {
  const stem = clean(originalName).replace(/\.ncm$/i, '').split(/[/\\]/).at(-1) || '未命名歌曲';
  const pair = stem.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const names = Array.isArray(raw.artist) ? raw.artist.map(item => clean(Array.isArray(item) ? item[0] : typeof item === 'object' ? item?.name : item)).filter(Boolean) : [];
  return {
    title: clean(raw.musicName ?? raw.name, pair?.[2] || stem),
    artist: names.join(' / ') || clean(raw.artist, pair?.[1] || '未知艺术家'),
    album: clean(typeof raw.album === 'object' ? raw.album?.name : raw.album, '未知专辑'),
  };
}

function filename(metadata, format) {
  const title = metadata.artist === '未知艺术家' ? metadata.title : `${metadata.artist} - ${metadata.title}`;
  let safe = Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim()).slice(0, 180).join('').replace(/^[. ]+|[. ]+$/g, '');
  if (!safe) safe = '未命名歌曲';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return `${safe}.${format}`;
}

/** Decode a selected File entirely in this browser. No network API is used. */
export async function decodeNcm(file, { onProgress } = {}) {
  if (!(file instanceof Blob) || typeof file.arrayBuffer !== 'function') throw new NcmError('请选择本地 NCM 文件。');
  if (file.size > MAX_FILE_SIZE) throw new NcmError('单个 NCM 文件暂支持最大 200 MB，请分批选择较小文件。', 'file_too_large');
  if (file.size < 42) throw new NcmError('NCM 文件太短或已损坏。');
  const crypto = globalThis.CryptoJS;
  if (!crypto?.AES || !crypto?.mode?.ECB) throw new NcmError('本地转换组件尚未加载，请刷新页面后重试。', 'decoder_unavailable');
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  progress(0);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new NcmError('本地 NCM 文件读取不完整。');
  if (!Array.from(MAGIC).every((letter, index) => bytes[index] === letter.charCodeAt(0))) throw new NcmError('这不是有效的 NCM 文件。');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 10; // Eight-byte magic followed by two reserved bytes.
  const take = length => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new NcmError('NCM 数据不完整，无法继续转换。');
    const value = bytes.subarray(offset, offset + length); offset += length; return value;
  };
  const uint32 = () => { const position = offset; take(4); return data.getUint32(position, true); };

  const keyLength = uint32();
  if (!keyLength || keyLength > MAX_KEY_SIZE) throw new NcmError('NCM 密钥块长度无效。');
  const encryptedKey = take(keyLength).map(byte => byte ^ 0x64);
  const key = decryptEcb(encryptedKey, CORE_KEY_HEX, crypto);
  const prefix = 'neteasecloudmusic';
  if (key.length <= prefix.length || !Array.from(prefix).every((letter,index) => key[index] === letter.charCodeAt(0))) throw new NcmError('NCM 密钥格式不受支持或文件已损坏。');
  const stream = keyStream(key.subarray(prefix.length));
  const metadataLength = uint32();
  if (metadataLength > MAX_META_SIZE) throw new NcmError('NCM 标签块过大或长度无效。');
  const rawMetadata = readMetadata(take(metadataLength), crypto);
  take(5); // CRC32 plus image version. Reference format does not validate CRC32.
  const coverFrameLength = uint32();
  const imageLength = uint32();
  if (imageLength > coverFrameLength) throw new NcmError('NCM 封面长度无效。');
  const coverFrame = take(coverFrameLength);
  const artworkBlob = imageLength <= MAX_ARTWORK_SIZE ? pictureBlob(coverFrame.subarray(0, imageLength)) : null;
  const audio = bytes.subarray(offset);
  if (audio.length < 4) throw new NcmError('NCM 文件没有完整的音频数据。');
  progress(.01);
  for (let start = 0; start < audio.length; start += CHUNK_SIZE) {
    const end = Math.min(audio.length, start + CHUNK_SIZE);
    for (let i = start; i < end; i++) audio[i] ^= stream[i & 255];
    progress(.01 + .97 * end / audio.length);
    if (end < audio.length) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const format = audioFormat(audio);
  const metadata = getMetadata(rawMetadata, file.name || '未命名歌曲.ncm');
  const output = new File([audio], filename(metadata, format), { type: format === 'flac' ? 'audio/flac' : 'audio/mpeg', lastModified: Number.isFinite(file.lastModified) ? file.lastModified : 0 });
  progress(1);
  return { file: output, metadata, artworkBlob };
}
