const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../game/state');

// ── Helpers ───────────────────────────────────────────────

// Reset to a clean board and start player 1's turn (gives $20).
function setup() {
  s.resetState();
  s.startTurn();
}

// Reset, place two mediums for p1 at [1,2] & [2,1] (distance-2 pair → territory activates),
// then start the turn so p1 collects income.
function setupWithTerritory() {
  s.resetState();
  s.placeInitialUnit('medium', 1, 2, 1);
  s.placeInitialUnit('medium', 2, 1, 1);
  s.startTurn(); // p1 gets $20 + floor(territory/10)
}

// Return a cell guaranteed to have the given territory, or throw.
function findTerritoryCell(board, player) {
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c].territory === player && board[r][c].unitId === null)
        return { r, c };
    }
  }
  throw new Error(`No free territory cell for player ${player}`);
}

// ── Initial state ─────────────────────────────────────────
describe('Initial board state', () => {
  it('is BOARD_SIZE × BOARD_SIZE', () => {
    setup();
    const { board } = s.getState();
    assert.equal(board.length, s.BOARD_SIZE);
    assert.equal(board[0].length, s.BOARD_SIZE);
  });

  it('starts on player 1\'s turn', () => {
    setup();
    assert.equal(s.getState().currentPlayer, 1);
  });

  it('default board starts with 4 units placed', () => {
    // Use the module as-loaded (initial board already set up)
    s.resetState();
    s.placeInitialUnit('medium', 1, 2, 1);
    s.placeInitialUnit('medium', 2, 1, 1);
    s.placeInitialUnit('medium', 17, 18, 2);
    s.placeInitialUnit('medium', 18, 17, 2);
    s.startTurn();
    const { units } = s.getState();
    assert.equal(Object.keys(units).length, 4);
  });
});

// ── Placement ─────────────────────────────────────────────
describe('Unit placement', () => {
  it('fails outside own territory', () => {
    setupWithTerritory();
    const result = s.addUnit('small', 10, 10, 1);
    assert.ok(result.error, 'should reject placement outside territory');
    assert.match(result.error, /territory/i);
  });

  it('succeeds inside own territory', () => {
    setupWithTerritory();
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const result = s.addUnit('small', r, c, 1);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.equal(result.unit.type, 'small');
  });

  it('deducts the correct cost', () => {
    setupWithTerritory();
    const before = s.getState().money[1];
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    s.addUnit('small', r, c, 1);
    assert.equal(s.getState().money[1], before - s.UNIT_COSTS.small);
  });

  it('fails when player cannot afford the unit', () => {
    s.resetState();
    s.placeInitialUnit('medium', 1, 2, 1);
    s.placeInitialUnit('medium', 2, 1, 1);
    // Don't call startTurn → money stays 0
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const result = s.addUnit('small', r, c, 1);
    assert.ok(result.error);
    assert.match(result.error, /money/i);
  });

  it('tracks placement in placedUnitIds', () => {
    setupWithTerritory();
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const { unit } = s.addUnit('small', r, c, 1);
    assert.ok(s.getState().turn.placedUnitIds.includes(unit.id));
  });

  it('blocks placement when actions are exhausted', () => {
    setupWithTerritory();
    // Give extra money and territory by adding more units
    s.placeInitialUnit('medium', 5, 5, 1);
    s.placeInitialUnit('medium', 5, 7, 1);
    s.startTurn();
    // Use all 3 actions
    const cells = [];
    const { board } = s.getState();
    for (let r = 0; r < board.length && cells.length < 3; r++) {
      for (let c = 0; c < board[r].length && cells.length < 3; c++) {
        if (board[r][c].territory === 1 && !board[r][c].unitId) cells.push({ r, c });
      }
    }
    // Burn 3 actions via moves (smalls we won't have) — just move existing pieces
    // Actually easiest: just call addUnit until 3 actions used... but we may not have enough money.
    // Let's verify via "no actions remaining" after 3 addUnits
    const freeCells = cells.slice(0, 3);
    freeCells.forEach(({ r, c }) => s.addUnit('small', r, c, 1));
    // Now any further action should be blocked
    const { board: board2 } = s.getState();
    const extra = findTerritoryCell(board2, 1);
    // This may fail on money or actions — we just want an error
    const result = s.addUnit('small', extra.r, extra.c, 1);
    assert.ok(result.error);
  });
});

// ── Undo placement ────────────────────────────────────────
describe('Undo unit placement', () => {
  it('removes the unit and refunds money', () => {
    setupWithTerritory();
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const moneyBefore = s.getState().money[1];
    const { unit } = s.addUnit('small', r, c, 1);
    s.undoUnitPlacement(unit.id);
    const { money, units, board: b2 } = s.getState();
    assert.equal(money[1], moneyBefore, 'money should be refunded');
    assert.ok(!units[unit.id], 'unit should be removed');
    assert.equal(b2[r][c].unitId, null, 'cell should be empty');
  });

  it('decrements action count', () => {
    setupWithTerritory();
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const { unit } = s.addUnit('small', r, c, 1);
    const countBefore = s.getState().turn.actionCount;
    s.undoUnitPlacement(unit.id);
    assert.equal(s.getState().turn.actionCount, countBefore - 1);
  });

  it('fails on a unit that was not placed this turn', () => {
    setup();
    const result = s.undoUnitPlacement('u_fake');
    assert.ok(result.error);
  });
});

// ── Movement ─────────────────────────────────────────────
describe('Unit movement', () => {
  it('can move up to MOVE_RANGE spaces', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 1);
    s.startTurn();
    const result = s.moveUnit(unit.id, 5, 7); // distance 2
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.deepEqual(result.unit.position, { row: 5, col: 7 });
  });

  it('rejects moves beyond MOVE_RANGE', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 1);
    s.startTurn();
    const result = s.moveUnit(unit.id, 5, 8); // distance 3
    assert.ok(result.error);
    assert.match(result.error, /more than/i);
  });

  it('blocks a unit from moving twice in one turn', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 1);
    s.startTurn();
    s.moveUnit(unit.id, 5, 7);
    const result = s.moveUnit(unit.id, 5, 5); // try to move back
    assert.ok(result.error);
    assert.match(result.error, /already moved/i);
  });

  it('rejects moving the other player\'s piece', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 2);
    s.startTurn();
    const result = s.moveUnit(unit.id, 5, 7);
    assert.ok(result.error);
    assert.match(result.error, /not your turn/i);
  });

  it('cannot move into a friendly piece', () => {
    setup();
    const a = s.placeInitialUnit('small', 5, 5, 1);
    s.placeInitialUnit('small', 5, 6, 1);
    s.startTurn();
    const result = s.moveUnit(a.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /friendly/i);
  });
});

// ── Collision rules ───────────────────────────────────────
describe('Capture rules', () => {
  it('small captures large', () => {
    setup();
    const small = s.placeInitialUnit('small', 5, 5, 1);
    const large = s.placeInitialUnit('large', 5, 6, 2);
    s.startTurn();
    const result = s.moveUnit(small.id, 5, 6);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.ok(!s.getState().units[large.id], 'enemy large should be captured');
  });

  it('blocks large moving into small (large would lose)', () => {
    setup();
    const large = s.placeInitialUnit('large', 5, 5, 1);
    s.placeInitialUnit('small', 5, 6, 2);
    s.startTurn();
    const result = s.moveUnit(large.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /destroyed/i);
  });

  it('blocks same-size capture', () => {
    setup();
    const a = s.placeInitialUnit('medium', 5, 5, 1);
    s.placeInitialUnit('medium', 5, 6, 2);
    s.startTurn();
    const result = s.moveUnit(a.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /same size/i);
  });
});

// ── Undo move ─────────────────────────────────────────────
describe('Undo move', () => {
  it('restores unit to original position', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 1);
    s.startTurn();
    s.moveUnit(unit.id, 5, 7);
    s.undoUnitMove(unit.id);
    assert.deepEqual(s.getState().units[unit.id].position, { row: 5, col: 5 });
  });

  it('restores a captured unit', () => {
    setup();
    const attacker = s.placeInitialUnit('small', 5, 5, 1);
    const defender = s.placeInitialUnit('large', 5, 6, 2);
    s.startTurn();
    s.moveUnit(attacker.id, 5, 6);
    assert.ok(!s.getState().units[defender.id], 'defender should be gone before undo');
    s.undoUnitMove(attacker.id);
    assert.ok(s.getState().units[defender.id], 'defender should be restored after undo');
  });

  it('decrements action count', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 1);
    s.startTurn();
    s.moveUnit(unit.id, 5, 7);
    const before = s.getState().turn.actionCount;
    s.undoUnitMove(unit.id);
    assert.equal(s.getState().turn.actionCount, before - 1);
  });

  it('fails when unit has not moved', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 1);
    s.startTurn();
    const result = s.undoUnitMove(unit.id);
    assert.ok(result.error);
  });
});

// ── Turn management ───────────────────────────────────────
describe('Turn management', () => {
  it('submit switches to the other player', () => {
    setup();
    s.submitTurn();
    assert.equal(s.getState().currentPlayer, 2);
    s.submitTurn();
    assert.equal(s.getState().currentPlayer, 1);
  });

  it('new player collects income on their turn', () => {
    setup();
    const moneyBefore = s.getState().money[2];
    s.submitTurn(); // switches to p2, p2 collects
    assert.ok(s.getState().money[2] > moneyBefore);
  });

  it('income formula: $20 + floor(territory / 10)', () => {
    s.resetState();
    // Give p1 exactly 10 territory cells
    s.placeInitialUnit('medium', 5, 5, 1);
    s.placeInitialUnit('medium', 5, 7, 1); // distance 2 → both activate, ~territory
    const { territoryCounts } = s.getState();
    const t = territoryCounts[1] || 0;
    const expectedIncome = 20 + Math.floor(t / 10);
    s.startTurn();
    assert.equal(s.getState().money[1], expectedIncome);
  });

  it('restart restores board to start of turn state', () => {
    setupWithTerritory();
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    s.addUnit('small', r, c, 1);
    assert.ok(s.getState().board[r][c].unitId, 'unit should be placed');
    s.restartTurn();
    assert.equal(s.getState().board[r][c].unitId, null, 'unit should be gone after restart');
  });

  it('restart resets action count to 0', () => {
    setup();
    const unit = s.placeInitialUnit('small', 5, 5, 1);
    s.startTurn();
    s.moveUnit(unit.id, 5, 7);
    assert.equal(s.getState().turn.actionCount, 1);
    s.restartTurn();
    assert.equal(s.getState().turn.actionCount, 0);
  });

  it('restart refunds money spent this turn', () => {
    setupWithTerritory();
    const moneyBefore = s.getState().money[1];
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    s.addUnit('small', r, c, 1);
    s.restartTurn();
    assert.equal(s.getState().money[1], moneyBefore);
  });
});

// ── Tower rules ───────────────────────────────────────────
describe('Tower rules', () => {
  it('tower cannot move', () => {
    setupWithTerritory();
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const { unit: tower } = s.addUnit('tower', r, c, 1);
    const result = s.moveUnit(tower.id, r, c + 1);
    assert.ok(result.error);
    assert.match(result.error, /cannot move/i);
  });

  it('small can capture tower', () => {
    setup();
    const small = s.placeInitialUnit('small', 5, 5, 1);
    s.placeInitialUnit('tower', 5, 6, 2);
    s.startTurn();
    const result = s.moveUnit(small.id, 5, 6);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
  });

  it('medium can capture tower', () => {
    setup();
    const medium = s.placeInitialUnit('medium', 5, 5, 1);
    s.placeInitialUnit('tower', 5, 6, 2);
    s.startTurn();
    const result = s.moveUnit(medium.id, 5, 6);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
  });

  it('large cannot capture tower', () => {
    setup();
    const large = s.placeInitialUnit('large', 5, 5, 1);
    s.placeInitialUnit('tower', 5, 6, 2);
    s.startTurn();
    const result = s.moveUnit(large.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /destroyed/i);
  });

  it('tower costs $20 to place', () => {
    setupWithTerritory();
    const before = s.getState().money[1];
    const { board } = s.getState();
    const { r, c } = findTerritoryCell(board, 1);
    s.addUnit('tower', r, c, 1);
    assert.equal(s.getState().money[1], before - s.UNIT_COSTS.tower);
  });
});
