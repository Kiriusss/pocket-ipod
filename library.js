const AUDIO_EXTENSION = /\.(mp3|m4a|aac|wav|wave|flac|ogg|oga|opus|aif|aiff|mp4)$/i;
const DATABASE = 'pocket-ipod-local-library';
const STORE = 'tracks';
const REMEMBER_KEY = 'pocket-ipod-remember-library';
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

/** This accepts file-like metadata; importFiles additionally requires a Blob. */
export function isAudioFile(file) {
  return Boolean(file && typeof file.name === 'string' &&
    ((typeof file.type === 'string' && /^audio\//i.test(file.type)) || AUDIO_EXTENSION.test(file.name)));
}

/** A stable, unambiguous key; neither paths nor file bytes leave the browser. */
export function fileKey(file) {
  return JSON.stringify([String(file?.name ?? ''), Number(file?.size) || 0, Number(file?.lastModified) || 0]);
}

export function guessMetadata(file) {
  const filename = typeof file === 'string' ? file : String(file?.name ?? '');
  let stem = filename.split(/[/\\]/).at(-1).replace(/\.[^.]+$/, '').trim();
  stem = stem.replace(/^\d{1,3}\s*[-._]\s*/, '').trim();
  const pair = stem.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return {
    title: pair?.[2]?.trim() || stem || '未命名歌曲',
    artist: pair?.[1]?.trim() || '未知艺术家',
    album: '未知专辑',
  };
}

const cleanTag = (value, fallback) => typeof value === 'string'
  ? value.replace(/\0/g, '').trim().slice(0, 1000) || fallback
  : fallback;

/** Only small, recognisable embedded raster pictures become image blobs. */
export function artworkFromPicture(picture) {
  if (!picture?.data) return null;
  const source = picture.data;
  const byteLength = source.byteLength ?? source.length;
  if (!Number.isFinite(byteLength) || byteLength < 4 || byteLength > MAX_ARTWORK_BYTES) return null;
  let bytes;
  try {
    bytes = source instanceof ArrayBuffer ? new Uint8Array(source)
      : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : Array.isArray(source) ? new Uint8Array(source) : null;
  } catch { return null; }
  if (!bytes) return null;
  let type;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'image/jpeg';
  else if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) type = 'image/png';
  else if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) type = 'image/gif';
  else if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) type = 'image/webp';
  return type ? new Blob([bytes], { type }) : null;
}

function readMetadata(file) {
  const fallback = guessMetadata(file);
  const reader = globalThis.jsmediatags;
  if (!reader || typeof reader.read !== 'function') return Promise.resolve({ ...fallback, artworkBlob: null });
  return new Promise(resolve => {
    let finished = false;
    const finish = (tags = {}) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve({
        title: cleanTag(tags.title, fallback.title),
        artist: cleanTag(tags.artist, fallback.artist),
        album: cleanTag(tags.album, fallback.album),
        artworkBlob: artworkFromPicture(tags.picture),
      });
    };
    const timeout = setTimeout(() => finish(), 4000);
    try {
      // Passing the File itself selects jsmediatags' BlobFileReader, never XHR.
      reader.read(file, { onSuccess: result => finish(result?.tags), onError: () => finish() });
    } catch { finish(); }
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法读取浏览器曲库'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('浏览器曲库存储已中止'));
    transaction.onerror = () => { /* onabort reports the final transaction error. */ };
  });
}

export class LocalLibrary extends EventTarget {
  constructor() {
    super();
    this.tracks = [];
    this.remember = false;
    this.importing = false;
    this.progress = { done: 0, total: 0 };
    this.lastStorageError = null;
    this._artworkBlobs = new Map();
    this._db = null;
    this._opening = null;
    this._initPromise = null;
    this._imports = Promise.resolve();
    this._writes = Promise.resolve();
    this._generation = 0;
    this._destroyed = false;
  }

  _changed() { if (!this._destroyed) this.dispatchEvent(new Event('change')); }

  _storageError(error) {
    this.lastStorageError = error;
    if (this._destroyed) return;
    const event = new Event('storageerror');
    event.detail = { message: '此浏览器暂时无法保留曲库，本次播放不受影响。', error };
    this.dispatchEvent(event);
  }

  async _getDb() {
    if (this._destroyed) throw new Error('曲库已关闭');
    if (this._db) return this._db;
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const fail = error => { if (!settled) { settled = true; clearTimeout(timeout); reject(error); } };
      const timeout = setTimeout(() => fail(new Error('浏览器曲库被其他页面占用')), 4000);
      try {
        if (!globalThis.indexedDB) throw new Error('此浏览器不支持本地曲库保存');
        request = globalThis.indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        request.onerror = () => fail(request.error || new Error('无法打开浏览器曲库'));
        request.onblocked = () => fail(new Error('请先关闭其他已打开的播放器页面'));
        request.onsuccess = () => {
          if (settled || this._destroyed) { request.result.close(); return; }
          settled = true;
          clearTimeout(timeout);
          this._db = request.result;
          this._db.onversionchange = () => { this._db?.close(); this._db = null; };
          resolve(this._db);
        };
      } catch (error) { fail(error); }
    }).finally(() => { this._opening = null; });
    return this._opening;
  }

  init() {
    this._initPromise ??= this._initialize();
    return this._initPromise;
  }

  async _initialize() {
    const generation = this._generation;
    let shouldRestore = false;
    try { shouldRestore = globalThis.localStorage?.getItem(REMEMBER_KEY) === '1'; }
    catch (error) { this._storageError(error); }
    this.remember = shouldRestore;
    try {
      const db = await this._getDb();
      if (this._destroyed || generation !== this._generation) return this;
      if (!shouldRestore) {
        const transaction = db.transaction(STORE, 'readwrite');
        const done = transactionDone(transaction);
        transaction.objectStore(STORE).clear();
        await done;
        return this;
      }
      const transaction = db.transaction(STORE, 'readonly');
      const done = transactionDone(transaction);
      const [records] = await Promise.all([requestResult(transaction.objectStore(STORE).getAll()), done]);
      if (this._destroyed || generation !== this._generation) return this;
      this.remember = true;
      const existing = new Set(this.tracks.map(track => track.id));
      for (const record of records) {
        if (!(record.file instanceof Blob)) continue;
        let file = record.file;
        if (typeof file.name !== 'string' && record.name && typeof File !== 'undefined') {
          file = new File([file], record.name, { type: file.type, lastModified: record.lastModified || 0 });
        }
        if (!isAudioFile(file)) continue;
        const id = fileKey(file);
        if (existing.has(id)) continue;
        existing.add(id);
        const fallback = guessMetadata(file);
        const artworkBlob = record.artworkBlob instanceof Blob && record.artworkBlob.size <= MAX_ARTWORK_BYTES ? record.artworkBlob : null;
        this._appendTrack(id, file, {
          title: cleanTag(record.title, fallback.title), artist: cleanTag(record.artist, fallback.artist),
          album: cleanTag(record.album, fallback.album), artworkBlob,
        });
      }
    } catch (error) {
      this.remember = false;
      this._storageError(error);
    } finally { this._changed(); }
    return this;
  }

  _appendTrack(id, file, metadata) {
    const artwork = metadata.artworkBlob ? URL.createObjectURL(metadata.artworkBlob) : null;
    if (metadata.artworkBlob) this._artworkBlobs.set(id, metadata.artworkBlob);
    const track = { id, title: metadata.title, artist: metadata.artist, album: metadata.album, file, artwork, duration: 0 };
    this.tracks.push(track);
    return track;
  }

  importFiles(fileList) {
    let files;
    try { files = Array.from(fileList ?? []); } catch { files = []; }
    const generation = this._generation;
    const operation = this._imports.then(() => this._import(files, generation));
    this._imports = operation.catch(() => {});
    return operation;
  }

  async _import(files, generation) {
    const summary = { added: 0, duplicates: 0, rejected: 0 };
    if (this._destroyed) { summary.rejected = files.length; return summary; }
    // Complete restoration before deduplicating against a retained library.
    await this.init();
    if (this._destroyed || generation !== this._generation) { summary.rejected = files.length; return summary; }
    const seen = new Set(this.tracks.map(track => track.id));
    const pending = [];
    for (const file of files) {
      if (!(file instanceof Blob) || !isAudioFile(file) || file.size === 0) { summary.rejected++; continue; }
      const id = fileKey(file);
      if (seen.has(id)) { summary.duplicates++; continue; }
      seen.add(id);
      pending.push({ id, file });
    }
    this.importing = true;
    this.progress = { done: 0, total: pending.length };
    this._changed();
    let cursor = 0;
    const results = new Array(pending.length);
    const worker = async () => {
      while (cursor < pending.length && generation === this._generation && !this._destroyed) {
        const index = cursor++;
        results[index] = await readMetadata(pending[index].file);
        this.progress.done++;
        this._changed();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
      if (generation !== this._generation || this._destroyed) { summary.rejected += pending.length; return summary; }
      for (let i = 0; i < pending.length; i++) {
        const { id, file } = pending[i];
        this._appendTrack(id, file, results[i]);
        summary.added++;
      }
      if (summary.added && this.remember) await this._save();
      return summary;
    } finally {
      this.importing = false;
      this._changed();
    }
  }

  _save() {
    const write = this._writes.then(async () => {
      if (this._destroyed) return false;
      const db = await this._getDb();
      if (this._destroyed) return false;
      const transaction = db.transaction(STORE, 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE);
      try {
        store.clear();
        if (this.remember) {
          for (const track of this.tracks) store.put({
            id: track.id, title: track.title, artist: track.artist, album: track.album,
            file: track.file, name: track.file.name, lastModified: track.file.lastModified,
            artworkBlob: this._artworkBlobs.get(track.id) ?? null,
          });
        }
      } catch (error) {
        try { transaction.abort(); } catch { /* Transaction may have already failed. */ }
        await done.catch(() => {});
        throw error;
      }
      await done;
      return true;
    }).catch(error => { this._storageError(error); return false; });
    this._writes = write;
    return write;
  }

  async setRemember(value) {
    await this.init();
    if (this._destroyed) return false;
    this.remember = Boolean(value);
    // Write the opt-out first so failed storage cannot restore files next time.
    try { globalThis.localStorage?.setItem(REMEMBER_KEY, this.remember ? '1' : '0'); }
    catch (error) { this.remember = false; this._storageError(error); }
    const saved = await this._save();
    if (!saved && this.remember) {
      this.remember = false;
      try { globalThis.localStorage?.setItem(REMEMBER_KEY, '0'); } catch { /* Already reported. */ }
    }
    this._changed();
    return saved && this.remember === Boolean(value);
  }

  async remove(id) {
    const index = this.tracks.findIndex(track => track.id === id);
    if (index < 0) return false;
    const [track] = this.tracks.splice(index, 1);
    if (track.artwork) URL.revokeObjectURL(track.artwork);
    this._artworkBlobs.delete(id);
    this._changed();
    if (this.remember) await this._save();
    return true;
  }

  async clear() {
    this._generation++;
    this.cleanup();
    this.tracks = [];
    this._changed();
    await this.init();
    if (this._destroyed) return;
    // Clear retained files even if remembering has just been turned off.
    if (this._db || this.remember) await this._save();
  }

  cleanup() {
    for (const track of this.tracks) {
      if (track.artwork) URL.revokeObjectURL(track.artwork);
      track.artwork = null;
    }
    this._artworkBlobs.clear();
  }

  destroy() {
    this._destroyed = true;
    this._generation++;
    this.cleanup();
    this.tracks = [];
    this._db?.close();
    this._db = null;
  }
}
