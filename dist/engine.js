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
    unlocked: def.unlocked ? new Set(cellsOf(def.unlocked).map(key)) : null,
    colWidths: Object.freeze(Object.fromEntries(Object.entries(def.colWidths || {}).map(([c, w]) => [parseCell(c + '1').col, w]))),
    hiddenRows: Object.freeze(def.hiddenRows || []), hiddenCols: Object.freeze((def.hiddenCols || []).map(c => parseCell(c + '1').col)),
    events: Object.freeze((def.events || []).map(e => Object.freeze({ ...e, at: parseCell(e.at) }))),
    cache: Object.freeze(def.cache ? Object.fromEntries(def.cache.map(([ref, v]) => [key(parseCell(ref)), v])) : {}),
  });
}
// A room's new sheet (Shift+F11) is compiled like a room of its own, sharing the room's title and hints.
// Workbook rooms (`sheets`) compile each sheet like a room of its own; the first sheet is the room itself.
const EMPTY = { values: [], formats: [], notes: [], traps: [], devices: [], rules: [], latches: [], selectHazards: [], decor: [], indicators: [], ghosts: [], events: [], newSheet: undefined, sheets: undefined, door: undefined, exitNeeds: undefined, exit: undefined, unlocked: undefined, locked: [], hiddenRows: [], hiddenCols: [], colWidths: {}, cache: undefined, filter: undefined, confirm: undefined, bulbs: undefined, sockets: undefined, shelf: undefined };
const withSheet = (def, index) => {
  const stage = compile(def, index);
  const extra = {};
  if (def.newSheet) extra.sheet = compile({ ...def, ...EMPTY, ...def.newSheet }, index);
  if (def.sheets) extra.sheetList = Object.freeze([stage, ...def.sheets.map(sh => compile({ ...def, ...EMPTY, calc: def.calc, ...sh }, index))]);
  return Object.keys(extra).length ? Object.freeze({ ...stage, ...extra }) : stage;
};
export const STAGES = Object.freeze(STAGE_DEFS.map(withSheet));
export const rootOf = state => STAGES[state.stage];
export function stageOf(state) {
  const root = STAGES[state.stage];
  if (state.sheet === 'new') return root.sheet;
  return root.sheetList ? root.sheetList[state.sheetIdx || 0] : root;
}
export const sheetNames = state => (rootOf(state).sheetList || [rootOf(state)]).map(sh => sh.sheetName || 'Sheet1');

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
    const fn = /^SUM\(/.exec(src.slice(i));
    if (fn) {
      i += 4; let total = 0;
      for (;;) {
        skip();
        const range = /^(\$?[A-Z]{1,3}\$?\d{1,7})(:(\$?[A-Z]{1,3}\$?\d{1,7}))?/.exec(src.slice(i));
        if (range) { i += range[0].length; for (const p of cellsOf(range[1].replace(/\$/g, '') + (range[3] ? ':' + range[3].replace(/\$/g, '') : ''))) { const v = values[key(p)]; total += typeof v === 'number' || isFormula(v) ? evaluate(values, v, depth + 1) : 0; } }
        else total += sum();
        skip(); if (peek() === ',') { i++; continue; } if (peek() === ')') { i++; break; } i = src.length; return NaN;
      }
      return total;
    }
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
// Every cell a formula reads, with ranges expanded.
export function formulaRefs(v) {
  if (!isFormula(v)) return [];
  const out = [], re = /(\$?[A-Z]{1,3}\$?\d{1,7})(:(\$?[A-Z]{1,3}\$?\d{1,7}))?/g; let m;
  while ((m = re.exec(v.f.slice(1)))) { if (/^SUM$/.test(m[1])) continue; out.push(...cellsOf(m[1].replace(/\$/g, '') + (m[3] ? ':' + m[3].replace(/\$/g, '') : ''))); }
  return out;
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
// Dates are day numbers counted like a spreadsheet's (1899-12-30 is day 0), shown with a date format.
export const DATE_FMT = 'yyyy/mm/dd';
export const dateSerial = d => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
export const serialText = n => { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
export function formatNumber(n, fmt) {
  if (Number.isNaN(n)) return '#VALUE!';
  if (fmt === DATE_FMT) return serialText(n);
  if (fmt === '#,##0.00') return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(Math.round(n * 1e9) / 1e9);
}
// Manual calculation keeps the last computed result of each formula until F9 (or until that cell is re-entered).
export function valueOf(state, p) {
  const k = key(p), v = state.values[k];
  if (isFormula(v) && state.cache && k in state.cache) return state.cache[k];
  return evaluate(state.values, v);
}
export function displayValue(state, p) {
  const k = key(p), v = state.values[k], fmt = state.formats[k]?.numFmt;
  if (isBlank(v)) return '';
  if (tokenOf(v)) return v.id || v.token.toUpperCase();
  if (isFormula(v) && state.showFormulas) return v.f;
  if (isFormula(v) || typeof v === 'number') return formatNumber(valueOf(state, p), fmt);
  return String(v);
}
export const rawText = v => isBlank(v) ? '' : isFormula(v) ? v.f : tokenOf(v) ? (v.id || v.token.toUpperCase()) : String(v);
function parseInput(text) {
  if (text === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(text.trim())) return Number(text);
  if (text.startsWith('=')) return { f: text.toUpperCase() };
  const d = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text.trim());
  if (d) return { date: dateSerial(new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]))) };
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
export const hiddenSet = state => new Set([...(state.hidden || []), ...(state.hiddenRows || [])]);
export const hiddenColSet = state => new Set(state.hiddenCols || []);
// Every selected area: the areas kept with Shift+F8, plus the one being made now.
export const selectionAreas = state => [...(state.areas || []), selectionRect(state)];
const inAreas = (areas, p) => areas.some(r => inRect(r, p));
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
  const keys = [...Object.keys(state.values).filter(k => !isBlank(state.values[k])), ...Object.keys(state.formats).filter(k => Object.keys(state.formats[k]).length)];
  if (!keys.length) return null;
  const ps = keys.map(fromKey);
  return { c1: Math.min(...ps.map(p => p.col)), r1: Math.min(...ps.map(p => p.row)), c2: Math.max(...ps.map(p => p.col)), r2: Math.max(...ps.map(p => p.row)) };
}

// ---- conditions ----
const valueAt = (s, c) => s.values[key(parseCell(c))];
// Cells on another sheet of the workbook: the stored copy, or that sheet's starting contents.
function sheetView(s, name) {
  const root = STAGES[s.stage], list = root.sheetList || [root];
  const idx = name === undefined ? (s.sheetIdx || 0) : list.findIndex(sh => (sh.sheetName || 'Sheet1') === name);
  if (idx < 0) return { values: {}, formats: {}, cache: {} };
  if (idx === (s.sheetIdx || 0) && s.sheet !== 'detached') return s;
  return s.store?.[idx] || { values: list[idx].values, formats: list[idx].formats, cache: list[idx].cache };
}
function resolve(s, at) {
  const [name, ref] = at.includes('!') ? at.split('!') : [undefined, at];
  const view = sheetView(s, name), k = key(parseCell(ref));
  return { view, k, v: view.values[k], f: view.formats[k] || {} };
}
// One small vocabulary for exits, traps, rules, latches and indicator lamps.
export function test(stage, s, c) {
  if (c === undefined || c === null) return true;
  if (c.saved) { const snap = s.saved?.[c.saved.book]; return !!snap && test(stage, { ...s, sheet: 'detached', store: snap.store }, c.saved.cond); }
  if (c.book) return s.book === c.book;
  if (c.solved) return !!s.solved[c.solved];
  if (c.here) return same(s.position, parseCell(c.here));
  if (c.clean) return !s.dirty;
  if (c.blank) return isBlank(resolve(s, c.blank).v);
  if (c.rowHidden !== undefined) return hiddenSet(s).has(c.rowHidden) === (c.is !== false);
  if (c.colHidden) return hiddenColSet(s).has(parseCell(c.colHidden + '1').col) === (c.is !== false);
  if (c.table) { const r = rangeOf(c.table.range); return (s.tables || []).length === 1 && s.tables.some(t => sameRect(t.range, r) && t.headers === c.table.headers); }
  if (c.tableIncludes) return (s.tables || []).some(t => inRect(t.range, parseCell(c.tableIncludes)));
  if (c.embedded) { const r = rangeOf(c.embedded); return (s.charts || []).some(ch => sameRect(ch.range, r)); }
  if (c.charts) { const r = rangeOf(c.charts); return (s.charts || []).some(ch => sameRect(ch.range, r)) && (s.chartSheets || []).some(ch => sameRect(ch.range, r)); }
  if (c.flash) return cellsOf(c.flash.cells).every((p, i) => resolve(s, cellName(p)).v === c.flash.expect[i]);
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
  const r = c.at ? resolve(s, c.at) : { v: undefined, f: {} }, v = r.v, f = r.f;
  if ('computed' in c) return isFormula(v) && valueOf(r.view, fromKey(r.k)) === c.computed;
  if ('formula' in c) return isFormula(v) && v.f === c.formula;
  if ('sumOf' in c) {
    if (!isFormula(v)) return false;
    const cells = cellsOf(c.sumOf), refs = formulaRefs(v).map(key);
    const total = cells.reduce((t, p) => t + (Number(r.view.values[key(p)]) || 0), 0);
    return cells.every(p => refs.includes(key(p))) && valueOf(r.view, fromKey(r.k)) === total;
  }
  if ('today' in c) return typeof v === 'number' && v === s.today;
  if ('style' in c) return ['bold', 'italic', 'underline', 'strike'].every(prop => !!f[prop] === !!c.style[prop]);
  if ('width' in c) return widthOf(s, parseCell(c.at).col) === c.width;
  if ('token' in c) return tokenOf(v) === c.token;
  if ('equals' in c) return v === c.equals;
  if ('contains' in c) return typeof v === 'string' && v.includes(c.contains);
  if ('fill' in c) return (f.fill || null) === c.fill;
  if ('bold' in c) return !!f.bold === c.bold;
  if ('numFmt' in c) return f.numFmt === c.numFmt;
  return false;
}
// Tokens across every sheet of the workbook (a key copied to another sheet is still a second key).
export function countBookTokens(s, token) {
  const root = STAGES[s.stage], list = root.sheetList || [root];
  return list.reduce((n, _, i) => n + countTokens(i === (s.sheetIdx || 0) ? s.values : (s.store?.[i]?.values || list[i].values), token), 0);
}
export const rangeOf = ref => { const cs = cellsOf(ref); return { c1: cs[0].col, r1: cs[0].row, c2: cs[cs.length - 1].col, r2: cs[cs.length - 1].row }; };
const sameRect = (a, b) => a.c1 === b.c1 && a.r1 === b.r1 && a.c2 === b.c2 && a.r2 === b.r2;
export const DEFAULT_WIDTH = 8;
export const widthOf = (s, col) => hiddenColSet(s).has(col) ? 0 : (s.colWidths?.[col] ?? DEFAULT_WIDTH);
// What each device shows right now: one lamp per device cell, and whether it is satisfied.
export function deviceStatus(stage, state) {
  const out = {};
  for (const d of stage.devices) {
    if (d.kind === 'selectAll') {
      const areas = selectionAreas(state), held = !!state.solved[d.id];
      out[d.id] = { satisfied: held, lit: d.cells.map(c => held || inAreas(areas, c)) };
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
// The parts of the state that belong to one sheet; switching sheets stores and restores them.
const SHEET_FIELDS = ['values', 'formats', 'position', 'previous', 'selectionEnd', 'sel', 'areas', 'hidden', 'hiddenRows', 'hiddenCols', 'colWidths', 'history', 'redo', 'cache', 'filter', 'tables', 'charts'];
function freshSheet(sh) {
  const cache = { ...sh.cache };
  if (sh.calc === 'manual') for (const [k, v] of Object.entries(sh.values)) if (isFormula(v) && !(k in cache)) cache[k] = evaluate(sh.values, v);
  return { values: { ...sh.values }, formats: { ...sh.formats }, position: { ...sh.start }, previous: { ...sh.start }, selectionEnd: { ...sh.start }, sel: null, areas: [],
    hidden: [], hiddenRows: [...sh.hiddenRows], hiddenCols: [...sh.hiddenCols], colWidths: { ...sh.colWidths }, history: [], redo: [], cache: sh.calc === 'manual' ? cache : null, filter: null, tables: [], charts: [] };
}
const pickSheet = s => Object.fromEntries(SHEET_FIELDS.map(f => [f, s[f]]));
const snapshot = s => ({ store: { ...(s.store || {}), [s.sheetIdx || 0]: pickSheet(s) } });
export function createState(stage = 0, deaths = 0, today = dateSerial(new Date())) {
  const s = STAGES[stage];
  const base = { stage, phase: 'ready', ...freshSheet(s), clipboard: null, solved: {}, latches: {}, fired: {},
    panel: null, mode: null, showFormulas: false, sheet: 'main', sheetIdx: 0, store: {}, order: (s.sheetList || [s]).map((_, i) => i), chartSheets: [], chartView: null,
    book: s.book || null, saved: {}, dirty: false, today, deaths, reason: null, trap: null, jump: false };
  // Dates on the wall are set relative to the attempt's own today.
  for (const [ref, offset] of s.dateValues || []) { const k = key(parseCell(ref)); base.values[k] = today + offset; base.formats[k] = Object.freeze({ numFmt: DATE_FMT }); }
  // Some workbooks open on a later sheet; the others wait in the store untouched.
  if (s.startSheet) Object.assign(base, freshSheet(s.sheetList[s.startSheet]), { sheetIdx: s.startSheet });
  // A workbook room starts from an already-saved original.
  if (s.book) base.saved = { [s.book]: snapshot(base) };
  return base;
}
export function begin(state) { return { ...createState(state.stage, state.deaths, state.today), phase: 'playing' }; }
export function restart(state) { return begin(state); }
const playing = s => s.phase === 'playing' && !s.panel;
const fail = (s, type, p) => ({ ...s, phase: 'failed', panel: null, deaths: s.deaths + 1, reason: type, trap: { ...p, type } });

// After every action: latches, then selection devices and hazards, then value rules.
function settle(stage, s, { values = false, selection = false } = {}) {
  let latches = s.latches;
  for (const l of stage.latches) if (!latches[l.id] && test(stage, s, l.when)) latches = { ...latches, [l.id]: true };
  if (latches !== s.latches) s = { ...s, latches };
  if (selection) {
    const areas = selectionAreas(s);
    for (const h of stage.selectHazards) if (h.cells.some(c => inAreas(areas, c))) return fail(s, h.type, s.position);
    let solved = s.solved;
    // Once every plate sat inside the selection the device stays solved, even after the selection shrinks.
    for (const d of stage.devices) if (d.kind === 'selectAll' && !solved[d.id] && d.cells.every(c => inAreas(areas, c))) solved = { ...solved, [d.id]: true };
    if (solved !== s.solved) s = { ...s, solved };
  }
  if (values) for (const rule of stage.rules) {
    const hit = rule.kind === 'tokenLimit' ? countTokens(s.values, rule.token) > rule.limit
      : rule.kind === 'bookTokenLimit' ? countBookTokens(s, rule.token) > rule.limit : test(stage, s, rule.when);
    if (hit) return fail(s, rule.type, s.position);
  }
  return s;
}
// Landing on a cell. Only the landing cell counts: cells passed over by a jump never fire.
function arrive(stage, state, target, jump) {
  if (state.chartView !== null && state.chartView !== undefined) return state;
  if (same(target, state.position) || !isFloor(stage, target) || hiddenSet(state).has(target.row) || hiddenColSet(state).has(target.col)) return state;
  let s = { ...state, previous: state.position, position: target, selectionEnd: target, sel: null, areas: state.mode === 'add' ? state.areas : [], jump };
  // Floor events (a weight dropping, say) change the sheet once per attempt. They are the world, not an edit.
  for (const e of stage.events) if (same(e.at, target) && !s.fired[key(e.at)]) {
    const values = { ...s.values }; for (const [ref, v] of e.set) values[key(parseCell(ref))] = v;
    s = { ...s, values, fired: { ...s.fired, [key(e.at)]: true } };
  }
  // An exit without a trap is simply shut until its condition holds.
  if (stage.exit && same(target, stage.exit)) return exitOpen(stage, s) ? { ...s, phase: 'won' } : stage.exitTrap ? fail(s, stage.exitTrap, target) : state;
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
  const stage = stageOf(state), hidden = hiddenSet(state), hiddenCols = hiddenColSet(state);
  let target;
  if (jump) target = edge(state.position, dx, dy, state.values);
  else {
    target = { col: state.position.col + dx, row: state.position.row + dy };
    while (dy && hidden.has(target.row)) target = { ...target, row: target.row + dy };
    while (dx && hiddenCols.has(target.col)) target = { ...target, col: target.col + dx };
  }
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
  // Whole columns (or rows) stay whole while they are widened.
  const sel = state.sel, a = state.position;
  if (sel && sel.r1 === 1 && sel.r2 === MAX_ROW && dx) return settle(stage, { ...state, selectionEnd: end, sel: { ...sel, c1: Math.min(a.col, end.col), c2: Math.max(a.col, end.col) } }, { selection: true });
  if (sel && sel.c1 === 1 && sel.c2 === MAX_COL && dy) return settle(stage, { ...state, selectionEnd: end, sel: { ...sel, r1: Math.min(a.row, end.row), r2: Math.max(a.row, end.row) } }, { selection: true });
  return settle(stage, { ...state, selectionEnd: end, sel: null }, { selection: true });
}
// Ctrl+Shift+Home / Ctrl+Shift+End: from the active cell to A1, or to the end of the used range.
export function selectTo(state, where) {
  if (!playing(state)) return state;
  const r = usedRange(state), end = where === 'home' ? { col: 1, row: 1 } : r ? { col: r.c2, row: r.r2 } : null;
  if (!end) return state;
  return settle(stageOf(state), { ...state, selectionEnd: end, sel: null }, { selection: true });
}
// F8 extends with plain arrows; Shift+F8 keeps what is selected and lets another area be added.
export function toggleExtend(state) { return playing(state) ? { ...state, mode: state.mode === 'extend' ? null : 'extend' } : state; }
export function toggleAdd(state) {
  if (!playing(state)) return state;
  if (state.mode === 'add') return { ...state, mode: null };
  return { ...state, mode: 'add', areas: [...(state.areas || []), selectionRect(state)], sel: null, selectionEnd: state.position };
}
export function clearModes(state) { return state.mode || (state.areas || []).length ? { ...state, mode: null, areas: [] } : state; }
const select = (state, sel) => playing(state) ? settle(stageOf(state), { ...state, sel, selectionEnd: state.position, areas: state.mode === 'add' ? state.areas : [] }, { selection: true }) : state;
export const selectColumn = s => select(s, { c1: s.position.col, c2: s.position.col, r1: 1, r2: MAX_ROW });
export const selectRow = s => select(s, { c1: 1, c2: MAX_COL, r1: s.position.row, r2: s.position.row });
// Ctrl+A: the current region first; pressed again (or from an empty spot), the whole sheet.
export function selectRegion(s) {
  const region = currentRegion(s, s.position), now = selectionRect(s);
  const isRegion = region && now.c1 === region.c1 && now.c2 === region.c2 && now.r1 === region.r1 && now.r2 === region.r2;
  return select(s, region && !isRegion ? region : { c1: 1, r1: 1, c2: MAX_COL, r2: MAX_ROW });
}

// ---- editing (every value change goes through here so Undo and the rules see it) ----
// A protected sheet only lets its unlocked cells be typed into; `noType` rooms refuse typing and pasting altogether.
const isLocked = (stage, p) => stage.locked.has(key(p)) || (!!stage.unlocked && !stage.unlocked.has(key(p)));
const lockedIn = (stage, cells) => cells.some(p => isLocked(stage, p));
function change(state, values, formats = state.formats, extra = {}) {
  const history = [...state.history, { values: state.values, formats: state.formats }].slice(-30);
  let cache = state.cache;
  // Manual calculation: a formula entered just now is worked out once; everything else keeps its old result.
  if (cache) { cache = { ...cache }; for (const [k, v] of Object.entries(values)) if (isFormula(v) && v !== state.values[k] && !extra.keepCache?.includes(k)) cache[k] = evaluate(values, v); for (const k of Object.keys(cache)) if (!isFormula(values[k])) delete cache[k]; }
  const { keepCache, ...rest } = extra;
  return settle(stageOf(state), { ...state, values, formats, history, redo: [], dirty: true, cache, ...rest }, { values: true });
}
export function copy(state, mode = 'copy') {
  if (!playing(state)) return state;
  const rect = clampRect(stageOf(state), selectionRect(state)), cells = [];
  for (const p of rectCells(rect)) cells.push({ dc: p.col - rect.c1, dr: p.row - rect.r1, value: state.values[key(p)], format: state.formats[key(p)] });
  // A copied formula remembers the result it showed, for pasting into a sheet that calculates by hand.
  const cache = cells.map(c => { const p = { col: rect.c1 + c.dc, row: rect.r1 + c.dr }; return isFormula(state.values[key(p)]) ? valueOf(state, p) : undefined; });
  const widths = []; for (let c = rect.c1; c <= rect.c2; c++) widths.push(widthOf(state, c));
  return { ...state, clipboard: { mode, rect, widths, cells: cells.map((c, i) => ({ ...c, cached: cache[i] })), sheetIdx: state.sheetIdx || 0 } };
}
export const cut = state => copy(state, 'cut');
export function cancelClipboard(state) { return state.clipboard ? { ...state, clipboard: null } : state; }
// Source and destination change together in one step, so a cut never counts as two keys mid-way.
// `only: 'values'` keeps the destination's own formats (paste special → values).
// Paste special picks parts: 'values', 'formulas', 'formats' or 'widths' (column widths only).
export function paste(state, only = 'all') {
  if (!playing(state) || !state.clipboard) return state;
  const stage = stageOf(state), { mode, rect, cells } = state.clipboard, at = state.position;
  if (only !== 'all' && mode === 'cut') return state;
  if (stage.noType && only !== 'widths' && only !== 'formats') return state;
  const w = rect.c2 - rect.c1, h = rect.r2 - rect.r1;
  const dest = cells.map(c => ({ col: at.col + c.dc, row: at.row + c.dr }));
  if (!inGrid(stage, { col: at.col + w, row: at.row + h })) return state;
  if (only === 'widths') {
    const colWidths = { ...state.colWidths };
    for (let c = 0; c <= w; c++) colWidths[at.col + c] = state.clipboard.widths?.[c] ?? widthOf(state, rect.c1 + c);
    return { ...state, colWidths, dirty: true };
  }
  if (only !== 'formats' && lockedIn(stage, dest)) return state;
  let values = { ...state.values }, formats = { ...state.formats }, store = state.store;
  if (mode === 'cut') {
    const src = state.clipboard.sheetIdx || 0;
    if (src === (state.sheetIdx || 0)) for (const c of cells) { const k = key({ col: rect.c1 + c.dc, row: rect.r1 + c.dr }); delete values[k]; delete formats[k]; }
    else {
      // A cut from another sheet empties the source there, in the same step.
      const other = store[src] || freshSheet((rootOf(state).sheetList || [])[src]), ov = { ...other.values }, of = { ...other.formats };
      for (const c of cells) { const k = key({ col: rect.c1 + c.dc, row: rect.r1 + c.dr }); delete ov[k]; delete of[k]; }
      store = { ...store, [src]: { ...other, values: ov, formats: of } };
    }
  }
  const keepCache = [], cache = state.cache ? { ...state.cache } : null;
  cells.forEach((c, i) => {
    const k = key(dest[i]);
    if (only !== 'formats') {
      const v = mode === 'cut' ? c.value : shiftFormula(c.value, at.col - rect.c1, at.row - rect.r1);
      if (isBlank(v)) delete values[k]; else values[k] = v;
      // Pasted into a sheet that calculates by hand, a formula keeps the result it had until F9.
      if (cache && isFormula(v) && c.cached !== undefined) { cache[k] = c.cached; keepCache.push(k); }
    }
    if (only === 'all' || only === 'formats') { if (c.format) formats[k] = c.format; else delete formats[k]; }
  });
  return change({ ...state, cache, store }, values, formats, { clipboard: mode === 'cut' ? null : state.clipboard, sel: null, selectionEnd: { col: at.col + w, row: at.row + h }, keepCache });
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
export function canEdit(state) { const stage = stageOf(state); return playing(state) && !stage.noType && !isLocked(stage, state.position); }
// Enter commits to the active cell and steps down (Shift+Enter: up, Tab: on); Ctrl+Enter fills every selected cell.
export function commitEdit(state, text, { all = false, dir = 'down' } = {}) {
  if (!playing(state)) return state;
  const stage = stageOf(state), parsed = parseInput(text);
  if (stage.noType) return state;
  const targets = all ? rectCells(clampRect(stage, selectionRect(state))) : [state.position];
  if (lockedIn(stage, targets)) return state;
  const values = { ...state.values }, formats = { ...state.formats };
  const value = parsed && typeof parsed === 'object' && 'date' in parsed ? parsed.date : parsed;
  for (const p of targets) {
    const v = shiftFormula(value, p.col - state.position.col, p.row - state.position.row);
    if (isBlank(v)) delete values[key(p)]; else values[key(p)] = v;
    if (parsed && typeof parsed === 'object' && 'date' in parsed) formats[key(p)] = Object.freeze({ ...(formats[key(p)] || {}), numFmt: DATE_FMT });
  }
  let s = change(state, values, formats);
  if (s.phase !== 'playing' || all || dir === 'none') return s;
  if (dir === 'tab' || dir === 'backtab') return tabMove(s, dir === 'tab' ? 1 : -1);
  const step = { down: [0, 1], up: [0, -1] }[dir], next = { col: s.position.col + step[0], row: s.position.row + step[1] };
  return isFloor(stage, next) ? arrive(stage, s, next, false) : s;
}
// Tab / Shift+Tab: on a protected sheet, the next (or previous) unlocked cell; elsewhere one cell right (left).
export function tabMove(state, dir = 1) {
  if (!playing(state)) return state;
  const stage = stageOf(state);
  if (!stage.unlocked) return move(state, dir, 0);
  const order = [...stage.unlocked].map(fromKey).sort((a, b) => a.row - b.row || a.col - b.col);
  const i = order.findIndex(p => same(p, state.position));
  const next = order[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + order.length) % order.length];
  return arrive(stage, state, next, true);
}
// Alt+= proposes a SUM over the numbers directly above (or, failing that, to the left).
export function autoSumText(state) {
  const p = state.position, num = q => { const v = state.values[key(q)]; return typeof v === 'number' || isFormula(v); };
  for (const [dc, dr] of [[0, -1], [-1, 0]]) {
    let q = { col: p.col + dc, row: p.row + dr }, first = null;
    while (q.col >= 1 && q.row >= 1 && num(q)) { first = q; q = { col: q.col + dc, row: q.row + dr }; }
    if (first) { const last = { col: p.col + dc, row: p.row + dr }; return `=SUM(${cellName(first)}:${cellName(last)})`; }
  }
  return '=SUM()';
}
// Ctrl+E: learn from the examples already typed in this column how the column to its left was cut, and fill the rest.
export function flashFill(state) {
  if (!playing(state) || stageOf(state).noType) return state;
  const col = state.position.col, src = col - 1;
  if (src < 1) return state;
  const rows = []; for (let r = 1; r <= stageOf(state).visibleRows; r++) if (!isBlank(state.values[key({ col: src, row: r })])) rows.push(r);
  const examples = rows.filter(r => typeof state.values[key({ col, row: r })] === 'string');
  if (!examples.length) return state;
  const rules = [];
  for (const d of ['-', '_', ' ', '|', '.', '@', '/']) {
    rules.push(t => t.includes(d) ? t.slice(t.lastIndexOf(d) + 1) : null, t => t.includes(d) ? t.slice(0, t.indexOf(d)) : null);
  }
  const rule = rules.find(fn => examples.every(r => fn(String(state.values[key({ col: src, row: r })])) === state.values[key({ col, row: r })]));
  if (!rule) return state;
  const values = { ...state.values };
  for (const r of rows) if (isBlank(values[key({ col, row: r })])) { const out = rule(String(values[key({ col: src, row: r })])); if (out) values[key({ col, row: r })] = out; }
  return change(state, values);
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
  const last = state.history[state.history.length - 1], redo = [...(state.redo || []), { values: state.values, formats: state.formats }];
  return settle(stageOf(state), { ...state, values: last.values, formats: last.formats, history: state.history.slice(0, -1), redo, dirty: true }, { values: true });
}
// Ctrl+Y puts back what Undo took away. Walking and selecting keep it; a new edit throws it away.
export function redo(state) {
  if (!playing(state) || !(state.redo || []).length) return state;
  const next = state.redo[state.redo.length - 1], history = [...state.history, { values: state.values, formats: state.formats }];
  return settle(stageOf(state), { ...state, values: next.values, formats: next.formats, history, redo: state.redo.slice(0, -1), dirty: true }, { values: true });
}
function formatSelection(state, apply) {
  if (!playing(state)) return state;
  const stage = stageOf(state), cells = rectCells(clampRect(stage, selectionRect(state)));
  const formats = { ...state.formats };
  for (const p of cells) { const next = apply(formats[key(p)] || {}); if (Object.keys(next).length) formats[key(p)] = Object.freeze(next); else delete formats[key(p)]; }
  return change(state, state.values, formats);
}
export const numberFormat = state => formatSelection(state, f => ({ ...f, numFmt: '#,##0.00' }));
export function toggleStyle(state, prop) {
  const on = !state.formats[key(state.position)]?.[prop];
  return formatSelection(state, f => { const n = { ...f }; if (on) n[prop] = true; else delete n[prop]; return n; });
}
export const toggleBold = state => toggleStyle(state, 'bold');
export const toggleFormulaView = state => playing(state) ? { ...state, showFormulas: !state.showFormulas } : state;
// F9: work every formula out again.
export function recalc(state) {
  if (!playing(state) || !state.cache) return state;
  const cache = {}; for (const [k, v] of Object.entries(state.values)) if (isFormula(v)) cache[k] = evaluate(state.values, v);
  return settle(stageOf(state), { ...state, cache }, { values: true });
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

// ---- cell structure: insert and delete shift the cells after them ----
function shiftCells(state, rect, dir, remove) {
  const move = (map) => {
    const out = {};
    for (const [k, v] of Object.entries(map)) {
      let p = fromKey(k);
      const rowsHit = p.row >= rect.r1 && p.row <= rect.r2, colsHit = p.col >= rect.c1 && p.col <= rect.c2;
      if (remove && rowsHit && colsHit) continue;
      const w = rect.c2 - rect.c1 + 1, h = rect.r2 - rect.r1 + 1;
      if (dir === 'right' && rowsHit && p.col >= rect.c1) p = { ...p, col: p.col + w };
      if (dir === 'down' && colsHit && p.row >= rect.r1) p = { ...p, row: p.row + h };
      if (dir === 'left' && rowsHit && p.col > rect.c2) p = { ...p, col: p.col - w };
      if (dir === 'up' && colsHit && p.row > rect.r2) p = { ...p, row: p.row - h };
      out[key(p)] = v;
    }
    return out;
  };
  return change(state, move(state.values), move(state.formats));
}
// Ctrl+Shift++ / Ctrl+-: whole rows or columns move as a block; otherwise the chosen direction decides.
export function insertCells(state, dir) {
  if (!playing(state)) return state;
  const r = selectionRect(state);
  if (r.c1 === 1 && r.c2 === MAX_COL) return shiftCells(state, r, 'down', false);
  if (r.r1 === 1 && r.r2 === MAX_ROW) return shiftCells(state, r, 'right', false);
  return shiftCells(state, clampRect(stageOf(state), r), dir === 'down' ? 'down' : 'right', false);
}
export function deleteCells(state, dir) {
  if (!playing(state)) return state;
  const r = selectionRect(state);
  if (r.c1 === 1 && r.c2 === MAX_COL) return shiftCells(state, r, 'up', true);
  if (r.r1 === 1 && r.r2 === MAX_ROW) return shiftCells(state, r, 'left', true);
  return shiftCells(state, clampRect(stageOf(state), r), dir === 'up' ? 'up' : 'left', true);
}
export const wholeRows = state => { const r = selectionRect(state); return r.c1 === 1 && r.c2 === MAX_COL; };
export const wholeCols = state => { const r = selectionRect(state); return r.r1 === 1 && r.r2 === MAX_ROW; };

// ---- tables and charts are objects on the sheet, with their own range ----
const dataRange = state => { const r = selectionRect(state); return r.c1 !== r.c2 || r.r1 !== r.r2 ? clampRect(stageOf(state), r) : currentRegion(state, state.position); };
export const tableRange = dataRange;
export function createTable(state, headers) {
  if (!playing(state)) return state;
  const range = dataRange(state);
  if (!range || (state.tables || []).some(t => t.range.c1 <= range.c2 && range.c1 <= t.range.c2 && t.range.r1 <= range.r2 && range.r1 <= t.range.r2)) return state;
  return settle(stageOf(state), { ...state, tables: [...(state.tables || []), { range, headers }], dirty: true }, { values: true });
}
// Alt+F1 embeds a chart in the sheet; F11 makes a chart sheet of its own and shows it.
export function addChart(state, kind) {
  if (!playing(state)) return state;
  const range = dataRange(state);
  if (!range) return state;
  if (kind === 'embedded') return { ...state, charts: [...(state.charts || []), { range }], dirty: true };
  const n = state.chartSheets.length, pos = state.order.indexOf(state.chartView !== null ? `c${state.chartView}` : state.sheetIdx);
  const order = [...state.order]; order.splice(pos + 1, 0, `c${n}`);
  return { ...state, chartSheets: [...state.chartSheets, { range, name: `Chart${n + 1}` }], order, chartView: n, dirty: true };
}

// ---- hiding rows and columns keeps their data ----
const rowsOf = (state) => { const r = clampRect(stageOf(state), selectionRect(state)); const out = []; for (let i = r.r1; i <= r.r2; i++) out.push(i); return out; };
const colsOf = (state) => { const r = clampRect(stageOf(state), selectionRect(state)); const out = []; for (let i = r.c1; i <= r.c2; i++) out.push(i); return out; };
const dirtied = (stage, s) => settle(stage, { ...s, dirty: true });
export const hideRows = state => playing(state) ? dirtied(stageOf(state), { ...state, hiddenRows: [...new Set([...(state.hiddenRows || []), ...rowsOf(state)])] }) : state;
export const hideCols = state => playing(state) ? dirtied(stageOf(state), { ...state, hiddenCols: [...new Set([...(state.hiddenCols || []), ...colsOf(state)])] }) : state;
export function unhideRows(state) { if (!playing(state)) return state; const rows = rowsOf(state), next = (state.hiddenRows || []).filter(r => !rows.includes(r)); return next.length === (state.hiddenRows || []).length ? state : dirtied(stageOf(state), { ...state, hiddenRows: next }); }
export function unhideCols(state) { if (!playing(state)) return state; const cols = colsOf(state), next = (state.hiddenCols || []).filter(c => !cols.includes(c)); return next.length === (state.hiddenCols || []).length ? state : dirtied(stageOf(state), { ...state, hiddenCols: next }); }

// ---- sheets of the workbook: each keeps its own cells, position and history ----
export function switchSheet(state, delta) {
  if (!playing(state) || state.sheet === 'new') return state;
  const here = state.chartView !== null ? `c${state.chartView}` : state.sheetIdx, i = state.order.indexOf(here), next = state.order[i + delta];
  if (next === undefined) return state;
  if (typeof next === 'string') return { ...state, chartView: Number(next.slice(1)) };
  // While a chart sheet is shown, the last worksheet's cells stay loaded; coming back to it is just a change of view.
  if (next === state.sheetIdx) return { ...state, chartView: null };
  const root = rootOf(state), store = { ...state.store, [state.sheetIdx]: pickSheet(state) };
  const loaded = store[next] || freshSheet((root.sheetList || [root])[next]);
  return { ...state, ...loaded, store, sheetIdx: next, chartView: null, mode: null, jump: false };
}

// ---- saving: the book's file is a snapshot of every sheet ----
export function save(state) {
  if (!playing(state) || !state.book) return state;
  return settle(stageOf(state), { ...state, saved: { ...state.saved, [state.book]: snapshot(state) }, dirty: false });
}
export function saveAs(state, name) {
  const n = String(name || '').trim().toUpperCase();
  if (!playing(state) || !state.book || !/^[A-Z0-9_-]{1,20}$/.test(n)) return state;
  return settle(stageOf(state), { ...state, book: n, saved: { ...state.saved, [n]: snapshot(state) }, dirty: false });
}
