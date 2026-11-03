import { STAGES, stageOf, createState, begin, restart, move, extend, copy, cut, paste, cancelClipboard, cellName, key, fromKey, parseCell, parseRef,
  tokenOf, isBlank, isFormula, deviceStatus, exitOpen, selectionRect, countTokens, test, displayValue, rawText, canEdit, commitEdit,
  clearContents, undo, fill, selectColumn, selectRow, selectRegion, jumpTo, goHome, goEnd, findNext, replaceAll, toggleFilter,
  applyFilter, filterChoices, numberFormat, toggleBold, answerConfirm, newSheet, cycleReference, hiddenSet, gotoRef, MAX_ROW, MAX_COL,
  rootOf, sheetNames, selectionAreas, widthOf, DEFAULT_WIDTH, hiddenColSet, redo, toggleExtend, toggleAdd, clearModes, selectTo, tabMove,
  insertCells, deleteCells, wholeRows, wholeCols, autoSumText, flashFill, toggleFormulaView, toggleStyle, recalc, createTable, tableRange,
  addChart, hideRows, hideCols, unhideRows, unhideCols, switchSheet, save, saveAs, serialText, valueOf } from './engine.js';

const $ = id => document.getElementById(id);
const canvas = $('board'), ctx = canvas.getContext('2d');
const hintDialog = $('hintDialog'), settingsDialog = $('settingsDialog'), panelEl = $('cmdPanel'), editor = $('cellEditor');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const safeRead = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } };
const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
let savedSettings = safeRead('cell-escape.settings', {});
if (!savedSettings || typeof savedSettings !== 'object') savedSettings = {};
let sound = savedSettings.sound === true;
let reduced = typeof savedSettings.reduced === 'boolean' ? savedSettings.reduced : matchMedia('(prefers-reduced-motion: reduce)').matches;
// Rooms cleared in order. Room n (0-based) is open once n rooms are cleared.
let progress = (() => { const n = safeRead('cell-escape.progress', null); if (Number.isInteger(n)) return Math.max(0, Math.min(STAGES.length, n)); return safeRead('cell-escape.cleared', false) === true ? 1 : 0; })();
let room = (() => { const q = Number(new URLSearchParams(location.search).get('room')); return q >= 1 && q <= STAGES.length ? q - 1 : Math.min(progress, STAGES.length - 1); })();
let S = STAGES[room];
let state = createState(room);
let hintIndex = 0, inputArmed = false;
let width = 0, height = 0, scale = 1, geo = null, audio = null;
let animation = null, particles = [], trapFx = null, bump = null, pendingDeath = false, doorK = null;
let panel = null, editing = null;
// Cells whose trap this player has watched fire, per room. Survives retries, not reloads.
const seenTraps = new Set();
// Game time only advances while nothing is paused, so dialogs freeze every effect in place.
// Each attempt owns its scheduled events; retry/start bump `attempt` so stale callbacks never fire.
let clock = 0, lastReal = null, attempt = 0, events = [];
let focusTimer = null;
const held = new Set();
// Milliseconds after the trap is triggered (landing, or the end of the look at what caused it).
const T = { drop: 60, impact: 180, burst: 240, result: 480 };
const LASER_LOOK = 450, CHANGE_LOOK = 260;
const IMPACT_SOUND = { ceilingPress: 'press', doorDrop: 'press', fakeDoor: 'press', floorDrop: 'drop', fakeExit: 'drop', spikes: 'spike', laser: 'laser', blast: 'drop' };
const ORDINALS = ['FIRST','SECOND','THIRD','FOURTH','FIFTH','SIXTH','SEVENTH','EIGHTH','NINTH','TENTH','ELEVENTH','TWELFTH','THIRTEENTH','FOURTEENTH','FIFTEENTH','SIXTEENTH','SEVENTEENTH','EIGHTEENTH','NINETEENTH','TWENTIETH','21ST','22ND','23RD','24TH','25TH','26TH','27TH','28TH','29TH','LAST'];
const pad = n => String(n).padStart(2, '0');
// What each shortcut does, shown on the clear screen (keys are the room's hint keys joined with ＋).
const KEY_HELP = {
  'Ctrl＋→':'データの端まで一気に移動','Ctrl＋↓':'下のデータの端まで移動','Ctrl＋Shift＋→':'データの端まで選択を広げる',
  'Ctrl＋C':'コピー','Ctrl＋V':'貼り付け','Ctrl＋X':'切り取り（貼り付けたときに元が消える）','Esc':'ダイアログを閉じる・取り消す',
  'Ctrl＋Z':'元に戻す','Ctrl＋Y':'やり直す（元に戻したものをもう一度）','Delete':'セルの中身だけを消す','F2':'中身を残したままセルを編集',
  'Backspace':'1文字消す','Enter':'確定して下のセルへ','Alt＋Enter':'セルの中で改行','Shift＋→':'選択を1セルずつ広げる',
  'Shift＋↓':'選択を1行広げる','Shift＋↑':'選択を上へ広げる','Ctrl＋Space':'列全体を選択','Shift＋Space':'行全体を選択',
  'Ctrl＋A':'いまの表（現在の領域）を選択。もう一度でシート全体','Ctrl＋Enter':'選んだセル全部に同じ値を入力',
  'Ctrl＋D':'一番上のセルを下へコピー','Ctrl＋R':'一番左のセルを右へコピー','Ctrl＋F':'検索','Ctrl＋H':'置換（範囲を選ぶとその中だけ）',
  'Ctrl＋G':'指定したセルへジャンプ','Ctrl＋Home':'A1へ移動','Ctrl＋End':'使っている範囲の右下へ移動',
  'Ctrl＋Shift＋L':'フィルターのオン・オフ','Alt＋↓':'フィルターのメニューを開く','Ctrl＋Alt＋V':'形式を選択して貼り付け',
  'V':'（形式を選択して貼り付けで）値だけ','T':'（形式を選択して貼り付けで）書式だけ','F':'（形式を選択して貼り付けで）数式だけ',
  'Ctrl＋Shift＋1':'桁区切り・小数2桁の数値表示','Ctrl＋B':'太字','Shift＋F2':'セルのメモを開く','F4':'式の参照を固定する（$を付ける）',
  'Shift＋F11':'新しいシートを挿入','F8':'選択の拡張モード（矢印だけで広げる）','Shift＋F8':'選択の追加モード（離れた範囲も一緒に選ぶ）',
  'Ctrl＋Shift＋Home':'A1まで選択','Ctrl＋Shift＋End':'使っている範囲の右下まで選択','Tab':'確定して右へ（保護シートでは次の入力欄へ）',
  'Shift＋Tab':'前の入力欄へ','Shift＋Enter':'確定して上のセルへ','Ctrl＋Shift＋+':'セルを挿入（後ろを押し出す）','Ctrl＋-':'セルを削除（後ろを詰める）',
  'Alt＋=':'合計（SUM）の式を入れる','Ctrl＋`':'セルに数式を表示する','Ctrl＋;':'今日の日付を入力','Ctrl＋PageDown':'次のシートへ','Ctrl＋PageUp':'前のシートへ',
  'Ctrl＋E':'フラッシュフィル（例から残りを埋める）','Ctrl＋T':'テーブルを作る','F9':'再計算','Alt＋F1':'グラフを作る','Shift＋F10':'右クリックメニューを開く',
  'Ctrl＋I':'斜体','Ctrl＋U':'下線','Ctrl＋5':'取り消し線','Ctrl＋Shift＋0':'列の再表示','Ctrl＋Shift＋9':'行の再表示','Ctrl＋9':'行を隠す','Ctrl＋0':'列を隠す',
  'Ctrl＋S':'上書き保存','F12':'名前を付けて保存','1':'数字を入力','3':'数字を入力',
};
// Hints open one at a time: one per death in this room, up to the third (the answer).
const unlockedHints = () => Math.min(3, state.deaths);
// Hints are written with Windows key names everywhere (on a Mac, ⌘ is still accepted wherever Ctrl is).
const forPlatform = text => text;
const seenKey = p => `${room}:${key(p)}`;
const same = (a, b) => a && b && a.col === b.col && a.row === b.row;

function rounded(x,y,w,h,r,fill,stroke) {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r); if(fill){ctx.fillStyle=fill;ctx.fill();} if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
// Filtered rows take no space, so the grid keeps only the rows that are shown.
// Filtered or hidden rows take no space; columns take their width (hidden ones none).
function computeGeometry() {
  const gutter = width < 500 ? 23 : 31, top = 27, hidden = hiddenSet(state), rows = [];
  for (let r = 1; r <= S.visibleRows; r++) if (!hidden.has(r)) rows.push(r);
  const widths = [0]; for (let c = 1; c <= S.visibleCols; c++) widths.push(widthOf(state, c));
  const unit = (width - gutter - 15) / widths.reduce((a, b) => a + b, 0), colLeft = [gutter], colW = [0];
  for (let c = 1; c <= S.visibleCols + 1; c++) { colW[c] = (widths[c] ?? DEFAULT_WIDTH) * unit; colLeft[c] = c === 1 ? gutter : colLeft[c - 1] + colW[c - 1]; }
  const cw = unit * DEFAULT_WIDTH, ch = (height - top - 17) / Math.max(rows.length, 1);
  geo = { gutter, top, cw, ch, rows, rowIdx: new Map(rows.map((r, i) => [r, i])), colLeft, colW };
}
const shown = p => p.col >= 1 && p.col <= S.visibleCols && geo.colW[p.col] > 0 && geo.rowIdx.has(p.row);
function point(p) {
  const i = geo.rowIdx.get(p.row), c = Math.min(p.col, S.visibleCols + 1);
  return { x: p.col > S.visibleCols ? width - 8 : geo.colLeft[c] + geo.colW[c]/2, y: geo.top + ((i ?? (p.row > S.visibleRows ? geo.rows.length + 1 : -1)) + .5)*geo.ch };
}
function cellBox(p) { const c = point(p); const w = geo.colW[Math.min(p.col, S.visibleCols)] || geo.cw; return { x: c.x - w/2, y: c.y - geo.ch/2, w, h: geo.ch }; }
// Shared by floors, the character and every trap so they always meet at the same height.
function at(p) {
  const { cw, ch } = geo, c = point(p), floorHeight = Math.min(ch*.7,36), size = Math.min(cw*.43,ch*.83,29);
  const standY = c.y - floorHeight*.3 - size*.35;
  return { x: c.x, floorY: c.y, floorTop: c.y - floorHeight*.5, floorHeight, size, standY, feetY: standY + size*.48, r: Math.max(4, size*.3), tx: c.x + cw*.2 };
}
function doorBox(p) {
  const { cw, ch } = geo, L = at(p), doorY = L.floorY + L.floorHeight*.28, dh = Math.max(12, Math.min(ch*1.8, 73, doorY - geo.top - 4)), dw = Math.min(cw*.67,36);
  return { ...L, dh, dw, doorY, ix: L.x-dw*.47, iy: doorY-dh+5, iw: dw*.94, ih: dh-7 };
}
function resize() {
  const rect = canvas.getBoundingClientRect(); width=rect.width;height=rect.height;scale=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.setTransform(scale,0,0,scale,0,0);computeGeometry();placeEditor();draw(clock);
}
function ghost(x,y,size,t,opacity=1,tilt=0,pose=null) {
  ctx.save(); ctx.translate(x,y);ctx.rotate(tilt);ctx.globalAlpha=opacity;
  // Squash around the feet so the body flattens onto the floor, not toward its centre.
  if(pose?.sx){ctx.translate(0,size*.48);ctx.scale(pose.sx,pose.sy);ctx.translate(0,-size*.48);}
  ctx.shadowColor='#c6eda655';ctx.shadowBlur=15;
  rounded(-size*.43,-size*.52,size*.86,size,Math.max(3,size*.18),'#dfe7cc');
  ctx.shadowBlur=0;
  rounded(-size*.43,size*.22,size*.86,size*.23,3,'#b2c995');
  rounded(size*.28,-size*.2,size*.23,size*.45,2,'#8caa70');
  if(pose?.shock) {
    for(const ex of [-.15,.13]){ctx.beginPath();ctx.arc(size*ex,-size*.16,size*.075,0,Math.PI*2);ctx.fillStyle='#293f27';ctx.fill();}
    ctx.beginPath();ctx.ellipse(-size*.01,size*.06,size*.05,size*.07,0,0,Math.PI*2);ctx.fill();
  } else {
    const blink = reduced ? 1 : Math.sin(t/1700)> .995 ? .2 : 1;
    rounded(-size*.19,-size*.18,size*.09,size*.2*blink,1,'#293f27');
    rounded(size*.09,-size*.18,size*.09,size*.2*blink,1,'#293f27');
  }
  ctx.globalAlpha=opacity*.65;ctx.fillStyle='#f4f9e8';ctx.fillRect(-size*.25,-size*.42,size*.35,1.5);
  ctx.restore();
}
// How the character reacts to each trap, by time since it fired.
function poseFor(type,lt) {
  if(lt===null||lt<0)return null;
  if(type==='floorDrop'||type==='fakeExit') {
    if(lt<T.drop)return {shock:true,hop:!reduced};
    if(lt<T.impact)return {shock:true,fall:reduced?1:(lt-T.drop)/(T.impact-T.drop)};
    return {hidden:true};
  }
  if(lt<T.impact)return {shock:true,hop:lt<T.drop&&!reduced};
  if(lt<(reduced?320:T.burst)) {
    if(type==='spikes')return {sx:.9,sy:.85,lift:true,tilt:.25};
    if(type==='laser'||type==='blast')return {sx:1.15,sy:.85,dim:true};
    return {sx:1.6,sy:.3};
  }
  return {hidden:true};
}
// A heavy weight that drops onto the cell: the ceiling press, or the shutter inside an exit.
function drawDrop(p,lt,style) {
  const { cw, ch } = geo, L = at(p), shutter = style==='shutter';
  const D = shutter ? doorBox(p) : null;
  const pw = shutter ? Math.min(cw*.92, D.dw*1.5) : cw*.88, bodyH = Math.max(L.size*1.3, ch*.95), teeth = shutter ? 0 : Math.max(3, L.size*.22);
  const mountY = shutter ? D.doorY-D.dh-2 : Math.max(geo.top+6, L.standY - L.size*.52 - ch*1.7), downY = L.feetY - L.size*.3;
  let k = 0;
  if(lt!==null&&lt>=T.drop) k = reduced ? 1 : Math.min(1, ((lt-T.drop)/(T.impact-T.drop))**2);
  if(shutter&&k===0)return;
  if(!shutter){ctx.fillStyle='#2a3725';for(const side of [-1,1])ctx.fillRect(L.x+side*(pw*.5+1.5)-1.5,mountY,3,ch*.38);}
  if(k>0) {
    const bottom = mountY + (downY-mountY)*k, by = bottom-bodyH, bx = L.x-pw/2, bh = bodyH-teeth;
    ctx.save();ctx.beginPath();ctx.rect(L.x-cw,mountY,cw*2,height);ctx.clip();
    if(!shutter&&by>mountY){ctx.fillStyle='#565b48';ctx.fillRect(L.x-pw*.11,mountY,pw*.22,by-mountY);ctx.fillStyle='#8d917a66';ctx.fillRect(L.x-pw*.11,mountY,1.5,by-mountY);}
    rounded(bx,by,pw,bh,2,shutter?'#3d4535':'#4b5140','#1b2216');
    ctx.fillStyle='#6d745b';ctx.fillRect(bx+2,by+2,pw-4,2);
    if(shutter){ctx.fillStyle='#262d20';for(let y=by+bh*.18;y<by+bh*.7;y+=Math.max(4,bh*.12))ctx.fillRect(bx+2,y,pw-4,1.5);}
    else{ctx.fillStyle='#262c1f';for(const fx of [.18,.82]){ctx.beginPath();ctx.arc(bx+pw*fx,by+bh*.22,Math.max(1.2,pw*.04),0,Math.PI*2);ctx.fill();}}
    const hy = by+bh*(shutter?.78:.52), hh = Math.max(4,bh*(shutter?.2:.26));
    ctx.save();ctx.beginPath();ctx.rect(bx+1,hy,pw-2,hh);ctx.clip();ctx.fillStyle='#d4a043';ctx.fillRect(bx,hy,pw,hh);ctx.fillStyle='#24271c';
    for(let s=-hh;s<pw+hh;s+=hh*1.3){ctx.beginPath();ctx.moveTo(bx+s,hy+hh);ctx.lineTo(bx+s+hh*.6,hy+hh);ctx.lineTo(bx+s+hh*1.2,hy);ctx.lineTo(bx+s+hh*.6,hy);ctx.closePath();ctx.fill();}
    ctx.restore();
    if(teeth){const n = Math.max(3,Math.round(pw/7));ctx.fillStyle='#a3a589';ctx.beginPath();ctx.moveTo(bx,by+bh);
      for(let i=0;i<n;i++){ctx.lineTo(bx+pw*(i+.5)/n,by+bh+teeth);ctx.lineTo(bx+pw*(i+1)/n,by+bh);}
      ctx.closePath();ctx.fill();}
    ctx.restore();
  }
  if(shutter)return;
  rounded(L.x-cw*.47,mountY-5,cw*.94,6,1.5,'#212c1e','#3b4a33');
  ctx.fillStyle='#0b120c';ctx.fillRect(L.x-pw*.5,mountY,pw,1.5);
  // A press seen in an earlier attempt keeps a faint scorch on its plate.
  if(seenTraps.has(seenKey(p))&&k===0){ctx.fillStyle='#c98a5a88';ctx.fillRect(L.x-cw*.3,mountY-3,cw*.6,1.5);}
}
function drawSpikes(p,lt) {
  if(lt===null||lt<T.drop)return;
  const { cw } = geo, L = at(p), k = reduced ? 1 : 1-(1-Math.min(1,(lt-T.drop)/(T.impact-T.drop)))**2;
  const n = 5, w = cw*.78, base = L.floorTop+3, h = L.size*1.25*k;
  ctx.fillStyle='#1b2417';ctx.fillRect(L.x-w/2,base-1.5,w,3);
  ctx.beginPath();
  for(let i=0;i<n;i++){const x0=L.x-w/2+w*i/n;ctx.moveTo(x0,base);ctx.lineTo(x0+w/n/2,base-h);ctx.lineTo(x0+w/n,base);}
  ctx.closePath();ctx.fillStyle='#cfd2ba';ctx.fill();ctx.strokeStyle='#2a3022';ctx.lineWidth=1;ctx.stroke();
}
function drawLaser(p,lt) {
  if(lt===null||lt<T.drop)return;
  const { cw, ch } = geo, L = at(p), k = reduced ? 1 : Math.min(1,(lt-T.drop)/(T.impact-T.drop));
  const mid = L.standY, gap = ch*.85*(1-k), x1 = L.x-cw*.62, x2 = L.x+cw*.62, after = lt>=T.burst;
  ctx.save();
  for(const side of [-1,1])rounded(side<0?x1-5:x2,mid-ch*.9,5,ch*1.8,1,'#1d2619','#56684a');
  ctx.strokeStyle=after?'#ff6a5466':'#ff5a4a';ctx.lineWidth=after?1.5:2;
  if(!reduced&&!after){ctx.shadowColor='#ff5a4a';ctx.shadowBlur=8;}
  ctx.beginPath();ctx.moveTo(x1,mid-gap);ctx.lineTo(x2,mid-gap);if(gap>1){ctx.moveTo(x1,mid+gap);ctx.lineTo(x2,mid+gap);}ctx.stroke();
  ctx.restore();
}
function drawBlast(p,lt) {
  if(lt===null||lt<T.drop)return;
  const L = at(p), k = reduced ? 1 : Math.min(1,(lt-T.drop)/(T.impact-T.drop)), r = geo.cw*.95*k;
  if(lt<T.burst+120){ctx.save();ctx.globalAlpha=reduced?.5:Math.max(0,1-(lt-T.drop)/300);ctx.fillStyle='#f0a050';ctx.beginPath();ctx.arc(L.x,L.standY,r,0,Math.PI*2);ctx.fill();ctx.restore();}
  ctx.fillStyle='#0d120c99';ctx.beginPath();ctx.ellipse(L.x,L.floorTop+3,geo.cw*.4,3,0,0,Math.PI*2);ctx.fill();
}
function drawHole(L,lt,t) {
  const { cw } = geo, k = reduced ? 1 : Math.min(1,(lt-T.drop)/80), x = L.x-cw*.5+1, w = cw-2;
  rounded(x,L.floorTop,w,L.floorHeight,2,'#070c08','#607b4544');
  // The gear waiting below.
  const gy = L.floorTop+L.floorHeight+geo.ch*.25, gr = Math.min(cw*.28,geo.ch*.3), spin = reduced ? 0 : t*.006;
  ctx.save();ctx.translate(L.x,gy);ctx.rotate(spin);ctx.fillStyle='#4f5544';
  for(let i=0;i<8;i++){ctx.rotate(Math.PI/4);ctx.fillRect(-gr*.16,-gr*1.2,gr*.32,gr*.4);}
  ctx.beginPath();ctx.arc(0,0,gr,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0d130e';ctx.beginPath();ctx.arc(0,0,gr*.35,0,Math.PI*2);ctx.fill();ctx.restore();
  // Two flaps hinge down from the slab edges.
  for(const side of [-1,1]){ctx.save();ctx.translate(side<0?x:x+w,L.floorTop);ctx.rotate(side*-k*1.25);ctx.fillStyle='#34472b';ctx.fillRect(side<0?0:-w/2,0,w/2,3);ctx.restore();}
}
function drawDoor(p,{fake=false,lit=true,closed=0,style=null,won=false}) {
  const D = doorBox(p), { x, dh, dw, doorY, ix, iy, iw, ih } = D;
  ctx.save();
  // A fake exit looks right at a glance: its frame is a touch crooked and there is a seam under it.
  if(fake){ctx.translate(x,doorY);ctx.rotate(-.045);ctx.translate(-x,-doorY);}
  ctx.shadowColor='#bee695';ctx.shadowBlur=!lit?0:won?35:closed>.9?6:16;
  rounded(x-dw*.65,doorY-dh,dw*1.3,dh+3,4,'#142518',lit?'#67854b':'#3c4a37');
  ctx.shadowBlur=0;
  const g=ctx.createLinearGradient(0,doorY-dh,0,doorY);
  if(lit){g.addColorStop(0,won?'#c2ecae':'#739b56');g.addColorStop(1,won?'#83bd72':'#365b31');}else{g.addColorStop(0,'#2b3328');g.addColorStop(1,'#161d16');}
  rounded(ix,iy,iw,ih,2,g);
  if(closed>0) {
    ctx.save();ctx.beginPath();ctx.rect(ix,iy,iw,ih);ctx.clip();
    const drop = ih*(1-closed);
    // The ajar door hangs lower on one side, so light leaks under the other.
    const lift = style==='ajar' ? ih*.28*closed : 0;
    ctx.beginPath();ctx.moveTo(ix,iy-drop);ctx.lineTo(ix+iw,iy-drop);ctx.lineTo(ix+iw,iy+ih-drop-lift);ctx.lineTo(ix,iy+ih-drop);ctx.closePath();
    ctx.fillStyle='#29352a';ctx.fill();ctx.strokeStyle='#1a2419';ctx.lineWidth=1;
    for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(ix+iw*i/3,iy-drop);ctx.lineTo(ix+iw*i/3,iy+ih-drop-lift*i/3);ctx.stroke();}
    if(style==='locked'){
      ctx.fillStyle='#0c120c';ctx.beginPath();ctx.arc(x,iy+ih*.58-drop,Math.max(2,iw*.09),0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.moveTo(x-iw*.06,iy+ih*.62-drop);ctx.lineTo(x+iw*.06,iy+ih*.62-drop);ctx.lineTo(x,iy+ih*.76-drop);ctx.fill();
      ctx.font=`${Math.max(9,iw*.4)}px Georgia,serif`;ctx.fillStyle='#c9b77a';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('I',x,iy+ih*.28-drop);
    }
    ctx.restore();
  }
  ctx.fillStyle=lit?'#d5efb1':'#59654f';ctx.fillRect(x+dw*.18,doorY-dh*.47,2,4);
  if(fake){ctx.fillStyle='#070c08';ctx.fillRect(x-dw*.62,doorY+4,dw*1.24,1.5);}
  ctx.restore();
  ctx.font='7px ui-monospace,monospace';ctx.fillStyle=lit?'#b0cc8e':'#56664c';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('EXIT',x,Math.max(geo.top+5,doorY-dh-8));
  if(lit){ctx.fillStyle='#a2ba7740';ctx.beginPath();ctx.ellipse(x,doorY+5,dw*.9,4,0,0,Math.PI*2);ctx.fill();}
}
function drawStone(x,y,r) {
  ctx.beginPath();ctx.ellipse(x,y,r,r*.72,0,0,Math.PI*2);ctx.fillStyle='#a9ae98';ctx.fill();ctx.strokeStyle='#4d5443';ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle='#d6dac6';ctx.beginPath();ctx.ellipse(x-r*.3,y-r*.25,r*.3,r*.14,-.4,0,Math.PI*2);ctx.fill();
}
function drawKey(x,y,r,color='#e0c36a') {
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.5,r*.3);ctx.lineCap='round';
  ctx.beginPath();ctx.arc(x-r*.55,y,r*.45,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x-r*.1,y);ctx.lineTo(x+r*1.05,y);ctx.moveTo(x+r*.65,y);ctx.lineTo(x+r*.65,y+r*.4);ctx.moveTo(x+r*1.02,y);ctx.lineTo(x+r*1.02,y+r*.5);ctx.stroke();
  ctx.restore();
}
function drawBattery(x,y,r,color='#9fd27a') {
  rounded(x-r*.9,y-r*.55,r*1.7,r*1.1,2,'#26331f',color);rounded(x+r*.8,y-r*.22,r*.25,r*.44,1,color);
  ctx.fillStyle=color;ctx.fillRect(x-r*.45,y-r*.08,r*.7,r*.16);ctx.fillRect(x-r*.18,y-r*.35,r*.16,r*.7);
}
function drawBomb(x,y,r) {
  ctx.fillStyle='#1b1e19';ctx.beginPath();ctx.arc(x,y,r*.85,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#5c6450';ctx.lineWidth=1;ctx.stroke();
  ctx.strokeStyle='#c99a5a';ctx.beginPath();ctx.moveTo(x+r*.5,y-r*.6);ctx.quadraticCurveTo(x+r*.9,y-r*1.3,x+r*1.2,y-r*1.1);ctx.stroke();
  ctx.fillStyle='#f2c46a';ctx.beginPath();ctx.arc(x+r*1.2,y-r*1.1,Math.max(1.5,r*.18),0,Math.PI*2);ctx.fill();
}
function drawVoid(x,y,r) {
  const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'#000');g.addColorStop(.7,'#2a1636');g.addColorStop(1,'#6b3f86');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
}
function drawSeal(x,y,r) {
  ctx.fillStyle='#a8322b';ctx.beginPath();for(let i=0;i<10;i++){const a=i/10*Math.PI*2,rr=i%2?r*.85:r;ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}ctx.fill();
  ctx.fillStyle='#d9594c';ctx.beginPath();ctx.arc(x,y,r*.55,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#7a1f1a';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x-r*.25,y);ctx.lineTo(x+r*.25,y);ctx.moveTo(x,y-r*.25);ctx.lineTo(x,y+r*.25);ctx.stroke();
}
function drawEye(x,y,r,awake) {
  ctx.save();ctx.beginPath();ctx.ellipse(x,y,r*1.2,r*.7,0,0,Math.PI*2);ctx.fillStyle='#f3efe0';ctx.fill();ctx.strokeStyle=awake?'#e0584e':'#55684a';ctx.lineWidth=1.5;ctx.stroke();
  if(awake){ctx.fillStyle='#c0392b';ctx.beginPath();ctx.arc(x,y,r*.42,0,Math.PI*2);ctx.fill();}else{ctx.strokeStyle='#55684a';ctx.beginPath();ctx.moveTo(x-r,y);ctx.lineTo(x+r,y);ctx.stroke();}
  ctx.restore();
}
function drawTokenIcon(token,x,y,r,color) {
  if(token==='eye'){drawEye(x,y,r,true);return;}
  if(token==='seal'){drawSeal(x,y,r);return;}
  if(token==='core'){ctx.save();if(!reduced){ctx.shadowColor='#bfe08a';ctx.shadowBlur=8;}ctx.fillStyle=color||'#cde7a0';ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r*.8,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r*.8,y);ctx.closePath();ctx.fill();ctx.restore();ctx.strokeStyle='#3b4a2c';ctx.lineWidth=1;ctx.stroke();return;}
  if(token==='stone')drawStone(x,y,r);
  else if(token==='key')drawKey(x-r*.25,y,r,color);
  else if(token==='battery')drawBattery(x,y,r,color);
  else if(token==='bomb')drawBomb(x,y,r);
  else if(token==='void')drawVoid(x,y,r);
}
function drawToken(v,p,danger=false) {
  const L = at(p), floor = S.floor.has(key(p));
  const x = floor ? L.tx : L.x, y = floor ? L.floorTop-L.r*.6 : L.floorY;
  drawTokenIcon(tokenOf(v),x,y,L.r,danger?'#ff7a64':undefined);
  if(danger){ctx.strokeStyle='#ff5a4a';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,L.r*1.6,0,Math.PI*2);ctx.stroke();}
}
function drawLamp(x,y,lit) {
  const lr=Math.max(3,Math.min(geo.cw*.08,6));
  ctx.save();if(lit&&!reduced){ctx.shadowColor='#f2d27e';ctx.shadowBlur=12;}ctx.beginPath();ctx.arc(x,y,lr,0,Math.PI*2);ctx.fillStyle=lit?'#f2d27e':'#263124';ctx.fill();ctx.strokeStyle=lit?'#fff0b8':'#55684a';ctx.stroke();ctx.restore();
}
// A monitor that counts one kind of token: one slot per allowed token, red when there are too many.
function drawMonitor(rule) {
  const target = parseCell(rule.at), spot = rule.monitor ? parseCell(rule.monitor) : { col: target.col, row: 2 };
  if(!shown(spot))return;
  const { cw, ch } = geo, c = point(spot), count = countTokens(state.values, rule.token);
  const alarm = count>rule.limit || (trapFx?.type==='laser'&&count>rule.limit);
  const w = Math.max(cw*1.5,42), h = Math.max(ch*.7,22), x = c.x-w/2, y = c.y-h/2;
  if(shown(target)){const L=at(target);ctx.strokeStyle='#4f6243';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(c.x,y+h);ctx.lineTo(L.tx,L.floorTop-L.r*1.6);ctx.stroke();ctx.setLineDash([]);}
  rounded(x,y,w,h,3,'#0e1811',alarm?'#ff5a4a':'#56704a');
  const slots = Math.max(rule.limit,count), r = Math.min(h*.2,w/(slots*3.2));
  for(let i=0;i<slots;i++)drawTokenIcon(rule.token,x+w*(i+.5)/slots,c.y,r,i<count?(alarm?'#ff6a54':'#b9df8f'):'#33452f');
}
const FILLS={red:['#b8453a40','#d0614f'],green:['#3f8a4a40','#6fbf6a']};
function drawCellText(p,text,f={}) {
  const b=cellBox(p), floor=S.floor.has(key(p)), L=at(p);
  if(FILLS[f.fill])rounded(b.x+3,b.y+3,b.w-6,b.h-6,3,...FILLS[f.fill]);
  const lines=String(text).split('\n'), size=Math.max(8,Math.min(11,geo.cw*.15));
  ctx.font=`${f.italic?'italic ':''}${f.bold?'800 ':''}${size}px ui-monospace,Consolas,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=text==='1'?'#9eaf7740':'#d6e3c3';
  const y0=floor?L.floorY+L.floorHeight*.14-(lines.length-1)*size*.55:L.floorY-(lines.length-1)*size*.55;
  ctx.save();ctx.beginPath();ctx.rect(b.x+1,b.y,b.w-2,b.h);ctx.clip();
  lines.forEach((line,i)=>{const y=y0+i*size*1.1;ctx.fillText(line,L.x,y);if(f.bold)ctx.fillText(line,L.x+.6,y);
    const w=ctx.measureText(line).width;
    if(f.underline){ctx.fillRect(L.x-w/2,y+size*.55,w,1.2);}if(f.strike){ctx.fillRect(L.x-w/2,y-.5,w,1.2);}});
  ctx.restore();
}
function draw(t) {
  if(!geo || !width)return;
  computeGeometry();
  ctx.clearRect(0,0,width,height);
  const { gutter, top, cw, ch }=geo;
  const lt=trapFx?t-trapFx.at:null, fxAt=p=>trapFx&&trapFx.col===p.col&&trapFx.row===p.row?lt:null;
  const status=deviceStatus(S,state);
  ctx.fillStyle='#141e17';ctx.fillRect(0,0,width,height);
  // Impact shake moves only the board drawing; the page chrome lives outside the canvas.
  const shaking=!reduced&&lt!==null&&lt>=T.impact&&lt<T.impact+130;
  if(shaking){const a=3*(1-(lt-T.impact)/130);ctx.save();ctx.translate(a*Math.sin(lt*.42),a*.6*Math.cos(lt*.57));}
  const gradient=ctx.createRadialGradient(width*.48,height*.57,0,width*.48,height*.57,width*.65);
  gradient.addColorStop(0,'#26392470');gradient.addColorStop(1,'#101a1300');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#1d291d';ctx.fillRect(0,0,width,top);ctx.fillRect(0,0,gutter,height);
  ctx.strokeStyle='#607c4524';ctx.lineWidth=.7;
  for(let c=1;c<=S.visibleCols+1;c++){const x=geo.colLeft[c];ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();
    // A hidden column leaves a doubled line where it used to be.
    if(c<=S.visibleCols&&geo.colW[c]===0){ctx.strokeStyle='#8fb06a66';ctx.beginPath();ctx.moveTo(x+1.5,0);ctx.lineTo(x+1.5,height);ctx.stroke();ctx.strokeStyle='#607c4524';}}
  ctx.beginPath();ctx.moveTo(gutter,0);ctx.lineTo(gutter,height);ctx.stroke();
  for(let i=0;i<=geo.rows.length;i++){const y=top+i*ch;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();
    // Hidden rows leave a doubled line, like a filtered sheet.
    if(i>0&&i<geo.rows.length&&geo.rows[i]-geo.rows[i-1]>1){ctx.strokeStyle='#8fb06a66';ctx.beginPath();ctx.moveTo(0,y+1.5);ctx.lineTo(width,y+1.5);ctx.stroke();ctx.strokeStyle='#607c4524';}}
  ctx.font=`${width<500?8:9}px ui-monospace,Consolas,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#6d8659';
  for(let c=1;c<=S.visibleCols;c++)if(geo.colW[c]>0)ctx.fillText(String.fromCharCode(64+c),geo.colLeft[c]+geo.colW[c]/2,top*.5);
  if(state.chartView!==null){drawChartSheet(t);if(shaking)ctx.restore();return;}
  geo.rows.forEach((r,i)=>ctx.fillText(String(r),gutter*.5,top+(i+.5)*ch));

  const floorCells=[...S.floor].map(fromKey).filter(shown);
  const deviceAt=new Map();for(const d of S.devices)d.cells.forEach((c,i)=>deviceAt.set(key(c),{d,i}));
  const hazardAt=new Set(S.selectHazards.flatMap(h=>h.cells.map(key)));
  // Rails between floors on stacked rows: the way down is visible before anyone tries it.
  for(const p of floorCells){const below={col:p.col,row:p.row+1};if(S.floor.has(key(below))&&shown(below)){const a=at(p),b=at(below);ctx.fillStyle='#5d7a4890';for(const side of [-1,1])ctx.fillRect(a.x+side*cw*.2-1,a.floorTop+a.floorHeight,2,b.floorTop-a.floorTop-a.floorHeight);}}
  for(const p of floorCells) {
    const L=at(p), x=L.x-cw*.5+1, trap=S.traps.get(key(p)), flt=fxAt(p), fired=flt!==null&&flt>=0;
    const holeType=trapFx&&(trapFx.type==='floorDrop'||trapFx.type==='fakeExit');
    if(fired&&holeType&&flt>=T.drop){drawHole(L,flt,t);continue;}
    const sink=fired?(reduced?2:Math.min(2,flt/30)):0;
    // A bridge that has lost power sinks and goes dark.
    const sunk=trap?.bridge&&test(S,state,trap.when);
    rounded(x,L.floorTop+sink*.5+(sunk?L.floorHeight*.35:0),cw-2,L.floorHeight*(sunk?.65:1),2,sunk?'#1d2618':'#34472b',sunk?'#3b4a3366':'#607b4544');
    if(!sunk){ctx.fillStyle=trap?.bridge?'#bfe08a55':'#839e4c24';ctx.fillRect(x+1,L.floorTop+1,cw-4,2);}
    const belowFloor=S.floor.has(key({col:p.col,row:p.row+1}));
    if(!belowFloor){ctx.strokeStyle='#7c965c60';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(x-1,L.floorTop+L.floorHeight+8);ctx.lineTo(x+cw-1,L.floorTop+L.floorHeight+8);ctx.stroke();ctx.setLineDash([]);}
    if(trap?.type==='ceilingPress') {
      // The switch plate: a faint seam that sinks when stepped on.
      const sx=L.x-cw*.32, sw=cw*.64, sh=Math.max(3,L.floorHeight*.22);
      if(fired){ctx.fillStyle='#1a2516';ctx.fillRect(sx,L.floorTop+2,sw,sh+sink);}
      ctx.strokeStyle=fired?'#11190f':'#56693f70';ctx.lineWidth=1;ctx.strokeRect(sx,L.floorTop+2+sink,sw,sh);
    } else if(trap?.type==='floorDrop'&&!trap.bridge) {
      ctx.strokeStyle='#5d6e43';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L.x-4,L.floorTop+3);ctx.lineTo(L.x+1,L.floorTop+L.floorHeight*.34);ctx.lineTo(L.x-2,L.floorY+1);ctx.stroke();
    } else if(trap?.type==='fakeExit') {
      ctx.fillStyle='#11190f99';ctx.fillRect(x+cw*.15,L.floorY-1,cw*.7,1.5);
    }
    const dev=deviceAt.get(key(p));
    if(dev?.d.kind==='selectAll') {
      const lit=status[dev.d.id].lit[dev.i], ps=Math.min(cw*.5,L.floorHeight*.9);
      rounded(L.x-ps/2,L.floorTop+2+sink,ps,L.floorHeight*.5,2,lit?'#5d6f3c':'#3e5131',lit?'#e6c66f':'#6f8659');
      ctx.fillStyle=lit?'#f2d27e':'#7d9367';ctx.beginPath();ctx.moveTo(L.x,L.floorTop+4+sink);ctx.lineTo(L.x+ps*.16,L.floorTop+2+L.floorHeight*.25+sink);ctx.lineTo(L.x,L.floorTop+L.floorHeight*.5+sink);ctx.lineTo(L.x-ps*.16,L.floorTop+2+L.floorHeight*.25+sink);ctx.fill();
      // One lamp per plate above it, unless another floor sits there.
      if(!S.floor.has(key({col:p.col,row:p.row-1}))&&!S.floor.has(key({col:p.col,row:p.row-2}))){const ly=L.floorTop-ch*1.55;ctx.strokeStyle='#4f6243';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(L.x,ly+5);ctx.lineTo(L.x,L.floorTop-2);ctx.stroke();ctx.setLineDash([]);drawLamp(L.x,ly,lit);}
    } else if(dev?.d.kind==='tokens') {
      const r=L.r, v=state.values[key(p)];
      if(dev.d.token==='stone'){rounded(L.tx-r*1.4,L.floorTop-r*.1,r*2.8,r*.55,1.5,'#4c5a40','#71845d');
        if(!status[dev.d.id].lit[dev.i]){ctx.strokeStyle='#8fa27a';ctx.setLineDash([2,2]);ctx.beginPath();ctx.ellipse(L.tx,L.floorTop-r*.6,r,r*.72,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}}
      else drawSocket(L,tokenOf(v)!==dev.d.token);
    }
    if(S.sockets.some(s=>same(s,p)))drawSocket(L,isBlank(state.values[key(p)]));
    if(S.bulbs.some(b=>same(b,p))){const on=state.values[key(p)]===1;ctx.save();if(on&&!reduced){ctx.shadowColor='#f2d27e';ctx.shadowBlur=14;}ctx.beginPath();ctx.arc(L.x+cw*.28,L.floorTop-L.r*.7,L.r*.7,0,Math.PI*2);ctx.fillStyle=on?'#f2d27e':'#263124';ctx.fill();ctx.strokeStyle=on?'#fff0b8':'#6f8659';ctx.stroke();ctx.restore();
      // An empty bulb shows the faint shape of the 1 it is waiting for.
      if(isBlank(state.values[key(p)])){ctx.font=`${Math.max(9,Math.min(12,cw*.17))}px ui-monospace,monospace`;ctx.fillStyle='#9eaf7755';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('1',L.x,L.floorY+L.floorHeight*.12);}}
    if(S.shelf&&same(S.shelf,p)){ctx.fillStyle='#6f5f43';ctx.fillRect(L.tx-L.r*1.5,L.floorTop-L.r*.05,L.r*3,2.5);ctx.fillRect(L.tx-L.r*1.2,L.floorTop,2,L.r*.5);ctx.fillRect(L.tx+L.r*1.2-2,L.floorTop,2,L.r*.5);}
    if(seenTraps.has(seenKey(p))&&!fired){ctx.strokeStyle='#b98a5f70';ctx.lineWidth=1;const sx=L.x-cw*.32,sw=cw*.64;ctx.beginPath();ctx.moveTo(sx+sw*.2,L.floorTop+L.floorHeight*.55);ctx.lineTo(sx+sw*.45,L.floorTop+L.floorHeight*.75);ctx.moveTo(sx+sw*.6,L.floorTop+L.floorHeight*.5);ctx.lineTo(sx+sw*.8,L.floorTop+L.floorHeight*.68);ctx.stroke();}
  }
  // Device terminals that are not floor: lit boxes in the grid, or arrows at the edge when they lie beyond it.
  for(const d of S.devices)if(d.kind==='selectAll')d.cells.forEach((c,i)=>{
    if(S.floor.has(key(c)))return;
    const lit=status[d.id].lit[i];
    if(shown(c)){const b=cellBox(c);rounded(b.x+b.w*.28,b.y+b.h*.25,b.w*.44,b.h*.5,3,lit?'#5d6f3c':'#23301f',lit?'#f2d27e':'#6f8659');drawLamp(b.x+b.w/2,b.y+b.h/2,lit);}
    else if(c.row>S.visibleRows&&c.col<=S.visibleCols){const x=point(c).x,y=height-9;ctx.fillStyle=lit?'#f2d27e':'#8fa27a';ctx.beginPath();ctx.moveTo(x-6,y-5);ctx.lineTo(x+6,y-5);ctx.lineTo(x,y+3);ctx.fill();}
    else if(c.col>S.visibleCols&&geo.rowIdx.has(c.row)){const y=point({col:1,row:c.row}).y,x=width-8;ctx.fillStyle=lit?'#f2d27e':'#8fa27a';ctx.beginPath();ctx.moveTo(x-5,y-6);ctx.lineTo(x-5,y+6);ctx.lineTo(x+3,y);ctx.fill();}
  });
  // Red sensors react to being selected.
  for(const k of hazardAt){const c=fromKey(k);if(!shown(c))continue;const b=cellBox(c),floor=S.floor.has(k);rounded(b.x+b.w*.3,floor?at(c).floorTop+2:b.y+b.h*.3,b.w*.4,floor?at(c).floorHeight*.45:b.h*.4,2,'#5a1f1a','#e0584e');}
  for(const d of S.decor){if(!shown(d.at))continue;
    if(d.star){const b=cellBox(d.at),r=Math.min(b.w,b.h)*.2,cx=b.x+b.w*.28,cy=b.y+b.h*.5;ctx.fillStyle='#f2d27e';ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.45:r;ctx.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr);}ctx.fill();}
    if(d.text){const solved=d.solved&&test(S,state,d.when),c=cellBox(d.at),b=d.wide?{...c,x:c.x-c.w,w:c.w*2}:c,text=solved?d.solved:d.text,lines=text.split('\n');
      ctx.strokeStyle=solved?'#f2d27e99':'#8fa27a66';ctx.setLineDash([2,2]);ctx.strokeRect(b.x+4,b.y+5,b.w-8,b.h-10);ctx.setLineDash([]);
      // Shrink the lettering until the longest line fits the plate.
      let size=Math.max(9,Math.min(13,cw*.2));ctx.font=`600 ${size}px Georgia,serif`;const widest=Math.max(...lines.map(l=>ctx.measureText(l).width));if(widest>b.w-12){size*=(b.w-12)/widest;ctx.font=`600 ${size}px Georgia,serif`;}
      if(d.style?.italic)ctx.font=`italic 600 ${size}px Georgia,serif`;
      ctx.fillStyle=solved?'#f2d27e':'#a8bd92';ctx.textAlign='center';ctx.textBaseline='middle';const lh=size*1.15;
      if(d.style?.underline||d.style?.strike){const w=ctx.measureText(text).width,cy=b.y+b.h/2;ctx.fillRect(b.x+b.w/2-w/2,d.style.underline?cy+size*.55:cy-.5,w,1.3);}lines.forEach((line,k)=>ctx.fillText(line,b.x+b.w/2,b.y+b.h/2+(k-(lines.length-1)/2)*lh));}
    if(d.today){const b=cellBox(d.at),wide={...b,x:b.x-b.w,w:b.w*2};rounded(wide.x+4,wide.y+6,wide.w-8,wide.h-12,4,'#0e1811','#56704a');ctx.font=`${Math.max(9,Math.min(12,cw*.17))}px ui-monospace,monospace`;ctx.fillStyle='#b9df8f';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(serialText(state.today),wide.x+wide.w/2,wide.y+wide.h/2);}
    if(d.vault)drawVault(d.at);
    // The shape the dock accepts: a small table with a header band, in the same colours a real table gets.
    if(d.tableIcon){const b=cellBox(d.at),x=b.x+4,y=b.y+4,w=b.w*1.6,h=b.h*1.5,rh=h/4;rounded(x,y,w,h,3,'#0e1811','#8fc7d6');ctx.fillStyle='#5aa0b866';ctx.fillRect(x+2,y+2,w-4,rh-2);ctx.strokeStyle='#8fc7d655';for(let i=2;i<4;i++){ctx.beginPath();ctx.moveTo(x+2,y+rh*i);ctx.lineTo(x+w-2,y+rh*i);ctx.stroke();}ctx.beginPath();ctx.moveTo(x+w/2,y+2);ctx.lineTo(x+w/2,y+h-2);ctx.stroke();}
    if(d.door)drawDoor(d.at,{closed:1,style:'closed',lit:false});}
  // Plain cell contents: numbers, words, formulas (their results), formats and notes.
  for(const [k,v] of Object.entries(state.values)){
    const p=fromKey(k);if(!shown(p)||isBlank(v)||tokenOf(v))continue;
    const f=state.formats[k]||{};drawCellText(p,displayValue(state,p),f);
  }
  for(const [k,f] of Object.entries(state.formats)){const p=fromKey(k);if(shown(p)&&(isBlank(state.values[k])||tokenOf(state.values[k]))&&FILLS[f.fill]){const b=cellBox(p);rounded(b.x+3,b.y+3,b.w-6,b.h-6,3,...FILLS[f.fill]);}}
  // Faint targets the room is waiting for, shown only while the cell is still empty.
  for(const g of S.ghosts)if(shown(g.at)&&isBlank(state.values[key(g.at)])){const b=cellBox(g.at);ctx.strokeStyle='#8fa27a55';ctx.setLineDash([2,3]);ctx.strokeRect(b.x+4,b.y+4,b.w-8,b.h-8);ctx.setLineDash([]);ctx.font=`${Math.max(8,Math.min(11,cw*.15))}px ui-monospace,monospace`;ctx.fillStyle='#9eaf7766';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(g.text,b.x+b.w/2,b.y+b.h/2);}
  for(const k of Object.keys(S.notes)){const p=fromKey(k);if(!shown(p))continue;const b=cellBox(p);ctx.fillStyle='#e0584e';ctx.beginPath();ctx.moveTo(b.x+b.w-1,b.y+1);ctx.lineTo(b.x+b.w-1,b.y+9);ctx.lineTo(b.x+b.w-9,b.y+1);ctx.fill();}
  if(S.filter&&state.filter&&shown(S.filter.header)){const b=cellBox(S.filter.header),s=Math.min(14,b.h*.45),on=!!state.filter.allowed;rounded(b.x+b.w-s-3,b.y+b.h-s-3,s,s,2,on?'#3a5a2e':'#1d2a1b','#8fa27a');ctx.fillStyle=on?'#f2d27e':'#c9d8b5';ctx.beginPath();const cx=b.x+b.w-s/2-3,cy=b.y+b.h-s/2-3;ctx.moveTo(cx-s*.25,cy-s*.12);ctx.lineTo(cx+s*.25,cy-s*.12);ctx.lineTo(cx,cy+s*.18);ctx.fill();}

  // Eyes watch their whole row or column with a red sight line; a hidden row or column closes them.
  for(const eye of S.eyes||[]){const p=parseCell(eye.at);if(!shown(p))continue;const c=point(p);ctx.save();ctx.strokeStyle='#e0584e88';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.lineDashOffset=reduced?0:-t/30;ctx.beginPath();
    if(eye.watch==='row'){ctx.moveTo(gutter,c.y);ctx.lineTo(width,c.y);}else{ctx.moveTo(c.x,top);ctx.lineTo(c.x,height);}ctx.stroke();ctx.restore();}
  // Exits, fake exits and the lamps that say what the exit still needs.
  const open=exitOpen(S,state);
  if(doorK===null)doorK=open?1:0;
  for(const [k,trap] of S.traps)if(trap.type==='fakeExit'||trap.type==='fakeDoor'){const p=fromKey(k);if(!shown(p))continue;const flt=fxAt(p);
    if(trap.look==='closed')drawDoor(p,{closed:1,style:'closed',lit:false});else drawDoor(p,{fake:true,lit:!(flt!==null&&flt>=T.drop&&trap.type==='fakeExit')});}
  if(S.exit&&shown(S.exit))drawDoor(S.exit,{closed:S.door?1-doorK:0,style:S.door,won:state.phase==='won'});
  const pedestals=S.devices.find(d=>d.kind==='tokens'&&d.token==='stone');
  const lamps=S.indicators.length?S.indicators.map(c=>test(S,state,c)):pedestals?status[pedestals.id].lit:[];
  if(S.exit&&lamps.length&&shown(S.exit)){const D=doorBox(S.exit),gap=Math.min(D.dw*.8,cw*.32);lamps.forEach((lit,i)=>drawLamp(D.x+(i-(lamps.length-1)/2)*gap,Math.max(geo.top+6,D.doorY-D.dh-18),lit));}
  const limits=S.rules.filter(r=>r.kind==='tokenLimit');
  for(const rule of limits)drawMonitor(rule);
  const over=new Set(limits.filter(r=>countTokens(state.values,r.token)>r.limit).map(r=>r.token));
  for(const [k,v] of Object.entries(state.values))if(tokenOf(v)&&shown(fromKey(k)))drawToken(v,fromKey(k),over.has(tokenOf(v)));
  // Before a laser fires, it traces what it found: the extra tokens, or the cell that broke the rule.
  if(trapFx?.type==='laser'&&lt<T.burst){
    ctx.strokeStyle='#ff5a4acc';ctx.lineWidth=1.2;ctx.setLineDash([4,3]);ctx.lineDashOffset=reduced?0:-t/30;
    for(const rule of limits)if(over.has(rule.token)){const spot=rule.monitor?parseCell(rule.monitor):{col:parseCell(rule.at).col,row:2},mc=point(spot);
      for(const [k,v] of Object.entries(state.values))if(tokenOf(v)===rule.token){const L=at(fromKey(k));ctx.beginPath();ctx.moveTo(mc.x,mc.y+ch*.35);ctx.lineTo(L.tx,L.floorTop-L.r*.75);ctx.stroke();}}
    if(!over.size){const b=cellBox(state.trap);ctx.strokeRect(b.x+2,b.y+2,b.w-4,b.h-4);}
    ctx.setLineDash([]);ctx.lineDashOffset=0;
  }

  const rect=selectionRect(state), vis={c1:rect.c1,r1:rect.r1,c2:Math.min(rect.c2,S.visibleCols),r2:Math.min(rect.r2,S.visibleRows)};
  const ranged=(state.phase==='playing'||state.phase==='failed')&&(rect.c1!==rect.c2||rect.r1!==rect.r2);
  const rectBox=r=>{const rs=geo.rows.filter(x=>x>=r.r1&&x<=r.r2);if(!rs.length)return null;const y1=point({col:1,row:rs[0]}).y-ch/2,y2=point({col:1,row:rs[rs.length-1]}).y+ch/2;const c2=Math.min(r.c2,S.visibleCols);const x1=geo.colLeft[r.c1],x2=geo.colLeft[c2]+geo.colW[c2];return x2>x1?{x:x1,y:y1,w:x2-x1,h:y2-y1}:null;};
  // Tables: a header band and striped rows inside their range.
  for(const tb of state.tables||[]){const b=rectBox(tb.range);if(!b)continue;ctx.strokeStyle='#8fc7d6';ctx.lineWidth=1.5;ctx.strokeRect(b.x+1,b.y+1,b.w-2,b.h-2);if(tb.headers){const hb=rectBox({...tb.range,r2:tb.range.r1});if(hb){ctx.fillStyle='#5aa0b833';ctx.fillRect(hb.x+1,hb.y+1,hb.w-2,hb.h-2);}}}
  // Embedded charts sit beside their data.
  // A room with a projector window shows its empty frame until a chart is put there.
  const win=S.chartAt?cellBox(parseCell(S.chartAt)):null;
  if(win&&!(state.charts||[]).length){rounded(win.x+4,win.y+4,geo.cw*4.4,geo.ch*1.8,4,'#0e181188','#8fc7d666');ctx.font='12px ui-monospace,monospace';ctx.fillStyle='#8fc7d688';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',win.x+4+geo.cw*2.2,win.y+4+geo.ch*.9);}
  (state.charts||[]).forEach((c,i)=>{if(win){drawBars(c.range,win.x+4,win.y+4,geo.cw*4.4,geo.ch*1.8,true);return;}const x1=geo.colLeft[Math.min(c.range.c2+2,S.visibleCols)],y1=geo.top+4+i*6,w=Math.min(geo.cw*4,width-x1-10),h=geo.ch*2.6;drawBars(c.range,x1,y1,w,h,true);});
  for(const area of state.areas||[]){const b=rectBox({...area,c2:Math.min(area.c2,S.visibleCols),r2:Math.min(area.r2,S.visibleRows)});if(b){ctx.fillStyle='#b9df8f1c';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeStyle='#b9df8f99';ctx.lineWidth=1;ctx.strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);}}
  if(ranged){const b=rectBox(vis);if(b){ctx.fillStyle='#b9df8f1c';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeStyle='#b9df8f99';ctx.lineWidth=1;ctx.strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);}}
  if(state.clipboard&&state.phase==='playing'){const b=rectBox(state.clipboard.rect);if(b){ctx.strokeStyle=state.clipboard.mode==='cut'?'#f2d27e':'#c3e9ad';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.lineDashOffset=reduced?0:-t/40;ctx.strokeRect(b.x+2,b.y+2,b.w-4,b.h-4);ctx.setLineDash([]);ctx.lineDashOffset=0;}}

  const a=animation, size=at(S.start).size;
  const here=at(state.phase==='ready'?S.start:state.position);
  let p={x:here.x,y:here.standY};
  if(a) {
    const duration=reduced?0:a.duration, progress=duration?Math.min(1,(t-a.at)/duration):1;
    const eased=1-Math.pow(1-progress,3);
    const from=at(a.from),to=at(a.to);
    p={x:from.x+(to.x-from.x)*eased,y:from.standY+(to.standY-from.standY)*eased};
    if(a.jump&&!reduced){p.y-=Math.sin(progress*Math.PI)*Math.min(48,ch*1.4);ctx.strokeStyle='#bed99555';ctx.lineWidth=1.5;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(from.x,from.standY-size*.45);ctx.quadraticCurveTo((from.x+to.x)/2,Math.min(from.standY,to.standY)-ch*1.45,to.x,to.standY-size*.45);ctx.stroke();ctx.setLineDash([]);}
    if(progress===1)animation=null;
  }
  const pose=trapFx?poseFor(trapFx.type,lt):null;
  if(pose?.hop)p.y-=Math.sin(Math.PI*lt/T.drop)*3;
  if(pose?.lift)p.y-=size*.3;
  if(bump&&!reduced){const k=(t-bump.at)/140;if(k<1){const off=Math.sin(Math.PI*k)*3;p.x+=bump.dx*off;p.y+=bump.dy*off;}}
  if(state.phase==='playing'&&!reduced&&!a)p.y+=Math.sin(t/450)*1.2;
  if(!pose?.hidden&&(state.phase!=='won'||animation)&&(state.phase==='ready'||geo.rowIdx.has(state.position.row))) {
    if(pose?.fall!==undefined){
      // Falling through the opened floor: clipped at the hole so it drops out of sight.
      const L=at(trapFx),k=pose.fall;ctx.save();ctx.beginPath();ctx.rect(0,0,width,L.floorTop+L.floorHeight);ctx.clip();
      ghost(p.x,p.y+k*k*ch*.9,size*(1-.4*k),t,1-.5*k,k*.4,{shock:true});ctx.restore();
    } else ghost(p.x,p.y,size,t,pose?.dim?.7:1,pose?.tilt||0,pose);
  }
  if(pose?.shock&&pose.fall===undefined){ctx.font=`bold ${Math.max(11,size*.6)}px ui-monospace,monospace`;ctx.fillStyle='#f2d27e';ctx.textAlign='center';ctx.fillText('!',p.x+size*.5,p.y-size*.75);}
  for(const [k,trap] of S.traps)if(trap.type==='ceilingPress'){const c=fromKey(k);if(shown(c))drawDrop(c,fxAt(c),'press');}
  if(trapFx&&shown(trapFx)){
    if(trapFx.type==='ceilingPress'&&!S.traps.has(key(trapFx)))drawDrop(trapFx,lt,'press');
    if(trapFx.type==='doorDrop'||trapFx.type==='fakeDoor')drawDrop(trapFx,lt,'shutter');
    if(trapFx.type==='spikes')drawSpikes(trapFx,lt);
    if(trapFx.type==='laser')drawLaser(trapFx,lt);
    if(trapFx.type==='blast')drawBlast(trapFx,lt);
  }
  if((state.phase==='playing'||state.phase==='ready')&&shown(state.position)) {
    const selected=point(state.phase==='ready'?S.start:state.position);
    ctx.strokeStyle='#b9df8f';ctx.lineWidth=1.5;ctx.strokeRect(selected.x-cw*.5+1,selected.y-ch*.5+1,cw-2,ch-2);
    if(!ranged){ctx.fillStyle='#cceca5';ctx.fillRect(selected.x+cw*.5-3,selected.y+ch*.5-3,4,4);}
    // A wall answers with a short tick on the side that was pushed, never with a trap effect.
    if(bump){const k=(t-bump.at)/220;if(k<1){ctx.strokeStyle=bump.lock?`rgba(242,210,126,${.9*(1-k)})`:`rgba(214,236,184,${.8*(1-k)})`;ctx.lineWidth=2;ctx.beginPath();
      if(bump.lock){ctx.strokeRect(selected.x-cw*.5+3,selected.y-ch*.5+3,cw-6,ch-6);}
      else if(bump.dx){const x=selected.x+bump.dx*(cw*.5-1);ctx.moveTo(x,selected.y-ch*.32);ctx.lineTo(x,selected.y+ch*.32);}
      else{const y=selected.y+bump.dy*(ch*.5-1);ctx.moveTo(selected.x-cw*.32,y);ctx.lineTo(selected.x+cw*.32,y);}
      ctx.stroke();}}
  }
  if(!reduced) {
    for(let i=0;i<14;i++) {const px=((i*83.3+t*(i%2?.002:-.001))%width+width)%width, py=top+((i*57.1+t*.003)%(height-top));ctx.fillStyle=`rgba(181,205,130,${.06+Math.sin(t/1000+i)*.04})`;ctx.fillRect(px,py,1.4,1.4);}
    particles=particles.filter(q=>t-q.at<q.life);
    for(const q of particles){const k=Math.max(0,(t-q.at)/q.life);ctx.save();ctx.globalAlpha=1-k;ctx.translate(q.x+q.vx*k,q.y+q.vy*k+q.g*k*k);ctx.rotate(q.spin*k);ctx.fillStyle=q.color;ctx.fillRect(-q.size/2,-q.size/2,q.size,q.size);ctx.restore();}
  }
  if(shaking)ctx.restore();
  // One soft warm pulse at impact. Never white, never repeated.
  if(!reduced&&lt!==null&&lt>=T.impact&&lt<T.impact+160){ctx.fillStyle=`rgba(224,122,78,${.16*(1-(lt-T.impact)/160)})`;ctx.fillRect(0,0,width,height);}
}
// Bars from a two-column range: names in the first column, heights in the second; a text first row is the header.
function drawBars(range,x,y,w,h,framed) {
  const rows=[];for(let r=range.r1;r<=range.r2;r++){const name=displayValue(state,{col:range.c1,row:r}),val=Number(valueOf(state,{col:range.c1+1,row:r}));if(Number.isFinite(val)&&!(r===range.r1&&!Number.isFinite(Number(state.values[key({col:range.c1+1,row:r})]))))rows.push({name,val});}
  if(framed)rounded(x,y,w,h,4,'#0e1811ee','#8fc7d6');
  const max=Math.max(1,...rows.map(r=>r.val)),bw=w/(rows.length*1.6+.6);
  rows.forEach((r,i)=>{const bh=(h-24)*r.val/max,bx=x+bw*.6+i*bw*1.6,by=y+h-14-bh;ctx.fillStyle=r.val===max?'#f2d27e':'#8fc7d6';ctx.fillRect(bx,by,bw,bh);ctx.font=`${Math.max(7,Math.min(10,bw*.4))}px ui-monospace,monospace`;ctx.fillStyle='#c9d8b5';ctx.textAlign='center';ctx.fillText(r.name,bx+bw/2,y+h-6);});
}
// A chart sheet shows only its chart.
function drawChartSheet() {
  const c=state.chartSheets[state.chartView];ctx.fillStyle='#111a14';ctx.fillRect(geo.gutter,geo.top,width-geo.gutter,height-geo.top);
  drawBars(c.range,geo.gutter+30,geo.top+24,width-geo.gutter-60,height-geo.top-50,false);
  ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#8fc7d6';ctx.textAlign='left';ctx.fillText(c.name,geo.gutter+30,geo.top+14);
}
// The vault window: what each saved book holds in C3 and H3.
function drawVault(atCell) {
  const b=cellBox(atCell),books=S.vaultBooks||Object.keys(state.saved||{}),w=Math.min(geo.cw*3.2,190),h=Math.max(geo.ch*.9,16)*(books.length||1)+10,x=b.x+b.w-w,y=b.y+4;
  rounded(x,y,w,h,4,'#0e1811ee','#56704a');
  ctx.font=`${Math.max(8,Math.min(11,geo.cw*.15))}px ui-monospace,monospace`;ctx.textAlign='left';ctx.textBaseline='middle';
  // Each slot: the saved file's C3 and H3, or a note that the file does not exist yet.
  books.forEach((name,i)=>{const saved=state.saved?.[name],ly=y+8+(i+.5)*(h-10)/books.length;ctx.fillStyle=name===state.book?'#f2d27e':'#a8bd92';
    if(!saved){ctx.fillText(`${name}.xlsx  まだない`,x+8,ly);return;}
    const snap=saved.store[0]||{values:{}},cell=a=>{const v=snap.values[key(parseCell(a))];return isBlank(v)?'·':tokenOf(v)?'🔑':rawText(v);};
    ctx.fillText(`${name}.xlsx  C3:${cell('C3')} H3:${cell('H3')}`,x+8,ly);});
}
function drawSocket(L,empty) {
  const r=L.r;rounded(L.tx-r*1.5,L.floorTop-r*1.6,r*3,r*1.55,2,'#22301f','#71845d');
  if(empty){ctx.fillStyle='#0b120b';ctx.beginPath();ctx.arc(L.tx,L.floorTop-r*.95,r*.25,0,Math.PI*2);ctx.fill();ctx.fillRect(L.tx-r*.1,L.floorTop-r*.95,r*.2,r*.5);}
}
function paused(){return isModal()||document.hidden;}
function frame(real){
  const dt=lastReal===null?0:Math.min(50,Math.max(0,real-lastReal));lastReal=real;
  if(!paused()){
    clock+=dt;
    const due=events.filter(e=>e.at<=clock);
    if(due.length){events=events.filter(e=>e.at>clock);due.sort((a,b)=>a.at-b.at).forEach(e=>e.fn());}
    if(doorK!==null){const target=exitOpen(S,state)?1:0;doorK=reduced?target:doorK+(target-doorK)*Math.min(1,dt/140);}
  }
  draw(clock);requestAnimationFrame(frame);
}
function schedule(delay,fn){const id=attempt;events.push({at:clock+delay,fn:()=>{if(id===attempt)fn();}});}
function cancelAttempt(){attempt++;events=[];particles=[];trapFx=null;animation=null;bump=null;pendingDeath=false;doorK=null;closePanel(false,false);closeEditor(false);}
function announce(text){$('announcement').textContent=text;}
function persistSettings(){safeWrite('cell-escape.settings',{sound,reduced});}
function audioReady(){try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}}
function tone(freq,at,len,{type='sine',gain=.045,to=0}={}){
  const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,at);if(to)o.frequency.exponentialRampToValueAtTime(to,at+len);
  g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+.008);g.gain.exponentialRampToValueAtTime(.001,at+len);o.connect(g);g.connect(audio.destination);o.start(at);o.stop(at+len+.02);
}
function beep(kind){
  if(!sound)return;audioReady();if(!audio)return;const now=audio.currentTime;
  // Impacts: short and close to the other cues' volume. Each trap family has its own colour.
  if(kind==='press'){tone(1250,now,.09,{type:'triangle',gain:.03,to:620});tone(1870,now,.05,{type:'square',gain:.01,to:900});tone(110,now,.26,{gain:.07,to:42});return;}
  if(kind==='drop'){tone(300,now,.18,{type:'triangle',gain:.03,to:70});tone(90,now+.06,.24,{gain:.06,to:40});return;}
  if(kind==='spike'){tone(2300,now,.08,{type:'triangle',gain:.025,to:1500});tone(130,now,.2,{gain:.05,to:55});return;}
  if(kind==='laser'){tone(880,now,.22,{type:'sawtooth',gain:.018,to:330});tone(120,now+.02,.2,{gain:.05,to:50});return;}
  if(kind==='alarm'){[0,.14].forEach(d=>tone(740,now+d,.09,{type:'square',gain:.012}));return;}
  if(kind==='click'){tone(900,now,.04,{type:'square',gain:.012,to:500});return;}
  if(kind==='bump'){tone(150,now,.07,{gain:.025,to:110});return;}
  if(kind==='tick'){tone(620,now,.05,{gain:.02});return;}
  if(kind==='open'){[523.25,659.25,783.99].forEach((f,i)=>tone(f,now+i*.07,.2,{gain:.03}));return;}
  (kind==='win'?[440,554.37,659.25,880]:[320]).forEach((freq,i)=>tone(freq,now+i*.085,.19));
}
function settingsUI(){document.body.classList.toggle('reduce-motion',reduced);$('soundStatus').textContent=sound?'ON':'OFF';$('soundBtn').setAttribute('aria-pressed',String(sound));$('soundBtn').setAttribute('aria-label',sound?'音をオフにする':'音をオンにする');$('soundToggle').checked=sound;$('motionToggle').checked=reduced;}
function isModal(){return hintDialog.open||settingsDialog.open;}
function focusGame(){held.clear();inputArmed=true;$('focusNotice').hidden=true;if(!isModal()&&!panel&&!editing)canvas.focus({preventScroll:true});}
function sync(){
  // The board follows whichever sheet is active (a new sheet is its own small room).
  S=stageOf(state);computeGeometry&&geo&&computeGeometry();
  const v=state.values[key(state.position)];
  $('cellAddress').textContent=cellName(state.position);
  if(!editing)$('cellValue').textContent=isFormula(v)?v.f:rawText(v).replace(/\n/g,' ⏎ ');
  // Until the trap lands, the death has happened in the rules but not yet on screen.
  $('deathCount').textContent=pad(state.deaths-(pendingDeath?1:0));
  // F8 / Shift+F8 modes show in the status bar, like Excel's EXTEND / ADD.
  // Manual calculation with stale results shows CALCULATE, as Excel's status bar does.
  const stale=state.cache&&Object.entries(state.values).some(([k,v])=>isFormula(v)&&state.cache[k]!==valueOf({...state,cache:null},fromKey(k)));
  $('sheetStatus').textContent=pendingDeath?'IN THE ROOM':state.phase==='playing'&&stale?'CALCULATE':state.phase==='playing'&&state.mode?{extend:'EXTEND',add:'ADD TO SELECTION'}[state.mode]:{ready:'READY',playing:'IN THE ROOM',failed:'CAUGHT',won:'ESCAPED'}[state.phase];
  $('fileName').textContent=state.book?`${state.book}.xlsx${state.dirty?' ●':''}`:`room_${pad(S.number)}.xlsx`;
  $('startScreen').hidden=state.phase!=='ready';
  const open=unlockedHints();if(open)$('hintBtn').dataset.count=String(open);else delete $('hintBtn').dataset.count;
  $('hintBtn').setAttribute('aria-label',open?`ヒントを開く（${open}つ開いている）`:'ヒント（まだ開いていない）');
  // Panels sit on the half of the board away from the character, so the cell they act on stays visible.
  panelEl.classList.toggle('low',state.position.row<=Math.ceil(S.visibleRows/2));
  if(state.panel?.kind==='confirm'&&panel?.kind!=='confirm')openPanel('confirm');
  if(!state.panel&&panel?.kind==='confirm')closePanel(false);
}
function renderTabs(){
  const tabs=STAGES.map((st,i)=>{
    const b=document.createElement('button');b.className='sheet-tab'+(i===room&&state.sheet!=='new'?' active':'');b.disabled=i>progress&&i!==room;
    b.innerHTML=`<span class="tab-dot"></span><span class="tab-word">Room </span>${pad(st.number)}`;
    b.setAttribute('aria-label',`第${st.number}室${b.disabled?'（まだ開いていない）':''}`);if(i===room)b.setAttribute('aria-current','page');
    b.addEventListener('click',()=>enterRoom(i));return b;
  });
  if(state.sheet==='new'){const b=document.createElement('button');b.className='sheet-tab active';b.innerHTML=`<span class="tab-dot"></span>${STAGES[room].newSheet?.name||'Sheet2'}`;b.disabled=true;tabs.splice(room+1,0,b);}
  // A workbook room shows its own sheets after the room tab (switched with Ctrl+PageUp / PageDown, not by clicking).
  else if(rootOf(state).sheetList||state.chartSheets.length){
    const names=sheetNames(state),here=state.chartView!==null?`c${state.chartView}`:state.sheetIdx;
    const sub=state.order.map(id=>{const b=document.createElement('button');b.className='sheet-tab sub'+(id===here?' active':'');b.disabled=true;b.innerHTML=`<span class="tab-dot"></span>${typeof id==='string'?state.chartSheets[Number(id.slice(1))].name:names[id]}`;return b;});
    tabs[room].classList.remove('active');tabs.splice(room+1,0,...sub);
  }
  $('sheetTabs').replaceChildren(...tabs);
  $('sheetTabs').querySelector('.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function applyRoom(){
  S=STAGES[room];
  $('roomEyebrow').textContent=$('startKicker').textContent=`ROOM ${pad(S.number)}`;
  const dot=document.createElement('span');dot.textContent='。';$('roomTitle').replaceChildren(S.title.replace(/[。？]$/,''),S.title.endsWith('？')?Object.assign(dot,{textContent:'？'}):dot);
  $('roomLead').textContent=S.lead;$('roomIndex').textContent=pad(S.number);
  $('buildLabel').textContent=`THE ${ORDINALS[room]} ROOM`;$('fileName').textContent=`room_${pad(S.number)}.xlsx`;
  $('gameShell').setAttribute('aria-label',`第${S.number}室`);
  renderTabs();if(width)computeGeometry();
}
function enterRoom(i){
  if(isModal())return;
  cancelAttempt();room=i;state=createState(i);hintIndex=0;$('resultScreen').hidden=true;
  applyRoom();sync();$('startBtn').focus({preventScroll:true});
}
function start(){cancelAttempt();$('resultScreen').hidden=true;state=begin(state);sync();focusGame();audioReady();}
function retry(){cancelAttempt();$('resultScreen').hidden=true;state=restart(state);renderTabs();sync();focusGame();beep('move');}
const hasNext=()=>room<STAGES.length-1;
function showResult(){
  const won=state.phase==='won', next=won&&hasNext(), result=$('resultScreen');
  closePanel(false);closeEditor(false);
  result.className=`result-screen screen ${won?'won':'failed'}`;
  $('resultKicker').textContent=won?'ESCAPED':'TRY AGAIN';$('resultTitle').textContent=won?'抜け出した。':'やられた。';
  // A death that opens a new hint says so; the hint itself stays behind the ? button.
  const opened=!won&&state.deaths>=1&&state.deaths<=3;
  $('resultSubtitle').textContent=won?(hasNext()?'扉の向こうに、たどり着いた。':'最後の扉を、抜けた。'):opened?`手掛かりがひとつ開いた（右上の ? ・${state.deaths}/3）`:'';$('resultSubtitle').hidden=!won&&!opened;
  // Cleared: the shortcuts this room used, and what each one does.
  $('clearKeys').hidden=!won;
  if(won)$('clearKeys').replaceChildren(...S.keys.map(combo=>{const k=combo.join('＋'),li=document.createElement('li'),kbd=document.createElement('span'),txt=document.createElement('span');kbd.className='ck-key';kbd.textContent=k;txt.textContent=KEY_HELP[k]||'';li.append(kbd,txt);return li;}));
  $('nextBtn').hidden=!next;$('retryBtn').hidden=next;$('resultKey').textContent=next?'ENTER で次へ · R でもう一度':'ENTER / R';
  // The last room: ALL CLEAR, with every room and the shortcuts it used.
  const all=won&&!hasNext();result.classList.toggle('all-clear',all);$('allClear').hidden=!all;
  if(all){$('clearKeys').hidden=true;$('resultKicker').textContent='ALL CLEAR';$('resultTitle').textContent='ぜんぶ、抜け出した。';$('resultSubtitle').textContent='50の部屋で使ったショートカット';
    $('allClear').replaceChildren(...STAGES.map(st=>{const li=document.createElement('li');const name=document.createElement('span');name.className='ac-room';name.textContent=`${pad(st.number)} ${st.title}`;
      const keys=document.createElement('span');keys.className='ac-keys';keys.textContent=st.keys.map(c=>c.join('＋')).join(' › ');li.append(name,keys);return li;}));}
  result.hidden=false;
  if(!isModal())$(next?'nextBtn':'retryBtn').focus({preventScroll:true});
}
function burst(){
  if(reduced||!trapFx)return;
  const L=at(trapFx),y=trapFx.type==='floorDrop'||trapFx.type==='fakeExit'?L.floorTop+L.floorHeight*.5:L.feetY-L.size*.2;
  particles.push(...Array.from({length:6},(_,i)=>{const side=i%2?1:-1;return{x:L.x+side*L.size*.3,y,vx:side*geo.cw*(.5+i*.1),vy:-L.size*(1+i*.15),g:L.size*3.2,at:clock,life:520,size:Math.max(3,L.size*.24),spin:side*(3+i),color:i%3?'#dfe7cc':'#b2c995'};}));
}
function dust(){
  if(reduced||!trapFx)return;
  const L=at(trapFx),y=L.feetY-L.size*.2;
  particles.push(...Array.from({length:4},(_,i)=>{const side=i<2?-1:1;return{x:L.x+side*geo.cw*.42,y,vx:side*geo.cw*(.3+i%2*.2),vy:-4-i%2*4,g:0,at:clock,life:300,size:2,spin:0,color:'#9aa68a'};}));
}
// The trap timeline starts when the character lands (or after a short look at what caused it), never on the key press.
function startTrap(delay){
  const t=state.trap;pendingDeath=true;trapFx={...t,at:clock+delay};
  closePanel(false);closeEditor(false);
  if(t.type==='laser')beep('alarm');
  schedule(delay,()=>beep('click'));
  schedule(delay+T.drop,()=>seenTraps.add(seenKey(t)));
  schedule(delay+T.impact,()=>{pendingDeath=false;sync();dust();beep(IMPACT_SOUND[t.type]);announce('やられた。Enterキーでもう一度。');});
  schedule(delay+T.burst,burst);
  schedule(delay+T.result,showResult);
}
const VALUE_KINDS=new Set(['paste','edit','delete','fill','undo','replace','format','confirm','structure','calc','table','save']);
function act(next,kind,dx=0,dy=0){
  const previous=state;
  if(next===previous){
    if((kind==='move'||kind==='jump')&&previous.phase==='playing'&&!previous.panel){bump={dx,dy,at:clock};beep('bump');}
    if(kind==='locked'){bump={dx:0,dy:0,lock:true,at:clock};beep('bump');}
    return false;
  }
  state=next;bump=null;
  const sheetChanged=previous.sheet!==state.sheet||previous.sheetIdx!==state.sheetIdx||previous.chartView!==state.chartView;
  const moved=!same(previous.position,state.position)&&!sheetChanged;
  const duration=moved?(reduced?0:(state.jump||kind==='jump')?350:115):0;
  if(moved)animation={from:previous.position,to:state.position,at:clock,duration,jump:state.jump||kind==='jump'};
  if(state.phase==='failed')startTrap(moved?duration:VALUE_KINDS.has(kind)?(state.reason==='laser'?(reduced?250:LASER_LOOK):(reduced?120:CHANGE_LOOK)):0);
  else if(state.phase==='won'){
    beep('win');announce('抜け出した。');progress=Math.max(progress,room+1);safeWrite('cell-escape.progress',progress);renderTabs();
    closePanel(false);
    if(S.exit){const p=point(S.exit);particles=Array.from({length:32},(_,i)=>({x:p.x,y:p.y-30,vx:Math.cos(i)*100,vy:Math.sin(i)*100-45,g:50,at:clock,life:900,size:3,spin:0,color:i%2?'#c7e8a8':'#e6ebcb'}));}
    schedule(reduced?0:600,showResult);
  }else{
    if(sheetChanged){renderTabs();animation=null;announce(state.chartView!==null?state.chartSheets[state.chartView].name:state.sheet==='new'?'新しいシート。':sheetNames(state)[state.sheetIdx]);}
    beep(kind==='move'||kind==='jump'?'move':'tick');
    if(!exitOpen(S,previous)&&exitOpen(S,state))schedule(duration+80,()=>{beep('open');announce('扉が開いた。');});
  }
  sync();return true;
}

// ---- in-game panels: confirm, find, replace, go to, filter, paste special, note ----
function el(tag,attrs={},...kids){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v);}n.append(...kids);return n;}
function openPanel(kind){
  if(state.phase!=='playing')return;
  closeEditor(false);
  const status=el('div',{class:'cmd-status','aria-live':'polite'}), say=t=>{status.textContent=t;};
  const title=(t,k)=>el('div',{class:'cmd-title'},el('span',{},t),el('span',{},k?forPlatform(k):''));
  const actions=(...b)=>el('div',{class:'cmd-actions'},...b);
  const closeBtn=el('button',{type:'button',onclick:()=>closePanel()},'閉じる');
  let body=[], first=null, enter=null;
  panelEl.className='cmd-panel';
  if(kind==='confirm'){
    panelEl.classList.add('confirm');
    // Only OK is offered, and only from the keyboard (a keyboard-made click has detail 0). Esc is the way to say no.
    const byKeyboard=e=>{if(e.detail===0)return true;say('マウスは使わないで。');first.focus({preventScroll:true});return false;};
    const ok=el('button',{type:'button',class:'go',onclick:e=>{if(!byKeyboard(e))return;panel=null;panelEl.hidden=true;act(answerConfirm(state,true),'confirm');}},'OK');
    body=[el('div',{class:'art','aria-hidden':'true'},'🗝 → ✕'),el('div',{class:'big'},'扉の鍵を、処分しますか？'),status,actions(ok)];first=ok;
  } else if(kind==='find'){
    const input=el('input',{type:'text','aria-label':'検索する文字列'});
    enter=()=>{const hit=findNext(state,input.value);if(!hit){say('見つかりません。');return;}if(!act(jumpTo(state,hit),'jump'))say(`${cellName(hit)} には立てない。`);else say(`${cellName(hit)}`);};
    body=[title('検索','Ctrl+F'),input,status,actions(el('button',{type:'button',class:'go',onclick:()=>enter()},'次を検索'),closeBtn)];first=input;
  } else if(kind==='replace'){
    const find=el('input',{type:'text','aria-label':'検索する文字列'}),to=el('input',{type:'text','aria-label':'置換後の文字列'}),r=selectionRect(state);
    const scope=r.c1!==r.c2||r.r1!==r.r2?`対象：選択範囲 ${cellName({col:r.c1,row:r.r1})}:${cellName({col:Math.min(r.c2,S.visibleCols),row:Math.min(r.r2,MAX_ROW)})}`:'対象：シート全体';
    enter=()=>{const res=replaceAll(state,find.value,to.value);if(!res.count){say('見つかりません。');return;}act(res.state,'replace');if(state.phase==='playing')say(`${res.count} 件を置換しました。`);};
    body=[title('置換','Ctrl+H'),el('label',{},'検索する文字列'),find,el('label',{},'置換後の文字列'),to,el('div',{class:'scope'},scope),status,actions(el('button',{type:'button',class:'go',onclick:()=>enter()},'すべて置換'),closeBtn)];first=find;
  } else if(kind==='goto'){
    const input=el('input',{type:'text','aria-label':'参照先'});
    enter=()=>{const p=parseRef(input.value);if(!p){say('セル番地を入力してください。');return;}if(S.noGoto){say('その番地へは、跳べない。');return;}if(!act(gotoRef(state,p),'jump'))say(`${cellName(p)} には立てない。`);else closePanel();};
    body=[title('ジャンプ','Ctrl+G'),el('label',{},'参照先'),input,status,actions(el('button',{type:'button',class:'go',onclick:()=>enter()},'OK'),closeBtn)];first=input;
  } else if(kind==='filter'){
    const allowed=state.filter.allowed, boxes=filterChoices(state).map(v=>{const c=el('input',{type:'checkbox'});c.checked=!allowed||allowed.includes(v);c.dataset.value=v;return c;});
    enter=()=>{const chosen=boxes.filter(b=>b.checked).map(b=>b.dataset.value);if(!chosen.length){say('ひとつ以上選んでください。');return;}act(applyFilter(state,chosen),'filter');closePanel();};
    body=[title(cellName(S.filter.header),'Alt+↓'),...boxes.map(b=>el('label',{class:'choice'},b,b.dataset.value)),status,actions(el('button',{type:'button',class:'go',onclick:()=>enter()},'OK'),closeBtn)];first=boxes[0];
  } else if(kind==='pasteSpecial'||kind==='insert'||kind==='delete'){
    // One radio list for paste special and for the insert / delete shift dialogs; a letter picks its option.
    const opts={pasteSpecial:[['all','すべて (A)','a'],['formulas','数式 (F)','f'],['values','値 (V)','v'],['formats','書式 (T)','t'],['widths','列幅 (W)','w']],
      insert:[['right','右方向にシフト (I)','i'],['down','下方向にシフト (D)','d']],delete:[['left','左方向にシフト (L)','l'],['up','上方向にシフト (U)','u']]}[kind];
    const radios=opts.map(([value])=>{const r=el('input',{type:'radio',name:'opt',value});return r;});radios[0].checked=true;
    const chosen=()=>radios.find(r=>r.checked).value;
    enter=()=>{const v=chosen();closePanel();const r=kind==='pasteSpecial'?act(paste(state,v),'paste'):act(kind==='insert'?insertCells(state,v):deleteCells(state,v),'structure');if(!r)act(state,'locked');};
    const heading={pasteSpecial:['形式を選択して貼り付け','Ctrl+Alt+V'],insert:['セルの挿入','Ctrl+Shift++'],delete:['削除','Ctrl+-']}[kind];
    body=[title(...heading),...opts.map(([,label],i)=>el('label',{class:'choice'},radios[i],label)),status,actions(el('button',{type:'button',class:'go',onclick:()=>enter()},'OK'),closeBtn)];first=radios[0];
    panel={kind,enter,pick:l=>{const i=opts.findIndex(o=>o[2]===l);if(i>=0){radios[i].checked=true;radios[i].focus();}}};
  } else if(kind==='table'){
    const range=tableRange(state),hdr=el('input',{type:'checkbox'});hdr.checked=true;
    enter=()=>{closePanel();if(!act(createTable(state,hdr.checked),'table'))act(state,'locked');};
    body=[title('テーブルの作成','Ctrl+T'),el('div',{class:'scope'},range?`範囲：${cellName({col:range.c1,row:range.r1})}:${cellName({col:range.c2,row:range.r2})}`:'範囲がない'),el('label',{class:'choice'},hdr,'先頭行をテーブルの見出しとして使用する'),status,actions(el('button',{type:'button',class:'go',onclick:()=>enter()},'OK'),closeBtn)];first=hdr;
  } else if(kind==='saveAs'){
    const input=el('input',{type:'text','aria-label':'ファイル名'});input.value=`${state.book}`;
    enter=()=>{const name=input.value.trim();const next=saveAs(state,name);if(next===state){say('英数字の名前をつけてください。');return;}closePanel();act(next,'save');announce(`${next.book} として保存した。`);};
    body=[title('名前を付けて保存','F12'),el('label',{},'ファイル名'),input,status,actions(el('button',{type:'button',class:'go',onclick:()=>enter()},'保存'),closeBtn)];first=input;
    setTimeout(()=>input.select(),0);
  } else if(kind==='menu'){
    // Shift+F10: the menu for what is selected — whole rows, whole columns, or cells.
    const rows=wholeRows(state),cols=wholeCols(state),items=[];
    if(cols)items.push(['列の非表示','h',()=>act(hideCols(state),'structure')],['再表示','u',()=>act(unhideCols(state),'structure')]);
    else if(rows)items.push(['行の非表示','h',()=>act(hideRows(state),'structure')],['再表示','u',()=>act(unhideRows(state),'structure')]);
    else{items.push(['コピー','c',()=>act(copy(state),'clip')],['切り取り','t',()=>act(cut(state),'clip')],['貼り付け','p',()=>act(paste(state),'paste')],['挿入…','i',()=>openPanel('insert')],['削除…','d',()=>openPanel('delete')],['数式と値のクリア','n',()=>act(clearContents(state),'delete')]);
      if(S.chartMenu)items.push(['グラフ（このシートに）','g',()=>act(addChart(state,'embedded'),'table')],['グラフシート','s',()=>act(addChart(state,'sheet'),'sheet')]);}
    const buttons=items.map(([label,letter,run])=>el('button',{type:'button',class:'menu-item','data-letter':letter,onclick:e=>{if(e.detail>0)return;closePanel(false);run();if(!panel)focusGame();}},label));
    enter=null;
    body=[title('メニュー','Shift+F10'),...buttons,status];first=buttons[0];
    panel={kind,enter,pick:l=>{const b=buttons.find(x=>x.dataset.letter===l);if(b)b.click();},nav:d=>{const i=buttons.indexOf(document.activeElement);buttons[(i+d+buttons.length)%buttons.length].focus();}};
  } else if(kind==='note'){
    body=[title(`${cellName(state.position)} のメモ`,'Shift+F2'),el('div',{class:'note-body'},S.notes[key(state.position)]),actions(closeBtn)];first=closeBtn;
  }
  if(!panel||panel.kind!==kind)panel={kind,enter};
  panelEl.replaceChildren(...body);panelEl.hidden=false;held.clear();
  first?.focus({preventScroll:true});
}
// Closing the confirm panel any way but OK is the cancel answer, except when a retry is throwing the attempt away.
function closePanel(refocus=true,answer=true){
  if(!panel&&panelEl.hidden)return;
  const kind=panel?.kind;panel=null;panelEl.hidden=true;panelEl.replaceChildren();delete panelEl.dataset.letters;
  if(answer&&kind==='confirm'&&state.panel)act(answerConfirm(state,false),'confirm');
  if(refocus)focusGame();
}
// In-game panels are answered from the keyboard. A pointer click (detail > 0) on a control is refused; text fields can still be clicked into.
panelEl.addEventListener('click',e=>{
  const t=e.target;
  if(e.detail>0&&t instanceof HTMLElement&&t.closest('button,label,input[type=checkbox],input[type=radio]')){
    e.preventDefault();e.stopImmediatePropagation();
    const status=panelEl.querySelector('.cmd-status');if(status)status.textContent='マウスは使わないで。';
  }
},true);
panelEl.addEventListener('keydown',e=>{
  if(e.isComposing||e.keyCode===229){e.stopPropagation();return;}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePanel();return;}
  if(panel?.nav&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();e.stopPropagation();panel.nav(e.key==='ArrowDown'?1:-1);return;}
  if(panel?.pick&&!e.ctrlKey&&!e.metaKey&&!(e.target instanceof HTMLInputElement&&e.target.type==='text')&&/^[a-z]$/i.test(e.key)){e.preventDefault();panel.pick(e.key.toLowerCase());return;}
  if(e.key==='Enter'&&panel?.enter&&!e.repeat&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();e.stopPropagation();panel.enter();}
  if(e.key==='Enter'&&e.repeat)e.preventDefault();
  e.stopPropagation();
});

// ---- in-cell editor: F2 keeps the content, typing replaces it ----
function placeEditor(){
  if(!editing||!geo)return;
  const b=cellBox(state.position);
  Object.assign(editor.style,{left:`${b.x}px`,top:`${b.y}px`,minWidth:`${Math.max(b.w*2,120)}px`,height:`${Math.max(b.h,editor.value.split('\n').length*17+10)}px`});
}
function openEditor(text,caretEnd=true){
  if(!canEdit(state)){act(state,'locked');return;}
  closePanel(false);
  editing={};editor.value=text;editor.hidden=false;placeEditor();
  editor.focus({preventScroll:true});const n=caretEnd?text.length:0;editor.setSelectionRange(n,n);
  $('cellValue').textContent=text;held.clear();
}
function closeEditor(refocus=true){
  if(!editing)return;
  editing=null;editor.hidden=true;editor.blur();sync();if(refocus)focusGame();
}
function commitEditor(all,dir='down'){
  const text=editor.value;editing=null;editor.hidden=true;
  const ok=act(commitEdit(state,text,{all,dir}),'edit');
  if(!ok)act(state,'locked');
  sync();focusGame();
}
editor.addEventListener('keydown',e=>{
  e.stopPropagation();
  // While an IME is composing, Enter confirms the conversion, not the cell.
  if(e.isComposing||e.keyCode===229)return;
  if(e.key==='Escape'){e.preventDefault();closeEditor();return;}
  if(e.key==='Enter'){
    e.preventDefault();if(e.repeat)return;
    // Alt+Enter: a new line inside the same cell.
    if(e.altKey){const s=editor.selectionStart,t=editor.value;editor.value=t.slice(0,s)+'\n'+t.slice(editor.selectionEnd);editor.setSelectionRange(s+1,s+1);placeEditor();$('cellValue').textContent=editor.value;return;}
    commitEditor(e.ctrlKey||(isMac&&e.metaKey),e.shiftKey?'up':'down');return;
  }
  if(e.key==='Tab'){e.preventDefault();commitEditor(false,e.shiftKey?'backtab':'tab');return;}
  // Ctrl+; types today's date where the caret is.
  if((e.ctrlKey||(isMac&&e.metaKey))&&(e.code==='Semicolon'||e.key===';')){e.preventDefault();const d=serialText(state.today),a=editor.selectionStart;editor.value=editor.value.slice(0,a)+d+editor.value.slice(editor.selectionEnd);editor.setSelectionRange(a+d.length,a+d.length);$('cellValue').textContent=editor.value;return;}
  // F4 fixes the reference under the caret (only when the caret sits on a reference).
  if(e.key==='F4'){e.preventDefault();const r=cycleReference(editor.value.toUpperCase(),editor.selectionStart);if(r){editor.value=r.text;editor.setSelectionRange(r.caret,r.caret);$('cellValue').textContent=r.text;}return;}
});
editor.addEventListener('input',()=>{$('cellValue').textContent=editor.value;placeEditor();});
editor.addEventListener('blur',()=>{if(editing)setTimeout(()=>{if(editing&&document.activeElement!==editor)closeEditor(false);},0);});

function renderHint(){
  const open=unlockedHints();hintIndex=Math.min(hintIndex,Math.max(0,open-1));
  $('hintText').textContent=open?forPlatform(S.hints[hintIndex]):'まだ手掛かりはない。\n一度やられるたびに、ひとつずつ開く。';$('hintBack').disabled=hintIndex===0||!open;
  const nextLocked=open&&hintIndex<2&&hintIndex>=open-1;
  $('hintNext').innerHTML=!open||hintIndex===2||nextLocked?'試してみる <span>↗</span>':'次の手掛かり <span>→</span>';
  $('hintLock').textContent=nextLocked||!open?`次の手掛かりは、あと${(open?hintIndex+2:1)-state.deaths}回やられると開く。`:'';
  const diagram=$('hintKeys'),mk=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  diagram.replaceChildren();
  S.keys.forEach((combo,i)=>{if(i)diagram.append(mk('span','›','sep'));combo.forEach((k,j)=>{if(j)diagram.append(mk('span','＋'));diagram.append(mk('kbd',forPlatform(k)));});});
  diagram.classList.toggle('compact',S.keys.flat().length>2);diagram.hidden=hintIndex!==2||open<3;
  Array.from($('hintProgress').children).forEach((e,i)=>{e.classList.toggle('active',open>0&&i<=hintIndex);e.classList.toggle('locked',i>=open);});
}
function openDialog(dialog){held.clear();$('focusNotice').hidden=true;dialog.showModal();}
function closeDialog(dialog){
  dialog.close();held.clear();
  if(editing){editor.focus({preventScroll:true});return;}
  if(panel){panelEl.querySelector('input,button')?.focus({preventScroll:true});return;}
  if(state.phase==='ready')$('startBtn').focus({preventScroll:true});
  else if(state.phase==='playing'||(state.phase==='failed'&&$('resultScreen').hidden))focusGame();
  else if(!$('resultScreen').hidden)$(!$('nextBtn').hidden?'nextBtn':'retryBtn').focus({preventScroll:true});
}
$('startBtn').addEventListener('click',start);$('retryBtn').addEventListener('click',retry);$('resumeBtn').addEventListener('click',focusGame);
$('nextBtn').addEventListener('click',()=>{if(hasNext())enterRoom(room+1);});
$('hintBtn').addEventListener('click',()=>{hintIndex=Math.max(0,unlockedHints()-1);renderHint();openDialog(hintDialog);});
$('hintBack').addEventListener('click',()=>{hintIndex=Math.max(0,hintIndex-1);renderHint();});
$('hintNext').addEventListener('click',()=>{if(hintIndex>=unlockedHints()-1){closeDialog(hintDialog);return;}hintIndex++;renderHint();});
$('settingsBtn').addEventListener('click',()=>{settingsUI();openDialog(settingsDialog);});
$('settingsDone').addEventListener('click',()=>closeDialog(settingsDialog));
for(const dialog of [hintDialog,settingsDialog]){
  dialog.querySelector('[data-close]').addEventListener('click',()=>closeDialog(dialog));
  dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog(dialog);});
  dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))closeDialog(dialog);});
}
function setSound(value){sound=value;settingsUI();persistSettings();if(sound)beep('move');}
$('soundBtn').addEventListener('click',()=>setSound(!sound));$('soundToggle').addEventListener('change',e=>setSound(e.target.checked));
$('motionToggle').addEventListener('change',e=>{reduced=e.target.checked;settingsUI();persistSettings();});
$('fullscreenBtn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('gameShell').requestFullscreen();}catch{announce('この環境では全画面にできません。');}});
if(!document.fullscreenEnabled)$('fullscreenBtn').hidden=true;
canvas.addEventListener('pointerdown',()=>{if(state.phase==='playing'&&!isModal()&&!panel)focusGame();});
// Board keys. Letters are read from e.code so ⌥ and keyboard layouts do not change them;
// when a device sends no code, the key itself is used instead.
const codeOf=e=>e.code||(/^[a-z]$/i.test(e.key)?`Key${e.key.toUpperCase()}`:/^[0-9]$/.test(e.key)?`Digit${e.key}`:e.key==='!'?'Digit1':e.key==='('?'Digit9':e.key===')'?'Digit0':e.key===' '?'Space':e.key===';'?'Semicolon':e.key==='`'?'Backquote':e.key==='-'?'Minus':e.key==='='||e.key==='+'?'Equal':'');
function boardKey(e){
  const code=codeOf(e), mod=e.ctrlKey||(isMac&&e.metaKey), shift=e.shiftKey, alt=e.altKey, k=e.key;
  const once=f=>{e.preventDefault();if(!e.repeat)f();return true;};
  if(state.panel)return false;
  if(k==='Escape'){e.preventDefault();if(state.clipboard)act(cancelClipboard(state),'clip');if(state.mode||(state.areas||[]).length)act(clearModes(state),'select');return true;}
  // A chart sheet has no cells: only moving between sheets works there.
  const sheetKey=(mod&&(k==='PageDown'||k==='PageUp'))||(alt&&!mod&&(k==='ArrowRight'||k==='ArrowLeft')&&(rootOf(state).sheetList||state.chartSheets.length));
  if(sheetKey)return once(()=>act(switchSheet(state,k==='PageDown'||k==='ArrowRight'?1:-1),'sheet'));
  if(state.chartView!==null){const retryKey=k.toLowerCase()==='r'&&!mod;if(!retryKey&&(k.startsWith('Arrow')||k.length===1))e.preventDefault();return !retryKey;}
  if(k==='F8'&&!mod&&!alt)return once(()=>act(shift?toggleAdd(state):toggleExtend(state),'select'));
  if(k==='F9'&&!mod&&!alt&&!shift)return once(()=>act(recalc(state),'calc'));
  if(k==='F11'&&!shift&&!mod)return once(()=>act(addChart(state,'sheet'),'sheet'));
  if(k==='F1'&&alt&&!mod)return once(()=>act(addChart(state,'embedded'),'table'));
  if((k==='F10'&&shift)||k==='ContextMenu')return once(()=>openPanel('menu'));
  if(k==='F12'||(mod&&shift&&code==='KeyS'))return once(()=>{if(state.book)openPanel('saveAs');});
  if(k==='Tab')return once(()=>act(tabMove(state,shift?-1:1),'jump'));
  if(mod&&shift&&(k==='Home'||k==='End'))return once(()=>act(selectTo(state,k==='Home'?'home':'end'),'select'));
  if(alt&&!mod&&code==='Equal')return once(()=>openEditor(autoSumText(state)));
  if(mod&&!alt&&(code==='Backquote'||k==='`'))return once(()=>act(toggleFormulaView(state),'view'));
  if(mod&&!alt&&!shift&&code==='Semicolon')return once(()=>openEditor(serialText(state.today)));
  if(mod&&shift&&(code==='Equal'||k==='+')||mod&&code==='NumpadAdd')return once(()=>{if(wholeRows(state)||wholeCols(state))act(insertCells(state),'structure');else openPanel('insert');});
  if(mod&&!shift&&(code==='Minus'||code==='NumpadSubtract'))return once(()=>{if(wholeRows(state)||wholeCols(state))act(deleteCells(state),'structure');else openPanel('delete');});
  if(mod&&shift&&code==='Digit9')return once(()=>act(unhideRows(state),'structure'));
  if(mod&&shift&&code==='Digit0')return once(()=>act(unhideCols(state),'structure'));
  if(mod&&!shift&&!alt&&code==='Digit9')return once(()=>act(hideRows(state),'structure'));
  if(mod&&!shift&&!alt&&code==='Digit0')return once(()=>act(hideCols(state),'structure'));
  if(mod&&!alt&&!shift&&code==='Digit5'||isMac&&e.metaKey&&shift&&code==='KeyX')return once(()=>act(toggleStyle(state,'strike'),'format'));
  if(mod&&shift&&code==='KeyZ')return once(()=>act(redo(state),'undo'));
  if(k==='F2'&&!mod&&!alt)return once(()=>shift?(S.notes[key(state.position)]?openPanel('note'):null):(()=>{const v=state.values[key(state.position)];openEditor(isFormula(v)?v.f:rawText(v));})());
  if(k==='F11'&&shift&&!mod)return once(()=>act(newSheet(state),'sheet'));
  if(k==='Delete'&&!mod)return once(()=>{if(!act(clearContents(state),'delete')&&S.locked.has(key(state.position)))act(state,'locked');});
  if(k==='Backspace'&&!mod)return once(()=>openEditor(''));
  if(code==='Space'&&mod&&!shift)return once(()=>act(selectColumn(state),'select'));
  if(code==='Space'&&shift&&!mod)return once(()=>act(selectRow(state),'select'));
  if(mod&&alt&&code==='KeyV')return once(()=>{if(state.clipboard?.mode==='copy')openPanel('pasteSpecial');});
  if(mod&&shift&&code==='KeyL')return once(()=>act(toggleFilter(state),'filter'));
  if(mod&&shift&&code==='Digit1')return once(()=>act(numberFormat(state),'format'));
  if(alt&&!mod&&k==='ArrowDown'&&state.filter&&S.filter&&same(state.position,S.filter.header))return once(()=>openPanel('filter'));
  if(mod&&!alt&&!shift){
    const cmd={KeyC:()=>act(copy(state),'clip'),KeyX:()=>act(cut(state),'clip'),KeyV:()=>act(paste(state),'paste'),KeyZ:()=>act(undo(state),'undo'),
      KeyD:()=>act(fill(state,'down'),'fill'),KeyR:()=>act(fill(state,'right'),'fill'),KeyF:()=>openPanel('find'),KeyH:()=>openPanel('replace'),KeyG:()=>openPanel('goto'),
      KeyB:()=>act(toggleBold(state),'format'),KeyA:()=>act(selectRegion(state),'select'),KeyY:()=>act(redo(state),'undo'),
      KeyI:()=>act(toggleStyle(state,'italic'),'format'),KeyU:()=>act(toggleStyle(state,'underline'),'format'),KeyE:()=>act(flashFill(state),'fill'),
      KeyS:()=>act(save(state),'save'),KeyT:()=>openPanel('table'),KeyL:()=>openPanel('table')}[code];
    if(cmd)return once(cmd);
    if(k==='Home')return once(()=>act(goHome(state),'jump'));
    if(k==='End')return once(()=>act(goEnd(state),'jump'));
  }
  return false;
}
document.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase(), mod=e.ctrlKey||(isMac&&e.metaKey);
  if(isModal())return;
  // Esc closes an in-game panel even before focus has reached it.
  if(panel&&e.key==='Escape'){e.preventDefault();closePanel();return;}
  const target=e.target;
  if(target instanceof HTMLElement&&(target.matches('input,textarea,select')||target.isContentEditable))return;
  if(panel&&panelEl.contains(target))return;
  if(state.phase==='ready')return;
  if(state.phase==='failed'||state.phase==='won'){
    if((key==='r'||key==='enter')&&!mod&&!e.altKey){e.preventDefault();if(!e.repeat&&!held.has(e.code)){held.add(e.code);if(key==='enter'&&state.phase==='won'&&hasNext())enterRoom(room+1);else retry();}}return;
  }
  if(document.activeElement!==canvas||!inputArmed)return;
  // Ctrl+R is "fill right", so modified keys are read before the plain R retry.
  if(boardKey(e))return;
  if(key==='r'&&!mod&&!e.altKey){e.preventDefault();if(!e.repeat)retry();return;}
  const dirs={arrowright:[1,0],arrowleft:[-1,0],arrowup:[0,-1],arrowdown:[0,1]};
  if(dirs[key]){
    e.preventDefault();if(e.repeat||held.has(e.code)||e.altKey||state.panel)return;
    held.add(e.code);const [dx,dy]=dirs[key];
    if(e.shiftKey||state.mode==='extend')act(extend(state,dx,dy,mod),'select');else act(move(state,dx,dy,mod),'move',dx,dy);
    return;
  }
  // Any other printable key starts typing into the cell, replacing what is there.
  if(e.key.length===1&&!mod&&!e.altKey&&!state.panel){e.preventDefault();openEditor(e.key);}
});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
// macOS does not send keyup for other keys while ⌘ is down, so releasing ⌘ frees them all.
document.addEventListener('keyup',e=>{held.delete(e.code);if(e.key==='Meta')held.clear();});
window.addEventListener('blur',()=>{held.clear();inputArmed=false;if(state.phase==='playing'&&!isModal()&&!panel&&!editing)$('focusNotice').hidden=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){held.clear();inputArmed=false;}});
document.addEventListener('focusin',()=>{
  clearTimeout(focusTimer);focusTimer=setTimeout(()=>{if(state.phase==='playing'&&!isModal()&&!panel&&!editing)$('focusNotice').hidden=document.activeElement===canvas;},0);
});
// ?debug exposes the live state for manual checks; nothing in the game reads it.
if(new URLSearchParams(location.search).has('debug'))window.__game={get state(){return state;},get held(){return [...held];},get inputArmed(){return inputArmed;}};
new ResizeObserver(resize).observe(canvas);
applyRoom();settingsUI();sync();$('startBtn').focus({preventScroll:true});requestAnimationFrame(frame);
