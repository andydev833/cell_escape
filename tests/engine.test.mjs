import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOM, createState, begin, move, restart, edge, cellName, isTrap, isSafe, isWalkable } from '../dist/engine.js';
const walk = (s, n, dx = 1) => { for (let i = 0; i < n; i++) s = move(s, dx, 0); return s; };
test('three steps right are safe; the fourth lands on F5 and fails exactly once', () => {
  let s = begin(createState());
  for (const name of ['C5', 'D5', 'E5']) {
    s = move(s, 1, 0);
    assert.equal(s.phase, 'playing'); assert.equal(s.deaths, 0); assert.equal(cellName(s.position), name);
  }
  s = move(s, 1, 0);
  assert.equal(s.phase, 'failed'); assert.equal(s.reason, 'ceilingPress'); assert.equal(s.deaths, 1);
  assert.equal(cellName(s.position), 'F5'); assert.equal(cellName(s.trap), 'F5');
  for (const [dx, dy, jump] of [[1,0,false],[1,0,true],[-1,0,false]]) assert.equal(move(s, dx, dy, jump), s);
});
test('every safe cell can jump to the exit with a modified arrow, firing no trap on the way', () => {
  for (let steps = 0; steps <= 3; steps++) {
    const s = move(walk(begin(createState()), steps), 1, 0, true);
    assert.equal(s.phase, 'won'); assert.equal(s.deaths, 0); assert.equal(s.trap, null); assert.equal(cellName(s.position), 'L5');
  }
});
test('the safe corridor can be walked back and forth', () => {
  let s = walk(begin(createState()), 3);
  s = walk(s, 3, -1); assert.equal(cellName(s.position), 'B5'); assert.equal(s.phase, 'playing');
  s = walk(s, 2); assert.equal(cellName(s.position), 'D5'); assert.equal(s.deaths, 0);
  assert.equal(cellName(move(s, -1, 0, true).position), 'B5');
});
test('walls leave position and deaths unchanged, including modified jumps out of the room', () => {
  const fresh = begin(createState());
  for (const [dx, dy] of [[-1,0],[0,-1],[0,1]]) for (const jump of [false, true]) assert.equal(move(fresh, dx, dy, jump), fresh);
  const e5 = walk(fresh, 3);
  for (const [dx, dy] of [[0,-1],[0,1]]) for (const jump of [false, true]) assert.equal(move(e5, dx, dy, jump), e5);
});
test('retry restores the room, keeps the death count, and the first three steps are safe again', () => {
  const failed = walk(begin(createState()), 4);
  const retry = restart(failed);
  assert.equal(retry.phase, 'playing'); assert.equal(retry.deaths, 1); assert.equal(retry.trap, null);
  assert.equal(cellName(retry.position), 'B5');
  const again = walk(retry, 3); assert.equal(again.phase, 'playing'); assert.equal(again.deaths, 1);
  assert.equal(move(retry, 1, 0, true).phase, 'won');
});
test('stage spans: B5:E5 safe, F5:K5 traps, L5 exit, B5:L5 contiguous data', () => {
  for (let c = 2; c <= 12; c++) {
    const p = { col: c, row: 5 };
    assert.equal(isWalkable(p), true); assert.equal(ROOM.values[`${c},5`], 1);
    assert.equal(isTrap(p), c >= 6 && c <= 11, cellName(p)); assert.equal(isSafe(p), !isTrap(p), cellName(p));
  }
  for (const p of [{col:1,row:5},{col:13,row:5},{col:2,row:4},{col:6,row:6}]) assert.equal(isWalkable(p), false);
});
test('blank gaps and contiguous values produce different destinations', () => {
  const values = {'2,5': 1, '3,5': 1, '7,5': 1, '8,5': 1};
  assert.equal(edge({col:2,row:5},1,0,values).col, 3);
  assert.equal(edge({col:3,row:5},1,0,values).col, 7);
  assert.equal(edge({col:4,row:5},1,0,values).col, 7);
  assert.equal(edge({col:2,row:5},1,0).col, 12);
});
test('unstarted or completed rooms cannot move', () => {
  const ready = createState(); assert.equal(move(ready,1,0),ready);
  const won = move(begin(ready),1,0,true); assert.equal(move(won,-1,0),won);
});
