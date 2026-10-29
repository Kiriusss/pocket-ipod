const WIDTH = 280;
const HEIGHT = 164;
const PLAY_TOP = 18;

/** A small, deterministic Brick rules engine. Time values are in seconds. */
export class BrickGame {
  constructor() { this.reset(); }

  reset() {
    this.score = 0;
    this.level = 1;
    this.lives = 3;
    this.phase = 'ready';
    this.paddle = { x: WIDTH / 2 - 23, y: 147, width: 46, height: 5 };
    this.ball = { x: WIDTH / 2, y: 141.5, radius: 2.5, vx: 0, vy: 0 };
    this._makeBricks();
    this._dockBall();
    return this;
  }

  _makeBricks() {
    this.bricks = [];
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 9; column++) {
        this.bricks.push({ x: 11 + column * 29, y: 27 + row * 11, width: 26, height: 7, alive: true, row });
      }
    }
  }

  _dockBall() {
    this.ball.x = this.paddle.x + this.paddle.width / 2;
    this.ball.y = this.paddle.y - this.ball.radius - 1;
    this.ball.vx = 0;
    this.ball.vy = 0;
  }

  movePaddle(pixels) {
    if (!Number.isFinite(pixels) || this.phase === 'over' || this.phase === 'won' || this.phase === 'paused') return this;
    this.paddle.x = Math.max(2, Math.min(WIDTH - this.paddle.width - 2, this.paddle.x + pixels));
    if (this.phase === 'ready') this._dockBall();
    return this;
  }

  launch() {
    if (this.phase === 'over' || this.phase === 'won') this.reset();
    if (this.phase === 'paused') { this.phase = 'running'; return this; }
    if (this.phase !== 'ready') return this;
    const speed = 108 + (this.level - 1) * 18;
    this.ball.vx = speed * .43;
    this.ball.vy = -speed * .903;
    this.phase = 'running';
    return this;
  }

  pause() { if (this.phase === 'running') this.phase = 'paused'; return this; }
  togglePause() {
    if (this.phase === 'running') this.pause();
    else if (this.phase === 'paused') this.phase = 'running';
    return this;
  }

  step(seconds) {
    if (this.phase !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return this;
    // A late animation frame cannot jump through a paddle or a brick.
    const elapsed = Math.min(seconds, .1);
    const steps = Math.max(1, Math.ceil(elapsed / (1 / 240)));
    const dt = elapsed / steps;
    for (let i = 0; i < steps && this.phase === 'running'; i++) this._step(dt);
    return this;
  }

  _step(dt) {
    const ball = this.ball;
    const oldX = ball.x, oldY = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.x < ball.radius) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx); }
    if (ball.x > WIDTH - ball.radius) { ball.x = WIDTH - ball.radius; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < PLAY_TOP + ball.radius) { ball.y = PLAY_TOP + ball.radius; ball.vy = Math.abs(ball.vy); }

    const paddle = this.paddle;
    if (ball.vy > 0 && oldY + ball.radius <= paddle.y && ball.y + ball.radius >= paddle.y &&
        ball.x + ball.radius >= paddle.x && ball.x - ball.radius <= paddle.x + paddle.width) {
      const hit = Math.max(-1, Math.min(1, (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2)));
      const speed = Math.max(108, Math.hypot(ball.vx, ball.vy));
      const angle = hit * Math.PI * .34;
      ball.vx = Math.sin(angle) * speed;
      ball.vy = -Math.cos(angle) * speed;
      ball.y = paddle.y - ball.radius - .01;
    }

    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const nearestX = Math.max(brick.x, Math.min(brick.x + brick.width, ball.x));
      const nearestY = Math.max(brick.y, Math.min(brick.y + brick.height, ball.y));
      if ((ball.x - nearestX) ** 2 + (ball.y - nearestY) ** 2 > ball.radius ** 2) continue;
      brick.alive = false;
      this.score += 10;
      if (oldY + ball.radius <= brick.y) { ball.vy = -Math.abs(ball.vy); ball.y = brick.y - ball.radius - .01; }
      else if (oldY - ball.radius >= brick.y + brick.height) { ball.vy = Math.abs(ball.vy); ball.y = brick.y + brick.height + ball.radius + .01; }
      else if (oldX + ball.radius <= brick.x) { ball.vx = -Math.abs(ball.vx); ball.x = brick.x - ball.radius - .01; }
      else if (oldX - ball.radius >= brick.x + brick.width) { ball.vx = Math.abs(ball.vx); ball.x = brick.x + brick.width + ball.radius + .01; }
      else {
        // Resolve a rare corner overlap on its shallowest axis.
        const horizontal = Math.min(Math.abs(ball.x + ball.radius - brick.x), Math.abs(brick.x + brick.width + ball.radius - ball.x));
        const vertical = Math.min(Math.abs(ball.y + ball.radius - brick.y), Math.abs(brick.y + brick.height + ball.radius - ball.y));
        if (horizontal < vertical) ball.vx = -ball.vx;
        else ball.vy = -ball.vy;
      }
      if (this.bricks.every(item => !item.alive)) {
        if (this.level === 3) this.phase = 'won';
        else { this.level++; this._makeBricks(); this.phase = 'ready'; this._dockBall(); }
      }
      break;
    }

    if (ball.y - ball.radius > HEIGHT) {
      this.lives--;
      this.phase = this.lives > 0 ? 'ready' : 'over';
      this._dockBall();
    }
  }
}

/** Canvas view used inside the iPod LCD. It owns and releases its RAF listener. */
export function createBrickGame({ canvas, getTheme = () => 'light', onStatus = () => {} }) {
  const game = new BrickGame();
  const ctx = canvas.getContext('2d');
  let destroyed = false;
  let frame = 0;
  let previousTime = 0;
  let lastStatus = '';
  const documentObject = typeof document === 'undefined' ? null : document;

  function render() {
    if (destroyed || !ctx) return;
    const dark = getTheme() === 'dark';
    const palette = dark
      ? { background: '#1d2b23', ink: '#c3d7b7', muted: '#91aa88', line: '#425a45', bricks: ['#8aa5b6', '#7296a8', '#668b99', '#5b818b'], panel: '#213628' }
      : { background: '#d1ddcc', ink: '#2d4531', muted: '#5e7959', line: '#9db299', bricks: ['#427497', '#557f98', '#688c9c', '#77999e'], panel: '#d9e5d3' };
    ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.font = '9px monospace';
    ctx.fillStyle = palette.ink;
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE ${String(game.score).padStart(4, '0')}`, 8, 12);
    ctx.textAlign = 'center';
    ctx.fillText(`BRICK ${game.level}/3`, WIDTH / 2, 12);
    ctx.textAlign = 'right';
    ctx.fillText(`LIFE ${game.lives}`, WIDTH - 8, 12);
    ctx.fillStyle = palette.line;
    ctx.fillRect(6, 17, WIDTH - 12, 1);
    for (const brick of game.bricks) {
      if (!brick.alive) continue;
      ctx.fillStyle = palette.bricks[brick.row];
      ctx.fillRect(brick.x, brick.y, brick.width, brick.height);
      ctx.fillStyle = dark ? '#aac1bd44' : '#eff8e333';
      ctx.fillRect(brick.x + 1, brick.y, brick.width - 2, 1);
    }
    ctx.fillStyle = palette.ink;
    ctx.fillRect(Math.round(game.paddle.x), game.paddle.y, game.paddle.width, game.paddle.height);
    ctx.fillRect(Math.round(game.ball.x - 2), Math.round(game.ball.y - 2), 4, 4);
    if (game.phase !== 'running') {
      const messages = {
        ready: ['打砖块', '转盘移动挡板 · 中键发球'],
        paused: ['已暂停', '播放键继续 · MENU 返回'],
        over: ['游戏结束', '中键再来一局 · MENU 返回'],
        won: ['三关全通！', '中键再来一局 · MENU 返回'],
      }[game.phase];
      ctx.fillStyle = palette.panel;
      ctx.fillRect(28, 80, 224, 43);
      ctx.strokeStyle = palette.line;
      ctx.strokeRect(28.5, 80.5, 223, 42);
      ctx.textAlign = 'center';
      ctx.fillStyle = palette.ink;
      ctx.font = 'bold 13px Arial, "Microsoft YaHei", sans-serif';
      ctx.fillText(messages[0], WIDTH / 2, 97);
      ctx.font = '9px Arial, "Microsoft YaHei", sans-serif';
      ctx.fillStyle = palette.muted;
      ctx.fillText(messages[1], WIDTH / 2, 113);
    }
    const status = `${game.phase}:${game.level}:${game.lives}`;
    if (lastStatus !== status) {
      lastStatus = status;
      onStatus(game.phase === 'running' ? '转盘移动 · 播放键暂停' : game.phase === 'paused' ? '播放键继续 · MENU 返回' : '转盘移动 · 中键发球');
    }
  }

  function input(action, value = 1) {
    if (destroyed) return;
    if (action === 'restart') game.reset();
    else if (action === 'move') game.movePaddle(Number(value) * 12);
    else if (action === 'left') game.movePaddle(-12);
    else if (action === 'right') game.movePaddle(12);
    else if (action === 'select') game.launch();
    else if (action === 'play') {
      if (['ready', 'over', 'won'].includes(game.phase)) game.launch();
      else game.togglePause();
    }
    render();
  }

  function pause() { game.pause(); render(); }
  const visibility = () => { if (documentObject?.hidden) pause(); };
  documentObject?.addEventListener('visibilitychange', visibility);

  function animate(now) {
    if (destroyed) return;
    const dt = previousTime ? (now - previousTime) / 1000 : 0;
    previousTime = now;
    if (!documentObject?.hidden) { game.step(dt); render(); }
    frame = requestAnimationFrame(animate);
  }
  render();
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(animate);

  return {
    game, input, render, pause,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      documentObject?.removeEventListener('visibilitychange', visibility);
    },
  };
}
