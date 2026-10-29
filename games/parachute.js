const WIDTH = 280;
const HEIGHT = 164;
const GROUND = 144;
const TURRET_X = WIDTH / 2;
const MAX_ANGLE = 1.17;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function segmentDistanceSquared(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1) : 0;
  return (px - ax - dx * t) ** 2 + (py - ay - dy * t) ** 2;
}

/** Original local recreation of the classic turret-and-parachutes game. */
export class ParachuteGame {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.reset();
  }

  reset() {
    this.status = 'ready';
    this.score = 0;
    this.angle = 0;
    this.landed = { left: 0, right: 0 };
    this.helicopters = [];
    this.parachutists = [];
    this.bullets = [];
    this.cooldown = 0;
    this.spawnTimer = .2;
    this.elapsed = 0;
    return this;
  }

  start() { if (this.status === 'ready' || this.status === 'paused') this.status = 'running'; return this; }
  pause() { if (this.status === 'running') this.status = 'paused'; return this; }
  resume() { if (this.status === 'paused') this.status = 'running'; return this; }

  aim(steps) {
    if (!Number.isFinite(Number(steps))) return this;
    this.angle = clamp(this.angle + Number(steps) * .13, -MAX_ANGLE, MAX_ANGLE);
    return this;
  }

  fire() {
    if (this.status !== 'running' || this.cooldown > 0) return false;
    const dx = Math.sin(this.angle), dy = -Math.cos(this.angle);
    this.bullets.push({ x: TURRET_X + dx * 17, y: GROUND - 4 + dy * 17, vx: dx * 185, vy: dy * 185 });
    this.cooldown = .17;
    return true;
  }

  spawnHelicopter() {
    const fromLeft = this.random() < .5;
    const speed = 28 + this.random() * 14 + Math.min(18, this.elapsed / 10);
    const helicopter = {
      x: fromLeft ? -20 : WIDTH + 20,
      y: 29 + this.random() * 25,
      vx: fromLeft ? speed : -speed,
      dropTimer: .75 + this.random() * .7,
      alive: true,
    };
    this.helicopters.push(helicopter);
    return helicopter;
  }

  dropParachutist(helicopter) {
    const parachutist = {
      x: helicopter.x,
      y: helicopter.y + 14,
      vy: 15 + Math.min(10, this.elapsed / 14),
      vx: (this.random() - .5) * 3,
      chute: true,
      alive: true,
    };
    this.parachutists.push(parachutist);
    return parachutist;
  }

  update(seconds) {
    if (this.status !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return this;
    const dt = Math.min(seconds, .2);
    const count = Math.ceil(dt / .01);
    for (let i = 0; i < count && this.status === 'running'; i++) this._step(dt / count);
    return this;
  }

  _step(dt) {
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnHelicopter();
      this.spawnTimer = Math.max(1.2, 2.7 - this.elapsed / 90) + this.random() * .65;
    }
    for (const helicopter of this.helicopters) {
      helicopter.x += helicopter.vx * dt;
      helicopter.dropTimer -= dt;
      if (helicopter.dropTimer <= 0) {
        if (helicopter.x > 19 && helicopter.x < WIDTH - 19 && Math.abs(helicopter.x - TURRET_X) > 17) this.dropParachutist(helicopter);
        helicopter.dropTimer = 1.3 + this.random() * .75;
      }
      if (helicopter.x < -35 || helicopter.x > WIDTH + 35) helicopter.alive = false;
    }

    for (const parachutist of this.parachutists) {
      parachutist.y += parachutist.vy * dt;
      parachutist.x = clamp(parachutist.x + parachutist.vx * dt, 9, WIDTH - 9);
      if (!parachutist.chute) parachutist.vy = Math.min(125, parachutist.vy + dt * 135);
    }

    for (const bullet of this.bullets) {
      const oldX = bullet.x, oldY = bullet.y;
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt;
      for (const helicopter of this.helicopters) {
        if (!helicopter.alive) continue;
        // Substeps bound the projectile advance to under two pixels.
        const distance = segmentDistanceSquared(oldX, oldY, bullet.x, bullet.y, helicopter.x, helicopter.y);
        if (distance <= 10 ** 2) {
          helicopter.alive = false; bullet.dead = true; this.score += 25; break;
        }
      }
      if (!bullet.dead) for (const parachutist of this.parachutists) {
        if (!parachutist.alive) continue;
        const bodyDistance = segmentDistanceSquared(oldX, oldY, bullet.x, bullet.y, parachutist.x, parachutist.y);
        if (bodyDistance <= 4.5 ** 2) {
          parachutist.alive = false; bullet.dead = true; this.score += 10; break;
        }
        const chuteDistance = segmentDistanceSquared(oldX, oldY, bullet.x, bullet.y, parachutist.x, parachutist.y - 10);
        if (parachutist.chute && chuteDistance <= 8 ** 2) {
          parachutist.chute = false; bullet.dead = true; this.score += 5; break;
        }
      }
      if (bullet.x < -3 || bullet.x > WIDTH + 3 || bullet.y < 15 || bullet.y > GROUND) bullet.dead = true;
    }

    for (const parachutist of this.parachutists) {
      if (!parachutist.alive || parachutist.y < GROUND - 5) continue;
      parachutist.alive = false;
      if (parachutist.chute) {
        const side = parachutist.x < TURRET_X ? 'left' : 'right';
        this.landed[side]++;
        if (this.landed[side] >= 4) this.status = 'over';
      } else this.score += 5;
    }
    this.helicopters = this.helicopters.filter(item => item.alive);
    this.parachutists = this.parachutists.filter(item => item.alive);
    this.bullets = this.bullets.filter(item => !item.dead);
  }
}

export function createParachuteGame({ canvas, getTheme = () => 'light', onStatus = () => {} }) {
  const game = new ParachuteGame();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前设备无法创建游戏画面。');
  let destroyed = false, frame = 0, previous = 0, previousStatus;

  function notify() {
    if (game.status === previousStatus) return;
    previousStatus = game.status;
    const messages = {
      ready: '转盘瞄准 · 中键开始 / 射击',
      running: '转盘瞄准 · 中键射击 · 播放键暂停',
      paused: '已暂停 · 播放键继续 · MENU 返回',
      over: '中键重新开始 · MENU 返回',
    };
    onStatus(messages[game.status]);
  }

  function soldier(x, y, color, landed = false) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x - 1), Math.round(y - 6), 3, 3);
    ctx.fillRect(Math.round(x - 2), Math.round(y - 3), 5, 4);
    ctx.fillRect(Math.round(x - 3), Math.round(y + 1), 2, 4);
    ctx.fillRect(Math.round(x + 2), Math.round(y + 1), 2, 4);
    if (!landed) {
      ctx.fillRect(Math.round(x - 5), Math.round(y - 3), 3, 1);
      ctx.fillRect(Math.round(x + 3), Math.round(y - 3), 3, 1);
    }
  }

  function render() {
    if (destroyed) return;
    const dark = getTheme() === 'dark';
    const colors = dark
      ? { bg: '#26372e', fg: '#c2d3b4', muted: '#7c9775', accent: '#9abc9f', alert: '#d4aa8b', glass: '#26372ef0' }
      : { bg: '#d4dfd4', fg: '#345039', muted: '#8ca486', accent: '#4b7490', alert: '#8c564b', glass: '#d4dfd4f0' };
    ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = colors.fg; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`SCORE ${String(game.score).padStart(3, '0')}`, 8, 11);
    ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`左 ${game.landed.left}/4   右 ${game.landed.right}/4`, WIDTH - 8, 11);
    ctx.strokeStyle = colors.muted; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.moveTo(0, 17); ctx.lineTo(WIDTH, 17); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, GROUND + .5); ctx.lineTo(WIDTH, GROUND + .5); ctx.stroke();
    ctx.fillStyle = colors.muted;
    for (let x = 3; x < WIDTH; x += 9) ctx.fillRect(x, GROUND + 6 + (x % 3), 2, 1);

    for (const helicopter of game.helicopters) {
      const x = Math.round(helicopter.x), y = Math.round(helicopter.y), direction = Math.sign(helicopter.vx);
      ctx.save(); ctx.translate(x, y); ctx.scale(direction, 1);
      ctx.fillStyle = colors.fg;
      ctx.fillRect(-8, -4, 14, 8); ctx.fillRect(6, -2, 5, 5);
      ctx.fillRect(-18, -1, 10, 2); ctx.fillRect(-19, -5, 2, 5);
      ctx.fillStyle = colors.bg; ctx.fillRect(3, -3, 4, 3);
      ctx.fillStyle = colors.fg; ctx.fillRect(-3, -8, 1, 4);
      ctx.fillRect(-15, -9, 26, 1); ctx.fillRect(-7, 6, 17, 1);
      ctx.fillRect(-6, 3, 1, 3); ctx.fillRect(6, 3, 1, 3);
      ctx.restore();
    }
    for (const parachutist of game.parachutists) {
      const x = parachutist.x, y = parachutist.y;
      if (parachutist.chute) {
        ctx.strokeStyle = colors.fg; ctx.lineWidth = .85;
        ctx.beginPath(); ctx.arc(x, y - 9, 9, Math.PI, 0); ctx.lineTo(x - 9, y - 9);
        ctx.moveTo(x - 9, y - 9); ctx.lineTo(x, y - 2); ctx.lineTo(x + 9, y - 9);
        ctx.moveTo(x, y - 17); ctx.lineTo(x, y - 3); ctx.stroke();
      }
      soldier(x, y, colors.fg);
    }
    for (const side of ['left', 'right']) for (let i = 0; i < game.landed[side]; i++) {
      const x = side === 'left' ? 20 + i * 20 : WIDTH - 20 - i * 20;
      soldier(x, GROUND - 5, colors.alert, true);
    }
    ctx.fillStyle = colors.fg;
    ctx.beginPath(); ctx.arc(TURRET_X, GROUND, 10, Math.PI, 0); ctx.fill();
    ctx.fillRect(TURRET_X - 13, GROUND - 1, 26, 3);
    ctx.strokeStyle = colors.fg; ctx.lineWidth = 3.5; ctx.lineCap = 'square';
    ctx.beginPath(); ctx.moveTo(TURRET_X, GROUND - 4);
    ctx.lineTo(TURRET_X + Math.sin(game.angle) * 17, GROUND - 4 - Math.cos(game.angle) * 17); ctx.stroke();
    ctx.fillStyle = colors.accent;
    for (const bullet of game.bullets) ctx.fillRect(Math.round(bullet.x) - 1, Math.round(bullet.y) - 2, 2, 4);
    if (game.status !== 'running') {
      ctx.fillStyle = colors.glass; ctx.fillRect(34, 49, WIDTH - 68, 69);
      ctx.strokeStyle = colors.muted; ctx.lineWidth = .6; ctx.strokeRect(34.5, 49.5, WIDTH - 69, 68);
      ctx.textAlign = 'center'; ctx.fillStyle = colors.fg; ctx.font = 'bold 15px sans-serif';
      ctx.fillText({ ready: '降落伞', paused: '已暂停', over: '阵地失守' }[game.status], WIDTH / 2, 71);
      ctx.font = '9px sans-serif';
      ctx.fillText(game.status === 'over' ? `本局得分 ${game.score} · 中键再来一局` : '转盘瞄准 · 中键射击', WIDTH / 2, 89);
      ctx.fillStyle = colors.muted; ctx.font = '8px sans-serif';
      ctx.fillText(game.status === 'paused' ? '播放键继续 · MENU 返回' : '任一侧落地 4 人则结束', WIDTH / 2, 104);
    }
    notify();
  }

  function input(action, value = 1) {
    if (destroyed) return;
    if (action === 'restart') game.reset();
    else if (action === 'move') game.aim(value);
    else if (action === 'left') game.aim(-1);
    else if (action === 'right') game.aim(1);
    else if (action === 'select') {
      if (game.status === 'over') game.reset().start();
      else if (game.status === 'ready') game.start();
      else if (game.status === 'paused') game.resume();
      else game.fire();
    } else if (action === 'play') {
      if (game.status === 'running') game.pause();
      else if (game.status === 'over') game.reset().start();
      else game.start();
    }
    render();
  }

  const pause = () => { game.pause(); render(); };
  const onVisibility = () => { if (document.hidden) pause(); previous = 0; };
  function animate(now) {
    if (destroyed) return;
    const dt = previous ? Math.min(.05, (now - previous) / 1000) : 0;
    previous = now;
    if (!document.hidden) { game.update(dt); render(); }
    frame = requestAnimationFrame(animate);
  }
  document.addEventListener('visibilitychange', onVisibility);
  render(); frame = requestAnimationFrame(animate);
  return {
    input, render, pause,
    destroy() { if (destroyed) return; destroyed = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', onVisibility); },
  };
}
