// ── Constants (module-level, shared across all game instances) ─────────────

const BOARD_SIZE  = 11;
const MOVE_RANGE  = 2;
const STAGE_SIZE  = 17;  // individual player turns per action-limit stage (3→4→5→…)

const UNIT_CONFIG = {
  large:  { range: 3 },
  medium: { range: 2 },
  small:  { range: 1 },
  tower:  { range: 2 }, // immovable; territory like medium; beaten by small & medium
};

const UNIT_COSTS    = { large: 100, medium: 60, small: 25, tower: 50 };
const STARTING_MONEY = { 1: 60, 2: 70 };

// Mountain tiles — units cannot be placed on these; +1 move range if starting there
const MOUNTAINS = new Set(['3,3', '3,7', '7,3', '7,7']);
function isMountain(r, c) { return MOUNTAINS.has(`${r},${c}`); }

// Capture hierarchy — each attacker type lists the types it can destroy
const BEATS = {
  small:  ['large', 'tower'],
  large:  ['medium', 'tower'],
  medium: ['small', 'tower'],
  tower:  [],
};

// ── Factory ───────────────────────────────────────────────────────────────

function createGame({ waterTiles = [] } = {}) {
  // ── Mutable state (closed over per game instance) ──────────────────────

  let nextUnitId      = 1;
  let currentPlayer   = 1;
  let globalTurnNumber = 0;
  let money            = { ...STARTING_MONEY };

  const isWater = (r, c) => waterTiles.some(t => t.row === r && t.col === c);

  const state = {
    board: Array.from({ length: BOARD_SIZE }, (_, r) =>
      Array.from({ length: BOARD_SIZE }, (_, c) => ({
        unitId: null, territory: null, mountain: isMountain(r, c), water: isWater(r, c),
      }))
    ),
    units: {},
  };

  let turnSnapshot    = null;
  let turnActionCount = 0;
  let turnMoves       = new Map(); // unitId → { fromRow, fromCol, capturedUnit }
  let turnPlacements  = new Set(); // unitIds placed this turn
  let turnAttacks     = new Map(); // unitId → { targetId, capturedTarget, attackerHpBefore, targetHpBefore, targetDestroyed, attackerDestroyed }

  let winner    = null; // null | 1 | 2
  let winReason = null; // null | 'elimination' | 'resignation'

  // ── Helpers ──────────────────────────────────────────────────────────────

  function manhattan(r1, c1, r2, c2) {
    return Math.abs(r1 - r2) + Math.abs(c1 - c2);
  }

  function friendlyUnits(player) {
    return Object.values(state.units).filter(u => u.player === player);
  }

  function canCapture(attackerType, defenderType) {
    return (BEATS[attackerType] || []).includes(defenderType);
  }

  function checkWinner() {
    if (winner !== null) return;
    const p1Units = Object.values(state.units).filter(u => u.player === 1).length;
    const p2Units = Object.values(state.units).filter(u => u.player === 2).length;
    if      (p1Units === 0) { winner = 2; winReason = 'elimination'; }
    else if (p2Units === 0) { winner = 1; winReason = 'elimination'; }
  }

  // Actions per turn escalates every STAGE_SIZE global turns: 3 → 4 → 5 → …
  function currentMaxActions() {
    if (globalTurnNumber < 1) return 3;
    return 3 + Math.floor((globalTurnNumber - 1) / STAGE_SIZE);
  }

  function effectiveMoveRange(unit) {
    const { row, col } = unit.position;
    return isMountain(row, col) ? MOVE_RANGE + 1 : MOVE_RANGE;
  }

  // BFS reachability check — respects water obstacles and unit blocking.
  // Returns true if unit `id` can reach (toRow, toCol) within its move range.
  function canReachCell(id, toRow, toCol) {
    const unit  = state.units[id];
    const range = effectiveMoveRange(unit);
    const { row: startRow, col: startCol } = unit.position;
    const queue   = [[startRow, startCol, 0]];
    const visited = new Set([`${startRow},${startCol}`]);
    while (queue.length) {
      const [r, c, steps] = queue.shift();
      if (r === toRow && c === toCol) return true;
      if (steps >= range) continue;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = r + dr, nc = c + dc;
        const key = `${nr},${nc}`;
        if (visited.has(key)) continue;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        const cell = state.board[nr][nc];
        if (cell.water) continue;
        // Allow entering the destination even if occupied (enemy unit);
        // block traversal through any other occupied cell.
        if (cell.unitId && cell.unitId !== id && !(nr === toRow && nc === toCol)) continue;
        visited.add(key);
        queue.push([nr, nc, steps + 1]);
      }
    }
    return false;
  }

  // ── Territory ─────────────────────────────────────────────────────────────

  // A unit activates its territory projection when it is within distance 2 of
  // any other friendly unit or building.  The distance-2 threshold is fixed
  // for all unit types; the RANGE of the projected territory still comes from
  // UNIT_CONFIG (1 / 2 / 3 depending on type).
  const TERRITORY_ACTIVATION_DIST = 2;

  function unitContributesTerritory(unit) {
    if (unit.type === 'tower') return true; // towers always project
    const { row, col } = unit.position;
    return friendlyUnits(unit.player).some(other =>
      other.id !== unit.id &&
      manhattan(row, col, other.position.row, other.position.col) <= TERRITORY_ACTIVATION_DIST
    );
  }

  function computeTerritory() {
    const contrib = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => new Set())
    );

    for (const unit of Object.values(state.units)) {
      if (!unitContributesTerritory(unit)) continue;
      const { range } = UNIT_CONFIG[unit.type];
      const { row, col } = unit.position;
      const p = Number(unit.player);
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (manhattan(row, col, r, c) <= range) contrib[r][c].add(p);
        }
      }
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const claimants = [...contrib[r][c]];
        state.board[r][c].territory = claimants.length === 1 ? claimants[0] : null;
        state.board[r][c].contested = claimants.length > 1;
        // mountain flag is set at init and never cleared by territory compute
      }
    }
  }

  function territoryCounts() {
    const counts = {};
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const t = state.board[r][c].territory;
        if (t != null) counts[t] = (counts[t] || 0) + 1;
      }
    }
    return counts;
  }

  // ── Turn management ───────────────────────────────────────────────────────

  function snapshotState() {
    return {
      board:     JSON.parse(JSON.stringify(state.board)),
      units:     JSON.parse(JSON.stringify(state.units)),
      nextUnitId,
      money:     { ...money },
    };
  }

  function restoreSnapshot(snapshot) {
    state.board = snapshot.board;
    state.units = snapshot.units;
    nextUnitId  = snapshot.nextUnitId;
    money       = { ...snapshot.money };
  }

  function nextIncomeFor(player) {
    const territory  = territoryCounts()[player] || 0;
    const towerCount = Object.values(state.units).filter(u => u.player === player && u.type === 'tower').length;
    const base       = 10;
    const terrBonus  = territory;       // $1 per territory cell
    const towerBonus = towerCount * 3;
    return { total: base + terrBonus + towerBonus, base, terrBonus, towerBonus };
  }

  function collectIncome(player) {
    const income = nextIncomeFor(player).total;
    money[player] = (money[player] || 0) + income;
  }

  function startTurn() {
    // Income is collected at END of turn (in submitTurn), not here.
    globalTurnNumber++;
    turnSnapshot    = snapshotState();
    turnActionCount = 0;
    turnMoves       = new Map();
    turnPlacements  = new Set();
    turnAttacks     = new Map();
  }

  function restartTurn() {
    if (winner !== null)  return { error: 'Game is over' };
    if (!turnSnapshot) return { error: 'No turn snapshot available' };
    restoreSnapshot(turnSnapshot);
    turnSnapshot    = snapshotState();
    turnActionCount = 0;
    turnMoves       = new Map();
    turnPlacements  = new Set();
    turnAttacks     = new Map();
    return { ok: true };
  }

  function submitTurn() {
    if (winner !== null) return { error: 'Game is over' };
    collectIncome(currentPlayer); // collect at end of YOUR turn
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    startTurn();
    return { ok: true };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validatePlacement(type, row, col, player) {
    if (winner !== null)                 return 'Game is over';
    if (player !== currentPlayer)       return 'Not your turn';
    if (turnMoves.size > 0 || turnAttacks.size > 0)
                                         return 'Cannot place units after moving';
    if (turnActionCount >= currentMaxActions())  return 'No actions remaining this turn';
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE)
                                         return 'Position out of bounds';
    if (isMountain(row, col))            return 'Cannot place units on mountains';
    if (state.board[row][col].water)     return 'Cannot place units on water';
    if (state.board[row][col].unitId !== null) return 'Cell already occupied';

    const cost = UNIT_COSTS[type];
    if (!cost)                           return `Unknown unit type: ${type}`;
    if ((money[player] || 0) < cost)     return `Not enough money (need $${cost})`;

    if (state.board[row][col].territory !== player)
                                         return 'Can only place units in your own territory';
    return null;
  }

  function validateMove(id, toRow, toCol) {
    if (winner !== null)                return 'Game is over';
    const unit = state.units[id];
    if (!unit)                          return 'Unit not found';
    if (unit.type === 'tower')          return 'Towers cannot move';
    if (unit.player !== currentPlayer)  return 'Not your turn';
    if (turnActionCount >= currentMaxActions()) return 'No actions remaining this turn';
    if (turnPlacements.has(id))                 return 'Units placed this turn cannot move until next turn';
    if (turnMoves.has(id))              return 'This unit has already moved this turn';
    if (turnAttacks.has(id))            return 'This unit has already attacked this turn';
    if (toRow < 0 || toRow >= BOARD_SIZE || toCol < 0 || toCol >= BOARD_SIZE)
                                        return 'Position out of bounds';

    const range = effectiveMoveRange(unit);
    const dist  = manhattan(unit.position.row, unit.position.col, toRow, toCol);
    if (dist === 0)      return 'Already at that position';
    if (dist > range)    return `Cannot move more than ${range} spaces`;
    if (state.board[toRow][toCol].water)  return 'Cannot move onto water';
    if (!canReachCell(id, toRow, toCol))  return 'Cannot reach that cell';

    const targetId = state.board[toRow][toCol].unitId;
    if (targetId) {
      const target = state.units[targetId];
      // Defensive: board and units map should always agree; if they don't,
      // treat the cell as occupied-but-unknown rather than crashing.
      if (!target)                             return 'Target cell is in an inconsistent state — please restart your turn';
      if (target.player === unit.player)       return 'Cannot move into a friendly piece';
      // Same type: allowed as a same-type attack (attacker stays)
      if (target.type !== unit.type && !canCapture(unit.type, target.type))
                                               return 'That piece would be destroyed in that matchup';
    }

    return null;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  // Bypass all turn/action/money/territory rules — for initial board setup and tests.
  function placeInitialUnit(type, row, col, player) {
    const id   = `u${nextUnitId++}`;
    const unit = { id, type, position: { row, col }, player: Number(player), hp: 2 };
    state.units[id]              = unit;
    state.board[row][col].unitId = id;
    computeTerritory();
    return unit;
  }

  function addUnit(type, row, col, player = 1) {
    const p = Number(player);
    const error = validatePlacement(type, row, col, p);
    if (error) return { error };

    const id   = `u${nextUnitId++}`;
    const unit = { id, type, position: { row, col }, player: p, hp: 2 };
    state.units[id]              = unit;
    state.board[row][col].unitId = id;
    money[p] -= UNIT_COSTS[type];
    turnPlacements.add(id);
    turnActionCount++;
    computeTerritory();
    return { unit };
  }

  function undoUnitPlacement(id) {
    if (!turnPlacements.has(id))          return { error: 'Unit was not placed this turn' };
    const unit = state.units[id];
    if (!unit)                            return { error: 'Unit not found' };
    if (unit.player !== currentPlayer)    return { error: 'Not your turn' };

    const { row, col } = unit.position;
    state.board[row][col].unitId = null;
    delete state.units[id];
    money[unit.player] += UNIT_COSTS[unit.type];
    turnPlacements.delete(id);
    turnActionCount--;
    computeTerritory();
    return { ok: true };
  }

  function moveUnit(id, toRow, toCol) {
    const error = validateMove(id, toRow, toCol);
    if (error) return { error };

    const unit = state.units[id];
    const { row: fromRow, col: fromCol } = unit.position;

    const targetId   = state.board[toRow][toCol].unitId;
    const targetUnit = targetId ? state.units[targetId] : null;
    // validateMove already caught desync; this is a belt-and-suspenders guard.
    if (targetId && !targetUnit) {
      return { error: 'Target cell is in an inconsistent state — please restart your turn' };
    }

    // ── Same-type attack: attacker stays, both take 1 damage ──────────────
    if (targetUnit && targetUnit.player !== unit.player && targetUnit.type === unit.type) {
      const attackerHpBefore = unit.hp;
      const targetHpBefore   = targetUnit.hp;
      const capturedTarget   = JSON.parse(JSON.stringify(targetUnit));

      unit.hp       -= 1;
      targetUnit.hp -= 1;

      const targetDestroyed   = targetUnit.hp <= 0;
      const attackerDestroyed = unit.hp <= 0;

      if (targetDestroyed) {
        state.board[toRow][toCol].unitId = null;
        delete state.units[targetId];
      }
      if (attackerDestroyed) {
        state.board[fromRow][fromCol].unitId = null;
        delete state.units[id];
      } else if (targetDestroyed) {
        // Attacker survived and destroyed target — advance into the conquered cell
        state.board[fromRow][fromCol].unitId = null;
        state.board[toRow][toCol].unitId = id;
        unit.position = { row: toRow, col: toCol };
      }

      turnAttacks.set(id, {
        targetId, capturedTarget,
        attackerHpBefore, targetHpBefore,
        targetDestroyed, attackerDestroyed,
        fromRow, fromCol,
      });
      turnActionCount++;
      computeTerritory();
      checkWinner();
      return { ok: true, attack: true };
    }

    // ── Normal move / outright capture ────────────────────────────────────
    const capturedUnit = targetUnit
      ? JSON.parse(JSON.stringify(targetUnit))
      : null;

    if (targetId) {
      delete state.units[targetId];
    }

    state.board[fromRow][fromCol].unitId = null;
    state.board[toRow][toCol].unitId     = id;
    unit.position = { row: toRow, col: toCol };

    turnMoves.set(id, { fromRow, fromCol, capturedUnit });
    turnActionCount++;
    computeTerritory();
    if (capturedUnit) checkWinner(); // only check when a unit was actually destroyed
    return { unit };
  }

  function undoUnitMove(id) {
    if (!turnMoves.has(id))             return { error: 'Unit has not moved this turn' };
    const unit = state.units[id];
    if (!unit)                          return { error: 'Unit not found' };
    if (unit.player !== currentPlayer)  return { error: 'Not your turn' };

    const { fromRow, fromCol, capturedUnit } = turnMoves.get(id);
    const { row: curRow, col: curCol }       = unit.position;

    state.board[curRow][curCol].unitId   = null;
    state.board[fromRow][fromCol].unitId = id;
    unit.position = { row: fromRow, col: fromCol };

    if (capturedUnit) {
      state.units[capturedUnit.id]       = capturedUnit;
      state.board[curRow][curCol].unitId = capturedUnit.id;
    }

    turnMoves.delete(id);
    turnActionCount--;
    computeTerritory();
    return { ok: true };
  }

  function undoUnitAttack(id) {
    if (!turnAttacks.has(id)) return { error: 'Unit has not attacked this turn' };

    const { targetId, capturedTarget, attackerHpBefore, targetHpBefore,
            targetDestroyed, attackerDestroyed, fromRow, fromCol } = turnAttacks.get(id);

    // If attacker was destroyed they can't be double-clicked — restart-turn handles it
    if (attackerDestroyed) return { error: 'Attacker was destroyed — use Restart Turn to undo' };

    const unit = state.units[id];
    if (!unit) return { error: 'Attacker not found — use Restart Turn to undo' };

    // Restore attacker position if it advanced into the target cell
    if (targetDestroyed && !attackerDestroyed) {
      const { row: curRow, col: curCol } = unit.position;
      state.board[curRow][curCol].unitId = null;
      state.board[fromRow][fromCol].unitId = id;
      unit.position = { row: fromRow, col: fromCol };
    }

    // Restore attacker HP
    unit.hp = attackerHpBefore;

    // Restore target
    if (targetDestroyed) {
      state.units[capturedTarget.id] = capturedTarget;
      state.board[capturedTarget.position.row][capturedTarget.position.col].unitId = capturedTarget.id;
    } else {
      state.units[targetId].hp = targetHpBefore;
    }

    turnAttacks.delete(id);
    turnActionCount--;
    computeTerritory();
    return { ok: true };
  }

  // ── Resign ────────────────────────────────────────────────────────────────

  function resign(player) {
    if (winner !== null) return { error: 'Game is already over' };
    winner    = player === 1 ? 2 : 1;
    winReason = 'resignation';
    return { ok: true };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function getState() {
    const unitNetWorth = (p) =>
      Object.values(state.units)
        .filter(u => u.player === p)
        .reduce((sum, u) => sum + (UNIT_COSTS[u.type] || 0), 0);

    const curMax             = currentMaxActions();
    const phase              = globalTurnNumber > 0 ? Math.floor((globalTurnNumber - 1) / STAGE_SIZE) : 0;
    const turnsUntilActionBump = globalTurnNumber > 0
      ? (phase + 1) * STAGE_SIZE + 1 - globalTurnNumber
      : STAGE_SIZE;
    const hasActedAny = turnMoves.size > 0 || turnAttacks.size > 0;

    return {
      board: state.board,
      units: state.units,
      waterTiles,
      territoryCounts: territoryCounts(),
      currentPlayer,
      money,
      unitCosts: UNIT_COSTS,
      nextIncome: { 1: nextIncomeFor(1), 2: nextIncomeFor(2) },
      netWorth:   { 1: (money[1] || 0) + unitNetWorth(1), 2: (money[2] || 0) + unitNetWorth(2) },
      winner,
      winReason,
      turnNumber: globalTurnNumber,
      turn: {
        actionCount:         turnActionCount,
        maxActions:          curMax,
        turnsUntilActionBump,
        nextMaxActions:      curMax + 1,
        stageSize:           STAGE_SIZE,
        movedUnitIds:        [...turnMoves.keys()],
        placedUnitIds:       [...turnPlacements],
        attackedUnitIds:     [...turnAttacks.keys()],
        hasMovedAny:         hasActedAny,
      },
    };
  }

  return {
    getState, addUnit, moveUnit, undoUnitMove, undoUnitPlacement, undoUnitAttack,
    restartTurn, submitTurn, placeInitialUnit, startTurn, resign,
  };
}

// ── Module exports ────────────────────────────────────────────────────────

module.exports = { createGame, BOARD_SIZE, STAGE_SIZE, UNIT_COSTS, BEATS, isMountain };
