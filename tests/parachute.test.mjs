import test from 'node:test';
import assert from 'node:assert/strict';
import { ParachuteGame } from '../games/parachute.js';

const fresh = () => {
  const game = new ParachuteGame({ random: () => .25 });
  game.spawnTimer = 100;
  return game;
};

test('parachute spawns deterministic aircraft and falling soldiers', () => {
  const game = fresh();
  const helicopter = game.spawnHelicopter();
  assert.equal(helicopter.x, -20);
  assert.equal(helicopter.y, 35.25);
  assert.ok(helicopter.vx > 0);
  helicopter.x = 60;
  const soldier = game.dropParachutist(helicopter);
  assert.equal(soldier.x, 60);
  assert.equal(soldier.y, helicopter.y + 14);
  assert.equal(soldier.chute, true);
  game.start().update(.1);
  assert.ok(soldier.y > helicopter.y + 14);
});

test('turret aiming clamps safely and fired shots follow its aim with a cooldown', () => {
  const game = fresh();
  assert.equal(game.fire(), false);
  game.aim(999); assert.equal(game.angle, 1.17);
  game.aim(-999); assert.equal(game.angle, -1.17);
  game.aim(NaN); assert.equal(game.angle, -1.17);
  game.start();
  assert.equal(game.fire(), true);
  assert.ok(game.bullets[0].vx < 0);
  assert.ok(game.bullets[0].vy < 0);
  assert.equal(game.fire(), false);
  game.update(.18);
  assert.equal(game.fire(), true);
});

test('projectiles remove hit helicopters and award points once', () => {
  const game = fresh().start();
  game.helicopters.push({ x: 140, y: 60, vx: 0, dropTimer: 99, alive: true });
  game.bullets.push({ x: 140, y: 72, vx: 0, vy: -185 });
  game.update(.1);
  assert.equal(game.helicopters.length, 0);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.score, 25);
  game.update(.1);
  assert.equal(game.score, 25);
});

test('body shots remove parachutists, while cutting a canopy makes them fall without landing', () => {
  const game = fresh().start();
  game.parachutists.push({ x: 80, y: 70, vx: 0, vy: 0, chute: true, alive: true });
  game.bullets.push({ x: 80, y: 78, vx: 0, vy: -185 });
  game.update(.05);
  assert.equal(game.parachutists.length, 0);
  assert.equal(game.score, 10);

  const falling = { x: 200, y: 90, vx: 0, vy: 0, chute: true, alive: true };
  game.parachutists.push(falling);
  game.bullets.push({ x: 194, y: 80, vx: 185, vy: 0 });
  game.update(.01);
  assert.equal(falling.chute, false);
  assert.equal(game.score, 15);
  for (let i = 0; i < 15; i++) game.update(.1);
  assert.equal(game.parachutists.length, 0);
  assert.deepEqual(game.landed, { left: 0, right: 0 });
  assert.equal(game.score, 20);
});

test('four safe landings on either side end the game', () => {
  const game = fresh().start();
  game.landed.left = 3;
  game.parachutists.push({ x: 30, y: 138, vx: 0, vy: 20, chute: true, alive: true });
  game.update(.1);
  assert.deepEqual(game.landed, { left: 4, right: 0 });
  assert.equal(game.status, 'over');
  const elapsed = game.elapsed;
  game.update(.2);
  assert.equal(game.elapsed, elapsed);
});

test('pause freezes physics and reset gives a clean new round', () => {
  const game = fresh().start();
  game.fire(); game.pause();
  const position = { x: game.bullets[0].x, y: game.bullets[0].y };
  game.update(.2);
  assert.equal(game.status, 'paused');
  assert.equal(game.bullets[0].y, position.y);
  assert.equal(game.fire(), false);
  game.resume().update(.1);
  assert.ok(game.bullets[0].y < position.y);
  game.score = 100;
  game.reset();
  assert.equal(game.status, 'ready');
  assert.equal(game.score, 0);
  assert.equal(game.angle, 0);
  assert.equal(game.bullets.length, 0);
  assert.deepEqual(game.landed, { left: 0, right: 0 });
});
