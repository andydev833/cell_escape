import { ROOM, createState, begin, restart, move, cellName, isTrap } from './engine.js';

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
let state = createState();
let highestHint = 0, hintIndex = 0, inputArmed = false;
let width = 0, height = 0, scale = 1, geo = null, audio = null;
let animation = null, particles = [], trapFx = null, bump = null, pendingDeath = false;
// Columns whose press this player has watched fall. Survives retries, not reloads.
const seenTraps = new Set();
// Game time only advances while nothing is paused, so dialogs freeze every effect in place.
// Each attempt owns its scheduled events; retry/start bump `attempt` so stale callbacks never fire.
let clock = 0, lastReal = null, attempt = 0, events = [];
let focusTimer = null;
const held = new Set();
// Milliseconds after the character lands on a trap cell.
const PRESS = { drop: 60, impact: 180, burst: 240, result: 480 };
const hints = [
  'あの床に、止まらずに進めないかな？',
  '矢印に、もうひとつのキーを添えてみよう。',
  isMac ? '⌘ を押したまま、→ を一回。' : 'Ctrl を押したまま、→ を一回。',
];

function rounded(x,y,w,h,r,fill,stroke) {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r); if(fill){ctx.fillStyle=fill;ctx.fill();} if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
function computeGeometry() {
  const gutter = width < 500 ? 23 : 31, top = 27;
  const cw = (width - gutter - 15) / ROOM.visibleCols;
  const ch = (height - top - 17) / ROOM.visibleRows;
  geo = { gutter, top, cw, ch };
}
function point(p) { return { x: geo.gutter + (p.col - .5)*geo.cw, y: geo.top + (p.row - .5)*geo.ch }; }
// Shared by the floor, the character and the press so they always meet at the same height.
function layout() {
  const { cw, ch } = geo, floorY = point(ROOM.start).y, floorHeight = Math.min(ch*.7,36), size = Math.min(cw*.43,ch*.83,29);
  const standY = floorY - floorHeight*.3 - size*.35;
  return { floorY, floorHeight, floorTop: floorY - floorHeight*.5, size, standY, feetY: standY + size*.48 };
}
function resize() {
  const rect = canvas.getBoundingClientRect(); width=rect.width;height=rect.height;scale=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.setTransform(scale,0,0,scale,0,0);computeGeometry();draw(clock);
}
function ghost(x,y,size,t,opacity=1,tilt=0,pose=null) {
  ctx.save(); ctx.translate(x,y);ctx.rotate(tilt);ctx.globalAlpha=opacity;
  // Squash around the feet so the body flattens onto the floor, not toward its centre.
  if(pose){ctx.translate(0,size*.48);ctx.scale(pose.sx,pose.sy);ctx.translate(0,-size*.48);}
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
// A heavy press hides above each trap cell; only its ceiling plate and short rails show until it fires.
function drawPress(col,L,lt) {
  const { cw, ch } = geo, c = point({ col, row: ROOM.traps.row });
  const pw = cw*.88, bodyH = Math.max(L.size*1.3, ch*.95), teeth = Math.max(3, L.size*.22);
  const mountY = Math.max(geo.top+6, L.standY - L.size*.52 - ch*1.7), downY = L.feetY - L.size*.3;
  let k = 0;
  if(lt!==null&&lt>=PRESS.drop) k = reduced ? 1 : Math.min(1, ((lt-PRESS.drop)/(PRESS.impact-PRESS.drop))**2);
  ctx.fillStyle='#2a3725';
  for(const side of [-1,1])ctx.fillRect(c.x+side*(pw*.5+1.5)-1.5,mountY,3,ch*.38);
  if(k>0) {
    const bottom = mountY + (downY-mountY)*k, by = bottom-bodyH, bx = c.x-pw/2, bh = bodyH-teeth;
    ctx.save();ctx.beginPath();ctx.rect(c.x-cw,mountY,cw*2,height);ctx.clip();
    if(by>mountY){ctx.fillStyle='#565b48';ctx.fillRect(c.x-pw*.11,mountY,pw*.22,by-mountY);ctx.fillStyle='#8d917a66';ctx.fillRect(c.x-pw*.11,mountY,1.5,by-mountY);}
    rounded(bx,by,pw,bh,2,'#4b5140','#1b2216');
    ctx.fillStyle='#6d745b';ctx.fillRect(bx+2,by+2,pw-4,2);
    ctx.fillStyle='#262c1f';
    for(const fx of [.18,.82]){ctx.beginPath();ctx.arc(bx+pw*fx,by+bh*.22,Math.max(1.2,pw*.04),0,Math.PI*2);ctx.fill();}
    const hy = by+bh*.52, hh = Math.max(4,bh*.26);
    ctx.save();ctx.beginPath();ctx.rect(bx+1,hy,pw-2,hh);ctx.clip();ctx.fillStyle='#d4a043';ctx.fillRect(bx,hy,pw,hh);ctx.fillStyle='#24271c';
    for(let s=-hh;s<pw+hh;s+=hh*1.3){ctx.beginPath();ctx.moveTo(bx+s,hy+hh);ctx.lineTo(bx+s+hh*.6,hy+hh);ctx.lineTo(bx+s+hh*1.2,hy);ctx.lineTo(bx+s+hh*.6,hy);ctx.closePath();ctx.fill();}
    ctx.restore();
    const n = Math.max(3,Math.round(pw/7));ctx.fillStyle='#a3a589';ctx.beginPath();ctx.moveTo(bx,by+bh);
    for(let i=0;i<n;i++){ctx.lineTo(bx+pw*(i+.5)/n,by+bh+teeth);ctx.lineTo(bx+pw*(i+1)/n,by+bh);}
    ctx.closePath();ctx.fill();
    ctx.restore();
  }
  rounded(c.x-cw*.47,mountY-5,cw*.94,6,1.5,'#212c1e','#3b4a33');
  ctx.fillStyle='#0b120c';ctx.fillRect(c.x-pw*.5,mountY,pw,1.5);
  // A press seen in an earlier attempt keeps a faint scorch on its plate.
  if(seenTraps.has(col)&&k===0){ctx.fillStyle='#c98a5a88';ctx.fillRect(c.x-cw*.3,mountY-3,cw*.6,1.5);}
}
function draw(t) {
  if(!geo || !width)return;
  ctx.clearRect(0,0,width,height);
  const { gutter, top, cw, ch }=geo, L=layout(), { floorY, floorHeight, floorTop, size }=L;
  const lt=trapFx?t-trapFx.at:null;
  ctx.fillStyle='#141e17';ctx.fillRect(0,0,width,height);
  // Impact shake moves only the board drawing; the page chrome lives outside the canvas.
  const shaking=!reduced&&lt!==null&&lt>=PRESS.impact&&lt<PRESS.impact+130;
  if(shaking){const a=3*(1-(lt-PRESS.impact)/130);ctx.save();ctx.translate(a*Math.sin(lt*.42),a*.6*Math.cos(lt*.57));}
  const gradient=ctx.createRadialGradient(width*.48,height*.57,0,width*.48,height*.57,width*.65);
  gradient.addColorStop(0,'#26392470');gradient.addColorStop(1,'#101a1300');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#1d291d';ctx.fillRect(0,0,width,top);ctx.fillRect(0,0,gutter,height);
  ctx.strokeStyle='#607c4524';ctx.lineWidth=.7;
  for(let c=0;c<=ROOM.visibleCols;c++){const x=gutter+c*cw;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
  for(let r=0;r<=ROOM.visibleRows;r++){const y=top+r*ch;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
  ctx.font=`${width<500?8:9}px ui-monospace,Consolas,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#6d8659';
  for(let c=1;c<=ROOM.visibleCols;c++)ctx.fillText(String.fromCharCode(64+c),gutter+(c-.5)*cw,top*.5);
  for(let r=1;r<=ROOM.visibleRows;r++)ctx.fillText(String(r),gutter*.5,top+(r-.5)*ch);

  const W=ROOM.walkable;
  const left=gutter+(W.fromCol-1)*cw, right=gutter+W.toCol*cw;
  for(let c=W.fromCol;c<=W.toCol;c++) {
    const cell={col:c,row:W.row}, center=point(cell), x=center.x-cw*.5+1;
    rounded(x,floorTop,cw-2,floorHeight,2,'#34472b','#607b4544');
    ctx.fillStyle='#839e4c24';ctx.fillRect(x+1,floorTop+1,cw-4,2);
    ctx.font='8px ui-monospace,Consolas,monospace';ctx.fillStyle='#9eaf7740';ctx.fillText('1',center.x,floorY+floorHeight*.14);
    if(isTrap(cell)) {
      // The switch plate: a faint seam that sinks when stepped on.
      const fired=trapFx&&trapFx.col===c&&lt>=0, sink=fired?(reduced?2:Math.min(2,lt/30)):0;
      const sx=center.x-cw*.32, sw=cw*.64, sh=Math.max(3,floorHeight*.22);
      if(fired){ctx.fillStyle='#1a2516';ctx.fillRect(sx,floorTop+2,sw,sh+sink);}
      ctx.strokeStyle=fired?'#11190f':'#56693f70';ctx.lineWidth=1;ctx.strokeRect(sx,floorTop+2+sink,sw,sh);
      if(seenTraps.has(c)&&!fired){ctx.strokeStyle='#b98a5f70';ctx.beginPath();ctx.moveTo(sx+sw*.2,floorTop+floorHeight*.55);ctx.lineTo(sx+sw*.45,floorTop+floorHeight*.75);ctx.moveTo(sx+sw*.6,floorTop+floorHeight*.5);ctx.lineTo(sx+sw*.8,floorTop+floorHeight*.68);ctx.stroke();}
    }
  }
  // A little island and a distant doorway keep the room readable without labels.
  ctx.strokeStyle='#7c965c60';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(left,floorY+floorHeight*.5+8);ctx.lineTo(right,floorY+floorHeight*.5+8);ctx.stroke();ctx.setLineDash([]);
  const start=point(ROOM.start), exit=point(ROOM.exit);
  const dh=Math.min(ch*1.8,73),dw=Math.min(cw*.67,36), doorY=floorY+floorHeight*.28;
  ctx.save();ctx.shadowColor='#bee695';ctx.shadowBlur=state.phase==='won'?35:16;
  rounded(exit.x-dw*.65,doorY-dh,dw*1.3,dh+3,4,'#142518','#67854b');
  const doorGrad=ctx.createLinearGradient(0,doorY-dh,0,doorY);doorGrad.addColorStop(0,state.phase==='won'?'#c2ecae':'#739b56');doorGrad.addColorStop(1,state.phase==='won'?'#83bd72':'#365b31');
  rounded(exit.x-dw*.47,doorY-dh+5,dw*.94,dh-7,2,doorGrad);
  ctx.restore();ctx.fillStyle='#d5efb1';ctx.fillRect(exit.x+dw*.18,doorY-dh*.47,2,4);
  ctx.font='7px ui-monospace,monospace';ctx.fillStyle='#b0cc8e';ctx.textAlign='center';ctx.fillText('EXIT',exit.x,doorY-dh-10);
  ctx.fillStyle='#a2ba7740';ctx.beginPath();ctx.ellipse(exit.x,doorY+5,dw*.9,4,0,0,Math.PI*2);ctx.fill();

  const a=animation;
  let p={x:point(state.position).x,y:L.standY}, pose=null, visible=true;
  if(state.phase==='ready')p={x:start.x,y:L.standY};
  if(a) {
    const duration=reduced?0:a.duration, progress=duration?Math.min(1,(t-a.at)/duration):1;
    const eased=1-Math.pow(1-progress,3);
    const from=point(a.from),to=point(a.to);
    p={x:from.x+(to.x-from.x)*eased,y:L.standY+(to.y-from.y)*eased};
    if(a.jump&&!reduced){p.y-=Math.sin(progress*Math.PI)*Math.min(48,ch*1.4);ctx.strokeStyle='#bed99555';ctx.lineWidth=1.5;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(from.x,L.standY-size*.45);ctx.quadraticCurveTo((from.x+to.x)/2,L.standY-ch*1.45,to.x,L.standY-size*.45);ctx.stroke();ctx.setLineDash([]);}
    if(progress===1)animation=null;
  }
  // Landed on a switch: flinch, freeze, get flattened, then burst.
  if(lt!==null&&lt>=0) {
    if(lt<PRESS.impact){pose={shock:true,sx:1,sy:1};if(!reduced&&lt<PRESS.drop)p.y-=Math.sin(Math.PI*lt/PRESS.drop)*3;}
    else if(lt<(reduced?320:PRESS.burst))pose={sx:1.6,sy:.3};
    else visible=false;
  }
  if(bump&&!reduced){const k=(t-bump.at)/140;if(k<1){const off=Math.sin(Math.PI*k)*3;p.x+=bump.dx*off;p.y+=bump.dy*off;}}
  if(state.phase==='playing'&&!reduced&&!a)p.y+=Math.sin(t/450)*1.2;
  if(visible&&(state.phase!=='won'||animation))ghost(p.x,p.y,size,t,1,0,pose);
  if(pose?.shock){ctx.font=`bold ${Math.max(11,size*.6)}px ui-monospace,monospace`;ctx.fillStyle='#f2d27e';ctx.fillText('!',p.x+size*.5,p.y-size*.75);}
  for(let c=ROOM.traps.fromCol;c<=ROOM.traps.toCol;c++)drawPress(c,L,trapFx&&trapFx.col===c?lt:null);
  if(state.phase==='playing'||state.phase==='ready') {
    const selected=point(state.phase==='ready'?ROOM.start:state.position);
    ctx.strokeStyle='#b9df8f';ctx.lineWidth=1.5;ctx.strokeRect(selected.x-cw*.5+1,selected.y-ch*.5+1,cw-2,ch-2);
    ctx.fillStyle='#cceca5';ctx.fillRect(selected.x+cw*.5-3,selected.y+ch*.5-3,4,4);
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
  if(!reduced&&lt!==null&&lt>=PRESS.impact&&lt<PRESS.impact+160){ctx.fillStyle=`rgba(224,122,78,${.16*(1-(lt-PRESS.impact)/160)})`;ctx.fillRect(0,0,width,height);}
}
function paused(){return isModal()||document.hidden;}
function frame(real){
  const dt=lastReal===null?0:Math.min(50,Math.max(0,real-lastReal));lastReal=real;
  if(!paused()){
    clock+=dt;
    const due=events.filter(e=>e.at<=clock);
    if(due.length){events=events.filter(e=>e.at>clock);due.sort((a,b)=>a.at-b.at).forEach(e=>e.fn());}
  }
  draw(clock);requestAnimationFrame(frame);
}
function schedule(delay,fn){const id=attempt;events.push({at:clock+delay,fn:()=>{if(id===attempt)fn();}});}
function cancelAttempt(){attempt++;events=[];particles=[];trapFx=null;animation=null;bump=null;pendingDeath=false;}
function announce(text){$('announcement').textContent=text;}
function persistSettings(){safeWrite('cell-escape.settings',{sound,reduced});}
function audioReady(){try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}}
function tone(freq,at,len,{type='sine',gain=.045,to=0}={}){
  const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,at);if(to)o.frequency.exponentialRampToValueAtTime(to,at+len);
  g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+.008);g.gain.exponentialRampToValueAtTime(.001,at+len);o.connect(g);g.connect(audio.destination);o.start(at);o.stop(at+len+.02);
}
function beep(kind){
  if(!sound)return;audioReady();if(!audio)return;const now=audio.currentTime;
  // Press: a short metallic clank over a low thud. Kept near the other cues' volume.
  if(kind==='press'){tone(1250,now,.09,{type:'triangle',gain:.03,to:620});tone(1870,now,.05,{type:'square',gain:.01,to:900});tone(110,now,.26,{gain:.07,to:42});return;}
  if(kind==='click'){tone(900,now,.04,{type:'square',gain:.012,to:500});return;}
  if(kind==='bump'){tone(150,now,.07,{gain:.025,to:110});return;}
  (kind==='win'?[440,554.37,659.25,880]:[320]).forEach((freq,i)=>tone(freq,now+i*.085,.19));
}
function settingsUI(){document.body.classList.toggle('reduce-motion',reduced);$('soundStatus').textContent=sound?'ON':'OFF';$('soundBtn').setAttribute('aria-pressed',String(sound));$('soundBtn').setAttribute('aria-label',sound?'音をオフにする':'音をオンにする');$('soundToggle').checked=sound;$('motionToggle').checked=reduced;}
function isModal(){return hintDialog.open||settingsDialog.open;}
function focusGame(){held.clear();inputArmed=true;$('focusNotice').hidden=true;if(!isModal())canvas.focus({preventScroll:true});}
function sync(){
  $('cellAddress').textContent=cellName(state.position);$('cellValue').textContent=ROOM.values[`${state.position.col},${state.position.row}`]??'';
  // Until the press lands, the death has happened in the rules but not yet on screen.
  $('deathCount').textContent=String(state.deaths-(pendingDeath?1:0)).padStart(2,'0');
  $('sheetStatus').textContent=pendingDeath?'IN THE ROOM':{ready:'READY',playing:'IN THE ROOM',failed:'CRUSHED',won:'ESCAPED'}[state.phase];
  $('startScreen').hidden=state.phase!=='ready';
}
function start(){cancelAttempt();$('resultScreen').hidden=true;state=begin(state);sync();focusGame();audioReady();}
function retry(){cancelAttempt();$('resultScreen').hidden=true;state=restart(state);sync();focusGame();beep('move');}
function showResult(){
  const won=state.phase==='won';const result=$('resultScreen');result.className=`result-screen screen ${won?'won':'failed'}`;
  $('resultKicker').textContent=won?'ESCAPED':'TRY AGAIN';$('resultTitle').textContent=won?'抜け出した。':'やられた。';
  $('resultSubtitle').textContent=won?'扉の向こうに、たどり着いた。':'';$('resultSubtitle').hidden=!won;result.hidden=false;
  if(!isModal())$('retryBtn').focus({preventScroll:true});
}
function burst(){
  if(reduced||!trapFx)return;
  const L=layout(),c=point(trapFx),y=L.feetY-L.size*.2;
  particles.push(...Array.from({length:6},(_,i)=>{const side=i%2?1:-1;return{x:c.x+side*L.size*.3,y,vx:side*geo.cw*(.5+i*.1),vy:-L.size*(1+i*.15),g:L.size*3.2,at:clock,life:520,size:Math.max(3,L.size*.24),spin:side*(3+i),color:i%3?'#dfe7cc':'#b2c995'};}));
}
function dust(){
  if(reduced||!trapFx)return;
  const L=layout(),c=point(trapFx),y=L.feetY-L.size*.2;
  particles.push(...Array.from({length:4},(_,i)=>{const side=i<2?-1:1;return{x:c.x+side*geo.cw*.42,y,vx:side*geo.cw*(.3+i%2*.2),vy:-4-i%2*4,g:0,at:clock,life:300,size:2,spin:0,color:'#9aa68a'};}));
}
function perform(dx,dy,jump){
  const previous=state;state=move(state,dx,dy,jump);
  if(state===previous){if(previous.phase==='playing'){bump={dx,dy,at:clock};beep('bump');}return;}
  const duration=reduced?0:jump?350:115;
  animation={from:previous.position,to:state.position,at:clock,duration,jump};bump=null;
  if(state.phase==='failed'){
    // The press timeline starts when the character lands, never on the key press.
    const col=state.trap.col;pendingDeath=true;trapFx={...state.trap,at:clock+duration};
    schedule(duration,()=>beep('click'));
    schedule(duration+PRESS.drop,()=>seenTraps.add(col));
    schedule(duration+PRESS.impact,()=>{pendingDeath=false;sync();dust();beep('press');announce('やられた。Enterキーでもう一度。');});
    schedule(duration+PRESS.burst,burst);
    schedule(duration+PRESS.result,showResult);
  }else if(state.phase==='won'){
    beep('win');safeWrite('cell-escape.cleared',true);announce('抜け出した。');
    const p=point(ROOM.exit);particles=Array.from({length:32},(_,i)=>({x:p.x,y:p.y-30,vx:Math.cos(i)*100,vy:Math.sin(i)*100-45,g:50,at:clock,life:900,size:3,spin:0,color:i%2?'#c7e8a8':'#e6ebcb'}));
    schedule(reduced?0:600,showResult);
  }else beep('move');
  sync();
}
function renderHint(){
  $('hintText').textContent=hints[hintIndex];$('hintBack').disabled=hintIndex===0;
  $('hintNext').innerHTML=hintIndex===2?'試してみる <span>↗</span>':'次の手掛かり <span>→</span>';
  $('hintKeys').hidden=hintIndex!==2;$('modifierKey').textContent=isMac?'⌘':'Ctrl';
  Array.from($('hintProgress').children).forEach((e,i)=>e.classList.toggle('active',i<=hintIndex));
}
function openDialog(dialog){held.clear();$('focusNotice').hidden=true;dialog.showModal();}
function closeDialog(dialog){
  dialog.close();held.clear();
  if(state.phase==='ready')$('startBtn').focus({preventScroll:true});
  else if(state.phase==='playing'||(state.phase==='failed'&&$('resultScreen').hidden))focusGame();
  else if(!$('resultScreen').hidden)$('retryBtn').focus({preventScroll:true});
}
$('startBtn').addEventListener('click',start);$('retryBtn').addEventListener('click',retry);$('resumeBtn').addEventListener('click',focusGame);
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
  const key=e.key.toLowerCase();
  if(isModal())return;
  const target=e.target;
  if(target instanceof HTMLElement&&(target.matches('input,textarea,select')||target.isContentEditable))return;
  if(state.phase==='ready')return;
  if(state.phase==='failed'||state.phase==='won'){
    if((key==='r'||key==='enter')&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!e.repeat&&!held.has(e.code)){held.add(e.code);retry();}}return;
  }
  if(document.activeElement!==canvas||!inputArmed)return;
  if(key==='r'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!e.repeat)retry();return;}
  const dirs={arrowright:[1,0],arrowleft:[-1,0],arrowup:[0,-1],arrowdown:[0,1]};
  if(!dirs[key])return;
  e.preventDefault();if(e.repeat||held.has(e.code)||e.altKey||e.shiftKey)return;
  held.add(e.code);perform(...dirs[key],e.ctrlKey||(isMac&&e.metaKey));
});
document.addEventListener('keyup',e=>held.delete(e.code));
window.addEventListener('blur',()=>{held.clear();inputArmed=false;if(state.phase==='playing'&&!isModal())$('focusNotice').hidden=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){held.clear();inputArmed=false;}});
document.addEventListener('focusin',()=>{
  clearTimeout(focusTimer);focusTimer=setTimeout(()=>{if(state.phase==='playing'&&!isModal())$('focusNotice').hidden=document.activeElement===canvas;},0);
});
new ResizeObserver(resize).observe(canvas);
settingsUI();sync();$('startBtn').focus({preventScroll:true});requestAnimationFrame(frame);
