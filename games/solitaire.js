const SUITS = ['S', 'H', 'C', 'D'];
const GLYPHS = { S: '♠', H: '♥', C: '♣', D: '♦' };
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const red = card => card && (card.suit === 'H' || card.suit === 'D');
const copy = cards => cards.map(card => ({ ...card }));
const mod = (number, divisor) => ((number % divisor) + divisor) % divisor;

/** Draw-one Klondike. All rules operate independently of canvas or the DOM. */
export class SolitaireGame {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.reset();
  }

  reset() {
    const deck = SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({
      id: `${suit}${i + 1}`, suit, rank: i + 1, faceUp: false,
    })));
    for (let i = deck.length - 1; i > 0; i--) {
      const sample = Number(this.random());
      const j = Math.max(0, Math.min(i, Math.floor((Number.isFinite(sample) ? sample : 0) * (i + 1))));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.tableau = Array.from({ length: 7 }, () => []);
    for (let column = 0; column < 7; column++) {
      for (let row = 0; row <= column; row++) {
        const card = deck.pop();
        card.faceUp = row === column;
        this.tableau[column].push(card);
      }
    }
    this.stock = deck;
    this.waste = [];
    this.foundations = Array.from({ length: 4 }, () => []);
    this.moves = 0;
    this.status = 'playing';
    this._history = [];
    return this;
  }

  get foundationCount() { return this.foundations.reduce((total, pile) => total + pile.length, 0); }

  _remember() {
    this._history.push({
      stock: copy(this.stock), waste: copy(this.waste), foundations: this.foundations.map(copy),
      tableau: this.tableau.map(copy), moves: this.moves, status: this.status,
    });
    if (this._history.length > 200) this._history.shift();
  }

  undo() {
    const previous = this._history.pop();
    if (!previous) return false;
    Object.assign(this, previous);
    return true;
  }

  draw() {
    if (this.status !== 'playing' || (!this.stock.length && !this.waste.length)) return false;
    this._remember();
    if (this.stock.length) {
      const card = this.stock.pop();
      card.faceUp = true;
      this.waste.push(card);
    } else {
      this.stock = this.waste.reverse();
      for (const card of this.stock) card.faceUp = false;
      this.waste = [];
    }
    this.moves++;
    return true;
  }

  _source(ref) {
    if (!ref || typeof ref !== 'object') return null;
    if (ref.type === 'waste') return this.waste.length ? { pile: this.waste, start: this.waste.length - 1 } : null;
    if (!Number.isInteger(ref.index)) return null;
    if (ref.type === 'foundation' && ref.index >= 0 && ref.index < 4) {
      const pile = this.foundations[ref.index];
      return pile.length ? { pile, start: pile.length - 1 } : null;
    }
    if (ref.type === 'tableau' && ref.index >= 0 && ref.index < 7) {
      const pile = this.tableau[ref.index];
      const start = ref.cardIndex ?? pile.findIndex(card => card.faceUp);
      if (!Number.isInteger(start) || start < 0 || start >= pile.length) return null;
      return { pile, start };
    }
    return null;
  }

  canMove(from, to) {
    if (this.status !== 'playing' || !to || !Number.isInteger(to.index)) return false;
    const source = this._source(from);
    if (!source) return false;
    const run = source.pile.slice(source.start);
    if (!run.length || run.some(card => !card.faceUp)) return false;
    for (let i = 1; i < run.length; i++) {
      if (run[i - 1].rank !== run[i].rank + 1 || red(run[i - 1]) === red(run[i])) return false;
    }
    const first = run[0];
    if (to.type === 'foundation' && to.index >= 0 && to.index < 4) {
      const pile = this.foundations[to.index];
      if (pile === source.pile || run.length !== 1) return false;
      const top = pile.at(-1);
      return top ? top.suit === first.suit && first.rank === top.rank + 1 : first.rank === 1;
    }
    if (to.type === 'tableau' && to.index >= 0 && to.index < 7) {
      const pile = this.tableau[to.index];
      if (pile === source.pile) return false;
      const top = pile.at(-1);
      return top ? top.faceUp && top.rank === first.rank + 1 && red(top) !== red(first) : first.rank === 13;
    }
    return false;
  }

  move(from, to) {
    if (!this.canMove(from, to)) return false;
    this._remember();
    const source = this._source(from);
    const run = source.pile.splice(source.start);
    const destination = to.type === 'foundation' ? this.foundations[to.index] : this.tableau[to.index];
    destination.push(...run);
    if (from.type === 'tableau' && source.pile.length) source.pile.at(-1).faceUp = true;
    this.moves++;
    if (this.foundationCount === 52) this.status = 'won';
    return true;
  }
}

const WIDTH = 280;
const HEIGHT = 164;
const CARD_W = 32;
const CARD_H = 35;
const TABLEAU_Y = 62;
const TABLEAU_BOTTOM = 151;
const TOP_Y = 16;
const COLUMNS = Array.from({ length: 7 }, (_, index) => 5 + index * 39);
const FOUNDATION_X = [122, 160, 198, 236];
const cardName = card => card ? `${GLYPHS[card.suit]}${RANKS[card.rank]}` : '';

/** An interactive LCD-sized adapter. Only this layer touches canvas and events. */
export function createSolitaireGame({ canvas, getTheme = () => 'light', onStatus = () => {} }) {
  const game = new SolitaireGame();
  const ctx = canvas.getContext('2d');
  let slot = 0;
  let focusedCard = null;
  let picked = null;
  let paused = false;
  let destroyed = false;
  let hint = '转盘选位置 · 中键拿起 / 放下';

  const palette = () => getTheme() === 'dark' ? {
    felt: '#7f9274', ink: '#172b12', muted: '#38502f', frame: '#536b47',
    card: '#c3ceb8', back: '#657e58', backLine: '#97ae89', red: '#813b30',
    selected: '#284e7d', picked: '#a57921', overlay: '#6d8262ed', white: '#ecf2e6',
  } : {
    felt: '#c6d3bd', ink: '#243d1d', muted: '#617953', frame: '#92a981',
    card: '#eef1e6', back: '#91aa7d', backLine: '#becdae', red: '#a64e3a',
    selected: '#396d9d', picked: '#aa7d27', overlay: '#c3d0b7f0', white: '#f8fbf2',
  };

  function currentRef() {
    if (slot === 0) return { type: 'stock' };
    if (slot === 1) return { type: 'waste' };
    if (slot < 6) return { type: 'foundation', index: slot - 2 };
    const index = slot - 6;
    const pile = game.tableau[index];
    const firstUp = pile.findIndex(card => card.faceUp);
    const cardIndex = focusedCard == null ? firstUp : Math.max(firstUp, Math.min(pile.length - 1, focusedCard));
    return { type: 'tableau', index, cardIndex };
  }

  function refCard(ref) {
    if (ref.type === 'waste') return game.waste.at(-1);
    if (ref.type === 'foundation') return game.foundations[ref.index].at(-1);
    if (ref.type === 'tableau') return game.tableau[ref.index][ref.cardIndex];
    return null;
  }

  function setHint(text) { hint = text; onStatus(text); }

  function cardGap(pile) {
    return pile.length < 2 ? 0 : Math.min(10, (TABLEAU_BOTTOM - TABLEAU_Y - CARD_H) / (pile.length - 1));
  }

  function roundedRect(x, y, width, height, radius = 2) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function outline(x, y, height, color, width = 1.5) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    roundedRect(x - 1.5, y - 1.5, CARD_W + 3, height + 3, 3); ctx.stroke();
  }

  function emptyCard(x, y, label, colors) {
    ctx.lineWidth = .7; ctx.strokeStyle = colors.frame;
    roundedRect(x, y, CARD_W, CARD_H); ctx.stroke();
    ctx.fillStyle = colors.muted; ctx.font = '11px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x + CARD_W / 2, y + 22);
    ctx.textAlign = 'left';
  }

  function drawCard(card, x, y, colors) {
    ctx.lineWidth = .6; ctx.strokeStyle = colors.frame;
    ctx.fillStyle = card.faceUp ? colors.card : colors.back;
    roundedRect(x, y, CARD_W, CARD_H); ctx.fill(); ctx.stroke();
    if (!card.faceUp) {
      ctx.strokeStyle = colors.backLine; ctx.lineWidth = .6;
      for (let line = 5; line < CARD_H - 2; line += 5) {
        ctx.beginPath(); ctx.moveTo(x + 3, y + line); ctx.lineTo(x + CARD_W - 3, y + line); ctx.stroke();
      }
      return;
    }
    ctx.fillStyle = red(card) ? colors.red : colors.ink;
    ctx.font = 'bold 8px Arial, sans-serif'; ctx.fillText(cardName(card), x + 3, y + 9);
    ctx.font = '17px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(GLYPHS[card.suit], x + CARD_W / 2, y + 28);
    ctx.textAlign = 'left';
  }

  function render() {
    if (destroyed || !ctx) return;
    ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const colors = palette();
    ctx.fillStyle = colors.felt; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = colors.ink; ctx.font = 'bold 7px Arial, sans-serif';
    ctx.fillText(`纸牌  ${game.foundationCount}/52`, 5, 9);
    ctx.textAlign = 'right'; ctx.font = '7px Arial, sans-serif';
    ctx.fillText(`${game.moves} 步`, WIDTH - 6, 9); ctx.textAlign = 'left';

    if (game.stock.length) {
      drawCard(game.stock.at(-1), 5, TOP_Y, colors);
      ctx.fillStyle = colors.white; ctx.font = 'bold 9px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(game.stock.length), 21, TOP_Y + 23); ctx.textAlign = 'left';
    } else emptyCard(5, TOP_Y, game.waste.length ? '↻' : '—', colors);
    if (game.waste.length) drawCard(game.waste.at(-1), 44, TOP_Y, colors);
    else emptyCard(44, TOP_Y, '·', colors);
    game.foundations.forEach((pile, index) => {
      if (pile.length) drawCard(pile.at(-1), FOUNDATION_X[index], TOP_Y, colors);
      else emptyCard(FOUNDATION_X[index], TOP_Y, 'A', colors);
    });

    game.tableau.forEach((pile, index) => {
      const x = COLUMNS[index], gap = cardGap(pile);
      if (!pile.length) emptyCard(x, TABLEAU_Y, 'K', colors);
      pile.forEach((card, position) => drawCard(card, x, TABLEAU_Y + position * gap, colors));
    });

    function highlight(ref, color, selected = false) {
      if (ref.type === 'stock') return outline(5, TOP_Y, CARD_H, color);
      if (ref.type === 'waste') return outline(44, TOP_Y, CARD_H, color);
      if (ref.type === 'foundation') return outline(FOUNDATION_X[ref.index], TOP_Y, CARD_H, color);
      const pile = game.tableau[ref.index], gap = cardGap(pile);
      const start = Math.max(0, ref.cardIndex);
      const y = TABLEAU_Y + start * gap;
      const height = CARD_H + Math.max(0, pile.length - start - 1) * gap;
      outline(COLUMNS[ref.index], y, height, color, selected ? 2 : 1.4);
    }
    const ref = currentRef();
    highlight(ref, colors.selected);
    if (picked) highlight(picked, colors.picked, true);

    ctx.fillStyle = colors.felt; ctx.fillRect(0, 153, WIDTH, 11);
    ctx.fillStyle = colors.ink; ctx.font = '7px Arial, sans-serif';
    const selected = refCard(ref);
    let footer = picked ? `${cardName(refCard(picked))} 已拿起 · 选目标后按中键` : selected ? `${cardName(selected)} · 中键选择 · ↑↓挑选牌组` : '转盘选位置 · 中键选择';
    if (ref.type === 'stock') footer = game.stock.length ? '牌堆 · 中键翻一张' : '牌堆 · 中键回收已翻开的牌';
    ctx.fillText(footer, 5, 161);
    if (paused || game.status === 'won') {
      ctx.fillStyle = colors.overlay; ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.textAlign = 'center'; ctx.fillStyle = colors.ink;
      ctx.font = 'bold 16px Arial, sans-serif'; ctx.fillText(game.status === 'won' ? '纸牌通关！' : '已暂停', WIDTH / 2, 69);
      ctx.font = '9px Arial, sans-serif'; ctx.fillText(game.status === 'won' ? `${game.moves} 步 · 中键再来一局` : '播放键继续 · MENU 返回', WIDTH / 2, 91);
      ctx.textAlign = 'left';
    }
  }

  function select() {
    if (game.status === 'won') { restart(); return; }
    if (paused) return;
    const ref = currentRef();
    if (ref.type === 'stock') {
      picked = null;
      const recycled = !game.stock.length;
      setHint(game.draw() ? (recycled ? '牌堆已回收，按中键继续翻牌。' : `翻开 ${cardName(game.waste.at(-1))}`) : '牌堆已空。');
      render(); return;
    }
    if (!picked) {
      const card = refCard(ref);
      if (!card || !card.faceUp) { setHint('这里没有可以拿起的牌。'); render(); return; }
      picked = { ...ref };
      setHint(`${cardName(card)} 已拿起，选择目标后按中键。`);
    } else if (picked.type === ref.type && picked.index === ref.index) {
      if (ref.type === 'tableau' && picked.cardIndex !== ref.cardIndex) {
        picked = { ...ref }; setHint(`改选 ${cardName(refCard(ref))} 开始的牌组。`);
      } else { picked = null; setHint('已放回原位。'); }
    } else if (game.move(picked, ref)) {
      picked = null; focusedCard = null;
      setHint(game.status === 'won' ? '纸牌通关！按中键再来一局。' : '移动成功 · 转盘继续选牌。');
    } else setHint('不能放在这里：牌列交替降序，回收区同花升序。');
    render();
  }

  function restart() {
    game.reset(); slot = 0; focusedCard = null; picked = null; paused = false;
    setHint('新的一局：转盘选位置，中键拿起或放下。'); render();
  }

  function input(action, value = 1) {
    if (destroyed) return;
    if (action === 'restart') return restart();
    if (action === 'play') { paused = !paused; setHint(paused ? '纸牌已暂停。' : '纸牌继续。'); render(); return; }
    if (action === 'undo') {
      if (game.undo()) { picked = null; focusedCard = null; setHint('已撤销上一步。'); }
      render(); return;
    }
    if (action === 'cancel') { picked = null; setHint('已取消选牌。'); render(); return; }
    if (action === 'select') return select();
    if (paused || game.status === 'won') return;
    if (action === 'move' || action === 'left' || action === 'right') {
      const steps = action === 'left' ? -Math.abs(value) : action === 'right' ? Math.abs(value) : value;
      if (!Number.isFinite(steps)) return;
      slot = mod(slot + Math.trunc(steps), 13); focusedCard = null;
    } else if ((action === 'up' || action === 'down') && slot >= 6) {
      const pile = game.tableau[slot - 6];
      const firstUp = pile.findIndex(card => card.faceUp);
      if (firstUp >= 0) focusedCard = Math.max(firstUp, Math.min(pile.length - 1, (focusedCard ?? firstUp) + (action === 'up' ? -1 : 1)));
    }
    render();
  }

  function hit(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * WIDTH / bounds.width;
    const y = (event.clientY - bounds.top) * HEIGHT / bounds.height;
    if (y >= TOP_Y - 3 && y <= TOP_Y + CARD_H + 3) {
      if (x >= 3 && x <= 39) return { slot: 0 };
      if (x >= 42 && x <= 78) return { slot: 1 };
      for (let i = 0; i < 4; i++) if (x >= FOUNDATION_X[i] - 2 && x <= FOUNDATION_X[i] + CARD_W + 2) return { slot: i + 2 };
    }
    if (y >= TABLEAU_Y - 3 && y <= TABLEAU_BOTTOM + 1) {
      for (let i = 0; i < 7; i++) {
        if (x < COLUMNS[i] - 2 || x > COLUMNS[i] + CARD_W + 2) continue;
        const pile = game.tableau[i], gap = cardGap(pile);
        const firstUp = pile.findIndex(card => card.faceUp);
        const cardIndex = pile.length ? Math.min(pile.length - 1, Math.max(0, Math.floor((y - TABLEAU_Y) / (gap || CARD_H)))) : -1;
        if (pile.length && cardIndex < firstUp) return null;
        return { slot: i + 6, cardIndex };
      }
    }
    return null;
  }

  function onPointer(event) {
    if (destroyed || (event.button != null && event.button !== 0)) return;
    event.preventDefault();
    if (game.status === 'won') { restart(); return; }
    if (paused) return;
    const target = hit(event);
    if (!target) return;
    slot = target.slot; focusedCard = target.cardIndex ?? null;
    select();
  }

  function autoFoundation(event) {
    if (destroyed || paused || game.status === 'won') return;
    const target = hit(event);
    if (!target || target.slot === 0) return;
    slot = target.slot;
    if (slot >= 6) focusedCard = game.tableau[slot - 6].length - 1;
    const source = currentRef();
    for (let index = 0; index < 4; index++) {
      if (game.move(source, { type: 'foundation', index })) {
        picked = null; focusedCard = null;
        setHint(game.status === 'won' ? '纸牌通关！' : '已移至回收区。'); render(); return;
      }
    }
    setHint('这张牌暂时不能放入回收区。'); render();
  }

  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('dblclick', autoFoundation);
  onStatus(hint); render();
  return {
    input, render,
    pause() { paused = true; render(); },
    destroy() {
      destroyed = true;
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('dblclick', autoFoundation);
    },
  };
}
