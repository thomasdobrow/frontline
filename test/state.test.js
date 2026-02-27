const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, BOARD_SIZE, UNIT_COSTS, BEATS } = require('../game/state');

// ── Helpers ───────────────────────────────────────────────

let game;

// Fresh empty board, start player 1's turn.
// Note: income is collected at END of turn (submitTurn), not here.
function setup() {
  game = createGame();
  game.startTurn();
}

// Fresh board with two p1 mediums at [1,2] & [2,1] (distance-2 pair → territory
// activates). Cycles through one full round so P1 collects income and has enough
// money for any unit type (tower costs $200, base income is $200+terrBonus).
function setupWithTerritory() {
  game = createGame();
  game.placeInitialUnit('medium', 1, 2, 1);
  game.placeInitialUnit('medium', 2, 1, 1);
  game.startTurn();
  game.submitTurn(); // P1 collects income → P2's turn
  game.submitTurn(); // P2 collects income → P1's turn (P1 now has $100 + income)
}

// Return a free cell guaranteed to have the given territory, or throw.
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
    const { board } = game.getState();
    assert.equal(board.length, BOARD_SIZE);
    assert.equal(board[0].length, BOARD_SIZE);
  });

  it('starts on player 1\'s turn', () => {
    setup();
    assert.equal(game.getState().currentPlayer, 1);
  });

  it('default board starts with 4 units placed', () => {
    // Mirrors server.js STARTING_UNITS: P2 = 180° rotation of P1 positions.
    game = createGame();
    game.placeInitialUnit('medium', 3, 2, 1);
    game.placeInitialUnit('medium', 2, 3, 1);
    game.placeInitialUnit('medium', BOARD_SIZE - 1 - 3, BOARD_SIZE - 1 - 2, 2);
    game.placeInitialUnit('medium', BOARD_SIZE - 1 - 2, BOARD_SIZE - 1 - 3, 2);
    game.startTurn();
    const { units } = game.getState();
    assert.equal(Object.keys(units).length, 4);
  });
});

// ── Placement ─────────────────────────────────────────────
describe('Unit placement', () => {
  it('fails outside own territory', () => {
    setupWithTerritory();
    // [8,8] is in-bounds for a 9×9 board but far from P1's starting units
    const result = game.addUnit('small', 8, 8, 1);
    assert.ok(result.error, 'should reject placement outside territory');
    assert.match(result.error, /territory/i);
  });

  it('succeeds inside own territory', () => {
    setupWithTerritory();
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const result = game.addUnit('small', r, c, 1);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.equal(result.unit.type, 'small');
  });

  it('deducts the correct cost', () => {
    setupWithTerritory();
    const before = game.getState().money[1];
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    game.addUnit('small', r, c, 1);
    assert.equal(game.getState().money[1], before - UNIT_COSTS.small);
  });

  it('fails when player cannot afford the unit', () => {
    game = createGame();
    game.placeInitialUnit('medium', 1, 2, 1);
    game.placeInitialUnit('medium', 2, 1, 1);
    // Don't call startTurn/submitTurn → money stays at $100 starting value.
    // large costs $325 > $100, so it should be rejected.
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const result = game.addUnit('large', r, c, 1);
    assert.ok(result.error);
    assert.match(result.error, /money/i);
  });

  it('tracks placement in placedUnitIds', () => {
    setupWithTerritory();
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const { unit } = game.addUnit('small', r, c, 1);
    assert.ok(game.getState().turn.placedUnitIds.includes(unit.id));
  });

  it('blocks placement when actions are exhausted', () => {
    // Set up P1 with enough territory to earn good income, then cycle a full
    // turn so P1 has enough money to buy 3 smalls ($75 each = $225 total).
    game = createGame();
    game.placeInitialUnit('medium', 1, 2, 1);
    game.placeInitialUnit('medium', 2, 1, 1);
    game.placeInitialUnit('medium', 4, 4, 1);
    game.placeInitialUnit('medium', 4, 6, 1);
    game.startTurn();
    game.submitTurn(); // P1 collects income → P2's turn
    game.submitTurn(); // P2 collects income → P1's turn again (P1 now has $100 + income)
    // Find 4 free p1 territory cells
    const cells = [];
    const { board } = game.getState();
    for (let r = 0; r < board.length && cells.length < 4; r++) {
      for (let c = 0; c < board[r].length && cells.length < 4; c++) {
        if (board[r][c].territory === 1 && !board[r][c].unitId) cells.push({ r, c });
      }
    }
    cells.slice(0, 3).forEach(({ r, c }) => game.addUnit('small', r, c, 1));
    // 4th action should be blocked
    const { board: board2 } = game.getState();
    const extra = findTerritoryCell(board2, 1);
    const result = game.addUnit('small', extra.r, extra.c, 1);
    assert.ok(result.error);
  });
});

// ── Undo placement ────────────────────────────────────────
describe('Undo unit placement', () => {
  it('removes the unit and refunds money', () => {
    setupWithTerritory();
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const moneyBefore = game.getState().money[1];
    const { unit } = game.addUnit('small', r, c, 1);
    game.undoUnitPlacement(unit.id);
    const { money, units, board: b2 } = game.getState();
    assert.equal(money[1], moneyBefore, 'money should be refunded');
    assert.ok(!units[unit.id], 'unit should be removed');
    assert.equal(b2[r][c].unitId, null, 'cell should be empty');
  });

  it('decrements action count', () => {
    setupWithTerritory();
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const { unit } = game.addUnit('small', r, c, 1);
    const countBefore = game.getState().turn.actionCount;
    game.undoUnitPlacement(unit.id);
    assert.equal(game.getState().turn.actionCount, countBefore - 1);
  });

  it('fails on a unit that was not placed this turn', () => {
    setup();
    const result = game.undoUnitPlacement('u_fake');
    assert.ok(result.error);
  });
});

// ── Movement ──────────────────────────────────────────────
describe('Unit movement', () => {
  it('can move up to MOVE_RANGE spaces', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 1);
    game.startTurn();
    const result = game.moveUnit(unit.id, 5, 7); // distance 2
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.deepEqual(result.unit.position, { row: 5, col: 7 });
  });

  it('rejects moves beyond MOVE_RANGE', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 1);
    game.startTurn();
    const result = game.moveUnit(unit.id, 5, 8); // distance 3
    assert.ok(result.error);
    assert.match(result.error, /more than/i);
  });

  it('blocks a unit from moving twice in one turn', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 1);
    game.startTurn();
    game.moveUnit(unit.id, 5, 7);
    const result = game.moveUnit(unit.id, 5, 5); // try to move back
    assert.ok(result.error);
    assert.match(result.error, /already moved/i);
  });

  it('rejects moving the other player\'s piece', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 2);
    game.startTurn();
    const result = game.moveUnit(unit.id, 5, 7);
    assert.ok(result.error);
    assert.match(result.error, /not your turn/i);
  });

  it('cannot move into a friendly piece', () => {
    setup();
    const a = game.placeInitialUnit('small', 5, 5, 1);
    game.placeInitialUnit('small', 5, 6, 1);
    game.startTurn();
    const result = game.moveUnit(a.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /friendly/i);
  });

  it('cannot move a unit placed this same turn', () => {
    setupWithTerritory();
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const { unit } = game.addUnit('small', r, c, 1);
    // Try to move the just-placed unit
    const result = game.moveUnit(unit.id, r, c + 1);
    assert.ok(result.error);
    assert.match(result.error, /placed this turn/i);
  });
});

// ── Capture rules ─────────────────────────────────────────
describe('Capture rules', () => {
  it('small captures large', () => {
    setup();
    const small = game.placeInitialUnit('small', 5, 5, 1);
    const large = game.placeInitialUnit('large', 5, 6, 2);
    game.startTurn();
    const result = game.moveUnit(small.id, 5, 6);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
    assert.ok(!game.getState().units[large.id], 'enemy large should be captured');
  });

  it('blocks large moving into small (large would lose)', () => {
    setup();
    const large = game.placeInitialUnit('large', 5, 5, 1);
    game.placeInitialUnit('small', 5, 6, 2);
    game.startTurn();
    const result = game.moveUnit(large.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /destroyed/i);
  });

  it('blocks same-size capture', () => {
    setup();
    const a = game.placeInitialUnit('medium', 5, 5, 1);
    game.placeInitialUnit('medium', 5, 6, 2);
    game.startTurn();
    const result = game.moveUnit(a.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /same size/i);
  });
});

// ── Undo move ─────────────────────────────────────────────
describe('Undo move', () => {
  it('restores unit to original position', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 1);
    game.startTurn();
    game.moveUnit(unit.id, 5, 7);
    game.undoUnitMove(unit.id);
    assert.deepEqual(game.getState().units[unit.id].position, { row: 5, col: 5 });
  });

  it('restores a captured unit', () => {
    setup();
    const attacker = game.placeInitialUnit('small', 5, 5, 1);
    const defender = game.placeInitialUnit('large', 5, 6, 2);
    game.startTurn();
    game.moveUnit(attacker.id, 5, 6);
    assert.ok(!game.getState().units[defender.id], 'defender should be gone before undo');
    game.undoUnitMove(attacker.id);
    assert.ok(game.getState().units[defender.id], 'defender should be restored after undo');
  });

  it('decrements action count', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 1);
    game.startTurn();
    game.moveUnit(unit.id, 5, 7);
    const before = game.getState().turn.actionCount;
    game.undoUnitMove(unit.id);
    assert.equal(game.getState().turn.actionCount, before - 1);
  });

  it('fails when unit has not moved', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 1);
    game.startTurn();
    const result = game.undoUnitMove(unit.id);
    assert.ok(result.error);
  });
});

// ── Turn management ───────────────────────────────────────
describe('Turn management', () => {
  it('submit switches to the other player', () => {
    setup();
    game.submitTurn();
    assert.equal(game.getState().currentPlayer, 2);
    game.submitTurn();
    assert.equal(game.getState().currentPlayer, 1);
  });

  it('current player collects income at end of their turn (on submit)', () => {
    setup();
    const moneyBefore = game.getState().money[1];
    game.submitTurn(); // P1 submits → P1 collects income → P2's turn
    assert.ok(game.getState().money[1] > moneyBefore, 'P1 money should increase after submit');
  });

  it('income formula: 200 + territory*2 + towers*5', () => {
    game = createGame();
    game.placeInitialUnit('medium', 4, 4, 1);
    game.placeInitialUnit('medium', 4, 6, 1); // distance 2 → territory activates
    const { territoryCounts } = game.getState();
    const t = territoryCounts[1] || 0;
    const towers = 0;
    const expectedIncome = 200 + t * 2 + towers * 5;
    game.startTurn();
    const moneyBefore = game.getState().money[1]; // $100 starting
    game.submitTurn(); // P1 collects income
    assert.equal(game.getState().money[1], moneyBefore + expectedIncome);
  });

  it('restart restores board to start of turn state', () => {
    setupWithTerritory();
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    game.addUnit('small', r, c, 1);
    assert.ok(game.getState().board[r][c].unitId, 'unit should be placed');
    game.restartTurn();
    assert.equal(game.getState().board[r][c].unitId, null, 'unit should be gone after restart');
  });

  it('restart resets action count to 0', () => {
    setup();
    const unit = game.placeInitialUnit('small', 5, 5, 1);
    game.startTurn();
    game.moveUnit(unit.id, 5, 7);
    assert.equal(game.getState().turn.actionCount, 1);
    game.restartTurn();
    assert.equal(game.getState().turn.actionCount, 0);
  });

  it('restart refunds money spent this turn', () => {
    setupWithTerritory();
    const moneyBefore = game.getState().money[1];
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    game.addUnit('small', r, c, 1);
    game.restartTurn();
    assert.equal(game.getState().money[1], moneyBefore);
  });
});

// ── Tower rules ───────────────────────────────────────────
describe('Tower rules', () => {
  it('tower cannot move', () => {
    setupWithTerritory();
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const { unit: tower } = game.addUnit('tower', r, c, 1);
    const result = game.moveUnit(tower.id, r, c + 1);
    assert.ok(result.error);
    assert.match(result.error, /cannot move/i);
  });

  it('small can capture tower', () => {
    setup();
    const small = game.placeInitialUnit('small', 5, 5, 1);
    game.placeInitialUnit('tower', 5, 6, 2);
    game.startTurn();
    const result = game.moveUnit(small.id, 5, 6);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
  });

  it('medium can capture tower', () => {
    setup();
    const medium = game.placeInitialUnit('medium', 5, 5, 1);
    game.placeInitialUnit('tower', 5, 6, 2);
    game.startTurn();
    const result = game.moveUnit(medium.id, 5, 6);
    assert.ok(!result.error, `unexpected error: ${result.error}`);
  });

  it('large cannot capture tower', () => {
    setup();
    const large = game.placeInitialUnit('large', 5, 5, 1);
    game.placeInitialUnit('tower', 5, 6, 2);
    game.startTurn();
    const result = game.moveUnit(large.id, 5, 6);
    assert.ok(result.error);
    assert.match(result.error, /destroyed/i);
  });

  it('tower costs UNIT_COSTS.tower to place', () => {
    setupWithTerritory();
    const before = game.getState().money[1];
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    game.addUnit('tower', r, c, 1);
    assert.equal(game.getState().money[1], before - UNIT_COSTS.tower);
  });
});
