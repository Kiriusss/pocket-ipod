import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');

test('local playback privacy policy blocks data transmission and remote media', () => {
  const policy = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
  assert.ok(policy, 'A CSP must be present before any application scripts run');
  const directives = new Map(policy.split(';').map(value => value.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives.get('connect-src'), ["'none'"]);
  assert.deepEqual(directives.get('media-src'), ['blob:']);
  assert.deepEqual(directives.get('form-action'), ["'none'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('frame-src'), ["'none'"]);
  assert.deepEqual(directives.get('script-src'), ["'self'"]);
});

test('every linked application asset is shipped locally, without third-party requests', async () => {
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi)].map(match => match[1]);
  assert.ok(assets.length > 0);
  for (const asset of assets) {
    assert.match(asset, /^\.\//, `${asset} must be relative to this installation`);
    assert.ok((await readFile(new URL(asset, root))).byteLength > 0, `${asset} must be included`);
  }
});

test('application code contains no network transport calls', async () => {
  for (const file of ['app.js', 'player.js', 'library.js', 'ncm.js', 'theme-init.js', 'games/index.js', 'games/brick.js', 'games/parachute.js', 'games/solitaire.js']) {
    const source = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(|\.sendBeacon\s*\(/, `${file} must not send music or metadata`);
  }
});
