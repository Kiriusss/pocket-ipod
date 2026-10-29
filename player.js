/** Local-file playback. Audio sources are always browser-created Blob URLs. */
export class LocalPlayer extends EventTarget {
  constructor(audio = new Audio(), { random = Math.random } = {}) {
    super();
    this.audio = audio;
    this.random = random;
    this.tracks = [];
    this.currentIndex = -1;
    this.shuffle = false;
    this.repeat = 'off';
    this.volume = Number.isFinite(audio.volume) ? audio.volume : 1;
    this._objectURL = null;
    this._loadedID = null;
    this._loadedFile = null;
    this._generation = 0;
    this._playRequest = 0;
    this._intentToPlay = false;
    this._errorGeneration = -1;
    this._upcoming = [];
    this._history = [];
    this._destroyed = false;
    this.audio.preload = 'metadata';
    this._listeners = {
      play: () => this._change(),
      pause: () => this._change(),
      playing: () => this._change(),
      timeupdate: () => this._time(),
      durationchange: () => this._time(),
      loadedmetadata: () => this._time(),
      ended: () => { void this.next({ automatic: true }); },
      error: () => {
        if (!this._objectURL || this._destroyed) return;
        this._intentToPlay = false;
        this._emitError(this.audio.error || new Error('Unable to decode this audio file.'));
        this._change();
      },
    };
    for (const [name, listener] of Object.entries(this._listeners)) audio.addEventListener(name, listener);
  }

  get currentTrack() { return this.tracks[this.currentIndex] ?? null; }
  get playing() { return !!this.currentTrack && !!this._objectURL && !this.audio.paused && !this.audio.ended; }
  get duration() { return Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : 0; }
  get currentTime() { return Number.isFinite(this.audio.currentTime) && this.audio.currentTime > 0 ? this.audio.currentTime : 0; }

  /** Updating metadata or the ordering of an unchanged current file never interrupts it. */
  setTracks(tracks) {
    if (this._destroyed) return this;
    const previous = this.currentTrack;
    const oldIDs = this.tracks.map(track => track.id);
    const seen = new Set();
    this.tracks = (Array.isArray(tracks) ? tracks : []).filter(track => {
      if (!track || track.id == null || !track.file || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
    const preserved = previous ? this.tracks.findIndex(track => track.id === previous.id) : -1;
    const nextIndex = preserved >= 0 ? preserved : this.tracks.length ? 0 : -1;
    const next = this.tracks[nextIndex];
    if (next && next.id === this._loadedID && next.file === this._loadedFile) {
      this.currentIndex = nextIndex;
    } else if (next) {
      this._load(nextIndex);
    } else {
      this.currentIndex = -1;
      this._release();
    }
    const membershipChanged = oldIDs.length !== seen.size || oldIDs.some(id => !seen.has(id));
    if (this.shuffle && membershipChanged) this._resetShuffle();
    this._history = this._history.filter(id => seen.has(id));
    this._change();
    return this;
  }

  async playIndex(index) {
    if (this._destroyed || !Number.isInteger(index) || index < 0 || index >= this.tracks.length) return false;
    const track = this.tracks[index];
    if (this._loadedID !== track.id || this._loadedFile !== track.file || !this._objectURL) {
      if (!this._load(index)) return false;
    } else {
      this.currentIndex = index;
    }
    if (this.shuffle) this._upcoming = this._upcoming.filter(id => id !== track.id);
    return this._play();
  }

  async toggle() {
    if (this._destroyed || !this.tracks.length) return false;
    if (this.playing || this._intentToPlay) { this.pause(); return false; }
    if (this.audio.ended) this.seek(0);
    return this.playIndex(this.currentIndex < 0 ? 0 : this.currentIndex);
  }

  pause() {
    this._intentToPlay = false;
    this._playRequest += 1;
    this.audio.pause();
    this._change();
    return this;
  }

  async next({ automatic = false } = {}) {
    if (this._destroyed || !this.tracks.length) return false;
    if (automatic && this.repeat === 'one') {
      this.seek(0);
      return this.playIndex(this.currentIndex);
    }
    let index;
    if (this.shuffle) {
      if (!this._upcoming.length) {
        if (automatic && this.repeat === 'off') { this.pause(); return false; }
        this._resetShuffle();
      }
      const id = this._upcoming.shift();
      index = id == null ? this.currentIndex : this.tracks.findIndex(track => track.id === id);
    } else {
      index = this.currentIndex + 1;
      if (index >= this.tracks.length) {
        if (automatic && this.repeat === 'off') { this.pause(); return false; }
        index = 0;
      }
    }
    if (this.currentTrack) this._history.push(this.currentTrack.id);
    if (this._history.length > 1000) this._history.shift();
    if (index === this.currentIndex) this.seek(0);
    return this.playIndex(index);
  }

  async previous() {
    if (this._destroyed || !this.tracks.length) return false;
    if (this.currentTime > 3) { this.seek(0); return this.playIndex(this.currentIndex); }
    let index;
    if (this.shuffle && this._history.length) {
      const currentID = this.currentTrack?.id;
      const previousID = this._history.pop();
      index = this.tracks.findIndex(track => track.id === previousID);
      if (currentID != null && !this._upcoming.includes(currentID)) this._upcoming.unshift(currentID);
    } else {
      index = (this.currentIndex - 1 + this.tracks.length) % this.tracks.length;
    }
    if (index < 0) index = 0;
    if (index === this.currentIndex) this.seek(0);
    return this.playIndex(index);
  }

  seek(seconds) {
    if (!this.currentTrack || !this._objectURL || !Number.isFinite(Number(seconds))) return this;
    const value = Math.max(0, Math.min(Number(seconds), this.duration || Number(seconds)));
    try { this.audio.currentTime = value; } catch { /* A not-yet-ready decoder may reject seeking. */ }
    this._time();
    return this;
  }

  setVolume(value) {
    if (!Number.isFinite(Number(value))) return this;
    this.volume = Math.max(0, Math.min(1, Number(value)));
    this.audio.volume = this.volume;
    this._change();
    return this;
  }

  setShuffle(value) {
    const enabled = !!value;
    if (enabled !== this.shuffle) {
      this.shuffle = enabled;
      this._history = [];
      if (enabled) this._resetShuffle();
      else this._upcoming = [];
      this._change();
    }
    return this;
  }

  setRepeat(value) {
    if (!['off', 'all', 'one'].includes(value)) return this;
    this.repeat = value;
    this._change();
    return this;
  }

  clear() {
    this.tracks = [];
    this.currentIndex = -1;
    this._upcoming = [];
    this._history = [];
    this._release();
    this._change();
    this._time();
    return this;
  }

  destroy() {
    if (this._destroyed) return;
    this.clear();
    for (const [name, listener] of Object.entries(this._listeners)) this.audio.removeEventListener(name, listener);
    this._destroyed = true;
  }

  _load(index) {
    this.currentIndex = index;
    this._release();
    const track = this.currentTrack;
    if (!track) return false;
    try {
      this._objectURL = URL.createObjectURL(track.file);
      this._loadedID = track.id;
      this._loadedFile = track.file;
      this.audio.src = this._objectURL;
      this.audio.load();
      this._change();
      this._time();
      return true;
    } catch (error) {
      this._emitError(error);
      this._release();
      return false;
    }
  }

  _release() {
    this._generation += 1;
    this._playRequest += 1;
    this._intentToPlay = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this._objectURL) URL.revokeObjectURL(this._objectURL);
    this._objectURL = null;
    this._loadedID = null;
    this._loadedFile = null;
  }

  async _play() {
    if (!this._objectURL || this._destroyed) return false;
    const generation = this._generation;
    const request = ++this._playRequest;
    this._intentToPlay = true;
    try {
      await this.audio.play();
      if (this._destroyed || generation !== this._generation) return false;
      if (request !== this._playRequest || !this._intentToPlay) {
        if (!this._intentToPlay) this.audio.pause();
        return false;
      }
      this._change();
      return this.playing;
    } catch (error) {
      if (this._destroyed || generation !== this._generation || request !== this._playRequest) return false;
      this._intentToPlay = false;
      if (error?.name !== 'AbortError') this._emitError(error);
      this._change();
      return false;
    }
  }

  _resetShuffle() {
    this._upcoming = this.tracks.filter(track => track.id !== this.currentTrack?.id).map(track => track.id);
    for (let i = this._upcoming.length - 1; i > 0; i--) {
      const sample = Number(this.random());
      const j = Math.max(0, Math.min(i, Math.floor((Number.isFinite(sample) ? sample : 0) * (i + 1))));
      [this._upcoming[i], this._upcoming[j]] = [this._upcoming[j], this._upcoming[i]];
    }
  }

  _emitError(error) {
    if (this._destroyed || this._errorGeneration === this._generation) return;
    this._errorGeneration = this._generation;
    const message = error?.name === 'NotAllowedError'
      ? '浏览器尚未允许播放，请点击播放键重试。'
      : '无法播放这首音乐，请尝试其他音频文件。';
    this.dispatchEvent(new CustomEvent('playerror', { detail: { message, error } }));
  }

  _change() { if (!this._destroyed) this.dispatchEvent(new Event('change')); }
  _time() { if (!this._destroyed) this.dispatchEvent(new Event('time')); }
}
