import { LocalPlayer } from './player.js';
import { LocalLibrary } from './library.js';
import { games } from './games/index.js';

const $ = id => document.getElementById(id);
const player = new LocalPlayer($('audio'));
const library = new LocalLibrary();
const menuStack = [{ type: 'root', title: 'iPod', selected: 0 }];
let locked = false;
let finish = 'silver';
let darkMode = document.documentElement.dataset.theme === 'dark';
let clickSound = false;
let wheelAudio;
let previousVolume = .7;
let clearArmed = false;
let toastTimer;
let search = '';
let lastTrackId;
let activeGame = null;
const gameHelp = document.createElement('p');
gameHelp.className = 'game-help'; gameHelp.hidden = true;
document.querySelector('.device-stage').append(gameHelp);
const repeatLabels = { off: '关闭', all: '全部', one: '单曲' };
const time = value => { const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const currentView = () => menuStack.at(-1);
const icon = (id, className = '') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${id}`); svg.append(use); return svg;
};

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3800);
}

function tick() {
  if (!clickSound) return;
  try {
    wheelAudio ??= new (window.AudioContext || window.webkitAudioContext)();
    wheelAudio.resume().catch(() => {});
    const osc = wheelAudio.createOscillator(), gain = wheelAudio.createGain();
    osc.frequency.value = 1300; osc.type = 'triangle'; gain.gain.setValueAtTime(.018, wheelAudio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, wheelAudio.currentTime + .015);
    osc.connect(gain); gain.connect(wheelAudio.destination); osc.start(); osc.stop(wheelAudio.currentTime + .018);
  } catch { /* Click feedback is optional. */ }
}

function go(type, title, extra = {}) {
  menuStack.push({ type, title, selected: 0, ...extra });
  renderScreen();
}
function rootMenu() { menuStack.splice(1); menuStack[0].selected = 0; renderScreen(); }
function nowPlaying() {
  if (!player.currentTrack) { toast('先选择一些本地音乐，再按下播放。'); return; }
  if (currentView().type === 'game') menuStack.pop();
  if (currentView().type !== 'now') go('now', '正在播放'); else renderScreen();
}
function back() {
  if (locked) { toast('HOLD 已开启，滑动机身上方的开关解锁。'); return; }
  if (menuStack.length > 1) menuStack.pop();
  renderScreen(); tick();
}
function viewTracks(view = currentView()) {
  if (view.type === 'artistSongs') return library.tracks.filter(track => track.artist === view.artist);
  if (view.type === 'albumSongs') return library.tracks.filter(track => track.album === view.album && track.artist === view.artist);
  return library.tracks;
}
function chooseTrack(track) {
  if (!track) return;
  player.playIndex(player.tracks.findIndex(item => item.id === track.id));
  nowPlaying();
}

function openGame(game) {
  player.pause();
  go('game', game.title, { gameID: game.id });
}

function gameInput(action, value = 1) {
  if (locked || currentView().type !== 'game') return false;
  activeGame?.controller.input(action, value);
  return true;
}

function getRows(view = currentView()) {
  if (view.type === 'root') return [
    { label: '音乐', action: () => go('music', '音乐') },
    { label: '随机播放歌曲', action: () => { if (!library.tracks.length) return toast('曲库还是空的，先添加本地音乐。'); player.setShuffle(false); player.playIndex(Math.floor(Math.random() * library.tracks.length)); player.setShuffle(true); savePreferences(); nowPlaying(); } },
    { label: '正在播放', action: nowPlaying },
    { label: '设置', action: () => go('settings', '设置') },
    { label: '游戏', action: () => go('games', '游戏') },
    { label: '关于 Pocket', action: () => go('about', '关于') },
    { label: '添加本地音乐', action: () => $('file-input').click() }
  ];
  if (view.type === 'games') return games.map(game => ({ label: game.title, action: () => openGame(game) }));
  if (view.type === 'music') return [
    { label: '所有歌曲', value: String(library.tracks.length), action: () => go('songs', '所有歌曲') },
    { label: '艺术家', action: () => go('artists', '艺术家') },
    { label: '专辑', action: () => go('albums', '专辑') }
  ];
  if (['songs', 'artistSongs', 'albumSongs'].includes(view.type)) return viewTracks(view).map(track => ({ label: track.title, value: track.id === player.currentTrack?.id ? (player.playing ? '▶' : 'Ⅱ') : '', action: () => chooseTrack(track) }));
  if (view.type === 'artists') return [...new Set(library.tracks.map(track => track.artist))].sort((a,b) => a.localeCompare(b, 'zh-CN')).map(artist => ({ label: artist, action: () => go('artistSongs', artist, { artist }) }));
  if (view.type === 'albums') {
    const albums = new Map();
    for (const track of library.tracks) albums.set(JSON.stringify([track.artist,track.album]), { artist: track.artist, album: track.album });
    return [...albums.values()].sort((a,b) => a.album.localeCompare(b.album, 'zh-CN')).map(({ artist, album }) => ({ label: album, action: () => go('albumSongs', album, { artist, album }) }));
  }
  if (view.type === 'settings') return [
    { label: '随机播放', value: player.shuffle ? '开启' : '关闭', action: () => { player.setShuffle(!player.shuffle); savePreferences(); } },
    { label: '重复播放', value: repeatLabels[player.repeat], action: () => { player.setRepeat({off:'all',all:'one',one:'off'}[player.repeat]); savePreferences(); } },
    { label: '音量', value: `${Math.round(player.volume * 100)}%`, action: () => go('volume', '音量') },
    { label: '转盘声', value: clickSound ? '开启' : '关闭', action: () => { clickSound = !clickSound; tick(); savePreferences(); renderScreen(); } },
    { label: '外观', value: finish === 'silver' ? '银色' : '石墨色', action: () => setFinish(finish === 'silver' ? 'graphite' : 'silver') },
    { label: '黑夜模式', value: darkMode ? '开启' : '关闭', action: () => setTheme(darkMode ? 'light' : 'dark') },
    { label: '返回主菜单', action: rootMenu }
  ];
  return [];
}

function artwork(track, className) {
  if (track?.artwork) { const img = document.createElement('img'); img.className = className; img.src = track.artwork; img.alt = `${track.album} 专辑封面`; return img; }
  const placeholder = document.createElement('span'); placeholder.className = `${className} art-placeholder`; placeholder.append(icon('music')); return placeholder;
}

function renderScreen() {
  const view = currentView();
  const content = $('screen-content');
  if (view.type !== 'game' && activeGame) { activeGame.controller.destroy(); activeGame = null; }
  gameHelp.hidden = view.type !== 'game';
  $('screen-title').textContent = view.title;
  $('screen-status').textContent = player.playing ? '▶' : 'Ⅱ';
  $('screen-status').setAttribute('aria-label', player.playing ? '正在播放' : '已暂停');
  $('lock-indicator').hidden = !locked;
  if (view.type === 'game') {
    const definition = games.find(game => game.id === view.gameID);
    if (!definition) { menuStack.pop(); renderScreen(); return; }
    gameHelp.textContent = `${definition.help} MENU 返回游戏菜单。`;
    if (activeGame?.view !== view) {
      activeGame?.controller.destroy();
      const canvas = document.createElement('canvas');
      canvas.width = 560; canvas.height = 328; canvas.className = 'game-canvas';
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${definition.title}。${definition.help}`);
      for (const name of ['pointerdown','pointerup','click','dblclick']) canvas.addEventListener(name, event => { if (locked) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
      content.replaceChildren(canvas);
      const controller = definition.create({ canvas, getTheme: () => darkMode ? 'dark' : 'light', onStatus: message => { view.gameStatus = message; if (currentView() === view) $('screen-footer').lastElementChild.textContent = locked ? 'HOLD · 游戏已暂停' : message; } });
      activeGame = { view, controller };
    }
    activeGame.controller.render();
    $('screen-footer').firstElementChild.textContent = 'GAMES';
    $('screen-footer').lastElementChild.textContent = locked ? 'HOLD · 游戏已暂停' : (view.gameStatus || '中键开始 · MENU 返回');
    return;
  }
  content.replaceChildren();
  $('screen-footer').firstElementChild.textContent = 'POCKET';
  if (view.type === 'now') {
    const track = player.currentTrack;
    if (!track) { menuStack.pop(); renderScreen(); return; }
    const wrapper = document.createElement('div'); wrapper.className = 'now-screen';
    const top = document.createElement('div'); top.className = 'now-top'; top.append(artwork(track,'album-art'));
    const meta = document.createElement('div'); meta.className = 'track-meta';
    const title = document.createElement('strong'); title.textContent = track.title; title.title = track.title;
    const artist = document.createElement('span'); artist.textContent = track.artist; artist.title = track.artist;
    const album = document.createElement('span'); album.textContent = track.album; album.title = track.album;
    const index = document.createElement('small'); index.textContent = `${player.currentIndex + 1} / ${player.tracks.length} 首歌曲`;
    meta.append(title, artist, album, index); top.append(meta);
    const progress = document.createElement('div'); progress.className = 'progress-row';
    const seek = document.createElement('input'); seek.id = 'seek-range'; seek.type = 'range'; seek.min = 0; seek.max = Math.max(1, player.duration); seek.step = .1; seek.value = player.currentTime; seek.className = 'seek-range'; seek.setAttribute('aria-label','播放进度'); seek.disabled = !player.duration || locked;
    seek.addEventListener('input', () => { if (!locked) player.seek(Number(seek.value)); });
    const labels = document.createElement('div'); labels.className = 'time-labels';
    const elapsed = document.createElement('span'); elapsed.id='elapsed-time'; elapsed.textContent=time(player.currentTime);
    const remaining = document.createElement('span'); remaining.id='remaining-time'; remaining.textContent=`-${time(player.duration-player.currentTime)}`;
    labels.append(elapsed,remaining); progress.append(seek,labels);
    const flags = document.createElement('div'); flags.className='playback-icons';
    if (player.shuffle) { const flag=document.createElement('span'); flag.textContent='随机'; flags.append(flag); }
    if (player.repeat!=='off') { const flag=document.createElement('span'); flag.textContent=player.repeat==='one'?'单曲循环':'全部循环'; flags.append(flag); }
    const status=document.createElement('span'); status.className='state-text'; status.textContent=player.playing?'正在播放':'已暂停'; flags.append(status);
    wrapper.append(top,progress,flags); content.append(wrapper);
  } else if (view.type === 'about') {
    const about=document.createElement('div'); about.className='screen-about';
    const title=document.createElement('strong'); title.textContent='pocket.';
    const lines=[`${library.tracks.length} 首歌曲 · 全本地播放`,'转盘画圈 / 鼠标滚轮浏览','中键选择 · MENU 返回','左右切歌，长按快进 / 快退','一个让音乐回归简单的小口袋。'];
    about.append(title); lines.forEach(line=>{ const p=document.createElement('p'); p.textContent=line; about.append(p); }); content.append(about);
  } else if (view.type === 'volume') {
    const volume=document.createElement('div'); volume.className='volume-screen'; volume.append(icon('music'));
    const number=document.createElement('strong'); number.textContent=`${Math.round(player.volume*100)}%`;
    const hint=document.createElement('span'); hint.textContent='转动转盘调节 · MENU 返回'; volume.append(number,hint); content.append(volume);
  } else {
    const rows = getRows(view); view.selected = Math.max(0,Math.min(view.selected,rows.length-1));
    if (!rows.length) {
      const empty=document.createElement('div'); empty.className='empty-screen'; empty.append(icon('music'));
      const title=document.createElement('strong'); title.textContent='口袋还是空的';
      const hint=document.createElement('p'); hint.textContent='添加本地音乐，让它唱起来。'; empty.append(title,hint); content.append(empty);
    } else {
      const list=document.createElement('ul'); list.className='device-menu'; list.setAttribute('aria-label',view.title);
      rows.forEach((row,i)=>{
        const li=document.createElement('li'); li.classList.toggle('selected',i===view.selected);
        const button=document.createElement('button'); button.tabIndex=-1; button.setAttribute('aria-current',i===view.selected?'true':'false');
        const label=document.createElement('span'); label.textContent=row.label;
        const trailing=document.createElement('span'); trailing.className=row.value?'menu-secondary':'menu-arrow'; trailing.textContent=row.value??'›';
        button.append(label,trailing); button.addEventListener('click',()=>{ if (locked) return toast('先关闭 HOLD，再操作转盘。'); view.selected=i; select(); });
        li.append(button); list.append(li);
      });
      content.append(list); list.scrollTop=Math.max(0,(view.selected-4)*26);
    }
  }
  $('screen-footer').lastElementChild.textContent = locked ? 'HOLD · 按键已锁定' : (view.type === 'now' ? '转盘调节音量' : '转盘浏览 · 中键选择');
}

function scrollMenu(steps) {
  if (locked || !steps) return;
  const view=currentView();
  if (view.type==='game') { gameInput('move',steps); return; }
  if (view.type==='now'||view.type==='volume') { player.setVolume(player.volume+steps*.025); savePreferences(); return; }
  const rows=getRows(view); if (!rows.length) return;
  const next=Math.max(0,Math.min(rows.length-1,view.selected+steps));
  if (next!==view.selected) { view.selected=next; tick(); renderScreen(); }
}
function select() {
  if (locked) return toast('HOLD 已开启，先解锁机身上方的开关。');
  tick();
  if (gameInput('select')) return;
  if (currentView().type==='now') return player.toggle();
  if (currentView().type==='about'||currentView().type==='volume') return back();
  getRows()[currentView().selected]?.action();
}

function renderLibrary() {
  $('track-count').textContent=String(library.tracks.length);
  $('drop-zone').hidden=!!library.tracks.length; $('library-filled').hidden=!library.tracks.length;
  $('clear-button').disabled=!library.tracks.length;
  $('remember-checkbox').checked=library.remember;
  $('storage-note').textContent=library.remember?'曲库已保留在此浏览器，不会上传。':'默认仅本次打开可用，刷新后需重新选择。';
  if(library.tracks.some(track=>track.convertedFromNcm))$('storage-note').textContent+=' NCM 歌曲右侧 ↓ 可下载解包音乐。';
  $('import-button').disabled=library.importing; $('append-button').disabled=library.importing;
  $('import-button').lastChild.textContent=library.importing?'正在本地读取…':'选择本地音乐';
  const list=$('track-list'); list.replaceChildren();
  const filtered=library.tracks.filter(track=>`${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(search));
  if (!filtered.length && library.tracks.length) { const empty=document.createElement('p'); empty.className='empty-search'; empty.textContent='没有找到这首歌，换个关键词试试。'; list.append(empty); }
  for (const track of filtered) {
    const row=document.createElement('div'); row.className='track-item'; row.setAttribute('role','listitem'); row.classList.toggle('active',track.id===player.currentTrack?.id);
    const button=document.createElement('button'); button.className='track-play'; button.setAttribute('aria-label',`播放 ${track.title}，${track.artist}`);
    button.append(artwork(track,'track-art'));
    const text=document.createElement('span'); text.className='track-item-text';
    const name=document.createElement('strong'); name.textContent=track.title; name.title=track.title;
    const artist=document.createElement('small'); artist.textContent=track.artist; text.append(name,artist); button.append(text);
    button.addEventListener('click',()=>chooseTrack(track));
    const remove=document.createElement('button'); remove.className='track-remove'; remove.textContent='×'; remove.setAttribute('aria-label',`移除 ${track.title}`); remove.addEventListener('click',()=>library.remove(track.id));
    row.append(button);
    if (track.convertedFromNcm) {
      const download=document.createElement('button'); download.className='track-download'; download.textContent='↓';
      download.title='下载解包后的音乐'; download.setAttribute('aria-label',`下载 ${track.title} 的解包音乐`);
      download.addEventListener('click',()=>downloadTrack(track)); row.append(download);
    }
    row.append(remove); list.append(row);
  }
}

function downloadTrack(track) {
  const url=URL.createObjectURL(track.file);
  const link=document.createElement('a'); link.href=url; link.download=track.file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast('已开始保存解包后的音乐，文件来自当前浏览器。');
}

function updateTime() {
  const seek=$('seek-range');
  if (seek) { seek.max=Math.max(1,player.duration); seek.disabled=!player.duration||locked; seek.value=player.currentTime; }
  if ($('elapsed-time')) $('elapsed-time').textContent=time(player.currentTime);
  if ($('remaining-time')) $('remaining-time').textContent=`-${time(player.duration-player.currentTime)}`;
}

function updatePlayer() {
  const track=player.currentTrack;
  $('mini-title').textContent=track?.title??'一首歌的时间';
  $('mini-artist').textContent=track?.artist??'选一首喜欢的，按下播放。';
  $('mini-art').replaceChildren(track?artwork(track,'mini-art-image'):icon('music'));
  $('mini-equalizer').classList.toggle('playing',player.playing);
  $('volume-range').value=Math.round(player.volume*100); $('volume-value').textContent=`${Math.round(player.volume*100)}%`;
  $('mute-button').setAttribute('aria-label',player.volume===0?'取消静音':'静音');
  $('mute-button').style.opacity=player.volume===0?'.4':'1';
  document.querySelectorAll('.track-item').forEach(row=>row.classList.remove('active'));
  const index=library.tracks.filter(item=>`${item.title} ${item.artist} ${item.album}`.toLocaleLowerCase().includes(search)).findIndex(item=>item.id===track?.id);
  if (index>=0) $('track-list').children[index]?.classList.add('active');
  renderScreen();
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState=player.playing?'playing':'paused';
      if (track && lastTrackId!==track.id) navigator.mediaSession.metadata=new MediaMetadata({ title:track.title,artist:track.artist,album:track.album,artwork:track.artwork?[{src:track.artwork}]:[] });
      else if (!track) navigator.mediaSession.metadata=null;
    } catch { /* OS media integration is optional. */ }
  }
  lastTrackId=track?.id;
}

function savePreferences() {
  try { localStorage.setItem('pocket-preferences',JSON.stringify({volume:player.volume,shuffle:player.shuffle,repeat:player.repeat,finish,clickSound,theme:darkMode?'dark':'light'})); } catch { /* Session settings remain usable. */ }
}
function applyTheme(value) {
  darkMode=value==='dark';
  document.documentElement.dataset.theme=darkMode?'dark':'light';
  document.querySelector('meta[name="theme-color"]').content=darkMode?'#141615':'#eeede7';
  $('theme-toggle').setAttribute('aria-pressed',String(darkMode));
  $('theme-toggle').setAttribute('aria-label',darkMode?'切换至日间模式':'开启黑夜模式');
  $('theme-label').textContent=darkMode?'日间':'夜间';
}
function setTheme(value) {
  applyTheme(value);
  setFinish(darkMode?'graphite':'silver');
}
function setFinish(value) {
  if(value==='silver'&&darkMode)applyTheme('light');
  finish=value; $('ipod').classList.toggle('graphite',value==='graphite');
  document.querySelectorAll('[data-finish]').forEach(button=>{ const selected=button.dataset.finish===value; button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected)); });
  $('finish-label').textContent=value==='silver'?'银色':'石墨色'; savePreferences(); renderScreen();
}
try {
  const prefs=JSON.parse(localStorage.getItem('pocket-preferences')??'{}')??{};
  player.setVolume(Number.isFinite(prefs.volume)?prefs.volume:.7); player.setShuffle(!!prefs.shuffle);
  player.setRepeat(['off','all','one'].includes(prefs.repeat)?prefs.repeat:'off'); clickSound=!!prefs.clickSound;
  applyTheme(darkMode?'dark':'light');
  setFinish(darkMode||prefs.finish==='graphite'?'graphite':'silver');
} catch { player.setVolume(.7); }
applyTheme(darkMode?'dark':'light');

player.addEventListener('change',updatePlayer); player.addEventListener('time',updateTime);
player.addEventListener('playerror',event=>toast(event.detail?.message??'这首歌暂时无法播放，请试试其他格式的文件。'));
library.addEventListener('change',()=>{ player.setTracks(library.tracks); renderLibrary(); renderScreen(); });
library.addEventListener('storageerror',()=>{ renderLibrary(); toast('浏览器本地存储暂不可用，本次仍可正常听歌。'); });

async function importFiles(files) {
  if (!files?.length) return;
  try {
    const result=await library.importFiles(files);
    if(!result.added&&library.lastImportErrors?.length){toast(library.lastImportErrors[0].message);return;}
    toast(result.added?`已把 ${result.added} 首歌放进口袋${result.duplicates?`，跳过 ${result.duplicates} 首重复歌曲`:''}${result.rejected?`，${result.rejected} 个文件未能读取`:''}。`:(result.duplicates?'这些歌已经在口袋里了。':(result.rejected?'文件未能读取或解包，请检查格式及文件是否完整。':'没有找到支持的音频文件。')));
  } catch { toast('本地文件读取未完成，请分批重新选择音乐。'); }
}
for (const id of ['import-button','add-more','append-button']) $(id).addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async()=>{ const files=Array.from($('file-input').files); $('file-input').value=''; await importFiles(files); });
$('library-search').addEventListener('input',()=>{ search=$('library-search').value.trim().toLocaleLowerCase(); renderLibrary(); });
$('remember-checkbox').addEventListener('change',async()=>{ $('remember-checkbox').disabled=true; try { await library.setRemember($('remember-checkbox').checked); renderLibrary(); } finally { $('remember-checkbox').disabled=false; } });
$('clear-button').addEventListener('click',async()=>{
  if (!clearArmed) { clearArmed=true; $('clear-button').textContent='确认清空'; toast('再次点击“确认清空”移除此曲库。原始音乐文件不会被删除。'); setTimeout(()=>{clearArmed=false;$('clear-button').textContent='清空';},4000); return; }
  clearArmed=false; await library.clear(); rootMenu(); toast('口袋清空了，原始文件仍在你的设备上。');
});
$('volume-range').addEventListener('input',()=>{ player.setVolume(Number($('volume-range').value)/100); savePreferences(); });
$('mute-button').addEventListener('click',()=>{ if(player.volume>0){previousVolume=player.volume;player.setVolume(0);}else player.setVolume(previousVolume||.7); savePreferences(); });
document.querySelectorAll('[data-finish]').forEach(button=>button.addEventListener('click',()=>setFinish(button.dataset.finish)));
$('theme-toggle').addEventListener('click',()=>setTheme(darkMode?'light':'dark'));
$('hold-button').addEventListener('click',()=>{ locked=!locked; if(locked)activeGame?.controller.pause(); $('hold-button').setAttribute('aria-checked',String(locked)); $('ipod').classList.toggle('locked',locked); renderScreen(); toast(locked?(activeGame?'HOLD 已开启，游戏已暂停。':'HOLD 已开启：转盘锁定，播放继续。'):'已解锁，继续转动转盘。'); });
$('menu-button').addEventListener('click',back); $('select-button').addEventListener('click',select);
$('toggle-button').addEventListener('click',()=>{ if(locked)return toast('先关闭 HOLD，再操作。'); if(gameInput('play'))return; if(!player.currentTrack)return toast('先添加本地音乐，或点击“先听一段”。'); player.toggle(); nowPlaying(); });

for (const [id, direction] of [['previous-button',-1],['next-button',1]]) {
  const button=$(id); let timer; let interval; let held=false;
  const stop=()=>{clearTimeout(timer);clearInterval(interval);};
  button.addEventListener('pointerdown',event=>{ held=false; if(locked||event.button!==0||currentView().type==='game')return; button.setPointerCapture(event.pointerId); timer=setTimeout(()=>{held=true;player.seek(player.currentTime+direction*5);interval=setInterval(()=>player.seek(player.currentTime+direction*3),180);},450); });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,stop);
  button.addEventListener('click',()=>{ if(locked)return toast('先关闭 HOLD，再操作。'); if(gameInput('move',direction))return; if(held){held=false;return;} if(!player.currentTrack)return toast('先添加几首歌到曲库。'); direction>0?player.next():player.previous(); nowPlaying(); });
}

let wheelGesture;
const wheel=$('click-wheel');
wheel.addEventListener('pointerdown',event=>{
  if(locked||event.target.closest('button'))return;
  event.preventDefault(); const rect=wheel.getBoundingClientRect();
  wheelGesture={angle:Math.atan2(event.clientY-rect.top-rect.height/2,event.clientX-rect.left-rect.width/2),accumulated:0};
  wheel.setPointerCapture(event.pointerId); wheel.classList.add('dragging');
});
wheel.addEventListener('pointermove',event=>{
  if(!wheelGesture||locked)return;
  const rect=wheel.getBoundingClientRect(),angle=Math.atan2(event.clientY-rect.top-rect.height/2,event.clientX-rect.left-rect.width/2);
  let delta=angle-wheelGesture.angle; if(delta>Math.PI)delta-=2*Math.PI; if(delta< -Math.PI)delta+=2*Math.PI;
  wheelGesture.angle=angle; wheelGesture.accumulated+=delta;
  const steps=Math.trunc(wheelGesture.accumulated/.23);
  if(steps){wheelGesture.accumulated-=steps*.23;scrollMenu(steps);}
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])wheel.addEventListener(event,()=>{wheelGesture=null;wheel.classList.remove('dragging');});
let wheelAccumulated=0;
wheel.addEventListener('wheel',event=>{event.preventDefault();if(locked)return;wheelAccumulated+=event.deltaY;const steps=Math.trunc(wheelAccumulated/35);if(steps){wheelAccumulated-=steps*35;scrollMenu(Math.max(-4,Math.min(4,steps)));}},{passive:false});
document.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||$('privacy-dialog').open||event.target.matches('input,textarea,select'))return;
  if(event.target.closest('button')&&['Enter',' '].includes(event.key))return;
  if(currentView().type==='game'&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape',' ','r','R','u','U'].includes(event.key)){
    event.preventDefault();if(locked)return;
    if(event.key==='Escape')back();
    else if(event.key==='r'||event.key==='R'){if(!event.repeat)gameInput('restart');}
    else if(event.key==='u'||event.key==='U'){if(!event.repeat)gameInput('undo');}
    else if(event.key==='Enter'||event.key===' '){if(!event.repeat)gameInput('select');}
    else if((currentView().gameID==='solitaire'||event.shiftKey)&&(event.key==='ArrowUp'||event.key==='ArrowDown'))gameInput(event.key==='ArrowUp'?'up':'down');
    else gameInput('move',(event.key==='ArrowLeft'||event.key==='ArrowUp')?-1:1);
    return;
  }
  const keys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape',' '];
  if(!keys.includes(event.key))return;event.preventDefault();if(locked)return;
  if(event.key==='ArrowUp')scrollMenu(-1); else if(event.key==='ArrowDown')scrollMenu(1);
  else if(event.key==='Escape')back(); else if(event.key==='Enter'&&!event.repeat)select();
  else if(event.key===' '&&!event.repeat){if(player.currentTrack){player.toggle();nowPlaying();}else toast('先添加本地音乐，或试试演示音轨。');}
  else if(event.key==='ArrowRight'&&!event.repeat){if(player.currentTrack){player.next();nowPlaying();}}
  else if(event.key==='ArrowLeft'&&!event.repeat){if(player.currentTrack){player.previous();nowPlaying();}}
});

let dragDepth=0;
document.addEventListener('dragenter',event=>{if(Array.from(event.dataTransfer?.types??[]).includes('Files')){event.preventDefault();dragDepth++;$('drop-overlay').hidden=false;}});
document.addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types??[]).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});
document.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;importFiles(Array.from(event.dataTransfer?.files??[]));});
$('privacy-button').addEventListener('click',()=>$('privacy-dialog').showModal());
$('privacy-button').addEventListener('click',()=>activeGame?.controller.pause());
document.addEventListener('visibilitychange',()=>{if(document.hidden)activeGame?.controller.pause();});
for(const id of ['close-privacy','privacy-done'])$(id).addEventListener('click',()=>$('privacy-dialog').close());
$('privacy-dialog').addEventListener('click',event=>{if(event.target===$('privacy-dialog'))$('privacy-dialog').close();});

function makeDemo() {
  const rate=32000,duration=24,length=rate*duration;
  const buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*2,true);
  const notes=[261.63,329.63,392,493.88,440,392,329.63,293.66,220,261.63,329.63,392,349.23,329.63,293.66,261.63];
  for(let i=0;i<length;i++){
    const t=i/rate,beat=Math.floor(t/.75),local=t% .75;
    let sample=0;
    for(let echo=0;echo<3;echo++){
      const n=beat-echo;if(n<0)continue;const age=local+echo*.75,f=notes[n%notes.length];
      sample+=(Math.sin(2*Math.PI*f*age)+.3*Math.sin(2*Math.PI*f*2*age))*.12*Math.exp(-age*3)*Math.min(1,age/.012);
    }
    sample+=(Math.sin(2*Math.PI*130.815*t)+Math.sin(2*Math.PI*164.815*t)+Math.sin(2*Math.PI*196*t))*.02;
    sample*=Math.min(1,t/1.2,(duration-t)/2);
    view.setInt16(44+i*2,Math.max(-1,Math.min(1,sample))*32767,true);
  }
  return new File([buffer],'Pocket - Sunday, offline.wav',{type:'audio/wav',lastModified:0});
}
$('demo-button').addEventListener('click',async()=>{
  const existing=library.tracks.find(track=>track.file.name==='Pocket - Sunday, offline.wav');
  if(existing){chooseTrack(existing);return;}
  $('demo-button').disabled=true;toast('正在这台设备上合成一小段音乐…');
  await new Promise(resolve=>setTimeout(resolve,30));
  try {const demo=makeDemo();await library.importFiles([demo]);const track=library.tracks.find(item=>item.file.name===demo.name);if(track)chooseTrack(track);}catch{toast('演示音轨未能生成，请选择本地音乐试听。');}finally{$('demo-button').disabled=false;}
});

if('mediaSession'in navigator){
  for(const [action,handler] of Object.entries({play:()=>{if(!player.playing)player.toggle();},pause:()=>player.pause(),previoustrack:()=>player.previous(),nexttrack:()=>player.next(),seekto:details=>player.seek(details.seekTime),seekbackward:details=>player.seek(player.currentTime-(details.seekOffset||10)),seekforward:details=>player.seek(player.currentTime+(details.seekOffset||10))})){
    try{navigator.mediaSession.setActionHandler(action,handler);}catch{/* Unsupported media action. */}
  }
}
updatePlayer();renderLibrary();
library.init().catch(()=>toast('无法恢复本地曲库，重新选择文件即可继续。'));
window.addEventListener('pagehide',event=>{activeGame?.controller.pause();if(!event.persisted){activeGame?.controller.destroy();player.destroy();library.destroy();}});
