import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPlayer } from '../player.js';

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.paused = true;
    this.ended = false;
    this.volume = .75;
    this.duration = NaN;
    this.currentTime = 0;
    this.src = '';
    this.loads = 0;
    this.playImpl = null;
  }
  load() { this.loads++; this.currentTime = 0; this.ended = false; this.duration = NaN; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) this.dispatchEvent(new Event('pause')); }
  play() {
    if (this.playImpl) return this.playImpl();
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
}

const track = id => ({ id, title: `Track ${id}`, artist: 'Local artist', album: 'Local album', file: new Blob([`audio-${id}`], { type: 'audio/wav' }) });
function setup(count = 3, random = () => .2) {
  const audio = new FakeAudio();
  const player = new LocalPlayer(audio, { random });
  const tracks = Array.from({ length: count }, (_, i) => track(String(i)));
  player.setTracks(tracks);
  return { audio, player, tracks };
}

test('selecting local files creates only a Blob source and does not autoplay', () => {
  const { player, audio, tracks } = setup();
  assert.equal(player.currentTrack, tracks[0]);
  assert.equal(player.currentIndex, 0);
  assert.match(audio.src, /^blob:/);
  assert.equal(player.playing, false);
  assert.equal(player.duration, 0);
  assert.equal(player.currentTime, 0);
  player.destroy();
});

test('metadata updates and track reordering preserve the source and playback time', async () => {
  const { player, audio, tracks } = setup();
  await player.playIndex(1);
  const url = audio.src, loads = audio.loads;
  audio.currentTime = 25;
  player.setTracks([tracks[2], { ...tracks[1], title: 'Updated title' }, tracks[0]]);
  assert.equal(audio.src, url);
  assert.equal(audio.loads, loads);
  assert.equal(player.currentTrack.title, 'Updated title');
  assert.equal(player.currentTime, 25);
  assert.equal(player.playing, true);
  player.destroy();
});

test('removing the playing track stops it and selects the first remaining song', async () => {
  const { player, audio, tracks } = setup();
  await player.playIndex(1);
  const oldURL = audio.src;
  player.setTracks([tracks[0], tracks[2]]);
  assert.equal(player.currentTrack.id, '0');
  assert.equal(player.playing, false);
  assert.notEqual(audio.src, oldURL);
  await assert.rejects(fetch(oldURL));
  player.destroy();
});

test('switching and clearing revoke old sources and release the audio element', async () => {
  const { player, audio } = setup();
  const firstURL = audio.src;
  await player.playIndex(1);
  await assert.rejects(fetch(firstURL));
  const secondURL = audio.src;
  player.clear();
  assert.equal(player.currentIndex, -1);
  assert.equal(player.currentTrack, null);
  assert.equal(audio.src, '');
  assert.equal(player.playing, false);
  await assert.rejects(fetch(secondURL));
  player.destroy();
});

test('manual next wraps and previous restarts after three seconds', async () => {
  const { player, audio } = setup();
  await player.playIndex(2);
  await player.next();
  assert.equal(player.currentIndex, 0);
  audio.currentTime = 4;
  await player.previous();
  assert.equal(player.currentIndex, 0);
  assert.equal(player.currentTime, 0);
  await player.previous();
  assert.equal(player.currentIndex, 2);
  player.destroy();
});

test('automatic advance stops at the end with repeat off and wraps with repeat all', async () => {
  const { player, audio } = setup();
  await player.playIndex(2);
  audio.currentTime = 60;
  audio.duration = 60;
  await player.next({ automatic: true });
  assert.equal(player.currentIndex, 2);
  assert.equal(player.playing, false);
  assert.equal(player.currentTime, 60);
  player.setRepeat('all');
  await player.next({ automatic: true });
  assert.equal(player.currentIndex, 0);
  assert.equal(player.playing, true);
  player.destroy();
});

test('repeat one restarts the same source, while manual skip still changes songs', async () => {
  const { player, audio } = setup();
  await player.playIndex(1);
  player.setRepeat('one');
  const url = audio.src;
  audio.currentTime = 80;
  await player.next({ automatic: true });
  assert.equal(audio.src, url);
  assert.equal(player.currentIndex, 1);
  assert.equal(player.currentTime, 0);
  await player.next();
  assert.equal(player.currentIndex, 2);
  player.destroy();
});

test('shuffle visits every song once, then stops or starts a fresh cycle', async () => {
  const { player } = setup(6);
  player.setShuffle(true);
  await player.playIndex(0);
  const heard = [player.currentTrack.id];
  for (let i = 0; i < 5; i++) { await player.next({ automatic: true }); heard.push(player.currentTrack.id); }
  assert.equal(new Set(heard).size, 6);
  assert.equal(await player.next({ automatic: true }), false);
  const last = player.currentTrack.id;
  player.setRepeat('all');
  await player.next({ automatic: true });
  assert.notEqual(player.currentTrack.id, last);
  const nextCycle = [player.currentTrack.id];
  for (let i = 0; i < 4; i++) { await player.next({ automatic: true }); nextCycle.push(player.currentTrack.id); }
  assert.equal(new Set(nextCycle).size, 5);
  player.destroy();
});

test('shuffle previous follows real playback history', async () => {
  const { player } = setup(5);
  player.setShuffle(true);
  await player.playIndex(0);
  await player.next();
  const previous = player.currentTrack.id;
  await player.next();
  const current = player.currentTrack.id;
  await player.previous();
  assert.equal(player.currentTrack.id, previous);
  await player.next();
  assert.equal(player.currentTrack.id, current);
  player.destroy();
});

test('one-track shuffle can repeat or stop without creating an invalid selection', async () => {
  const { player } = setup(1);
  player.setShuffle(true);
  await player.playIndex(0);
  assert.equal(await player.next({ automatic: true }), false);
  await player.next();
  assert.equal(player.currentIndex, 0);
  assert.equal(player.playing, true);
  player.destroy();
});

test('volume and seeking are finite and clamped', () => {
  const { player, audio } = setup();
  player.setVolume(10);
  assert.equal(audio.volume, 1);
  player.setVolume(-2);
  assert.equal(audio.volume, 0);
  player.setVolume(NaN);
  assert.equal(audio.volume, 0);
  audio.duration = 90;
  player.seek(120);
  assert.equal(player.currentTime, 90);
  player.seek(-10);
  assert.equal(player.currentTime, 0);
  player.seek(NaN);
  assert.equal(player.currentTime, 0);
  audio.duration = Infinity;
  assert.equal(player.duration, 0);
  player.destroy();
});

test('playback failures emit one usable error instead of rejecting', async () => {
  const { player, audio } = setup();
  const errors = [];
  player.addEventListener('playerror', event => errors.push(event.detail));
  audio.playImpl = () => Promise.reject(new DOMException('User gesture required', 'NotAllowedError'));
  assert.equal(await player.playIndex(0), false);
  assert.match(errors[0].message, /播放键/);
  audio.error = { code: 3 };
  audio.dispatchEvent(new Event('error'));
  assert.equal(errors.length, 1);
  assert.equal(player.playing, false);
  player.destroy();
});

test('stale play rejection after changing tracks does not report an error for the new song', async () => {
  const { player, audio } = setup();
  let rejectFirst;
  audio.playImpl = () => new Promise((resolve, reject) => { rejectFirst = reject; });
  let errors = 0;
  player.addEventListener('playerror', () => errors++);
  const first = player.playIndex(0);
  audio.playImpl = null;
  await player.playIndex(1);
  rejectFirst(new DOMException('Old source replaced', 'AbortError'));
  await first;
  assert.equal(player.currentIndex, 1);
  assert.equal(player.playing, true);
  assert.equal(errors, 0);
  player.destroy();
});

test('pausing a pending play request keeps it paused when that request later resolves', async () => {
  const { player, audio } = setup();
  let resolvePlay;
  audio.playImpl = () => new Promise(resolve => { resolvePlay = () => { audio.paused = false; resolve(); }; });
  const pending = player.playIndex(0);
  player.pause();
  resolvePlay();
  assert.equal(await pending, false);
  assert.equal(audio.paused, true);
  player.destroy();
});

test('time events are forwarded and destroy disconnects the audio element', () => {
  const { player, audio } = setup();
  let times = 0, changes = 0;
  player.addEventListener('time', () => times++);
  player.addEventListener('change', () => changes++);
  audio.dispatchEvent(new Event('timeupdate'));
  audio.dispatchEvent(new Event('durationchange'));
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(times, 3);
  player.destroy();
  const afterDestroy = { times, changes };
  audio.dispatchEvent(new Event('timeupdate'));
  audio.dispatchEvent(new Event('play'));
  assert.deepEqual({ times, changes }, afterDestroy);
  player.setTracks([track('ignored')]);
  assert.equal(player.currentTrack, null);
});
