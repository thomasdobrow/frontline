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
// Uses BFS so water tiles (cell.water) and unit-occupied cells block traversal.
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
  const rows  = boardState.board.length;
  const cols  = boardState.board[0].length;
  const myPlayer = unit.player;

  const targets = new Set();
  const queue   = [[row, col, 0]];
  const visited = new Set([`${row},${col}`]);

  while (queue.length) {
    const [r, c, steps] = queue.shift();
    if (steps >= range) continue;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const cell = boardState.board[nr][nc];
      if (cell.water) continue;
      const occId = cell.unitId;
      if (occId) {
        const occ = boardState.units[occId];
        if (occ && occ.player !== myPlayer) {
          // Enemy cell: valid target if capturable or same type; not traversable
          if (canCapture(unit.type, occ.type) || occ.type === unit.type)
            targets.add(key);
        }
        // Friendly or invalid enemy: blocks traversal entirely
      } else {
        targets.add(key);
        visited.add(key);
        queue.push([nr, nc, steps + 1]);
      }
    }
  }
  return targets;
}

if (typeof module !== 'undefined') {
  module.exports = { BEATS, canCapture, manhattan, validMoveTargets };
}
