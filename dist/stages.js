// Rooms are data only; engine.js compiles them. Cells use A1 notation.
// `floor` is where the character can stand, `values` is what Ctrl+arrow and the devices read.
// The two are independent: a blank cell can still have floor (room 03 K5, room 04 H5).
export const STONE = Object.freeze({ token: 'stone' });
export const KEY = Object.freeze({ token: 'key', id: 'KEY_05' });

export const STAGE_DEFS = [
  {
    id: 'room-01', title: '一歩目', lead: '出口は、すぐそこ。',
    start: 'B5', exit: 'L5',
    floor: ['B5:L5'], values: [['B5:L5', 1]],
    traps: [{ cells: 'F5:K5', type: 'ceilingPress' }],
    hints: ['あの床に、止まらずに進めないかな？', '矢印に、もうひとつのキーを添えてみよう。', 'Ctrl を押したまま、→ を一回。'],
    keys: [['Ctrl', '→']],
  },
  {
    id: 'room-02', title: '見えている出口', lead: '光るほうへ？',
    start: 'B3', exit: 'L7',
    floor: ['B3:L3', 'E3:E7', 'E7:L7'], values: [['B3:L3', 1], ['E3:E7', 1], ['E7:L7', 1]],
    traps: [
      { cells: 'F3:K3', type: 'ceilingPress' },
      { cells: 'L3', type: 'fakeExit' },
      { cells: 'E5:E6', type: 'floorDrop' },
      { cells: 'I7:K7', type: 'ceilingPress' },
    ],
    hints: ['明るい扉が、本物とは限らない。', '途中の床から、下にも続いている。', '右に3歩。Ctrl＋↓、それからCtrl＋→。'],
    keys: [['Ctrl', '↓'], ['Ctrl', '→']],
  },
  {
    id: 'room-03', title: 'ひとりでは開かない', lead: '五つの灯りは、まだ暗い。',
    start: 'B5', exit: 'L5', door: 'closed',
    floor: ['B5:L5'], values: [['B5:J5', 1], ['L5', 1]],
    traps: [{ cells: 'F5:J5', type: 'spikes', disarmedBy: 'plates' }],
    devices: [{ id: 'plates', kind: 'selectAll', cells: 'F5:J5' }],
    exitNeeds: 'plates', exitTrap: 'doorDrop',
    hints: ['ひとつだけでは、開かない。', '自分が動かず、床をまとめて囲めないかな？', 'Ctrl＋Shift＋→でまとめて囲む。開いたら、Ctrl＋→で進もう。'],
    keys: [['Ctrl', 'Shift', '→'], ['Ctrl', '→']],
  },
  {
    id: 'room-04', title: 'ふたつの灯り', lead: '灯りは、まだひとつ。',
    start: 'B5', exit: 'L5', door: 'ajar',
    floor: ['B5:L5'], values: [['B5:G5', 1], ['I5:L5', 1], ['C5', STONE]],
    devices: [{ id: 'pedestals', kind: 'tokens', cells: ['C5', 'H5'], token: 'stone' }],
    exitNeeds: 'pedestals', exitTrap: 'doorDrop',
    hints: ['扉を支えるものが、まだ足りない。', 'ひとつは残したまま、もうひとつ置けないかな？', 'C5でCtrl＋C。H5へ移動してCtrl＋V。'],
    keys: [['Ctrl', 'C'], ['Ctrl', 'V']],
  },
  {
    id: 'room-05', title: 'ふたつはいらない', lead: '鍵穴は、ひとつ。',
    start: 'B5', exit: 'L5', door: 'locked',
    floor: ['B5:L5'], values: [['B5:G5', 1], ['I5:L5', 1], ['C5', KEY]],
    shelf: 'C5',
    devices: [{ id: 'lock', kind: 'tokens', cells: ['H5'], token: 'key', count: 1 }],
    rules: [{ kind: 'tokenLimit', token: 'key', limit: 1, type: 'laser' }],
    exitNeeds: 'lock', exitTrap: 'doorDrop',
    hints: ['ここに必要なのは、ひとつだけ。', '増やすと見つかる。元の場所には、残さない。', 'C5でCtrl＋X。H5へ移動してCtrl＋V。'],
    keys: [['Ctrl', 'X'], ['Ctrl', 'V']],
  },
];
