import { createBrickGame } from './brick.js';
import { createParachuteGame } from './parachute.js';
import { createSolitaireGame } from './solitaire.js';

export const games = [
  { id: 'brick', title: '打砖块', create: createBrickGame, help: '转盘 / ← → 移动挡板，中键发球。播放键暂停，R 重开。' },
  { id: 'parachute', title: '降落伞', create: createParachuteGame, help: '转盘 / ← → 瞄准，中键发射。播放键暂停，R 重开。' },
  { id: 'solitaire', title: '纸牌', create: createSolitaireGame, help: '转盘 / ← → 选位置，中键取牌或放牌。↑ ↓ 选列内纸牌，也可点屏幕。U 撤回，R 重开。' }
];
