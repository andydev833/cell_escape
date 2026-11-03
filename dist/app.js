import { STAGES, createState, begin, restart, move, extend, copy, cut, paste, cancelClipboard, cellName, key,
  tokenOf, isBlank, deviceStatus, exitOpen, selectionRect, countTokens } from './engine.js';

const $ = id => document.getElementById(id);
const canvas = $('board'), ctx = canvas.getContext('2d');
const hintDialog = $('hintDialog'), settingsDialog = $('settingsDialog');
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
let highestHint = 0, hintIndex = 0, inputArmed = false;
let width = 0, height = 0, scale = 1, geo = null, audio = null;
let animation = null, particles = [], trapFx = null, bump = null, pendingDeath = false, doorK = null;
// Cells whose trap this player has watched fire, per room. Survives retries, not reloads.
const seenTraps = new Set();
// Game time only advances while nothing is paused, so dialogs freeze every effect in place.
// Each attempt owns its scheduled events; retry/start bump `attempt` so stale callbacks never fire.
let clock = 0, lastReal = null, attempt = 0, events = [];
let focusTimer = null;
const held = new Set();
// Milliseconds after the trap is triggered (landing, or the end of the laser's look at the two keys).
const T = { drop: 60, impact: 180, burst: 240, result: 480 };
const LASER_LOOK = 450;
const IMPACT_SOUND = { ceilingPress: 'press', doorDrop: 'press', floorDrop: 'drop', fakeExit: 'drop', spikes: 'spike', laser: 'laser' };
const ORDINALS = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH'];
const pad = n => String(n).padStart(2, '0');
const forPlatform = text => isMac ? text.replaceAll('Ctrl', '⌘') : text;
const seenKey = p => `${room}:${key(p)}`;

function rounded(x,y,w,h,r,fill,stroke) {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r); if(fill){ctx.fillStyle=fill;ctx.fill();} if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
function computeGeometry() {
  const gutter = width < 500 ? 23 : 31, top = 27;
  const cw = (width - gutter - 15) / S.visibleCols;
  const ch = (height - top - 17) / S.visibleRows;
  geo = { gutter, top, cw, ch };
}
function point(p) { return { x: geo.gutter + (p.col - .5)*geo.cw, y: geo.top + (p.row - .5)*geo.ch }; }
// Shared by floors, the character and every trap so they always meet at the same height.
function at(p) {
  const { cw, ch } = geo, c = point(p), floorHeight = Math.min(ch*.7,36), size = Math.min(cw*.43,ch*.83,29);
  const standY = c.y - floorHeight*.3 - size*.35;
  return { x: c.x, floorY: c.y, floorTop: c.y - floorHeight*.5, floorHeight, size, standY, feetY: standY + size*.48, r: Math.max(4, size*.3), tx: c.x + cw*.2 };
}
function doorBox(p) {
  const { cw, ch } = geo, L = at(p), dh = Math.min(ch*1.8,73), dw = Math.min(cw*.67,36), doorY = L.floorY + L.floorHeight*.28;
  return { ...L, dh, dw, doorY, ix: L.x-dw*.47, iy: doorY-dh+5, iw: dw*.94, ih: dh-7 };
}
function resize() {
  const rect = canvas.getBoundingClientRect(); width=rect.width;height=rect.height;scale=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.setTransform(scale,0,0,scale,0,0);computeGeometry();draw(clock);
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
    if(type==='laser')return {sx:1.15,sy:.85,dim:true};
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
function drawDoor(p,{fake=false,lit=true,closed=0,style=null,won=false,t=0}) {
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
  ctx.font='7px ui-monospace,monospace';ctx.fillStyle=lit?'#b0cc8e':'#56664c';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('EXIT',x,doorY-dh-10);
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
function drawToken(v,p,danger=false) {
  const L = at(p);
  if(tokenOf(v)==='stone')drawStone(L.tx,L.floorTop-L.r*.45,L.r);
  else if(tokenOf(v)==='key'){drawKey(L.tx-L.r*.25,L.floorTop-L.r*.75,L.r,danger?'#ff7a64':'#e0c36a');if(danger){ctx.strokeStyle='#ff5a4a';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(L.tx,L.floorTop-L.r*.75,L.r*1.6,0,Math.PI*2);ctx.stroke();}}
}
// Monitor above the lock: one slot per allowed key, lit keys for the keys that exist.
function drawMonitor(rule,lt) {
  const lock = S.devices[0].cells[0], { cw, ch } = geo, c = point({ col: lock.col, row: 2 }), count = countTokens(state.values, rule.token);
  const alarm = count>rule.limit || (trapFx?.type==='laser');
  const w = Math.max(cw*1.5,42), h = Math.max(ch*.7,22), x = c.x-w/2, y = c.y-h/2;
  ctx.strokeStyle='#4f6243';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(c.x,y+h);ctx.lineTo(c.x,at(lock).floorTop-at(lock).r*1.6);ctx.stroke();ctx.setLineDash([]);
  rounded(x,y,w,h,3,'#0e1811',alarm?'#ff5a4a':'#56704a');
  const shown = Math.max(rule.limit,count), r = Math.min(h*.2,w/(shown*3.2));
  for(let i=0;i<shown;i++)drawKey(x+w*(i+.5)/shown,c.y,r,i<count?(alarm?'#ff6a54':'#b9df8f'):'#33452f');
}
function draw(t) {
  if(!geo || !width)return;
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
  for(let c=0;c<=S.visibleCols;c++){const x=gutter+c*cw;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
  for(let r=0;r<=S.visibleRows;r++){const y=top+r*ch;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
  ctx.font=`${width<500?8:9}px ui-monospace,Consolas,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#6d8659';
  for(let c=1;c<=S.visibleCols;c++)ctx.fillText(String.fromCharCode(64+c),gutter+(c-.5)*cw,top*.5);
  for(let r=1;r<=S.visibleRows;r++)ctx.fillText(String(r),gutter*.5,top+(r-.5)*ch);

  const floorCells=[...S.floor].map(k=>{const [col,row]=k.split(',').map(Number);return {col,row};});
  const deviceAt=new Map();for(const d of S.devices)d.cells.forEach((c,i)=>deviceAt.set(key(c),{d,i}));
  // Rails between floors on stacked rows: the way down is visible before anyone tries it.
  for(const p of floorCells)if(S.floor.has(key({col:p.col,row:p.row+1}))){const a=at(p),b=at({col:p.col,row:p.row+1});ctx.fillStyle='#5d7a4890';for(const side of [-1,1])ctx.fillRect(a.x+side*cw*.2-1,a.floorTop+a.floorHeight,2,b.floorTop-a.floorTop-a.floorHeight);}
  for(const p of floorCells) {
    const L=at(p), x=L.x-cw*.5+1, trap=S.traps.get(key(p)), flt=fxAt(p), fired=flt!==null&&flt>=0, v=state.values[key(p)];
    if(fired&&(trap?.type==='floorDrop'||trap?.type==='fakeExit'||trapFx.type==='floorDrop')&&flt>=T.drop){drawHole(L,flt,t);continue;}
    const sink=fired?(reduced?2:Math.min(2,flt/30)):0;
    rounded(x,L.floorTop+sink*.5,cw-2,L.floorHeight,2,'#34472b','#607b4544');
    ctx.fillStyle='#839e4c24';ctx.fillRect(x+1,L.floorTop+1,cw-4,2);
    if(!S.floor.has(key({col:p.col,row:p.row+1}))){ctx.strokeStyle='#7c965c60';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(x-1,L.floorTop+L.floorHeight+8);ctx.lineTo(x+cw-1,L.floorTop+L.floorHeight+8);ctx.stroke();ctx.setLineDash([]);}
    if(v===1){ctx.font='8px ui-monospace,Consolas,monospace';ctx.fillStyle='#9eaf7740';ctx.textAlign='center';ctx.fillText('1',L.x-(deviceAt.has(key(p))?cw*.2:0),L.floorY+L.floorHeight*.14);}
    if(trap?.type==='ceilingPress') {
      // The switch plate: a faint seam that sinks when stepped on.
      const sx=L.x-cw*.32, sw=cw*.64, sh=Math.max(3,L.floorHeight*.22);
      if(fired){ctx.fillStyle='#1a2516';ctx.fillRect(sx,L.floorTop+2,sw,sh+sink);}
      ctx.strokeStyle=fired?'#11190f':'#56693f70';ctx.lineWidth=1;ctx.strokeRect(sx,L.floorTop+2+sink,sw,sh);
    } else if(trap?.type==='floorDrop') {
      ctx.strokeStyle='#5d6e43';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L.x-4,L.floorTop+3);ctx.lineTo(L.x+1,L.floorTop+L.floorHeight*.34);ctx.lineTo(L.x-2,L.floorY+1);ctx.stroke();
    } else if(trap?.type==='fakeExit') {
      ctx.fillStyle='#11190f99';ctx.fillRect(x+cw*.15,L.floorY-1,cw*.7,1.5);
    }
    const dev=deviceAt.get(key(p));
    if(dev?.d.kind==='selectAll') {
      // Five identical plates, one lamp each.
      const lit=status[dev.d.id].lit[dev.i], ps=Math.min(cw*.5,L.floorHeight*.9);
      rounded(L.x-ps/2,L.floorTop+2+sink,ps,L.floorHeight*.5,2,lit?'#5d6f3c':'#3e5131',lit?'#e6c66f':'#6f8659');
      ctx.fillStyle=lit?'#f2d27e':'#7d9367';ctx.beginPath();ctx.moveTo(L.x,L.floorTop+4+sink);ctx.lineTo(L.x+ps*.16,L.floorTop+2+L.floorHeight*.25+sink);ctx.lineTo(L.x,L.floorTop+L.floorHeight*.5+sink);ctx.lineTo(L.x-ps*.16,L.floorTop+2+L.floorHeight*.25+sink);ctx.fill();
      const ly=L.floorTop-ch*1.55, lr=Math.max(3,Math.min(cw*.09,7));
      ctx.strokeStyle='#4f6243';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(L.x,ly+lr);ctx.lineTo(L.x,L.floorTop-2);ctx.stroke();ctx.setLineDash([]);
      ctx.save();if(lit&&!reduced){ctx.shadowColor='#f2d27e';ctx.shadowBlur=12;}ctx.beginPath();ctx.arc(L.x,ly,lr,0,Math.PI*2);ctx.fillStyle=lit?'#f2d27e':'#263124';ctx.fill();ctx.strokeStyle=lit?'#fff0b8':'#55684a';ctx.stroke();ctx.restore();
    } else if(dev?.d.kind==='tokens') {
      const r=L.r;
      if(dev.d.token==='stone'){rounded(L.tx-r*1.4,L.floorTop-r*.1,r*2.8,r*.55,1.5,'#4c5a40','#71845d');
        if(!status[dev.d.id].lit[dev.i]){ctx.strokeStyle='#8fa27a';ctx.setLineDash([2,2]);ctx.beginPath();ctx.ellipse(L.tx,L.floorTop-r*.45,r,r*.72,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}}
      else{rounded(L.tx-r*1.5,L.floorTop-r*1.6,r*3,r*1.55,2,'#22301f','#71845d');
        if(tokenOf(v)!=='key'){ctx.fillStyle='#0b120b';ctx.beginPath();ctx.arc(L.tx,L.floorTop-r*.95,r*.25,0,Math.PI*2);ctx.fill();ctx.fillRect(L.tx-r*.1,L.floorTop-r*.95,r*.2,r*.5);}}
    }
    if(S.shelf&&S.shelf.col===p.col&&S.shelf.row===p.row){ctx.fillStyle='#6f5f43';ctx.fillRect(L.tx-L.r*1.5,L.floorTop-L.r*.05,L.r*3,2.5);ctx.fillRect(L.tx-L.r*1.2,L.floorTop,2,L.r*.5);ctx.fillRect(L.tx+L.r*1.2-2,L.floorTop,2,L.r*.5);}
    if(seenTraps.has(seenKey(p))&&!fired){ctx.strokeStyle='#b98a5f70';ctx.lineWidth=1;const sx=L.x-cw*.32,sw=cw*.64;ctx.beginPath();ctx.moveTo(sx+sw*.2,L.floorTop+L.floorHeight*.55);ctx.lineTo(sx+sw*.45,L.floorTop+L.floorHeight*.75);ctx.moveTo(sx+sw*.6,L.floorTop+L.floorHeight*.5);ctx.lineTo(sx+sw*.8,L.floorTop+L.floorHeight*.68);ctx.stroke();}
  }
  // Values outside the floor (only reachable by pasting a wide range) still show as plain numbers.
  for(const [k,v] of Object.entries(state.values)){if(S.floor.has(k)||isBlank(v)||tokenOf(v))continue;const [col,row]=k.split(',').map(Number);if(col>S.visibleCols||row>S.visibleRows)continue;const c=point({col,row});ctx.font='8px ui-monospace,Consolas,monospace';ctx.fillStyle='#9eaf7760';ctx.fillText(String(v),c.x,c.y);}

  // Exits: lamps over the door for the stone room, a monitor for the key room.
  const open=exitOpen(S,state);
  if(doorK===null)doorK=open?1:0;
  const exitFx=fxAt(S.exit);
  for(const [k,trap] of S.traps)if(trap.type==='fakeExit'){const [col,row]=k.split(',').map(Number),flt=fxAt({col,row});drawDoor({col,row},{fake:true,lit:!(flt!==null&&flt>=T.drop)});}
  drawDoor(S.exit,{closed:S.door?1-doorK:0,style:S.door,won:state.phase==='won',t});
  const pedestals=S.devices.find(d=>d.kind==='tokens'&&d.token==='stone');
  if(pedestals){const D=doorBox(S.exit),lr=Math.max(3,Math.min(cw*.08,6));status[pedestals.id].lit.forEach((lit,i)=>{const lx=D.x+(i?1:-1)*D.dw*.38,ly=D.doorY-D.dh-20;ctx.save();if(lit&&!reduced){ctx.shadowColor='#f2d27e';ctx.shadowBlur=12;}ctx.beginPath();ctx.arc(lx,ly,lr,0,Math.PI*2);ctx.fillStyle=lit?'#f2d27e':'#263124';ctx.fill();ctx.strokeStyle=lit?'#fff0b8':'#55684a';ctx.stroke();ctx.restore();});}
  const limit=S.rules.find(r=>r.kind==='tokenLimit');
  if(limit)drawMonitor(limit,lt);
  const keyAlarm=limit&&(countTokens(state.values,limit.token)>limit.limit);
  for(const [k,v] of Object.entries(state.values))if(tokenOf(v)){const [col,row]=k.split(',').map(Number);drawToken(v,{col,row},keyAlarm&&tokenOf(v)===limit.token);}
  // The laser first traces every key it sees, so the cause is on screen before it fires.
  if(keyAlarm&&trapFx?.type==='laser'&&lt<T.burst){
    const lock=S.devices[0].cells[0],mc=point({col:lock.col,row:2});
    ctx.strokeStyle='#ff5a4acc';ctx.lineWidth=1.2;ctx.setLineDash([4,3]);ctx.lineDashOffset=reduced?0:-t/30;
    for(const [k,v] of Object.entries(state.values))if(tokenOf(v)===limit.token){const [col,row]=k.split(',').map(Number),L=at({col,row});ctx.beginPath();ctx.moveTo(mc.x,mc.y+geo.ch*.35);ctx.lineTo(L.tx,L.floorTop-L.r*.75);ctx.stroke();}
    ctx.setLineDash([]);ctx.lineDashOffset=0;
  }

  const rect=selectionRect(state);
  const ranged=(state.phase==='playing'||state.phase==='failed')&&(rect.c1!==rect.c2||rect.r1!==rect.r2);
  if(ranged){const x=gutter+(rect.c1-1)*cw,y=top+(rect.r1-1)*ch,w=(rect.c2-rect.c1+1)*cw,h=(rect.r2-rect.r1+1)*ch;ctx.fillStyle='#b9df8f1c';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#b9df8f99';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,w-1,h-1);}
  if(state.clipboard&&state.phase==='playing'){const r=state.clipboard.rect,x=gutter+(r.c1-1)*cw,y=top+(r.r1-1)*ch,w=(r.c2-r.c1+1)*cw,h=(r.r2-r.r1+1)*ch;
    ctx.strokeStyle=state.clipboard.mode==='cut'?'#f2d27e':'#c3e9ad';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.lineDashOffset=reduced?0:-t/40;ctx.strokeRect(x+2,y+2,w-4,h-4);ctx.setLineDash([]);ctx.lineDashOffset=0;}

  const a=animation, start=at(S.start), size=start.size;
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
  if(!pose?.hidden&&(state.phase!=='won'||animation)) {
    if(pose?.fall!==undefined){
      // Falling through the opened floor: clipped at the hole so it drops out of sight.
      const L=at(trapFx),k=pose.fall;ctx.save();ctx.beginPath();ctx.rect(0,0,width,L.floorTop+L.floorHeight);ctx.clip();
      ghost(p.x,p.y+k*k*ch*.9,size*(1-.4*k),t,1-.5*k,k*.4,{shock:true});ctx.restore();
    } else ghost(p.x,p.y,size,t,pose?.dim?.7:1,pose?.tilt||0,pose);
  }
  if(pose?.shock&&pose.fall===undefined){ctx.font=`bold ${Math.max(11,size*.6)}px ui-monospace,monospace`;ctx.fillStyle='#f2d27e';ctx.textAlign='center';ctx.fillText('!',p.x+size*.5,p.y-size*.75);}
  for(const [k,trap] of S.traps)if(trap.type==='ceilingPress'){const [col,row]=k.split(',').map(Number);drawDrop({col,row},fxAt({col,row}),'press');}
  if(trapFx?.type==='doorDrop')drawDrop(trapFx,lt,'shutter');
  if(trapFx?.type==='spikes')drawSpikes(trapFx,lt);
  if(trapFx?.type==='laser')drawLaser(trapFx,lt);
  if(state.phase==='playing'||state.phase==='ready') {
    const selected=point(state.phase==='ready'?S.start:state.position);
    ctx.strokeStyle='#b9df8f';ctx.lineWidth=1.5;ctx.strokeRect(selected.x-cw*.5+1,selected.y-ch*.5+1,cw-2,ch-2);
    if(!ranged){ctx.fillStyle='#cceca5';ctx.fillRect(selected.x+cw*.5-3,selected.y+ch*.5-3,4,4);}
    else{const e=point(state.selectionEnd);ctx.fillStyle='#cceca5';ctx.fillRect(gutter+rect.c2*cw-3,top+rect.r2*ch-3,4,4);ctx.strokeStyle='#b9df8f66';ctx.strokeRect(e.x-cw*.5+1.5,e.y-ch*.5+1.5,cw-3,ch-3);}
    // A wall answers with a short tick on the side that was pushed, never with a trap effect.
    if(bump){const k=(t-bump.at)/220;if(k<1){ctx.strokeStyle=`rgba(214,236,184,${.8*(1-k)})`;ctx.lineWidth=2;ctx.beginPath();
      if(bump.dx){const x=selected.x+bump.dx*(cw*.5-1);ctx.moveTo(x,selected.y-ch*.32);ctx.lineTo(x,selected.y+ch*.32);}
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
function cancelAttempt(){attempt++;events=[];particles=[];trapFx=null;animation=null;bump=null;pendingDeath=false;doorK=null;}
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
function focusGame(){held.clear();inputArmed=true;$('focusNotice').hidden=true;if(!isModal())canvas.focus({preventScroll:true});}
function valueText(v){return isBlank(v)?'':tokenOf(v)==='stone'?'STONE':tokenOf(v)==='key'?v.id:String(v);}
function sync(){
  $('cellAddress').textContent=cellName(state.position);$('cellValue').textContent=valueText(state.values[key(state.position)]);
  // Until the trap lands, the death has happened in the rules but not yet on screen.
  $('deathCount').textContent=pad(state.deaths-(pendingDeath?1:0));
  $('sheetStatus').textContent=pendingDeath?'IN THE ROOM':{ready:'READY',playing:'IN THE ROOM',failed:'CAUGHT',won:'ESCAPED'}[state.phase];
  $('startScreen').hidden=state.phase!=='ready';
}
function renderTabs(){
  $('sheetTabs').replaceChildren(...STAGES.map((st,i)=>{
    const b=document.createElement('button');b.className='sheet-tab'+(i===room?' active':'');b.disabled=i>progress&&i!==room;
    b.innerHTML=`<span class="tab-dot"></span><span class="tab-word">Room </span>${pad(st.number)}`;
    b.setAttribute('aria-label',`第${st.number}室${b.disabled?'（まだ開いていない）':''}`);if(i===room)b.setAttribute('aria-current','page');
    b.addEventListener('click',()=>enterRoom(i));return b;
  }));
}
function applyRoom(){
  S=STAGES[room];
  $('roomEyebrow').textContent=$('startKicker').textContent=`ROOM ${pad(S.number)}`;
  const dot=document.createElement('span');dot.textContent='。';$('roomTitle').replaceChildren(S.title,dot);
  $('roomLead').textContent=S.lead;$('roomIndex').textContent=pad(S.number);
  $('buildLabel').textContent=`THE ${ORDINALS[room]} ROOM`;$('fileName').textContent=`room_${pad(S.number)}.xlsx`;
  $('gameShell').setAttribute('aria-label',`第${S.number}室`);
  renderTabs();if(width)computeGeometry();
}
function enterRoom(i){
  if(isModal())return;
  cancelAttempt();room=i;state=createState(i);highestHint=0;hintIndex=0;$('resultScreen').hidden=true;
  applyRoom();sync();$('startBtn').focus({preventScroll:true});
}
function start(){cancelAttempt();$('resultScreen').hidden=true;state=begin(state);sync();focusGame();audioReady();}
function retry(){cancelAttempt();$('resultScreen').hidden=true;state=restart(state);sync();focusGame();beep('move');}
const hasNext=()=>room<STAGES.length-1;
function showResult(){
  const won=state.phase==='won', next=won&&hasNext(), result=$('resultScreen');
  result.className=`result-screen screen ${won?'won':'failed'}`;
  $('resultKicker').textContent=won?'ESCAPED':'TRY AGAIN';$('resultTitle').textContent=won?'抜け出した。':'やられた。';
  $('resultSubtitle').textContent=won?(hasNext()?'扉の向こうに、たどり着いた。':'最後の扉を、抜けた。'):'';$('resultSubtitle').hidden=!won;
  $('nextBtn').hidden=!next;$('retryBtn').hidden=next;$('resultKey').textContent=next?'ENTER で次へ · R でもう一度':'ENTER / R';
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
// The trap timeline starts when the character lands (or after the laser has shown both keys), never on the key press.
function startTrap(delay){
  const t=state.trap;pendingDeath=true;trapFx={...t,at:clock+delay};
  if(t.type==='laser')beep('alarm');
  schedule(delay,()=>beep('click'));
  schedule(delay+T.drop,()=>seenTraps.add(seenKey(t)));
  schedule(delay+T.impact,()=>{pendingDeath=false;sync();dust();beep(IMPACT_SOUND[t.type]);announce('やられた。Enterキーでもう一度。');});
  schedule(delay+T.burst,burst);
  schedule(delay+T.result,showResult);
}
function act(next,kind,dx=0,dy=0){
  const previous=state;
  if(next===previous){if(kind==='move'&&previous.phase==='playing'){bump={dx,dy,at:clock};beep('bump');}return;}
  state=next;bump=null;
  const duration=kind==='move'?(reduced?0:state.jump?350:115):0;
  if(kind==='move')animation={from:previous.position,to:state.position,at:clock,duration,jump:state.jump};
  if(state.phase==='failed')startTrap(kind==='paste'?(reduced?250:LASER_LOOK):duration);
  else if(state.phase==='won'){
    beep('win');announce('抜け出した。');progress=Math.max(progress,room+1);safeWrite('cell-escape.progress',progress);renderTabs();
    const p=point(S.exit);particles=Array.from({length:32},(_,i)=>({x:p.x,y:p.y-30,vx:Math.cos(i)*100,vy:Math.sin(i)*100-45,g:50,at:clock,life:900,size:3,spin:0,color:i%2?'#c7e8a8':'#e6ebcb'}));
    schedule(reduced?0:600,showResult);
  }else{
    beep(kind==='move'?'move':'tick');
    if(!exitOpen(S,previous)&&exitOpen(S,state))schedule(duration+80,()=>{beep('open');announce('扉が開いた。');});
  }
  sync();
}
function renderHint(){
  $('hintText').textContent=forPlatform(S.hints[hintIndex]);$('hintBack').disabled=hintIndex===0;
  $('hintNext').innerHTML=hintIndex===2?'試してみる <span>↗</span>':'次の手掛かり <span>→</span>';
  const diagram=$('hintKeys'),el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  diagram.replaceChildren();
  S.keys.forEach((combo,i)=>{if(i)diagram.append(el('span','›','sep'));combo.forEach((k,j)=>{if(j)diagram.append(el('span','＋'));diagram.append(el('kbd',forPlatform(k)));});});
  diagram.classList.toggle('compact',S.keys.flat().length>2);diagram.hidden=hintIndex!==2;
  Array.from($('hintProgress').children).forEach((e,i)=>e.classList.toggle('active',i<=hintIndex));
}
function openDialog(dialog){held.clear();$('focusNotice').hidden=true;dialog.showModal();}
function closeDialog(dialog){
  dialog.close();held.clear();
  if(state.phase==='ready')$('startBtn').focus({preventScroll:true});
  else if(state.phase==='playing'||(state.phase==='failed'&&$('resultScreen').hidden))focusGame();
  else if(!$('resultScreen').hidden)$(!$('nextBtn').hidden?'nextBtn':'retryBtn').focus({preventScroll:true});
}
$('startBtn').addEventListener('click',start);$('retryBtn').addEventListener('click',retry);$('resumeBtn').addEventListener('click',focusGame);
$('nextBtn').addEventListener('click',()=>{if(hasNext())enterRoom(room+1);});
$('hintBtn').addEventListener('click',()=>{hintIndex=highestHint;renderHint();openDialog(hintDialog);});
$('hintBack').addEventListener('click',()=>{hintIndex=Math.max(0,hintIndex-1);renderHint();});
$('hintNext').addEventListener('click',()=>{if(hintIndex===2){closeDialog(hintDialog);return;}highestHint=Math.max(highestHint,++hintIndex);renderHint();});
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
canvas.addEventListener('pointerdown',()=>{if(state.phase==='playing'&&!isModal())focusGame();});
document.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase(), mod=e.ctrlKey||(isMac&&e.metaKey);
  if(isModal())return;
  const target=e.target;
  if(target instanceof HTMLElement&&(target.matches('input,textarea,select')||target.isContentEditable))return;
  if(state.phase==='ready')return;
  if(state.phase==='failed'||state.phase==='won'){
    if((key==='r'||key==='enter')&&!mod&&!e.altKey){e.preventDefault();if(!e.repeat&&!held.has(e.code)){held.add(e.code);if(key==='enter'&&state.phase==='won'&&hasNext())enterRoom(room+1);else retry();}}return;
  }
  if(document.activeElement!==canvas||!inputArmed)return;
  if(key==='r'&&!mod&&!e.altKey){e.preventDefault();if(!e.repeat)retry();return;}
  if(key==='escape'){if(state.clipboard){e.preventDefault();act(cancelClipboard(state),'clip');}return;}
  if(mod&&!e.altKey&&!e.shiftKey&&(key==='c'||key==='x'||key==='v')){
    e.preventDefault();if(e.repeat)return;
    act(key==='c'?copy(state):key==='x'?cut(state):paste(state),key==='v'?'paste':'clip');return;
  }
  const dirs={arrowright:[1,0],arrowleft:[-1,0],arrowup:[0,-1],arrowdown:[0,1]};
  if(!dirs[key])return;
  e.preventDefault();if(e.repeat||held.has(e.code)||e.altKey)return;
  held.add(e.code);const [dx,dy]=dirs[key];
  if(e.shiftKey)act(extend(state,dx,dy,mod),'select');else act(move(state,dx,dy,mod),'move',dx,dy);
});
// macOS does not send keyup for other keys while ⌘ is down, so releasing ⌘ frees them all.
document.addEventListener('keyup',e=>{held.delete(e.code);if(e.key==='Meta')held.clear();});
window.addEventListener('blur',()=>{held.clear();inputArmed=false;if(state.phase==='playing'&&!isModal())$('focusNotice').hidden=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){held.clear();inputArmed=false;}});
document.addEventListener('focusin',()=>{
  clearTimeout(focusTimer);focusTimer=setTimeout(()=>{if(state.phase==='playing'&&!isModal())$('focusNotice').hidden=document.activeElement===canvas;},0);
});
new ResizeObserver(resize).observe(canvas);
applyRoom();settingsUI();sync();$('startBtn').focus({preventScroll:true});requestAnimationFrame(frame);
