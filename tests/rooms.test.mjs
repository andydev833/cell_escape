import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, createState, begin, move, extend, copy, cut, paste, restart, cellName, key, parseCell, undo, clearContents, commitEdit,
  selectColumn, selectRow, gotoRef, selectRegion, fill, findNext, jumpTo, replaceAll, goHome, goEnd, toggleFilter, applyFilter, filterChoices,
  numberFormat, toggleBold, answerConfirm, newSheet, cycleReference, evaluate, exitOpen, canEdit, displayValue } from '../dist/engine.js';

// Small route language: each step is a function of the state.
const R = (dx, dy = 0) => s => move(s, dx, dy);
const J = (dx, dy = 0) => s => move(s, dx, dy, true);
const SH = (dx, dy = 0, jump = false) => s => extend(s, dx, dy, jump);
const GO = a1 => s => jumpTo(s, parseCell(a1));
const FIND = text => s => jumpTo(s, findNext(s, text));
const TYPE = (text, opts) => s => commitEdit(s, text, opts);
const times = (n, f) => Array(n).fill(f);
const room = n => STAGES.findIndex(s => s.number === n);
const run = (n, ...steps) => steps.flat(Infinity).reduce((s, f) => f(s), begin(createState(room(n))));
const at = s => cellName(s.position);
const v = (s, a1) => s.values[key(parseCell(a1))];
const won = s => { assert.equal(s.phase, 'won', `expected a win, got ${s.phase} (${s.reason}) at ${at(s)}`); assert.equal(s.deaths, 0); };
const died = (s, type, msg) => { assert.equal(s.phase, 'failed', `expected a death at ${at(s)}`); if (type) assert.equal(s.reason, type, msg); assert.equal(s.deaths, 1); };

test('rooms 01-50 exist and every first plain step is safe; walls never kill', () => {
  assert.equal(STAGES.length, 50);
  for (const stage of STAGES) {
    const fresh = begin(createState(stage.index));
    for (const [dx, dy] of [[1,0],[-1,0],[0,-1],[0,1]]) {
      const s = move(fresh, dx, dy);
      assert.notEqual(s.phase, 'failed', `${stage.id} first step ${dx},${dy}`);
    }
  }
});

test('06: OK destroys the key and drops the shutter; Esc (cancel) keeps it and the way out', () => {
  const panel = run(6, times(3, R(1)));
  assert.equal(at(panel), 'E5'); assert.equal(panel.panel.kind, 'confirm'); assert.equal(R(1)(panel), panel, 'moves wait for the answer');
  died(answerConfirm(panel, true), 'doorDrop');
  won(run(6, times(3, R(1)), s => answerConfirm(s, false), times(7, R(1))));
  won(run(6, J(1), s => answerConfirm(s, false), J(1)));
});

test('07: cut+paste unlocks but sinks the bridge; Ctrl+Z restores power and the latch stays', () => {
  const moved = run(7, R(1), cut, J(1), R(1), paste);
  assert.equal(moved.latches.lock, true); assert.equal(v(moved, 'C5'), undefined);
  died(R(1)(moved), 'floorDrop');
  const back = undo(moved);
  assert.equal(v(back, 'C5').token, 'battery'); assert.equal(v(back, 'H5'), undefined); assert.equal(back.latches.lock, true);
  won(run(7, R(1), cut, J(1), R(1), paste, undo, times(4, R(1))));
  died(run(7, R(1), copy, J(1), R(1), paste), 'laser');
  died(run(7, times(10, R(1))), 'doorDrop');
});

test('08: the exit counts bombs; cutting it elsewhere still fails, Delete clears it', () => {
  died(run(8, J(1)), 'blast');
  died(run(8, times(6, R(1)), cut, R(1), paste, times(3, R(1))), 'blast');
  const cleared = run(8, times(6, R(1)), clearContents);
  assert.equal(v(cleared, 'H5'), undefined); assert.equal(cleared.phase, 'playing');
  won(run(8, times(6, R(1)), clearContents, times(4, R(1))));
});

test('09: typing OPEN over the cell loses GATE7; editing the end keeps it', () => {
  died(run(9, times(3, R(1)), TYPE('OPEN')), 'laser');
  const ok = run(9, times(3, R(1)), TYPE('GATE7=OPEN'));
  assert.equal(at(ok), 'E6', 'Enter steps down onto safe floor'); assert.equal(v(ok, 'E5'), 'GATE7=OPEN');
  won(run(9, times(3, R(1)), TYPE('GATE7=OPEN'), R(0, -1), times(7, R(1))));
  died(run(9, J(1)), 'doorDrop');
});

test('10: Enter moves to the seal and writing it fires the press; Alt+Enter keeps both lines in E5', () => {
  died(run(10, times(3, R(1)), TYPE('NORTH'), TYPE('STAR')), 'ceilingPress');
  const ok = run(10, times(3, R(1)), TYPE('NORTH\nSTAR'));
  assert.equal(v(ok, 'E6').token, 'seal'); assert.equal(exitOpen(STAGES[room(10)], ok), true);
  won(run(10, times(3, R(1)), TYPE('NORTH\nSTAR'), R(0, -1), times(7, R(1))));
});

test('11: Ctrl+Shift+→ also selects the red sensor; Shift+→ ×3 from E5 opens', () => {
  died(run(11, times(3, R(1)), SH(1, 0, true)), 'ceilingPress');
  const ok = run(11, times(3, R(1)), times(3, SH(1)));
  assert.equal(at(ok), 'E5'); assert.equal(ok.solved.plates, true);
  won(run(11, times(3, R(1)), times(3, SH(1)), times(7, R(1))));
  died(run(11, times(4, R(1))), 'spikes');
});

test('12: whole column C reaches both terminals; widening sideways hits column D', () => {
  died(run(12, SH(1)), 'laser');
  const partial = run(12, R(0, -1), times(3, SH(0, 1)));
  assert.equal(partial.solved.pillar, undefined);
  const ok = run(12, selectColumn); assert.equal(ok.solved.pillar, true); assert.equal(at(ok), 'C4');
  won(run(12, selectColumn, times(4, R(0, 1))));
  died(run(12, times(2, R(0, 1))), 'spikes');
});

test('13: Ctrl+Space on D catches D5; Shift+Space on row 4 fixes the beam', () => {
  died(run(13, selectColumn), 'floorDrop');
  won(run(13, selectRow, J(1)));
  won(run(13, selectRow, times(7, R(1))));
  died(run(13, times(4, R(1))), 'floorDrop');
});

test('14: Ctrl+A once selects the island B3:E6; twice reaches the alarm', () => {
  const once = run(14, selectRegion);
  assert.equal(once.solved.island, true); assert.deepEqual(once.sel, { c1: 2, r1: 3, c2: 5, r2: 6 });
  died(selectRegion(once), 'ceilingPress');
  won(run(14, selectRegion, R(1), R(0, 1), R(0, 1), R(1), R(0, 1)));
  died(run(14, R(1), R(1), R(0, 1), R(0, 1), R(0, 1)), 'doorDrop');
});

test('15: 1 + Enter lights one bulb and discharges; Ctrl+Enter lights all five', () => {
  const top = [times(4, R(1)), R(0, -1), R(0, -1)];
  died(run(15, top, TYPE('1')), 'laser');
  const ok = run(15, top, times(4, SH(0, 1)), TYPE('1', { all: true }));
  assert.equal(ok.phase, 'playing'); assert.deepEqual(['F3','F4','F5','F6','F7'].map(a => v(ok, a)), [1,1,1,1,1]);
  won(run(15, top, times(4, SH(0, 1)), TYPE('1', { all: true }), R(0, 1), R(0, 1), times(6, R(1))));
});

test('16: Ctrl+D on F3 alone copies the blank above; F3:F7 fills every pedestal', () => {
  const f3 = [times(4, R(1)), R(0, -1), R(0, -1)];
  died(run(16, f3, s => fill(s, 'down')), 'floorDrop');
  const ok = run(16, f3, times(4, SH(0, 1)), s => fill(s, 'down'));
  assert.equal(['F3','F4','F5','F6','F7'].every(a => v(ok, a)?.token === 'stone'), true);
  won(run(16, f3, times(4, SH(0, 1)), s => fill(s, 'down'), R(0, 1), R(0, 1), times(6, R(1))));
  died(run(16, J(1), times(10, R(1))), 'doorDrop');
  died(run(16, f3, copy, R(0, 1), paste), 'floorDrop', 'one copy at a time tips the pedestals');
  died(run(16, f3, SH(0, 1), s => fill(s, 'down')), 'floorDrop');
});

test('17: Ctrl+D pulls the VOID down; Ctrl+R spreads the stone right', () => {
  const sel = [R(1), times(4, SH(1))];
  died(run(17, sel, s => fill(s, 'down')), 'spikes');
  won(run(17, sel, s => fill(s, 'right'), times(9, R(1))));
});

test('18: searching OWL lands on I3 next to the only exit', () => {
  const owl = run(18, FIND('owl'));
  assert.equal(at(owl), 'I3');
  won(R(1)(owl));
  assert.equal(run(18, times(10, R(1))).phase, 'playing', 'the corridor is a dead end, not a trap');
});

test('19: replacing across the sheet breaks UNLOCKED; inside the control row it opens', () => {
  const sheet = run(19, times(2, R(1)));
  const all = replaceAll(sheet, 'LOCKED', 'OPEN'); died(all.state, 'ceilingPress'); assert.equal(v(all.state, 'C7'), 'UNOPEN');
  const scoped = replaceAll(run(19, times(2, R(1)), SH(0, -1), times(8, SH(1))), 'LOCKED', 'OPEN');
  assert.equal(scoped.count, 2); assert.equal(v(scoped.state, 'C7'), 'UNLOCKED');
  won(run(19, times(2, R(1)), SH(0, -1), times(8, SH(1)), s => replaceAll(s, 'LOCKED', 'OPEN').state, times(8, R(1))));
});

test('20: the data edge G5 is a false floor; Ctrl+G J6 escapes', () => {
  died(run(20, J(1)), 'floorDrop');
  assert.equal(run(20, times(4, R(1))).phase, 'playing');
  won(run(20, GO('J6')));
  assert.equal(parseCell('J 6'), null); assert.equal(parseCell('6J'), null);
});

test('21: both corners are traps; Ctrl+Home goes straight to A1; a typed address does not', () => {
  died(run(21, J(-1)), 'ceilingPress');
  died(run(21, J(0, -1)), 'ceilingPress');
  won(run(21, goHome));
  const s = run(21); assert.equal(gotoRef(s, parseCell('A1')), s);
});

test('22: both corners are traps; Ctrl+End reaches K7; a typed address does not', () => {
  died(run(22, J(1)), 'ceilingPress');
  died(run(22, J(0, 1)), 'ceilingPress');
  assert.equal(run(22, times(8, R(1))).phase, 'playing');
  won(run(22, goEnd));
  const s = run(22); assert.equal(gotoRef(s, parseCell('K7')), s);
});

test('23: walking down hits D5; the filter alone hides nothing; SAFE-only opens the way', () => {
  died(run(23, times(3, R(0, 1))), 'spikes');
  const on = run(23, toggleFilter); assert.deepEqual(on.hidden, []); assert.deepEqual(filterChoices(on), ['SAFE', 'TRAP']);
  died(run(23, toggleFilter, times(3, R(0, 1))), 'spikes');
  died(run(23, J(0, 1)), 'spikes');
  const safe = run(23, toggleFilter, s => applyFilter(s, ['SAFE']));
  assert.deepEqual(safe.hidden, [5, 6, 8, 9]); assert.equal(v(safe, 'D5'), 'TRAP', 'hidden, not deleted');
  won(run(23, toggleFilter, s => applyFilter(s, ['SAFE']), times(4, R(0, 1))));
});

test('24: plain paste brings the red format; values-only paste keeps H5 colourless', () => {
  const ready = [R(1), copy, J(1), R(1)];
  died(run(24, ready, s => paste(s)), 'laser');
  const ok = run(24, ready, s => paste(s, 'values'));
  assert.equal(v(ok, 'H5').token, 'core'); assert.equal(ok.formats[key(parseCell('H5'))], undefined);
  const typed = run(24, times(6, R(1)), TYPE('CORE')); assert.equal(exitOpen(STAGES[room(24)], typed), false, 'typing the word is not the object');
  won(run(24, ready, s => paste(s, 'values'), J(1)));
  assert.equal(paste(run(24, R(1), cut, J(1), R(1)), 'values').clipboard.mode, 'cut', 'no values-only paste after cut');
});

test('25: E5 is protected; Ctrl+Shift+1 shows 12,500.00 without changing the value', () => {
  const e5 = run(25, times(3, R(1)));
  assert.equal(canEdit(e5), false); assert.equal(commitEdit(e5, '12,500.00'), e5);
  died(J(1)(e5), 'floorDrop');
  const fmt = numberFormat(e5); assert.equal(v(fmt, 'E5'), 12500); assert.equal(displayValue(fmt, parseCell('E5')), '12,500.00');
  won(run(25, times(3, R(1)), numberFormat, J(1)));
});

test('26: RUN must be bold; toggling twice is thin again', () => {
  const h5 = run(26, times(6, R(1)));
  died(J(1)(h5), 'floorDrop');
  died(run(26, times(6, R(1)), toggleBold, toggleBold, J(1)), 'floorDrop');
  won(run(26, times(6, R(1)), toggleBold, J(1)));
});

test('27: deleting the KEY drops the shutter; the note points to J6', () => {
  const c4 = run(27, R(1));
  assert.equal(STAGES[room(27)].notes[key(parseCell('C4'))], 'J6');
  died(clearContents(c4), 'doorDrop');
  died(run(27, times(10, R(1))), 'fakeDoor');
  won(run(27, R(1), GO('J6')));
});

test('28: relative fill gives 0s; $B$2 fill gives 14 everywhere', () => {
  const c5 = run(28, R(1));
  assert.equal(evaluate(c5.values, v(c5, 'C5')), 14);
  const rel = run(28, R(1), times(2, SH(0, 1)), s => fill(s, 'down'));
  assert.equal(evaluate(rel.values, v(rel, 'C6')), 0);
  died(run(28, R(1), times(2, SH(0, 1)), s => fill(s, 'down'), times(9, R(1))), 'floorDrop');
  assert.equal(cycleReference('=B2*2', 5), null, 'caret after the literal 2 is not a reference');
  const fixed = cycleReference('=B2*2', 3); assert.equal(fixed.text, '=$B$2*2');
  won(run(28, R(1), TYPE(fixed.text), times(2, SH(0, 1)), s => fill(s, 'down'), times(9, R(1))));
});

test('29: no exit here; Ctrl+End finds the closed room; the new sheet holds the way out', () => {
  died(run(29, goEnd), 'ceilingPress');
  assert.equal(run(29, times(4, R(1))).phase, 'playing');
  const out = run(29, newSheet);
  assert.equal(out.phase, 'playing'); assert.equal(out.sheet, 'new'); assert.equal(at(out), 'A1'); assert.deepEqual(out.values, {});
  assert.equal(newSheet(out), out, 'only one new sheet');
  won(run(29, newSheet, times(3, R(1)), times(2, R(0, 1)), times(2, R(1))));
  assert.equal(restart(out).sheet, 'main');
  assert.equal(newSheet(run(1)).phase, 'playing', 'other rooms ignore a new sheet');
  assert.equal(newSheet(run(1)).sheet, 'main');
});

test('30: every earlier trick, in the right order', () => {
  died(run(30, goEnd), 'fakeExit');
  died(run(30, goHome), 'doorDrop');
  died(run(30, FIND('CORE'), copy, GO('H3'), s => paste(s)), 'laser');
  died(run(30, FIND('CORE'), copy, GO('H3'), s => paste(s, 'values'), GO('C6'), copy, GO('H6'), paste), 'laser');
  won(run(30, FIND('CORE'), copy, GO('H3'), s => paste(s, 'values'), GO('C6'), cut, GO('H6'), paste, goHome));
  died(run(30, GO('H3'), TYPE('CORE'), GO('C6'), cut, GO('H6'), paste, goHome), 'doorDrop');
});

test('retry resets edits, clipboard, history, filter and panels', () => {
  const messy = run(23, toggleFilter, s => applyFilter(s, ['SAFE']));
  const fresh = restart(messy); assert.equal(fresh.filter, null); assert.deepEqual(fresh.hidden, []);
  const edited = run(7, R(1), cut, J(1), R(1), paste); const r = restart(edited);
  assert.equal(r.history.length, 0); assert.equal(v(r, 'C5').token, 'battery'); assert.deepEqual(r.latches, {});
  assert.equal(restart(run(6, times(3, R(1)))).panel, null);
});
