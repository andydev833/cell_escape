import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, createState, begin, move, extend, copy, cut, paste, cancelClipboard, restart, edge, cellName, activeTrap,
  isFloor, deviceStatus, exitOpen, countTokens, selectionRect, key } from '../dist/engine.js';
const R = (dx, dy = 0) => s => move(s, dx, dy);
const J = (dx, dy = 0) => s => move(s, dx, dy, true);
const SH = (dx, dy = 0, jump = false) => s => extend(s, dx, dy, jump);
const run = (stage, ...steps) => steps.flat().reduce((s, f) => f(s), begin(createState(stage)));
const times = (n, f) => Array(n).fill(f);
const at = s => cellName(s.position);
const value = (s, a1) => s.values[key(cellsKey(a1))];
const cellsKey = a1 => ({ col: a1.charCodeAt(0) - 64, row: Number(a1.slice(1)) });

test('every room: the first plain step right is safe, and walls never move or kill', () => {
  for (const stage of STAGES) {
    const fresh = begin(createState(stage.index));
    const one = move(fresh, 1, 0);
    assert.equal(one.phase, 'playing', stage.id); assert.equal(one.deaths, 0, stage.id);
    for (const [dx, dy] of [[-1,0],[0,-1],[0,1]]) for (const jump of [false, true]) assert.equal(move(fresh, dx, dy, jump), fresh, stage.id);
  }
});

test('room 01: three steps safe, fourth lands on F5 and fails once; Ctrl+→ escapes from B5:E5', () => {
  let s = run(0, times(3, R(1)));
  assert.equal(at(s), 'E5'); assert.equal(s.deaths, 0);
  s = move(s, 1, 0);
  assert.equal(s.phase, 'failed'); assert.equal(s.reason, 'ceilingPress'); assert.equal(s.deaths, 1); assert.equal(cellName(s.trap), 'F5');
  for (const f of [R(1), J(1), R(-1)]) assert.equal(f(s), s);
  for (let n = 0; n <= 3; n++) { const w = run(0, times(n, R(1)), J(1)); assert.equal(w.phase, 'won'); assert.equal(at(w), 'L5'); assert.equal(w.deaths, 0); }
  const retry = restart(s); assert.equal(at(retry), 'B5'); assert.equal(retry.deaths, 1); assert.equal(run(0, times(3, R(1))).phase, 'playing');
});

test('room 02: Ctrl+→ lands on the fake exit L3; →×3, Ctrl+↓, Ctrl+→ reaches L7', () => {
  const fake = run(1, J(1));
  assert.equal(at(fake), 'L3'); assert.equal(fake.phase, 'failed'); assert.equal(fake.reason, 'fakeExit');
  const down = run(1, times(3, R(1)), J(0, 1));
  assert.equal(at(down), 'E7'); assert.equal(down.phase, 'playing'); assert.equal(down.deaths, 0);
  const win = J(1)(down); assert.equal(at(win), 'L7'); assert.equal(win.phase, 'won');
  const walk = run(1, times(3, R(1)), R(0, 1));
  assert.equal(at(walk), 'E4'); assert.equal(walk.phase, 'playing');
  const drop = R(0, 1)(walk); assert.equal(drop.phase, 'failed'); assert.equal(drop.reason, 'floorDrop'); assert.equal(at(drop), 'E5');
  const lower = run(1, times(3, R(1)), J(0, 1), times(3, R(1)));
  assert.equal(at(lower), 'H7'); assert.equal(lower.phase, 'playing');
  assert.equal(R(1)(lower).reason, 'ceilingPress');
  for (const p of [{col:4,row:4},{col:6,row:5},{col:12,row:4}]) assert.equal(isFloor(STAGES[1], p), false);
});

test('room 03: Ctrl+→ alone dies on J5; Ctrl+Shift+→ selects B5:J5, solves, and stays solved', () => {
  const rush = run(2, J(1)); assert.equal(at(rush), 'J5'); assert.equal(rush.reason, 'spikes');
  assert.equal(run(2, times(3, R(1))).phase, 'playing');
  assert.equal(run(2, times(4, R(1))).reason, 'spikes');
  const sel = run(2, SH(1, 0, true));
  assert.equal(at(sel), 'B5'); assert.deepEqual(selectionRect(sel), { c1: 2, r1: 5, c2: 10, r2: 5 });
  assert.equal(sel.solved.plates, true); assert.equal(exitOpen(STAGES[2], sel), true);
  assert.equal(deviceStatus(STAGES[2], sel).plates.lit.every(Boolean), true);
  const j5 = J(1)(sel); assert.equal(at(j5), 'J5'); assert.equal(j5.phase, 'playing'); assert.equal(activeTrap(STAGES[2], j5, j5.position), null);
  const win = J(1)(j5); assert.equal(at(win), 'L5'); assert.equal(win.phase, 'won'); assert.equal(win.deaths, 0);
  const partial = run(2, times(5, SH(1))); assert.equal(partial.solved.plates, undefined); assert.equal(partial.phase, 'playing');
  const stepwise = run(2, times(8, SH(1))); assert.equal(stepwise.solved.plates, true); assert.equal(at(stepwise), 'B5');
  const shrunk = run(2, times(8, SH(1)), times(8, SH(-1)), R(1));
  assert.equal(shrunk.solved.plates, true); assert.equal(exitOpen(STAGES[2], shrunk), true);
  assert.equal(restart(stepwise).solved.plates, undefined);
});

test('room 04: exit without both stones drops the door; copy C5 to H5 opens it; cut leaves C5 empty', () => {
  const rush = run(3, J(1)); assert.equal(at(rush), 'G5');
  const door = run(3, J(1), R(1), J(1), J(1)); assert.equal(at(door), 'L5'); assert.equal(door.phase, 'failed'); assert.equal(door.reason, 'doorDrop');
  const h5 = run(3, R(1), copy, J(1), R(1));
  assert.equal(at(h5), 'H5'); assert.equal(h5.phase, 'playing'); assert.equal(h5.clipboard.mode, 'copy');
  const pasted = paste(h5);
  assert.equal(value(pasted, 'C5').token, 'stone'); assert.equal(value(pasted, 'H5').token, 'stone');
  assert.equal(deviceStatus(STAGES[3], pasted).pedestals.satisfied, true);
  const win = J(1)(pasted); assert.equal(at(win), 'L5'); assert.equal(win.phase, 'won');
  assert.equal(at(J(1)(h5)), 'I5', 'blank H5 breaks the run before pasting');
  const moved = paste(run(3, R(1), cut, J(1), R(1)));
  assert.equal(value(moved, 'C5'), undefined); assert.equal(value(moved, 'H5').token, 'stone');
  assert.deepEqual(deviceStatus(STAGES[3], moved).pedestals.lit, [false, true]);
  assert.equal(J(1)(moved).reason, 'doorDrop');
  const one = run(3, copy, R(1), R(1), R(1), R(1), R(1), R(1)); assert.equal(at(one), 'H5');
  assert.equal(deviceStatus(STAGES[3], paste(one)).pedestals.satisfied, false, 'a plain 1 is not a stone');
});

test('room 05: copy+paste makes two keys and fires the laser; cut+paste moves the one key and opens', () => {
  const twin = paste(run(4, R(1), copy, J(1), R(1)));
  assert.equal(twin.phase, 'failed'); assert.equal(twin.reason, 'laser'); assert.equal(twin.deaths, 1);
  assert.equal(countTokens(twin.values, 'key'), 2); assert.equal(cellName(twin.trap), 'H5');
  const pending = run(4, R(1), cut, J(1), R(1));
  assert.equal(value(pending, 'C5').token, 'key', 'cut alone does not remove the key'); assert.equal(exitOpen(STAGES[4], pending), false);
  const moved = paste(pending);
  assert.equal(moved.phase, 'playing'); assert.equal(value(moved, 'C5'), undefined); assert.equal(value(moved, 'H5').id, 'KEY_05');
  assert.equal(countTokens(moved.values, 'key'), 1); assert.equal(moved.clipboard, null); assert.equal(exitOpen(STAGES[4], moved), true);
  const win = J(1)(moved); assert.equal(at(win), 'L5'); assert.equal(win.phase, 'won');
  assert.equal(run(4, J(1), R(1), J(1), J(1)).reason, 'doorDrop', 'no key in the lock: the shutter falls');
  const reset = restart(pending); assert.equal(reset.clipboard, null); assert.equal(value(reset, 'C5').token, 'key');
  assert.equal(cancelClipboard(pending).clipboard, null);
});

test('paste without a clipboard or past the grid changes nothing', () => {
  const s = run(3, R(1)); assert.equal(paste(s), s);
  const wide = run(3, times(3, SH(1, 0, true)), copy, J(1), R(1)); assert.equal(paste(wide), wide);
});

test('blank gaps and contiguous values produce different destinations', () => {
  const values = {'2,5': 1, '3,5': 1, '7,5': 1, '8,5': 1};
  assert.equal(edge({col:2,row:5},1,0,values).col, 3);
  assert.equal(edge({col:3,row:5},1,0,values).col, 7);
  assert.equal(edge({col:4,row:5},1,0,values).col, 7);
  assert.equal(edge({col:2,row:5},1,0,STAGES[0].values).col, 12);
});

test('unstarted or completed rooms cannot move', () => {
  const ready = createState(); assert.equal(move(ready,1,0),ready); assert.equal(copy(ready), ready);
  const won = move(begin(ready),1,0,true); assert.equal(move(won,-1,0),won); assert.equal(paste(won), won);
});
