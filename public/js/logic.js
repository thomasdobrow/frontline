// ── Shared pure logic — loaded in browser and required in Node tests ─────────
// In the browser this file is loaded via <script> before main.js, making
// BEATS / canCapture / manhattan / validMoveTargets available as globals.
// In Node (tests) they are exported via module.exports.

const BEATS = {
  small:  ['large', 'tower'],
  large:  ['medium', 'tower'],
  medium: ['small', 'tower'],
  tower:  [],
};

const canCapture = (at, dt) => (BEATS[at] || []).includes(dt);

const manhattan = (r1, c1, r2, c2) => Math.abs(r1 - r2) + Math.abs(c1 - c2);

// Returns the Set of `"row,col"` strings that `unitId` can legally move to,
// given the current boardState and this-turn tracking data.
// Takes explicit arguments so it can be called from both browser and tests.
function validMoveTargets(unitId, boardState, turn) {
  const { movedUnitIds = [], attackedUnitIds = [] } = turn;
  if (movedUnitIds.includes(unitId) || attackedUnitIds.includes(unitId)) return new Set();

  const unit = boardState.units[unitId];
  if (!unit) return new Set();
  if (unit.type === 'tower') return new Set();

  const { row, col } = unit.position;
  const onMountain = boardState.board[row]?.[col]?.mountain;
  const range = onMountain ? 3 : 2;
  const targets = new Set();

  boardState.board.forEach((rowArr, r) =>
    rowArr.forEach((cell, c) => {
      const dist = manhattan(row, col, r, c);
      if (dist === 0 || dist > range) return;
      if (!cell.unitId) {
        targets.add(`${r},${c}`);
      } else {
        const occ = boardState.units[cell.unitId];
        if (occ && occ.player !== unit.player) {
          if (canCapture(unit.type, occ.type) || occ.type === unit.type)
            targets.add(`${r},${c}`);
        }
      }
    })
  );
  return targets;
}

if (typeof module !== 'undefined') {
  module.exports = { BEATS, canCapture, manhattan, validMoveTargets };
}
