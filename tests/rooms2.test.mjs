import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, createState, begin, move, extend, copy, cut, paste, restart, cellName, key, parseCell, undo, redo, clearContents, commitEdit,
  selectColumn, selectRow, selectRegion, fill, jumpTo, goHome, goEnd, exitOpen, selectTo, toggleExtend, toggleAdd, tabMove, insertCells,
  deleteCells, autoSumText, toggleFormulaView, displayValue, flashFill, createTable, recalc, addChart, switchSheet, hideRows, hideCols,
  unhideRows, unhideCols, toggleStyle, save, saveAs, valueOf, serialText, test as check } from '../dist/engine.js';

const TODAY = 46000;
const R = (dx, dy = 0) => s => move(s, dx, dy);
const J = (dx, dy = 0) => s => move(s, dx, dy, true);
const SH = (dx, dy = 0, jump = false) => s => extend(s, dx, dy, jump);
const GO = a1 => s => jumpTo(s, parseCell(a1));
const TYPE = (text, opts) => s => commitEdit(s, text, opts);
const times = (n, f) => Array(n).fill(f);
const room = n => STAGES.findIndex(s => s.number === n);
const run = (n, ...steps) => steps.flat(Infinity).reduce((s, f) => f(s), begin(createState(room(n), 0, TODAY)));
const at = s => cellName(s.position);
const v = (s, a1) => s.values[key(parseCell(a1))];
const won = s => { assert.equal(s.phase, 'won', `expected a win, got ${s.phase} (${s.reason}) at ${at(s)}`); assert.equal(s.deaths, 0); };
const died = (s, type, msg) => { assert.equal(s.phase, 'failed', `expected a death at ${at(s)}${msg ? ' — ' + msg : ''}`); if (type) assert.equal(s.reason, type, msg); };
const alive = (s, msg) => assert.equal(s.phase, 'playing', `${msg || ''} (${s.reason}) at ${at(s)}`);

test('31: moving the battery sinks the near bridge; undo to cross, redo on the island', () => {
  const toH3 = [R(0, -1), R(0, -1), R(1), cut, times(5, R(1)), paste];
  const pasted = run(31, toH3); alive(pasted); assert.equal(v(pasted, 'H3').token, 'battery');
  died(run(31, toH3, times(6, R(-1)), R(0, 1), R(0, 1), times(2, R(1))), 'floorDrop', 'the near bridge is gone');
  const back = run(31, toH3, undo); assert.equal(v(back, 'C3').token, 'battery'); assert.equal(back.redo.length, 1);
  const island = run(31, toH3, undo, times(6, R(-1)), R(0, 1), R(0, 1), times(5, R(1)));
  alive(island); assert.equal(at(island), 'G5'); assert.equal(island.redo.length, 1, 'walking keeps redo');
  won(run(31, toH3, undo, times(6, R(-1)), R(0, 1), R(0, 1), times(5, R(1)), redo, times(5, R(1))));
  died(run(31, toH3, undo, times(6, R(-1)), R(0, 1), R(0, 1), times(5, R(1)), times(5, R(1))), 'floorDrop', 'without redo the far bridge is dark');
  died(run(31, R(0, -1), R(0, -1), R(1), copy, times(5, R(1)), paste), 'laser');
});

test('32: one rectangle catches the red middle; two areas with F8 / Shift+F8 open the door', () => {
  died(run(32, SH(1, 0, true)), 'ceilingPress');
  const route = [toggleExtend, R(1), toggleExtend, toggleAdd, R(0, 1), times(5, R(1)), R(0, -1), toggleExtend, R(1), toggleExtend];
  const ext = (s) => s; // arrows in extend mode are handled by the app; here we mirror it with extend()
  const s0 = run(32, toggleExtend, SH(1), toggleExtend, toggleAdd, R(0, 1), times(5, R(1)), R(0, -1), SH(1));
  alive(s0); assert.equal(s0.solved.pair, true); assert.equal(s0.areas.length, 1);
  won(run(32, toggleExtend, SH(1), toggleExtend, toggleAdd, R(0, 1), times(5, R(1)), R(0, -1), SH(1), toggleAdd, R(1), R(0, 1), R(0, 1), R(0, 1), R(1), R(1)));
  assert.ok(route && ext);
});

test('33: each corner from the right start point; the wrong order sweeps over E5', () => {
  died(run(33, s => selectTo(s, 'end')), 'laser');
  const a = run(33, s => selectTo(s, 'home')); alive(a); assert.equal(a.solved.gateA, true);
  died(run(33, s => selectTo(s, 'home'), R(0, 1), R(0, 1), R(1), R(1), s => selectTo(s, 'home')), 'laser');
  won(run(33, s => selectTo(s, 'home'), R(0, 1), R(0, 1), R(1), R(1), s => selectTo(s, 'end'), times(4, R(1)), times(4, R(0, 1))));
  died(run(33, R(0, 1), R(0, 1), times(6, R(1)), times(4, R(0, 1))), 'doorDrop');
});

test('34: Tab is the only way between the boxes; Enter drops into the pit', () => {
  alive(run(34, R(0, 1)), 'a plain step down is safe'); assert.equal(at(run(34, R(1))), 'D4', 'no floor between boxes');
  died(run(34, TYPE('1')), 'floorDrop');
  const one = run(34, TYPE('1', { dir: 'tab' })); assert.equal(at(one), 'F4');
  assert.equal(at(tabMove(run(34, TYPE('1', { dir: 'tab' }), TYPE('2', { dir: 'tab' })), 1)), 'H4', 'the shut exit does not take you in');
  won(run(34, TYPE('1', { dir: 'tab' }), TYPE('2', { dir: 'tab' }), TYPE('3', { dir: 'tab' })));
});
test('35: Delete leaves the receivers empty; inserting a cell shifts both tokens right', () => {
  const e3 = [times(3, R(1)), R(0, -1), R(0, -1)];
  died(run(35, e3, clearContents, R(0, 1), R(0, 1), times(7, R(1))), 'ceilingPress');
  const ins = run(35, e3, s => insertCells(s, 'right'));
  assert.equal(v(ins, 'E3'), undefined); assert.equal(v(ins, 'F3').token, 'stone'); assert.equal(v(ins, 'G3').token, 'key');
  won(run(35, e3, s => insertCells(s, 'right'), R(0, 1), R(0, 1), times(7, R(1))));
  const down = run(35, e3, s => insertCells(s, 'down')); assert.equal(v(down, 'E4').token, 'stone');
  const cutting = run(35, e3, cut, R(0, 1)); assert.equal(paste(cutting), cutting, 'pasting is sealed here');
});

test('36: Delete leaves a hole; deleting the cell shifts the key into the lock; whole rows break the seals', () => {
  const e3 = [times(3, R(1)), R(0, -1), R(0, -1)];
  died(run(36, e3, clearContents, R(0, 1), R(0, 1), times(7, R(1))), 'floorDrop');
  const del = run(36, e3, s => deleteCells(s, 'left'));
  assert.equal(v(del, 'D3').token, 'seal'); assert.equal(v(del, 'E3').token, 'key'); assert.equal(v(del, 'F3').token, 'seal'); assert.equal(v(del, 'G3'), undefined);
  won(run(36, e3, s => deleteCells(s, 'left'), R(0, 1), R(0, 1), times(7, R(1))));
  died(run(36, e3, selectRow, s => deleteCells(s, 'up')), 'spikes');
  const sealed = run(36, e3); assert.equal(commitEdit(sealed, 'KEY'), sealed, 'typing is sealed');
});

test('37: a fixed 14 breaks when the weight changes; a SUM keeps up', () => {
  const c7 = [R(1), R(0, -1)];
  assert.equal(autoSumText(run(37, c7)), '=SUM(C3:C6)');
  died(run(37, c7, TYPE('14'), R(1), R(1)), 'floorDrop');
  const sum = run(37, c7, TYPE('=SUM(C3:C6)'), R(1)); alive(sum); assert.equal(valueOf(sum, parseCell('C7')), 15, 'the weight dropped at D8');
  won(run(37, c7, TYPE('=SUM(C3:C6)'), times(7, R(1))));
  won(run(37, c7, TYPE('=C3+C4+C5+C6'), times(7, R(1))));
});

test('38: three 12s on the path; standing on one shows its formula', () => {
  const e7 = run(38, times(2, R(1))); assert.equal(at(e7), 'E7'); assert.equal(v(e7, 'E7').f, '=B2'); assert.equal(displayValue(e7, parseCell('E7')), '12');
  assert.equal(displayValue(toggleFormulaView(e7), parseCell('K7')), '=B1');
  died(run(38, times(2, R(1)), R(0, -1)), 'fakeDoor', 'the nearest door is fake');
  died(run(38, times(5, R(1)), R(0, -1)), 'fakeDoor');
  won(run(38, times(8, R(1)), R(0, -1)));
});
test('39: yesterday\'s pass fails; today stamped as a value opens', () => {
  const s = run(39); assert.equal(v(s, 'C3'), TODAY - 1);
  const e5 = [times(3, R(1))];
  died(run(39, e5, TYPE(serialText(TODAY - 1)), R(0, -1), times(7, R(1))), 'ceilingPress');
  const ok = run(39, e5, TYPE(serialText(TODAY)));
  assert.equal(v(ok, 'E5'), TODAY); assert.equal(displayValue(ok, parseCell('E5')), serialText(TODAY));
  won(run(39, e5, TYPE(serialText(TODAY), { dir: 'none' }), times(7, R(1))));
  died(run(39, e5, TYPE('=TODAY()', { dir: 'none' }), times(7, R(1))), 'ceilingPress');
});

test('40: the power switch is on the next sheet; each sheet keeps its own cells', () => {
  died(run(40, times(10, R(1))), 'doorDrop');
  const power = run(40, s => switchSheet(s, 1)); assert.equal(power.sheetIdx, 1); assert.equal(at(power), 'B5');
  const typed = run(40, s => switchSheet(s, 1), times(2, R(1)), R(0, -1), TYPE('1', { dir: 'none' }));
  assert.equal(v(typed, 'D4'), 1);
  const back = switchSheet(typed, -1); assert.equal(back.sheetIdx, 0); assert.equal(v(back, 'D4'), undefined, 'Gate has its own cells');
  won(run(40, s => switchSheet(s, 1), times(2, R(1)), R(0, -1), TYPE('1', { dir: 'none' }), s => switchSheet(s, -1), times(10, R(1))));
  assert.equal(switchSheet(run(40), -1).sheetIdx, 0, 'no sheet before the first');
});

test('41: Ctrl+D copies one name to every lock; Ctrl+E learns the pattern', () => {
  const c5 = [R(1), times(3, R(0, -1))];
  const fill5 = run(41, c5, flashFill);
  assert.deepEqual(['C5', 'C6', 'C7'].map(a => v(fill5, a)), ['BAT', 'ANT', 'EEL']);
  won(run(41, c5, flashFill, times(3, R(0, 1)), times(7, R(1))));
  died(run(41, R(1), times(4, R(0, -1)), times(4, SH(0, 1)), s => fill(s, 'down'), times(4, R(0, 1)), times(7, R(1))), 'blast');
});

test('42: the table must be B3:C6 with its header row', () => {
  const b3 = [times(3, R(-1)), times(3, R(0, -1))];
  const region = run(42, b3, selectRegion); assert.deepEqual(region.sel, { c1: 2, r1: 3, c2: 3, r2: 6 });
  won(run(42, b3, selectRegion, s => createTable(s, true), times(3, R(0, 1)), times(9, R(1))));
  died(run(42, b3, selectRegion, s => createTable(s, false), times(3, R(0, 1)), times(9, R(1))), 'blast');
  died(run(42, b3, SH(1), times(5, SH(0, 1)), s => createTable(s, true)), 'blast');
});

test('43: manual calculation keeps 6 until F9', () => {
  const b2 = [times(4, R(0, -1))];
  const edited = run(43, b2, TYPE('3')); assert.equal(valueOf(edited, parseCell('C2')), 6);
  died(run(43, b2, TYPE('3'), times(3, R(0, 1)), times(4, R(1))), 'floorDrop');
  const f9 = run(43, b2, TYPE('3'), recalc); assert.equal(valueOf(f9, parseCell('C2')), 9);
  won(run(43, b2, TYPE('3'), recalc, times(3, R(0, 1)), times(10, R(1))));
});

test('44: the doors wait for the chart; then the tallest bar shows the way', () => {
  const b2 = [times(5, R(0, -1))];
  assert.equal(run(44, times(4, R(1)), R(0, -1)).phase, 'playing', 'before the chart a door is just shut');
  assert.equal(at(run(44, times(8, R(1)), R(0, -1))), 'J7');
  died(run(44, b2, selectRegion, s => addChart(s, 'embedded'), times(5, R(0, 1)), times(4, R(1)), R(0, -1)), 'fakeDoor');
  won(run(44, b2, selectRegion, s => addChart(s, 'embedded'), times(5, R(0, 1)), times(8, R(1)), R(0, -1)));
});
test('45: column E is hidden; unhiding it shows the door', () => {
  assert.equal(at(run(45, R(1))), 'F6', 'walking skips the hidden column');
  assert.equal(at(run(45, GO('E6'))), 'D6', 'a hidden cell cannot be reached');
  const shown = run(45, selectColumn, SH(1), unhideCols); assert.deepEqual(shown.hiddenCols, []);
  won(run(45, selectColumn, SH(1), unhideCols, R(1)));
});

test('46: bold everywhere fails; italic, underline and strike each in place', () => {
  const marks = [R(1), times(3, R(0, -1)), s => toggleStyle(s, 'italic'), times(3, R(0, 1)), times(3, R(1)), times(3, R(0, -1)), s => toggleStyle(s, 'underline'), times(3, R(0, 1)), times(3, R(1)), times(3, R(0, -1)), s => toggleStyle(s, 'strike'), times(3, R(0, 1))];
  won(run(46, marks, times(3, R(1))));
  died(run(46, R(1), times(3, R(0, -1)), s => toggleStyle(s, 'bold'), times(3, R(0, 1)), times(10, R(1))), 'spikes');
  assert.equal(clearContents(run(46, R(1), times(3, R(0, -1)))).phase, 'playing');
});

test('47: colour only into H3, formula only into H6', () => {
  const toC3 = [R(1), times(5, R(0, -1))], c3toH3 = [copy, times(5, R(0, 1)), times(5, R(1)), times(5, R(0, -1))];
  died(run(47, toC3, c3toH3, s => paste(s)), 'blast');
  const h3 = run(47, toC3, c3toH3, s => paste(s, 'formats')); alive(h3); assert.equal(v(h3, 'H3'), 'SAFE'); assert.equal(h3.formats[key(parseCell('H3'))].fill, 'green');
  const c6toH6 = [R(1), times(2, R(0, -1)), copy, times(2, R(0, 1)), times(5, R(1)), times(2, R(0, -1))];
  died(run(47, c6toH6, s => paste(s)), 'laser');
  const h6 = run(47, c6toH6, s => paste(s, 'formulas')); alive(h6); assert.equal(v(h6, 'H6').f, '=G6*2'); assert.equal(valueOf(h6, parseCell('H6')), 8);
  won(run(47, toC3, c3toH3, s => paste(s, 'formats'), times(5, R(0, 1)), times(5, R(-1)), times(2, R(0, -1)), copy, times(2, R(0, 1)), times(5, R(1)), times(2, R(0, -1)), s => paste(s, 'formulas'), times(2, R(0, 1)), times(6, R(1))));
});
test('48: unhide to read the key, hide the eyes, keep everything', () => {
  died(run(48, times(8, R(1))), 'laser');
  const route = [times(3, R(1)), SH(1), SH(1), unhideCols, R(1), R(0, -1), R(0, -1), SH(0, -1), unhideRows, R(0, -1), R(0, -1), selectRow, hideRows,
    R(0, 1), R(0, 1), R(0, 1), R(0, 1), R(1), R(1), selectColumn, hideCols];
  const done = run(48, route); alive(done);
  assert.equal(done.latches.read, true); assert.deepEqual(done.hiddenRows, [3]); assert.deepEqual(done.hiddenCols, [8]);
  won(run(48, route, R(1), R(1)));
});

test('49: keep ORIGIN, save a copy as ESCAPE, move the key there, save again', () => {
  const c3 = [R(1), R(0, -1), R(0, -1)], toH3 = [R(0, 1), R(0, 1), times(5, R(1)), R(0, -1), R(0, -1)];
  died(run(49, times(10, R(1))), 'doorDrop');
  const route = [s => saveAs(s, 'ESCAPE'), c3, cut, toH3, paste, save];
  const ready = run(49, route); assert.equal(ready.book, 'ESCAPE'); assert.equal(ready.dirty, false);
  won(run(49, route, R(0, 1), R(0, 1), times(4, R(1))));
  died(run(49, c3, cut, toH3, paste, save, s => saveAs(s, 'ESCAPE'), R(0, 1), R(0, 1), times(4, R(1))), 'doorDrop', 'the original was overwritten');
  died(run(49, s => saveAs(s, 'ESCAPE'), c3, cut, toH3, paste, R(0, 1), R(0, 1), times(4, R(1))), 'doorDrop', 'not saved');
});
test('50: jump, move the key, bring only the core, go home', () => {
  alive(run(50, R(1)), 'the first step is safe'); died(run(50, times(3, R(1))), 'ceilingPress');
  died(run(50, J(1), goHome), 'doorDrop');
  const key = [J(1), R(0, -1), R(0, -1), cut, times(4, R(1)), paste];
  const keyed = run(50, key); alive(keyed); assert.equal(v(keyed, 'K3').token, 'key'); assert.equal(v(keyed, 'G3'), undefined);
  died(run(50, J(1), R(0, -1), R(0, -1), copy, times(4, R(1)), paste), 'laser');
  const core = [R(0, 1), R(0, 1), copy, R(1), R(1)];
  died(run(50, key, core, s => paste(s)), 'laser');
  won(run(50, key, core, s => paste(s, 'values'), goHome));
});
test('retry clears books, sheets, redo and modes', () => {
  const messy = run(49, s => saveAs(s, 'ESCAPE'), toggleAdd);
  const r = restart(messy); assert.equal(r.book, 'ORIGIN'); assert.equal(r.mode, null); assert.deepEqual(Object.keys(r.saved), ['ORIGIN']);
  const sheets = restart(run(40, s => switchSheet(s, 1))); assert.equal(sheets.sheetIdx, 0);
  assert.deepEqual(restart(run(31, R(0, -1), R(0, -1), R(1), cut, times(5, R(1)), paste, undo)).redo, []);
});
