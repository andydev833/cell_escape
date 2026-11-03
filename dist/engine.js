// Stage data is the single source for rules and drawing: app.js reads the same spans.
const WALKABLE = Object.freeze({ row: 5, fromCol: 2, toCol: 12 });   // B5:L5
export const ROOM = Object.freeze({
  id: 'room-01', start: Object.freeze({ col: 2, row: 5 }), exit: Object.freeze({ col: 12, row: 5 }),
  visibleCols: 14, visibleRows: 8,
  walkable: WALKABLE,
  safe: Object.freeze({ row: 5, fromCol: 2, toCol: 5 }),                       // B5:E5
  traps: Object.freeze({ row: 5, fromCol: 6, toCol: 11, type: 'ceilingPress' }), // F5:K5
  values: Object.freeze(Object.fromEntries(Array.from({ length: WALKABLE.toCol - WALKABLE.fromCol + 1 }, (_, i) => [`${WALKABLE.fromCol + i},${WALKABLE.row}`, 1]))),
});
const same = (a, b) => a.col === b.col && a.row === b.row;
export const inSpan = (span, p) => p.row === span.row && p.col >= span.fromCol && p.col <= span.toCol;
export const isWalkable = p => inSpan(ROOM.walkable, p);
export const isTrap = p => inSpan(ROOM.traps, p);
export const isSafe = p => inSpan(ROOM.safe, p) || same(p, ROOM.exit);
export function createState(deaths = 0) {
  return { phase: 'ready', position: { ...ROOM.start }, previous: { ...ROOM.start }, deaths, reason: null, trap: null, jump: false };
}
export function begin(state) { return { ...createState(state.deaths), phase: 'playing' }; }
export function restart(state) { return begin(state); }
export function edge(position, dx, dy, values = ROOM.values) {
  const has = (p) => values[`${p.col},${p.row}`] !== undefined && values[`${p.col},${p.row}`] !== '';
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
// Only the landing cell counts: cells passed over by a jump never fire.
// Walls (anything outside the walkable span) leave the state untouched — no move, no death.
export function move(state, dx, dy, jump = false) {
  if (state.phase !== 'playing' || Math.abs(dx) + Math.abs(dy) !== 1) return state;
  const target = jump ? edge(state.position, dx, dy) : { col: state.position.col + dx, row: state.position.row + dy };
  if (same(target, state.position) || !isWalkable(target)) return state;
  const win = same(target, ROOM.exit);
  const trapped = !win && isTrap(target);
  return { ...state, previous: state.position, position: target, jump,
    phase: win ? 'won' : trapped ? 'failed' : 'playing',
    deaths: state.deaths + (trapped ? 1 : 0),
    reason: trapped ? ROOM.traps.type : null, trap: trapped ? { ...target } : null };
}
export function cellName(p) {
  let c = p.col, name = ''; while(c > 0) { c--; name = String.fromCharCode(65 + c % 26) + name; c = Math.floor(c / 26); }
  return name + p.row;
}
