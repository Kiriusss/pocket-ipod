import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLibrary, isAudioFile, fileKey, guessMetadata, artworkFromPicture } from '../library.js';

test('audio file selection accepts audio MIME or known extensions without admitting arbitrary documents', () => {
  assert.equal(isAudioFile({ name: 'song.MP3', type: '' }), true);
  assert.equal(isAudioFile({ name: 'voice.bin', type: 'audio/ogg' }), true);
  assert.equal(isAudioFile({ name: 'song.m4a', type: 'video/mp4' }), true);
  for (const extension of ['aac', 'wav', 'wave', 'flac', 'ogg', 'oga', 'opus', 'aif', 'aiff', 'mp4']) {
    assert.equal(isAudioFile({ name: `song.${extension}`, type: '' }), true);
  }
  assert.equal(isAudioFile({ name: 'music.html', type: 'text/html' }), false);
  assert.equal(isAudioFile({ name: 'album.png', type: 'image/png' }), false);
  assert.equal(isAudioFile(null), false);
});

test('stable file keys include name, size and modified time and avoid separator collisions', () => {
  const a = { name: 'Artist - Song.mp3', size: 100, lastModified: 5 };
  assert.equal(fileKey(a), fileKey({ ...a }));
  assert.notEqual(fileKey(a), fileKey({ ...a, size: 101 }));
  assert.notEqual(fileKey(a), fileKey({ ...a, lastModified: 6 }));
  assert.notEqual(fileKey({ name: 'a|1', size: 2 }), fileKey({ name: 'a', size: 1, lastModified: 2 }));
});

test('filename fallback extracts artist/title and strips an optional track prefix', () => {
  assert.deepEqual(guessMetadata('Artist - Song.mp3'), { title: 'Song', artist: 'Artist', album: '未知专辑' });
  assert.deepEqual(guessMetadata({ name: '01 - 艺术家 - 歌名.flac' }), { title: '歌名', artist: '艺术家', album: '未知专辑' });
  assert.deepEqual(guessMetadata('Solo.wav'), { title: 'Solo', artist: '未知艺术家', album: '未知专辑' });
  assert.equal(guessMetadata('').title, '未命名歌曲');
});

test('embedded artwork only accepts bounded raster image data', () => {
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.equal(artworkFromPicture({ data: png, format: 'image/png' }).type, 'image/png');
  assert.equal(artworkFromPicture({ data: new Uint8Array([255, 216, 255, 0]) }).type, 'image/jpeg');
  assert.equal(artworkFromPicture({ data: Array.from(Buffer.from('<svg onload="alert(1)"/>')) }), null);
  assert.equal(artworkFromPicture({ data: new Uint8Array(8 * 1024 * 1024 + 1) }), null);
  assert.equal(artworkFromPicture({ data: [] }), null);
});

test('import accepts actual File blobs, deduplicates, falls back on tags errors and stays session-local', async () => {
  const original = globalThis.jsmediatags;
  globalThis.jsmediatags = { read(file, callbacks) {
    assert.ok(file instanceof Blob);
    callbacks.onError(new Error('no tags'));
  } };
  const library = new LocalLibrary();
  const first = new File(['audio'], 'Artist - Track.mp3', { type: 'audio/mpeg', lastModified: 42 });
  const other = new File(['other'], 'Second.wav', { type: 'audio/wav', lastModified: 43 });
  try {
    const result = await library.importFiles([first, first, other, new File(['text'], 'notes.txt'), 'https://example.com/music.mp3']);
    assert.deepEqual(result, { added: 2, duplicates: 1, rejected: 2 });
    assert.equal(library.tracks[0].title, 'Track');
    assert.equal(library.tracks[0].file, first);
    assert.equal(library.tracks[0].artwork, null);
    assert.equal(library.remember, false);
    assert.equal(library.importing, false);
    assert.deepEqual(await library.importFiles([first]), { added: 0, duplicates: 1, rejected: 0 });
    await library.remove(library.tracks[0].id);
    assert.equal(library.tracks.length, 1);
    await library.clear();
    assert.equal(library.tracks.length, 0);
  } finally { library.destroy(); globalThis.jsmediatags = original; }
});

test('metadata loading is bounded to four readers and retains file selection order', async () => {
  const original = globalThis.jsmediatags;
  let active = 0, peak = 0;
  globalThis.jsmediatags = { read(file, callbacks) {
    active++;
    peak = Math.max(peak, active);
    setTimeout(() => { active--; callbacks.onSuccess({ tags: { title: file.name } }); }, file.name.startsWith('0') ? 20 : 2);
  } };
  const library = new LocalLibrary();
  const files = Array.from({ length: 9 }, (_, i) => new File(['audio'], `${i}.mp3`));
  try {
    const summary = await library.importFiles(files);
    assert.equal(summary.added, 9);
    assert.equal(peak, 4);
    assert.deepEqual(library.tracks.map(track => track.title), files.map(file => file.name));
  } finally { library.destroy(); globalThis.jsmediatags = original; }
});

test('clearing during tag reading cancels the pending import instead of resurrecting files', async () => {
  const original = globalThis.jsmediatags;
  let finishRead;
  globalThis.jsmediatags = { read(file, callbacks) { finishRead = () => callbacks.onSuccess({ tags: {} }); } };
  const library = new LocalLibrary();
  try {
    const importing = library.importFiles([new File(['audio'], 'song.mp3')]);
    while (!finishRead) await new Promise(resolve => setTimeout(resolve, 0));
    await library.clear();
    finishRead();
    assert.deepEqual(await importing, { added: 0, duplicates: 0, rejected: 1 });
    assert.equal(library.tracks.length, 0);
    assert.equal(library.importing, false);
  } finally { library.destroy(); globalThis.jsmediatags = original; }
});
