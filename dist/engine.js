import { STAGE_DEFS } from './stages.js';

// Stage data is the single source for rules and drawing: app.js reads the same compiled stages.
// Every action here is pure: it returns the same state object when nothing happens (walls, refused edits).
const VISIBLE = { cols: 14, rows: 8 };
export const MAX_COL = 16384, MAX_ROW = 1048576;
export const key = p => `${p.col},${p.row}`;
const same = (a, b) => a.col === b.col && a.row === b.row;
export const fromKey = k => { const [col, row] = k.split(',').map(Number); return { col, row }; };
export function parseCell(a1) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(a1).trim());
  if (!m) return null;
  let col = 0; for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  const row = Number(m[2]);
  return col >= 1 && col <= MAX_COL && row >= 1 && row <= MAX_ROW ? { col, row } : null;
}
export function cellsOf(ref) {
  if (!ref) return [];
  if (Array.isArray(ref)) return ref.flatMap(cellsOf);
  const [a, b = a] = ref.split(':'), p = parseCell(a), q = parseCell(b), out = [];
  for (let row = Math.min(p.row, q.row); row <= Math.max(p.row, q.row); row++)
    for (let col = Math.min(p.col, q.col); col <= Math.max(p.col, q.col); col++) out.push({ col, row });
  return out;
}
export function colName(c) { let name = ''; while (c > 0) { c--; name = String.fromCharCode(65 + c % 26) + name; c = Math.floor(c / 26); } return name; }
export const cellName = p => colName(p.col) + p.row;

function compile(def, index) {
  const values = {}, formats = {}, notes = {};
  for (const [ref, value] of def.values) for (const p of cellsOf(ref)) values[key(p)] = value;
  for (const [ref, f] of def.formats || []) for (const p of cellsOf(ref)) formats[key(p)] = Object.freeze({ ...f });
  for (const [ref, text] of def.notes || []) notes[key(parseCell(ref))] = text;
  const traps = new Map();
  for (const t of def.traps || []) for (const p of cellsOf(t.cells)) traps.set(key(p), Object.freeze({ ...t, cells: undefined }));
  return Object.freeze({
    ...def, index, number: index + 1, visibleCols: VISIBLE.cols, visibleRows: def.rows || VISIBLE.rows,
    start: parseCell(def.start), exit: def.exit ? parseCell(def.exit) : null,
    floor: new Set(def.floor.flatMap(cellsOf).map(key)),
    values: Object.freeze(values), formats: Object.freeze(formats), notes: Object.freeze(notes), traps,
    devices: Object.freeze((def.devices || []).map(d => Object.freeze({ ...d, cells: cellsOf(d.cells) }))),
    rules: Object.freeze(def.rules || []), latches: Object.freeze(def.latches || []),
    selectHazards: Object.freeze((def.selectHazards || []).map(h => Object.freeze({ ...h, cells: cellsOf(h.cells) }))),
    locked: new Set(cellsOf(def.locked || []).map(key)),
    shelf: def.shelf ? parseCell(def.shelf) : null, sockets: cellsOf(def.sockets || []), bulbs: cellsOf(def.bulbs || []),
    confirm: def.confirm ? Object.freeze({ ...def.confirm, at: parseCell(def.confirm.at), clears: parseCell(def.confirm.clears) }) : null,
    filter: def.filter ? Object.freeze({ cells: cellsOf(def.filter), header: cellsOf(def.filter)[0] }) : null,
    decor: Object.freeze((def.decor || []).map(d => Object.freeze({ ...d, at: parseCell(d.at) }))),
    indicators: Object.freeze(def.indicators || []),
    ghosts: Object.freeze((def.ghosts || []).map(([ref, text]) => Object.freeze({ at: parseCell(ref), text }))),
  });
}
// A room's new sheet (Shift+F11) is compiled like a room of its own, sharing the room's title and hints.
const withSheet = (def, index) => {
  const stage = compile(def, index);
  if (!def.newSheet) return stage;
  const sheet = compile({ ...def, ...def.newSheet, values: [], formats: [], notes: [], traps: [], devices: [], rules: [], latches: [], selectHazards: [], decor: [], indicators: [], ghosts: [], newSheet: undefined, door: undefined, exitNeeds: undefined }, index);
  return Object.freeze({ ...stage, sheet });
};
export const STAGES = Object.freeze(STAGE_DEFS.map(withSheet));
export const stageOf = state => state.sheet === 'new' ? STAGES[state.stage].sheet : STAGES[state.stage];

// ---- values, formulas, display ----
export const isBlank = v => v === undefined || v === null || v === '';
export const tokenOf = v => (v && typeof v === 'object' && 'token' in v ? v.token : null);
export const isFormula = v => !!(v && typeof v === 'object' && 'f' in v);
export const countTokens = (values, token) => Object.values(values).filter(v => tokenOf(v) === token).length;
const REF = /(\$?)([A-Z]{1,3})(\$?)(\d{1,7})/g;
// A tiny formula model: numbers, cell references ($ allowed), + - * / and parentheses.
export function evaluate(values, v, depth = 0) {
  if (!isFormula(v)) return typeof v === 'number' ? v : isBlank(v) ? 0 : NaN;
  if (depth > 20) return NaN;
  const src = v.f.slice(1).toUpperCase(); let i = 0;
  const peek = () => src[i], skip = () => { while (src[i] === ' ') i++; };
  function atom() {
    skip();
    if (peek() === '(') { i++; const n = sum(); skip(); i++; return n; }
    if (peek() === '-') { i++; return -atom(); }
    const ref = /^\$?[A-Z]{1,3}\$?\d{1,7}/.exec(src.slice(i));
    if (ref) { i += ref[0].length; const p = parseCell(ref[0]); return evaluate(values, values[key(p)], depth + 1); }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    i = src.length; return NaN;
  }
  function product() { let n = atom(); for (;;) { skip(); if (peek() === '*') { i++; n *= atom(); } else if (peek() === '/') { i++; n /= atom(); } else return n; } }
  function sum() { let n = product(); for (;;) { skip(); if (peek() === '+') { i++; n += product(); } else if (peek() === '-') { i++; n -= product(); } else return n; } }
  const n = sum();
  return i >= src.length ? n : NaN;
}
// Relative references follow the copy; $-fixed parts stay.
export function shiftFormula(v, dc, dr) {
  if (!isFormula(v) || (!dc && !dr)) return v;
  return { f: v.f.replace(REF, (m, dcol, letters, drow, digits) => {
    const p = parseCell(letters + digits);
    const col = dcol ? p.col : p.col + dc, row = drow ? p.row : p.row + dr;
    if (col < 1 || row < 1) return '#REF!';
    return `${dcol}${colName(col)}${drow}${row}`;
  }) };
}
// F4 cycles the reference under the text cursor: B2 → $B$2 → B$2 → $B2 → B2. Anything else is left alone.
export function cycleReference(text, caret) {
  REF.lastIndex = 0; let m;
  while ((m = REF.exec(text))) {
    const start = m.index, end = start + m[0].length;
    if (caret >= start && caret <= end && /[A-Z$]/.test(text[start] || '')) {
      const next = !m[1] && !m[3] ? `$${m[2]}$${m[4]}` : m[1] && m[3] ? `${m[2]}$${m[4]}` : !m[1] && m[3] ? `$${m[2]}${m[4]}` : `${m[2]}${m[4]}`;
      return { text: text.slice(0, start) + next + text.slice(end), caret: start + next.length };
    }
  }
  return null;
}
export function formatNumber(n, fmt) {
  if (Number.isNaN(n)) return '#VALUE!';
  if (fmt === '#,##0.00') return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(Math.round(n * 1e9) / 1e9);
}
export function displayValue(state, p) {
  const k = key(p), v = state.values[k], fmt = state.formats[k]?.numFmt;
  if (isBlank(v)) return '';
  if (tokenOf(v)) return v.id || v.token.toUpperCase();
  if (isFormula(v) || typeof v === 'number') return formatNumber(evaluate(state.values, v), fmt);
  return String(v);
}
export const rawText = v => isBlank(v) ? '' : isFormula(v) ? v.f : tokenOf(v) ? (v.id || v.token.toUpperCase()) : String(v);
function parseInput(text) {
  if (text === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(text.trim())) return Number(text);
  if (text.startsWith('=')) return { f: text.toUpperCase() };
  return text;
}

// ---- selection ----
export const isFloor = (stage, p) => stage.floor.has(key(p));
const inGrid = (stage, p) => p.col >= 1 && p.row >= 1 && p.col <= stage.visibleCols && p.row <= stage.visibleRows;
export function selectionRect(state) {
  if (state.sel) return state.sel;
  const a = state.position, b = state.selectionEnd;
  return { c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row), c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row) };
}
export const inRect = (r, p) => p.col >= r.c1 && p.col <= r.c2 && p.row >= r.r1 && p.row <= r.r2;
const clampRect = (stage, r) => ({ c1: r.c1, r1: r.r1, c2: Math.min(r.c2, stage.visibleCols), r2: Math.min(r.r2, stage.visibleRows) });
const rectCells = r => { const out = []; for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) out.push({ col, row }); return out; };
export const hiddenSet = state => new Set(state.hidden);
// Excel's current region: grow the box while any non-blank cell touches its edge (diagonals included).
export function currentRegion(state, p) {
  const has = (col, row) => !isBlank(state.values[key({ col, row })]);
  let r = { c1: p.col, r1: p.row, c2: p.col, r2: p.row }, grew = true;
  while (grew) {
    grew = false;
    const edge = (c1, r1, c2, r2) => { for (let row = r1; row <= r2; row++) for (let col = c1; col <= c2; col++) if (col >= 1 && row >= 1 && has(col, row)) return true; return false; };
    if (edge(r.c1 - 1, r.r1 - 1, r.c1 - 1, r.r2 + 1)) { r.c1--; grew = true; }
    if (edge(r.c2 + 1, r.r1 - 1, r.c2 + 1, r.r2 + 1)) { r.c2++; grew = true; }
    if (edge(r.c1 - 1, r.r1 - 1, r.c2 + 1, r.r1 - 1)) { r.r1--; grew = true; }
    if (edge(r.c1 - 1, r.r2 + 1, r.c2 + 1, r.r2 + 1)) { r.r2++; grew = true; }
    r = { c1: Math.max(1, r.c1), r1: Math.max(1, r.r1), c2: r.c2, r2: r.r2 };
  }
  return r.c1 === r.c2 && r.r1 === r.r2 && !has(p.col, p.row) ? null : r;
}
export function usedRange(state) {
  const keys = [...Object.keys(state.values).filter(k => !isBlank(state.values[k])), ...Object.keys(state.formats)];
  if (!keys.length) return null;
  const ps = keys.map(fromKey);
  return { c1: Math.min(...ps.map(p => p.col)), r1: Math.min(...ps.map(p => p.row)), c2: Math.max(...ps.map(p => p.col)), r2: Math.max(...ps.map(p => p.row)) };
}

// ---- conditions ----
const valueAt = (s, c) => s.values[key(parseCell(c))];
// One small vocabulary for exits, traps, rules, latches and indicator lamps.
export function test(stage, s, c) {
  if (c === undefined || c === null) return true;
  if (typeof c === 'string') return !!deviceStatus(stage, s)[c]?.satisfied;
  if (c.all) return c.all.every(x => test(stage, s, x));
  if (c.any) return c.any.some(x => test(stage, s, x));
  if (c.not) return !test(stage, s, c.not);
  if (c.latch) return !!s.latches[c.latch];
  if (c.tokens) return countTokens(s.values, c.tokens) === c.count;
  if (c.partial) { const n = cellsOf(c.partial.cells).filter(p => s.values[key(p)] === c.partial.equals).length; return n > 0 && n < cellsOf(c.partial.cells).length; }
  if (c.allEqual) return cellsOf(c.allEqual.cells).every(p => s.values[key(p)] === c.allEqual.equals);
  if (c.tokenPartial) { const n = cellsOf(c.tokenPartial.cells).filter(p => tokenOf(s.values[key(p)]) === c.tokenPartial.token).length; return n > 0 && n < cellsOf(c.tokenPartial.cells).length; }
  if (c.tokenIn) return cellsOf(c.tokenIn.cells).some(p => tokenOf(s.values[key(p)]) === c.tokenIn.token);
  if (c.filter) {
    const F = stage.filter; if (!F || !s.filter) return false;
    const allowed = s.filter.allowed; if (!allowed) return false;
    const intact = F.cells.every(p => s.values[key(p)] === stage.values[key(p)]);
    return intact && allowed.length === c.filter.allowed.length && c.filter.allowed.every(a => allowed.includes(a));
  }
  if (c.formulas) {
    const target = parseCell(c.formulas.ref);
    return cellsOf(c.formulas.cells).every(p => {
      const v = s.values[key(p)];
      if (!isFormula(v) || evaluate(s.values, v) !== c.formulas.value) return false;
      REF.lastIndex = 0; let m, hit = false;
      while ((m = REF.exec(v.f))) if (same(parseCell(m[2] + m[4]), target)) hit = true;
      return hit;
    });
  }
  const k = c.at ? key(parseCell(c.at)) : null, v = k ? s.values[k] : undefined, f = k ? s.formats[k] || {} : {};
  if ('token' in c) return tokenOf(v) === c.token;
  if ('equals' in c) return v === c.equals;
  if ('contains' in c) return typeof v === 'string' && v.includes(c.contains);
  if ('fill' in c) return (f.fill || null) === c.fill;
  if ('bold' in c) return !!f.bold === c.bold;
  if ('numFmt' in c) return f.numFmt === c.numFmt;
  return false;
}
// What each device shows right now: one lamp per device cell, and whether it is satisfied.
export function deviceStatus(stage, state) {
  const out = {};
  for (const d of stage.devices) {
    if (d.kind === 'selectAll') {
      const rect = selectionRect(state), held = !!state.solved[d.id];
      out[d.id] = { satisfied: held, lit: d.cells.map(c => held || inRect(rect, c)) };
    } else if (d.kind === 'tokens') {
      const lit = d.cells.map(c => tokenOf(state.values[key(c)]) === d.token);
      out[d.id] = { satisfied: lit.every(Boolean) && (d.count === undefined || countTokens(state.values, d.token) === d.count), lit };
    }
  }
  return out;
}
export const exitOpen = (stage, state) => !stage.exitNeeds || test(stage, state, stage.exitNeeds);
export function activeTrap(stage, state, p) {
  const t = stage.traps.get(key(p));
  return t && !(t.disarmedBy && state.solved[t.disarmedBy]) && test(stage, state, t.when) ? t : null;
}

// ---- state ----
export function createState(stage = 0, deaths = 0) {
  const s = STAGES[stage];
  return { stage, phase: 'ready', position: { ...s.start }, previous: { ...s.start }, selectionEnd: { ...s.start }, sel: null,
    values: { ...s.values }, formats: { ...s.formats }, clipboard: null, solved: {}, latches: {}, history: [],
    panel: null, filter: null, hidden: [], sheet: 'main', deaths, reason: null, trap: null, jump: false };
}
export function begin(state) { return { ...createState(state.stage, state.deaths), phase: 'playing' }; }
export function restart(state) { return begin(state); }
const playing = s => s.phase === 'playing' && !s.panel;
const fail = (s, type, p) => ({ ...s, phase: 'failed', panel: null, deaths: s.deaths + 1, reason: type, trap: { ...p, type } });

// After every action: latches, then selection devices and hazards, then value rules.
function settle(stage, s, { values = false, selection = false } = {}) {
  let latches = s.latches;
  for (const l of stage.latches) if (!latches[l.id] && test(stage, s, l.when)) latches = { ...latches, [l.id]: true };
  if (latches !== s.latches) s = { ...s, latches };
  if (selection) {
    const rect = selectionRect(s);
    for (const h of stage.selectHazards) if (h.cells.some(c => inRect(rect, c))) return fail(s, h.type, s.position);
    let solved = s.solved;
    // Once every plate sat inside one selection the device stays solved, even after the selection shrinks.
    for (const d of stage.devices) if (d.kind === 'selectAll' && !solved[d.id] && d.cells.every(c => inRect(rect, c))) solved = { ...solved, [d.id]: true };
    if (solved !== s.solved) s = { ...s, solved };
  }
  if (values) for (const rule of stage.rules) {
    const hit = rule.kind === 'tokenLimit' ? countTokens(s.values, rule.token) > rule.limit : test(stage, s, rule.when);
    if (hit) return fail(s, rule.type, s.position);
  }
  return s;
}
// Landing on a cell. Only the landing cell counts: cells passed over by a jump never fire.
function arrive(stage, state, target, jump) {
  if (same(target, state.position) || !isFloor(stage, target) || hiddenSet(state).has(target.row)) return state;
  let s = { ...state, previous: state.position, position: target, selectionEnd: target, sel: null, jump };
  if (stage.exit && same(target, stage.exit)) return exitOpen(stage, s) ? { ...s, phase: 'won' } : fail(s, stage.exitTrap, target);
  const trap = activeTrap(stage, s, target);
  if (trap) return fail(s, trap.type, target);
  if (stage.confirm && same(target, stage.confirm.at)) s = { ...s, panel: { kind: 'confirm' } };
  return settle(stage, s);
}
export function edge(position, dx, dy, values) {
  const has = (p) => !isBlank(values[key(p)]);
  let next = { col: position.col + dx, row: position.row + dy };
  if (has(position) && has(next)) {
    while (has({ col: next.col + dx, row: next.row + dy })) next = { col: next.col + dx, row: next.row + dy };
    return next;
  }
  const candidates = Object.keys(values).map(fromKey).filter(p => has(p) && (dx ? p.row === position.row && (p.col - position.col) * dx > 0 : p.col === position.col && (p.row - position.row) * dy > 0));
  candidates.sort((a,b) => (Math.abs(a.col-position.col)+Math.abs(a.row-position.row))-(Math.abs(b.col-position.col)+Math.abs(b.row-position.row)));
  return candidates[0] || { col: dx ? (dx > 0 ? MAX_COL : 1) : position.col, row: dy ? (dy > 0 ? MAX_ROW : 1) : position.row };
}
// Walls (anything without floor) leave the state untouched — no move, no death. Hidden rows are skipped.
export function move(state, dx, dy, jump = false) {
  if (!playing(state) || Math.abs(dx) + Math.abs(dy) !== 1) return state;
  const stage = stageOf(state), hidden = hiddenSet(state);
  let target;
  if (jump) target = edge(state.position, dx, dy, state.values);
  else { target = { col: state.position.col + dx, row: state.position.row + dy }; while (dy && hidden.has(target.row)) target = { ...target, row: target.row + dy }; }
  return arrive(stage, state, target, jump);
}
export function jumpTo(state, target) {
  if (!playing(state) || !target) return state;
  return arrive(stageOf(state), state, target, true);
}
// Ctrl+G. Some rooms are about another way of arriving, and there a typed address does not carry you.
export function gotoRef(state, target) { return stageOf(state).noGoto ? state : jumpTo(state, target); }
export const goHome = state => jumpTo(state, { col: 1, row: 1 });
export function goEnd(state) { const r = usedRange(state); return r ? jumpTo(state, { col: r.c2, row: r.r2 }) : state; }
// Shift(+Ctrl)+arrow grows the selection from its far corner. The character (active cell) stays put.
export function extend(state, dx, dy, jump = false) {
  if (!playing(state) || Math.abs(dx) + Math.abs(dy) !== 1) return state;
  const stage = stageOf(state), from = state.selectionEnd;
  const end = jump ? edge(from, dx, dy, state.values) : { col: from.col + dx, row: from.row + dy };
  if (same(end, from) || !inGrid(stage, end)) return state;
  return settle(stage, { ...state, selectionEnd: end, sel: null }, { selection: true });
}
const select = (state, sel) => playing(state) ? settle(stageOf(state), { ...state, sel, selectionEnd: state.position }, { selection: true }) : state;
export const selectColumn = s => select(s, { c1: s.position.col, c2: s.position.col, r1: 1, r2: MAX_ROW });
export const selectRow = s => select(s, { c1: 1, c2: MAX_COL, r1: s.position.row, r2: s.position.row });
// Ctrl+A: the current region first; pressed again (or from an empty spot), the whole sheet.
export function selectRegion(s) {
  const region = currentRegion(s, s.position), now = selectionRect(s);
  const isRegion = region && now.c1 === region.c1 && now.c2 === region.c2 && now.r1 === region.r1 && now.r2 === region.r2;
  return select(s, region && !isRegion ? region : { c1: 1, r1: 1, c2: MAX_COL, r2: MAX_ROW });
}

// ---- editing (every value change goes through here so Undo and the rules see it) ----
const lockedIn = (stage, cells) => cells.some(p => stage.locked.has(key(p)));
function change(state, values, formats = state.formats, extra = {}) {
  const history = [...state.history, { values: state.values, formats: state.formats }].slice(-30);
  return settle(stageOf(state), { ...state, values, formats, history, ...extra }, { values: true });
}
export function copy(state, mode = 'copy') {
  if (!playing(state)) return state;
  const rect = clampRect(stageOf(state), selectionRect(state)), cells = [];
  for (const p of rectCells(rect)) cells.push({ dc: p.col - rect.c1, dr: p.row - rect.r1, value: state.values[key(p)], format: state.formats[key(p)] });
  return { ...state, clipboard: { mode, rect, cells } };
}
export const cut = state => copy(state, 'cut');
export function cancelClipboard(state) { return state.clipboard ? { ...state, clipboard: null } : state; }
// Source and destination change together in one step, so a cut never counts as two keys mid-way.
// `only: 'values'` keeps the destination's own formats (paste special → values).
export function paste(state, only = 'all') {
  if (!playing(state) || !state.clipboard) return state;
  const stage = stageOf(state), { mode, rect, cells } = state.clipboard, at = state.position;
  if (only === 'values' && mode === 'cut') return state;
  const w = rect.c2 - rect.c1, h = rect.r2 - rect.r1;
  const dest = cells.map(c => ({ col: at.col + c.dc, row: at.row + c.dr }));
  if (!inGrid(stage, { col: at.col + w, row: at.row + h }) || lockedIn(stage, dest)) return state;
  const values = { ...state.values }, formats = { ...state.formats };
  if (mode === 'cut') for (const c of cells) { const k = key({ col: rect.c1 + c.dc, row: rect.r1 + c.dr }); delete values[k]; delete formats[k]; }
  cells.forEach((c, i) => {
    const k = key(dest[i]), v = mode === 'cut' ? c.value : shiftFormula(c.value, at.col - rect.c1, at.row - rect.r1);
    if (isBlank(v)) delete values[k]; else values[k] = v;
    if (only === 'all') { if (c.format) formats[k] = c.format; else delete formats[k]; }
  });
  return change(state, values, formats, { clipboard: mode === 'cut' ? null : state.clipboard, sel: null, selectionEnd: { col: at.col + w, row: at.row + h } });
}
// Delete clears contents only: floor, formats and the cell itself stay.
export function clearContents(state) {
  if (!playing(state)) return state;
  const stage = stageOf(state), rect = selectionRect(state);
  const hit = Object.keys(state.values).filter(k => inRect(rect, fromKey(k)) && !isBlank(state.values[k]));
  if (!hit.length || lockedIn(stage, hit.map(fromKey))) return state;
  const values = { ...state.values }; for (const k of hit) delete values[k];
  return change(state, values);
}
export function canEdit(state) { return playing(state) && !stageOf(state).locked.has(key(state.position)); }
// Enter commits to the active cell and steps down; Ctrl+Enter commits the same entry to every selected cell.
export function commitEdit(state, text, { all = false } = {}) {
  if (!playing(state)) return state;
  const stage = stageOf(state), value = parseInput(text);
  const targets = all ? rectCells(clampRect(stage, selectionRect(state))) : [state.position];
  if (lockedIn(stage, targets)) return state;
  const values = { ...state.values };
  for (const p of targets) {
    const v = shiftFormula(value, p.col - state.position.col, p.row - state.position.row);
    if (isBlank(v)) delete values[key(p)]; else values[key(p)] = v;
  }
  let s = change(state, values);
  if (s.phase !== 'playing' || all) return s;
  const below = { col: s.position.col, row: s.position.row + 1 };
  return isFloor(stage, below) ? arrive(stage, s, below, false) : s;
}
// Ctrl+D / Ctrl+R: the first row (column) of the selection fills the rest. With one row selected, the cell above fills it.
export function fill(state, dir) {
  if (!playing(state)) return state;
  const stage = stageOf(state), r = clampRect(stage, selectionRect(state)), down = dir === 'down';
  const single = down ? r.r1 === r.r2 : r.c1 === r.c2;
  if (single && (down ? r.r1 === 1 : r.c1 === 1)) return state;
  const targets = rectCells(r).filter(p => single || (down ? p.row !== r.r1 : p.col !== r.c1));
  if (lockedIn(stage, targets)) return state;
  const values = { ...state.values }, formats = { ...state.formats };
  for (const p of targets) {
    const src = down ? { col: p.col, row: single ? r.r1 - 1 : r.r1 } : { col: single ? r.c1 - 1 : r.c1, row: p.row };
    const v = shiftFormula(state.values[key(src)], p.col - src.col, p.row - src.row), f = state.formats[key(src)];
    if (isBlank(v)) delete values[key(p)]; else values[key(p)] = v;
    if (f) formats[key(p)] = f; else delete formats[key(p)];
  }
  return change(state, values, formats);
}
// Undo restores the last edit's cells. It never brings back walking, deaths, or world latches that already moved.
export function undo(state) {
  if (!playing(state) || !state.history.length) return state;
  const last = state.history[state.history.length - 1];
  return settle(stageOf(state), { ...state, values: last.values, formats: last.formats, history: state.history.slice(0, -1) }, { values: true });
}
function formatSelection(state, apply) {
  if (!playing(state)) return state;
  const stage = stageOf(state), cells = rectCells(clampRect(stage, selectionRect(state)));
  const formats = { ...state.formats };
  for (const p of cells) { const next = apply(formats[key(p)] || {}); if (Object.keys(next).length) formats[key(p)] = Object.freeze(next); else delete formats[key(p)]; }
  return change(state, state.values, formats);
}
export const numberFormat = state => formatSelection(state, f => ({ ...f, numFmt: '#,##0.00' }));
export function toggleBold(state) {
  const on = !state.formats[key(state.position)]?.bold;
  return formatSelection(state, f => { const n = { ...f }; if (on) n.bold = true; else delete n.bold; return n; });
}

// ---- find, replace, go to ----
export function findNext(state, text) {
  const q = text.trim().toLowerCase(); if (!q) return null;
  const order = Object.keys(state.values).map(fromKey).filter(p => !isBlank(state.values[key(p)]))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  const after = order.filter(p => p.row > state.position.row || (p.row === state.position.row && p.col > state.position.col));
  return [...after, ...order].find(p => displayValue(state, p).toLowerCase().includes(q)) || null;
}
// With a range selected, only that range is touched; otherwise the whole sheet. Partial matches count, like Excel's default.
export function replaceAll(state, find, replacement) {
  if (!playing(state) || !find) return { state, count: 0 };
  const stage = stageOf(state), rect = selectionRect(state), ranged = rect.c1 !== rect.c2 || rect.r1 !== rect.r2;
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), values = { ...state.values };
  let count = 0;
  for (const [k, v] of Object.entries(state.values)) {
    if (typeof v !== 'string' || (ranged && !inRect(rect, fromKey(k))) || stage.locked.has(k)) continue;
    const next = v.replace(pattern, () => { count++; return replacement; });
    if (next !== v) values[k] = next;
  }
  return count ? { state: change(state, values), count } : { state, count };
}
export const parseRef = text => parseCell(text);

// ---- dialogs, filter, sheets ----
// The confirm panel: OK carries out what it asks (and that is the trap); cancel just closes it.
export function answerConfirm(state, ok) {
  if (state.phase !== 'playing' || state.panel?.kind !== 'confirm') return state;
  const stage = stageOf(state);
  if (!ok) return { ...state, panel: null };
  const values = { ...state.values }; delete values[key(stage.confirm.clears)];
  return fail({ ...state, values, panel: null }, stage.confirm.type, state.position);
}
export function toggleFilter(state) {
  const F = stageOf(state).filter;
  if (!playing(state) || !F) return state;
  if (state.filter) return { ...state, filter: null, hidden: [] };
  return F.cells.some(p => same(p, state.position)) ? { ...state, filter: { allowed: null } } : state;
}
export function filterChoices(state) {
  const F = stageOf(state).filter;
  return [...new Set(F.cells.slice(1).map(p => displayValue(state, p)))];
}
// Filtering hides rows; it never deletes them.
export function applyFilter(state, allowed) {
  const F = stageOf(state).filter;
  if (!playing(state) || !F || !state.filter) return state;
  const all = filterChoices(state), keep = all.every(v => allowed.includes(v)) ? null : allowed;
  const hidden = keep ? F.cells.slice(1).filter(p => !keep.includes(displayValue(state, p))).map(p => p.row) : [];
  return { ...state, filter: { allowed: keep }, hidden };
}
// Shift+F11 inserts a sheet and moves there, to its A1. Rooms without one ignore it.
export function newSheet(state) {
  if (!playing(state) || state.sheet === 'new' || !stageOf(state).sheet) return state;
  const sheet = stageOf(state).sheet;
  return { ...state, sheet: 'new', values: { ...sheet.values }, formats: {}, clipboard: null, history: [], filter: null, hidden: [], sel: null,
    previous: state.position, position: { ...sheet.start }, selectionEnd: { ...sheet.start } };
}
