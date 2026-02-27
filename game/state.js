// ── Constants (module-level, shared across all game instances) ─────────────

const BOARD_SIZE  = 10;
const MAX_ACTIONS = 3;
const MOVE_RANGE  = 2;

const UNIT_CONFIG = {
  large:  { range: 3 },
  medium: { range: 2 },
  small:  { range: 1 },
  tower:  { range: 2 }, // immovable; territory like medium; beaten by small & medium
};

const UNIT_COSTS = { large: 325, medium: 200, small: 75, tower: 200 };

// Capture hierarchy — each attacker type lists the types it can destroy
const BEATS = {
  small:  ['large', 'tower'],
  large:  ['medium'],
  medium: ['small', 'tower'],
  tower:  [],
};

// ── Factory ───────────────────────────────────────────────────────────────

function createGame() {
  // ── Mutable state (closed over per game instance) ──────────────────────

  let nextUnitId    = 1;
  let currentPlayer = 1;
  let money         = { 1: 100, 2: 100 };

  const state = {
    board: Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => ({ unitId: null, territory: null }))
    ),
    units: {},
  };

  let turnSnapshot    = null;
  let turnActionCount = 0;
  let turnMoves       = new Map(); // unitId → { fromRow, fromCol, capturedUnit }
  let turnPlacements  = new Set(); // unitIds placed this turn

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

  // ── Territory ─────────────────────────────────────────────────────────────

  function unitContributesTerritory(unit) {
    if (unit.type === 'tower') return true; // towers always contribute
    const { range } = UNIT_CONFIG[unit.type];
    const { row, col } = unit.position;
    return friendlyUnits(unit.player).some(other =>
      other.id !== unit.id &&
      manhattan(row, col, other.position.row, other.position.col) <= range
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
      board:      JSON.parse(JSON.stringify(state.board)),
      units:      JSON.parse(JSON.stringify(state.units)),
      nextUnitId,
      money:      { ...money },
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
    const base       = 200;
    const terrBonus  = Math.floor(territory / 5) * 10;
    const towerBonus = towerCount * 5;
    return { total: base + terrBonus + towerBonus, base, terrBonus, towerBonus };
  }

  function collectIncome(player) {
    money[player] = (money[player] || 0) + nextIncomeFor(player).total;
  }

  function startTurn() {
    // Income is collected at END of turn (in submitTurn), not here.
    turnSnapshot    = snapshotState();
    turnActionCount = 0;
    turnMoves       = new Map();
    turnPlacements  = new Set();
  }

  function restartTurn() {
    if (!turnSnapshot) return { error: 'No turn snapshot available' };
    restoreSnapshot(turnSnapshot);
    turnSnapshot    = snapshotState();
    turnActionCount = 0;
    turnMoves       = new Map();
    turnPlacements  = new Set();
    return { ok: true };
  }

  function submitTurn() {
    collectIncome(currentPlayer); // collect at end of YOUR turn
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    startTurn();
    return { ok: true };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validatePlacement(type, row, col, player) {
    if (player !== currentPlayer)       return 'Not your turn';
    if (turnMoves.size > 0)             return 'Cannot place units after moving';
    if (turnActionCount >= MAX_ACTIONS)  return 'No actions remaining this turn';
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE)
                                         return 'Position out of bounds';
    if (state.board[row][col].unitId !== null) return 'Cell already occupied';

    const cost = UNIT_COSTS[type];
    if (!cost)                           return `Unknown unit type: ${type}`;
    if ((money[player] || 0) < cost)     return `Not enough money (need $${cost})`;

    if (state.board[row][col].territory !== player)
                                         return 'Can only place units in your own territory';
    return null;
  }

  function validateMove(id, toRow, toCol) {
    const unit = state.units[id];
    if (!unit)                          return 'Unit not found';
    if (unit.type === 'tower')          return 'Towers cannot move';
    if (unit.player !== currentPlayer)  return 'Not your turn';
    if (turnActionCount >= MAX_ACTIONS) return 'No actions remaining this turn';
    if (turnMoves.has(id))              return 'This unit has already moved this turn';
    if (toRow < 0 || toRow >= BOARD_SIZE || toCol < 0 || toCol >= BOARD_SIZE)
                                        return 'Position out of bounds';

    const dist = manhattan(unit.position.row, unit.position.col, toRow, toCol);
    if (dist === 0)        return 'Already at that position';
    if (dist > MOVE_RANGE) return `Cannot move more than ${MOVE_RANGE} spaces`;

    const targetId = state.board[toRow][toCol].unitId;
    if (targetId) {
      const target = state.units[targetId];
      if (target.player === unit.player)       return 'Cannot move into a friendly piece';
      if (target.type === unit.type)           return 'Cannot move into an enemy piece of the same size';
      if (!canCapture(unit.type, target.type)) return 'That piece would be destroyed in that matchup';
    }

    return null;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  // Bypass all turn/action/money/territory rules — for initial board setup and tests.
  function placeInitialUnit(type, row, col, player) {
    const id   = `u${nextUnitId++}`;
    const unit = { id, type, position: { row, col }, player: Number(player) };
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
    const unit = { id, type, position: { row, col }, player: p };
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

    const targetId     = state.board[toRow][toCol].unitId;
    const capturedUnit = targetId
      ? JSON.parse(JSON.stringify(state.units[targetId]))
      : null;

    if (targetId) delete state.units[targetId];

    state.board[fromRow][fromCol].unitId = null;
    state.board[toRow][toCol].unitId     = id;
    unit.position = { row: toRow, col: toCol };

    turnMoves.set(id, { fromRow, fromCol, capturedUnit });
    turnActionCount++;
    computeTerritory();
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

  // ── Public API ────────────────────────────────────────────────────────────

  function getState() {
    return {
      board: state.board,
      units: state.units,
      territoryCounts: territoryCounts(),
      currentPlayer,
      money,
      unitCosts: UNIT_COSTS,
      nextIncome: { 1: nextIncomeFor(1), 2: nextIncomeFor(2) },
      turn: {
        actionCount:   turnActionCount,
        maxActions:    MAX_ACTIONS,
        movedUnitIds:  [...turnMoves.keys()],
        placedUnitIds: [...turnPlacements],
        hasMovedAny:   turnMoves.size > 0,
      },
    };
  }

  return {
    getState, addUnit, moveUnit, undoUnitMove, undoUnitPlacement,
    restartTurn, submitTurn, placeInitialUnit, startTurn,
  };
}

// ── Module exports ────────────────────────────────────────────────────────

module.exports = { createGame, BOARD_SIZE, UNIT_COSTS, BEATS };
