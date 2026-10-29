import test from 'node:test';
import assert from 'node:assert/strict';
import { BrickGame } from '../games/brick.js';

test('Brick starts docked, clamps the paddle, and does not advance before launch', () => {
  const game = new BrickGame();
  assert.equal(game.phase, 'ready');
  assert.equal(game.bricks.length, 36);
  assert.equal(game.lives, 3);
  game.movePaddle(-1000).step(1);
  assert.equal(game.paddle.x, 2);
  assert.equal(game.ball.x, game.paddle.x + game.paddle.width / 2);
  game.movePaddle(1000);
  assert.equal(game.paddle.x + game.paddle.width, 278);
  assert.equal(game.ball.vy, 0);
});

test('the launched ball reflects off side and top boundaries', () => {
  const game = new BrickGame().launch();
  game.ball.x = 2.6; game.ball.y = 95; game.ball.vx = -100; game.ball.vy = -40;
  game.step(.02);
  assert.ok(game.ball.vx > 0);
  assert.ok(game.ball.x >= game.ball.radius);
  game.ball.x = 140; game.ball.y = 20.6; game.ball.vy = -100; game.ball.vx = 0;
  game.step(.02);
  assert.ok(game.ball.vy > 0);
  assert.ok(game.ball.y >= 18 + game.ball.radius);
});

test('paddle impact sends the ball upward and uses hit position to aim', () => {
  const game = new BrickGame().launch();
  game.ball.x = game.paddle.x + game.paddle.width - 4;
  game.ball.y = game.paddle.y - game.ball.radius - 1;
  game.ball.vx = 0; game.ball.vy = 100;
  game.step(.04);
  assert.ok(game.ball.vy < 0);
  assert.ok(game.ball.vx > 40);
  assert.ok(game.ball.y + game.ball.radius < game.paddle.y);
});

test('brick contact removes one brick, scores it once, and reflects the ball', () => {
  const game = new BrickGame().launch();
  const brick = game.bricks.at(-1);
  game.ball.x = brick.x + brick.width / 2;
  game.ball.y = brick.y + brick.height + game.ball.radius + 1;
  game.ball.vx = 0; game.ball.vy = -100;
  game.step(.03);
  assert.equal(brick.alive, false);
  assert.equal(game.score, 10);
  assert.ok(game.ball.vy > 0);
  game.step(.03);
  assert.equal(game.score, 10);
});

test('missing the paddle costs one life, docks the next ball, and eventually ends', () => {
  const game = new BrickGame();
  for (let remaining = 2; remaining >= 0; remaining--) {
    game.launch();
    game.ball.y = 170; game.ball.vy = 100;
    game.step(.01);
    assert.equal(game.lives, remaining);
    assert.equal(game.phase, remaining ? 'ready' : 'over');
  }
  game.launch();
  assert.equal(game.phase, 'running');
  assert.equal(game.lives, 3);
  assert.equal(game.score, 0);
});

test('clearing a level preserves score and lives; the third clear wins', () => {
  const game = new BrickGame();
  for (let level = 1; level <= 3; level++) {
    game.launch();
    game.bricks.forEach(brick => { brick.alive = false; });
    const brick = game.bricks.at(-1); brick.alive = true;
    game.ball.x = brick.x + 13; game.ball.y = brick.y + brick.height + 3.5;
    game.ball.vx = 0; game.ball.vy = -100;
    game.step(.03);
    assert.equal(game.score, level * 10);
    assert.equal(game.lives, 3);
    assert.equal(game.phase, level === 3 ? 'won' : 'ready');
  }
  assert.equal(game.level, 3);
});

test('pause freezes physics and paddle movement, and launch resumes the same ball', () => {
  const game = new BrickGame().launch();
  game.step(.02).pause();
  const ball = { ...game.ball }, paddleX = game.paddle.x;
  game.step(1).movePaddle(50);
  assert.deepEqual(game.ball, ball);
  assert.equal(game.paddle.x, paddleX);
  game.launch().step(.02);
  assert.equal(game.phase, 'running');
  assert.notEqual(game.ball.y, ball.y);
  game.togglePause();
  assert.equal(game.phase, 'paused');
  game.togglePause();
  assert.equal(game.phase, 'running');
});

test('long frame delays are capped rather than teleporting through the board', () => {
  const short = new BrickGame().launch(), late = new BrickGame().launch();
  short.step(.1); late.step(500);
  assert.deepEqual(late.ball, short.ball);
  const before = { ...late.ball };
  late.step(NaN).step(-1);
  assert.deepEqual(late.ball, before);
});
