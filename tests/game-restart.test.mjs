import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrickGame } from '../games/brick.js';
import { createParachuteGame } from '../games/parachute.js';

test('R restart input returns both arcade games to their ready screen and stops old play', () => {
  const original = Object.fromEntries(['document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new EventTarget(); document.hidden = false;
  let scheduled = 0, cancelled = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => ++scheduled });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => { cancelled++; } });
  const context = new Proxy({}, { get: (target, name) => target[name] ?? (() => {}) });
  const canvas = { width: 560, height: 328, getContext: () => context };
  try {
    for (const create of [createBrickGame, createParachuteGame]) {
      const notices = [];
      const controller = create({ canvas, onStatus: message => notices.push(message) });
      const readyNotice = notices.at(-1);
      controller.input('select');
      controller.input('play');
      assert.match(notices.at(-1), /继续/);
      controller.input('restart');
      assert.equal(notices.at(-1), readyNotice);
      if (controller.game) {
        assert.equal(controller.game.phase, 'ready');
        assert.equal(controller.game.lives, 3);
        assert.equal(controller.game.score, 0);
      }
      controller.destroy();
    }
    assert.equal(cancelled, 2);
  } finally {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
