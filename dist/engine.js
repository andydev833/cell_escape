import { STAGE_DEFS } from './stages.js';

// Stage data is the single source for rules and drawing: app.js reads the same compiled stages.
const VISIBLE = { cols: 14, rows: 8 };
export const key = p => `${p.col},${p.row}`;
const same = (a, b) => a.col === b.col && a.row === b.row;
export function parseCell(a1) {
  const m = /^([A-Z]+)(\d+)$/.exec(a1);
  let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { col, row: Number(m[2]) };
}
export function cellsOf(ref) {
  if (Array.isArray(ref)) return ref.flatMap(cellsOf);
  const [a, b = a] = ref.split(':'), p = parseCell(a), q = parseCell(b), out = [];
  for (let row = Math.min(p.row, q.row); row <= Math.max(p.row, q.row); row++)
    for (let col = Math.min(p.col, q.col); col <= Math.max(p.col, q.col); col++) out.push({ col, row });
  return out;
}
function compile(def, index) {
  const values = {};
  for (const [ref, value] of def.values) for (const p of cellsOf(ref)) values[key(p)] = value;
  const traps = new Map();
  for (const t of def.traps || []) for (const p of cellsOf(t.cells)) traps.set(key(p), Object.freeze({ ...t, cells: undefined }));
  return Object.freeze({
    ...def, index, number: index + 1, visibleCols: VISIBLE.cols, visibleRows: VISIBLE.rows,
    start: parseCell(def.start), exit: parseCell(def.exit),
    floor: new Set(def.floor.flatMap(cellsOf).map(key)),
    values: Object.freeze(values), traps,
    devices: Object.freeze((def.devices || []).map(d => Object.freeze({ ...d, cells: cellsOf(d.cells) }))),
    rules: Object.freeze(def.rules || []),
    shelf: def.shelf ? parseCell(def.shelf) : null,
  });
}
export const STAGES = Object.freeze(STAGE_DEFS.map(compile));
export const stageOf = state => STAGES[state.stage];

export const isBlank = v => v === undefined || v === null || v === '';
export const tokenOf = v => (v && typeof v === 'object' ? v.token : null);
export const countTokens = (values, token) => Object.values(values).filter(v => tokenOf(v) === token).length;
export const isFloor = (stage, p) => stage.floor.has(key(p));
const inGrid = (stage, p) => p.col >= 1 && p.row >= 1 && p.col <= stage.visibleCols && p.row <= stage.visibleRows;
export function selectionRect(state) {
  const a = state.position, b = state.selectionEnd;
  return { c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row), c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row) };
}
export const inRect = (r, p) => p.col >= r.c1 && p.col <= r.c2 && p.row >= r.r1 && p.row <= r.r2;

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
export const exitOpen = (stage, state) => !stage.exitNeeds || deviceStatus(stage, state)[stage.exitNeeds].satisfied;
export function activeTrap(stage, state, p) {
  const t = stage.traps.get(key(p));
  return t && !(t.disarmedBy && state.solved[t.disarmedBy]) ? t : null;
}

export function createState(stage = 0, deaths = 0) {
  const s = STAGES[stage];
  return { stage, phase: 'ready', position: { ...s.start }, previous: { ...s.start }, selectionEnd: { ...s.start },
    values: { ...s.values }, clipboard: null, solved: {}, deaths, reason: null, trap: null, jump: false };
}
export function begin(state) { return { ...createState(state.stage, state.deaths), phase: 'playing' }; }
export function restart(state) { return begin(state); }
export function edge(position, dx, dy, values) {
  const has = (p) => !isBlank(values[key(p)]);
  let next = { col: position.col + dx, row: position.row + dy };
  if (has(position) && has(next)) {
    while (has({ col: next.col + dx, row: next.row + dy })) next = { col: next.col + dx, row: next.row + dy };
    return next;
  }
  const candidates = Object.keys(values).map(k => {
    const [col, row] = k.split(',').map(Number); return { col, row };
  }).filter(p => has(p) && (dx ? p.row === position.row && (p.col - position.col) * dx > 0 : p.col === position.col && (p.row - position.row) * dy > 0));
  candidates.sort((a,b) => (Math.abs(a.col-position.col)+Math.abs(a.row-position.row))-(Math.abs(b.col-position.col)+Math.abs(b.row-position.row)));
  return candidates[0] || { col: dx ? (dx > 0 ? 16384 : 1) : position.col, row: dy ? (dy > 0 ? 1048576 : 1) : position.row };
}
const fail = (s, type, p) => ({ ...s, phase: 'failed', deaths: s.deaths + 1, reason: type, trap: { ...p, type } });

// Only the landing cell counts: cells passed over by a jump never fire.
// Walls (anything without floor) leave the state untouched — no move, no death.
export function move(state, dx, dy, jump = false) {
  if (state.phase !== 'playing' || Math.abs(dx) + Math.abs(dy) !== 1) return state;
  const stage = stageOf(state);
  const target = jump ? edge(state.position, dx, dy, state.values) : { col: state.position.col + dx, row: state.position.row + dy };
  if (same(target, state.position) || !isFloor(stage, target)) return state;
  const s = { ...state, previous: state.position, position: target, selectionEnd: target, jump };
  if (same(target, stage.exit)) return exitOpen(stage, s) ? { ...s, phase: 'won' } : fail(s, stage.exitTrap, target);
  const trap = activeTrap(stage, s, target);
  return trap ? fail(s, trap.type, target) : s;
}
// Shift(+Ctrl)+arrow grows the selection from its far corner. The character (active cell) stays put.
export function extend(state, dx, dy, jump = false) {
  if (state.phase !== 'playing' || Math.abs(dx) + Math.abs(dy) !== 1) return state;
  const stage = stageOf(state), from = state.selectionEnd;
  const end = jump ? edge(from, dx, dy, state.values) : { col: from.col + dx, row: from.row + dy };
  if (same(end, from) || !inGrid(stage, end)) return state;
  const s = { ...state, selectionEnd: end }, rect = selectionRect(s);
  let solved = s.solved;
  // Once every plate sat inside one selection the device stays solved, even after the selection shrinks.
  for (const d of stage.devices) if (d.kind === 'selectAll' && !solved[d.id] && d.cells.every(c => inRect(rect, c))) solved = { ...solved, [d.id]: true };
  return solved === s.solved ? s : { ...s, solved };
}
export function copy(state, mode = 'copy') {
  if (state.phase !== 'playing') return state;
  const rect = selectionRect(state), cells = [];
  for (let row = rect.r1; row <= rect.r2; row++) for (let col = rect.c1; col <= rect.c2; col++)
    cells.push({ dc: col - rect.c1, dr: row - rect.r1, value: state.values[key({ col, row })] });
  return { ...state, clipboard: { mode, rect, cells } };
}
export const cut = state => copy(state, 'cut');
export function cancelClipboard(state) { return state.clipboard ? { ...state, clipboard: null } : state; }
// Source and destination change together in one step, so a cut never counts as two keys mid-way.
export function paste(state) {
  if (state.phase !== 'playing' || !state.clipboard) return state;
  const stage = stageOf(state), { mode, rect, cells } = state.clipboard, at = state.position;
  const w = rect.c2 - rect.c1, h = rect.r2 - rect.r1;
  if (!inGrid(stage, { col: at.col + w, row: at.row + h })) return state;
  const values = { ...state.values };
  if (mode === 'cut') for (const c of cells) delete values[key({ col: rect.c1 + c.dc, row: rect.r1 + c.dr })];
  for (const c of cells) {
    const k = key({ col: at.col + c.dc, row: at.row + c.dr });
    if (isBlank(c.value)) delete values[k]; else values[k] = c.value;
  }
  const s = { ...state, values, clipboard: mode === 'cut' ? null : state.clipboard,
    selectionEnd: { col: at.col + w, row: at.row + h } };
  for (const rule of stage.rules) if (rule.kind === 'tokenLimit' && countTokens(values, rule.token) > rule.limit) return fail(s, rule.type, at);
  return s;
}
export function cellName(p) {
  let c = p.col, name = ''; while(c > 0) { c--; name = String.fromCharCode(65 + c % 26) + name; c = Math.floor(c / 26); }
  return name + p.row;
}
