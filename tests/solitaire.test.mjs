import test from 'node:test';
import assert from 'node:assert/strict';
import { SolitaireGame } from '../games/solitaire.js';

const card = (suit, rank, faceUp = true) => ({ id: `${suit}${rank}`, suit, rank, faceUp });
const ref = (index, cardIndex = 0) => ({ type: 'tableau', index, cardIndex });
const foundation = index => ({ type: 'foundation', index });
function emptyGame() {
  const game = new SolitaireGame({ random: () => .4 });
  game.stock = []; game.waste = []; game.tableau = Array.from({ length: 7 }, () => []);
  game.foundations = Array.from({ length: 4 }, () => []); game._history = [];
  return game;
}

test('Klondike deals exactly 52 unique cards with seven exposed tableau tops', () => {
  const game = new SolitaireGame({ random: () => .5 });
  assert.deepEqual(game.tableau.map(pile => pile.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(game.stock.length, 24);
  assert.equal(game.stock.every(item => !item.faceUp), true);
  for (const pile of game.tableau) {
    assert.equal(pile.at(-1).faceUp, true);
    assert.equal(pile.slice(0, -1).every(item => !item.faceUp), true);
  }
  const cards = [...game.stock, ...game.tableau.flat()];
  assert.equal(new Set(cards.map(item => item.id)).size, 52);
  assert.equal(game.moves, 0); assert.equal(game.status, 'playing');
});

test('stock draws one card, then recycles in the same draw order without losing cards', () => {
  const game = emptyGame();
  game.stock = [card('S', 2, false), card('H', 3, false), card('D', 4, false)];
  const expected = ['D4', 'H3', 'S2'];
  for (const id of expected) { assert.equal(game.draw(), true); assert.equal(game.waste.at(-1).id, id); assert.equal(game.waste.at(-1).faceUp, true); }
  assert.equal(game.stock.length, 0); assert.equal(game.draw(), true);
  assert.equal(game.waste.length, 0); assert.equal(game.stock.every(item => !item.faceUp), true);
  for (const id of expected) { game.draw(); assert.equal(game.waste.at(-1).id, id); }
  assert.equal(game.moves, 7);
});

test('tableau moves whole descending alternating-color exposed runs and flips the old top', () => {
  const game = emptyGame();
  game.tableau[0] = [card('D', 2, false), card('S', 7), card('H', 6), card('C', 5)];
  game.tableau[1] = [card('D', 8)];
  assert.equal(game.move(ref(0, 1), ref(1)), true);
  assert.deepEqual(game.tableau[1].map(item => item.id), ['D8', 'S7', 'H6', 'C5']);
  assert.deepEqual(game.tableau[0], [card('D', 2)]);
  assert.equal(game.moves, 1);
});

test('tableau subruns can be selected independently and only kings occupy empty columns', () => {
  const game = emptyGame();
  game.tableau[0] = [card('S', 7), card('H', 6), card('C', 5)];
  game.tableau[1] = [card('D', 6)];
  assert.equal(game.move(ref(0, 2), ref(1)), true);
  assert.deepEqual(game.tableau[0].map(item => item.id), ['S7', 'H6']);
  assert.equal(game.canMove(ref(1, 1), ref(2)), false);
  game.waste = [card('H', 13)];
  assert.equal(game.move({ type: 'waste' }, ref(2)), true);
  assert.equal(game.tableau[2][0].id, 'H13');
});

test('foundations require an ace first, then ascending cards of the same suit', () => {
  const game = emptyGame();
  game.waste = [card('S', 2)];
  assert.equal(game.move({ type: 'waste' }, foundation(0)), false);
  game.waste = [card('S', 1)]; assert.equal(game.move({ type: 'waste' }, foundation(0)), true);
  game.waste = [card('H', 2)]; assert.equal(game.move({ type: 'waste' }, foundation(0)), false);
  game.waste = [card('S', 3)]; assert.equal(game.move({ type: 'waste' }, foundation(0)), false);
  game.waste = [card('S', 2)]; assert.equal(game.move({ type: 'waste' }, foundation(0)), true);
  assert.deepEqual(game.foundations[0].map(item => item.id), ['S1', 'S2']);
});

test('illegal moves leave the board unchanged, including hidden cards and malformed runs', () => {
  const game = emptyGame();
  game.tableau[0] = [card('C', 8), card('S', 7)];
  game.tableau[1] = [card('D', 9)];
  game.tableau[2] = [card('H', 10, false)];
  const before = JSON.stringify(game);
  assert.equal(game.move(ref(0), ref(1)), false);
  assert.equal(game.move(ref(2), ref(3)), false);
  assert.equal(game.move(ref(0), ref(0)), false);
  assert.equal(game.move({ type: 'stock' }, ref(1)), false);
  assert.equal(game.move(ref(0, -1), ref(1)), false);
  assert.equal(JSON.stringify(game), before);
});

test('undo restores a move and the newly revealed card back to face down', () => {
  const game = emptyGame();
  game.tableau[0] = [card('S', 3, false), card('D', 1)];
  assert.equal(game.move(ref(0, 1), foundation(0)), true);
  assert.equal(game.tableau[0][0].faceUp, true);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.tableau[0], [card('S', 3, false), card('D', 1)]);
  assert.equal(game.foundations[0].length, 0); assert.equal(game.moves, 0);
  assert.equal(game.undo(), false);
});

test('the final foundation card wins; undo restores play and reset starts a complete new deal', () => {
  const game = emptyGame();
  for (const [index, suit] of ['S', 'H', 'C', 'D'].entries()) {
    game.foundations[index] = Array.from({ length: index === 3 ? 12 : 13 }, (_, i) => card(suit, i + 1));
  }
  game.waste = [card('D', 13)];
  assert.equal(game.move({ type: 'waste' }, foundation(3)), true);
  assert.equal(game.status, 'won'); assert.equal(game.foundationCount, 52);
  assert.equal(game.draw(), false); assert.equal(game.undo(), true);
  assert.equal(game.status, 'playing'); assert.equal(game.foundationCount, 51);
  game.reset(); assert.equal(game.stock.length, 24); assert.equal(game.foundationCount, 0); assert.equal(game.moves, 0);
});
