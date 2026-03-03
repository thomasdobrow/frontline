// ── Multi-turn scenario / integration tests ────────────────────────────────
// These tests exercise sequences of turns to catch interaction bugs that
// isolated unit tests miss: income loops, HP tracking across turns,
// stage escalation, and full undo chains within a single turn.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, BOARD_SIZE, UNIT_COSTS } = require('../game/state');

// ── Helpers ───────────────────────────────────────────────

function findTerritoryCell(board, player) {
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c].territory === player && board[r][c].unitId === null)
        return { r, c };
    }
  }
  throw new Error(`No free territory cell for player ${player}`);
}

// ── Scenarios ─────────────────────────────────────────────

describe('Scenario: territory → income → tower → tower income', () => {
  it('tower income (towerBonus) increases after placing a tower', () => {
    const game = createGame();
    // Two P1 mediums within activation distance so territory activates
    game.placeInitialUnit('medium', 1, 2, 1);
    game.placeInitialUnit('medium', 2, 1, 1);
    game.startTurn();

    // Cycle two full rounds so P1 has enough money to buy a tower ($50)
    game.submitTurn(); // P1 collects income → P2's turn
    game.submitTurn(); // P2 collects income → P1's turn
    game.submitTurn(); // P1 collects income → P2's turn
    game.submitTurn(); // P2 collects income → P1's turn

    // Before tower: towerBonus should be 0
    assert.equal(game.getState().nextIncome[1].towerBonus, 0, 'no towers yet');

    // Place a tower in P1 territory
    const { board } = game.getState();
    const { r, c } = findTerritoryCell(board, 1);
    const result = game.addUnit('tower', r, c, 1);
    assert.ok(!result.error, `failed to place tower: ${result.error}`);

    // After tower: towerBonus should be 3
    assert.equal(game.getState().nextIncome[1].towerBonus, 3, 'tower adds $3 bonus');

    // Submit and verify the bonus was included in the actual income received
    const moneyBefore = game.getState().money[1];
    const expectedIncome = game.getState().nextIncome[1].total;
    game.submitTurn(); // P1 collects income (including tower bonus)
    assert.equal(game.getState().money[1], moneyBefore + expectedIncome);
  });

  it('two towers stack income bonus', () => {
    const game = createGame();
    game.placeInitialUnit('medium', 1, 2, 1);
    game.placeInitialUnit('medium', 2, 1, 1);
    game.startTurn();
    // Cycle enough to afford two towers ($100 total)
    for (let i = 0; i < 6; i++) game.submitTurn();

    const { board: b1 } = game.getState();
    const c1 = findTerritoryCell(b1, 1);
    game.addUnit('tower', c1.r, c1.c, 1);

    const { board: b2 } = game.getState();
    const c2 = findTerritoryCell(b2, 1);
    game.addUnit('tower', c2.r, c2.c, 1);

    assert.equal(game.getState().nextIncome[1].towerBonus, 6, 'two towers = $6 bonus');
  });
});

describe('Scenario: combat chain with HP tracking across turns', () => {
  it('two same-type attacks destroy both units', () => {
    const game = createGame();
    const a = game.placeInitialUnit('small', 5, 5, 1);
    const b = game.placeInitialUnit('small', 5, 6, 2);
    game.startTurn();

    // Round 1: P1 attacks P2's small (same-type) → both at HP=1
    game.moveUnit(a.id, 5, 6);
    assert.equal(game.getState().units[a.id]?.hp, 1, 'a at HP=1 after first attack');
    assert.equal(game.getState().units[b.id]?.hp, 1, 'b at HP=1 after first attack');

    game.submitTurn(); // P2's turn

    // Round 2: P2's small (HP=1) attacks P1's small (HP=1) → both at HP=0 → both destroyed
    // b is at [5,6], a is at [5,5] (same-type attack leaves attacker in place)
    game.moveUnit(b.id, 5, 5);
    assert.ok(!game.getState().units[a.id], 'a destroyed in second same-type clash');
    assert.ok(!game.getState().units[b.id], 'b destroyed in second same-type clash');
  });

  it('HP stays tracked correctly through undo and redo', () => {
    const game = createGame();
    const a = game.placeInitialUnit('medium', 5, 5, 1);
    const b = game.placeInitialUnit('medium', 5, 6, 2);
    game.startTurn();

    game.moveUnit(a.id, 5, 6); // both → HP=1
    assert.equal(game.getState().units[a.id].hp, 1);
    assert.equal(game.getState().units[b.id].hp, 1);

    game.undoUnitAttack(a.id); // restore HP
    assert.equal(game.getState().units[a.id].hp, 2, 'HP restored after undo');
    assert.equal(game.getState().units[b.id].hp, 2, 'HP restored after undo');

    game.moveUnit(a.id, 5, 6); // attack again — both → HP=1
    assert.equal(game.getState().units[a.id].hp, 1, 'HP decremented again after redo');
    assert.equal(game.getState().units[b.id].hp, 1);
  });
});

describe('Scenario: stage escalation after 21 turns', () => {
  it('maxActions bumps from 3 to 4 after 21 individual player turns', () => {
    const game = createGame();
    game.placeInitialUnit('medium', 5, 5, 1);
    game.startTurn();

    assert.equal(game.getState().turn.maxActions, 3, 'starts at 3');

    // globalTurnNumber starts at 1 (from startTurn). submitTurn calls startTurn internally.
    // After 21 submits, globalTurnNumber = 22, which is stage 2 (maxActions = 4).
    for (let i = 0; i < 21; i++) game.submitTurn();

    assert.equal(game.getState().turn.maxActions, 4, 'bumped to 4 at turn 22');
  });

  it('maxActions bumps from 4 to 5 after 42 individual player turns', () => {
    const game = createGame();
    game.placeInitialUnit('medium', 5, 5, 1);
    game.startTurn();

    for (let i = 0; i < 42; i++) game.submitTurn(); // globalTurnNumber = 43

    assert.equal(game.getState().turn.maxActions, 5, 'bumped to 5 at turn 43');
  });

  it('turnsUntilActionBump counts down correctly', () => {
    const game = createGame();
    game.placeInitialUnit('medium', 5, 5, 1);
    game.startTurn(); // globalTurnNumber = 1 → 21 until bump

    assert.equal(game.getState().turn.turnsUntilActionBump, 21);

    game.submitTurn(); // globalTurnNumber = 2 → 20 remaining
    assert.equal(game.getState().turn.turnsUntilActionBump, 20);

    game.submitTurn(); // globalTurnNumber = 3 → 19 remaining
    assert.equal(game.getState().turn.turnsUntilActionBump, 19);
  });
});

describe('Scenario: full undo chain in one turn', () => {
  // Each action uses a DIFFERENT unit — a unit can only do one action per turn
  // (either move or attack, never both).
  it('undo attack → undo move → undo placement restores original state', () => {
    const game = createGame();
    // Territory pair for P1 (dist-2) so placement is legal
    game.placeInitialUnit('medium', 1, 2, 1);
    game.placeInitialUnit('medium', 2, 1, 1);
    // Unit that will be moved to an empty cell
    const mover    = game.placeInitialUnit('medium', 5, 0, 1);
    // Unit that will perform a same-type attack
    const attacker = game.placeInitialUnit('medium', 5, 4, 1);
    // Enemy adjacent to attacker
    const enemy    = game.placeInitialUnit('medium', 5, 5, 2);
    game.startTurn();

    // Collect two rounds of income so P1 can afford a small ($25)
    game.submitTurn(); game.submitTurn();
    game.submitTurn(); game.submitTurn();

    // Action 1: place a small in P1 territory
    const { board } = game.getState();
    const { r: pr, c: pc } = findTerritoryCell(board, 1);
    const { unit: placed } = game.addUnit('small', pr, pc, 1);
    assert.equal(game.getState().turn.actionCount, 1);

    // Action 2: move a different unit (mover) to an empty cell
    game.moveUnit(mover.id, 5, 2); // dist 2
    assert.equal(game.getState().turn.actionCount, 2);

    // Action 3: attacker does a same-type attack on the enemy
    game.moveUnit(attacker.id, 5, 5); // same-type attack
    assert.equal(game.getState().turn.actionCount, 3);
    assert.equal(game.getState().units[attacker.id]?.hp, 1, 'attacker HP=1 after attack');
    assert.equal(game.getState().units[enemy.id]?.hp, 1, 'enemy HP=1 after attack');

    // Undo in reverse order: attack → move → placement
    game.undoUnitAttack(attacker.id);
    assert.equal(game.getState().turn.actionCount, 2);
    assert.equal(game.getState().units[attacker.id].hp, 2, 'attacker HP restored');
    assert.equal(game.getState().units[enemy.id].hp, 2, 'enemy HP restored');

    game.undoUnitMove(mover.id);
    assert.equal(game.getState().turn.actionCount, 1);
    assert.deepEqual(game.getState().units[mover.id].position, { row: 5, col: 0 });

    game.undoUnitPlacement(placed.id);
    assert.equal(game.getState().turn.actionCount, 0);
    assert.ok(!game.getState().units[placed.id], 'placed unit removed');
    assert.equal(game.getState().board[pr][pc].unitId, null, 'cell emptied');
  });
});

describe('Scenario: income accumulates correctly over multiple rounds', () => {
  it('P1 income grows each round proportional to territory', () => {
    const game = createGame();
    game.placeInitialUnit('medium', 4, 4, 1);
    game.placeInitialUnit('medium', 4, 6, 1); // pair → territory active
    game.startTurn();

    const incomePerRound = game.getState().nextIncome[1].total;
    assert.ok(incomePerRound > 10, 'income should be > base with territory');

    const startMoney = game.getState().money[1];
    game.submitTurn(); // P1 collects
    const after1 = game.getState().money[1];
    game.submitTurn(); // P2 collects
    game.submitTurn(); // P1 collects
    const after2 = game.getState().money[1];

    assert.equal(after1, startMoney + incomePerRound, 'first income collection correct');
    assert.equal(after2, after1 + incomePerRound, 'second income collection correct');
  });

  it('players collect income independently (P2 does not affect P1 money on P2 submit)', () => {
    const game = createGame();
    game.placeInitialUnit('medium', 4, 4, 1);
    game.placeInitialUnit('medium', 4, 6, 1);
    game.startTurn();

    const p1Before = game.getState().money[1];
    const p2Before = game.getState().money[2];

    game.submitTurn(); // P1 collects; P2's turn starts
    const p1After = game.getState().money[1];
    assert.ok(p1After > p1Before, 'P1 money increased on P1 submit');
    assert.equal(game.getState().money[2], p2Before, 'P2 money unchanged on P1 submit');

    game.submitTurn(); // P2 collects; P1's turn starts
    assert.ok(game.getState().money[2] > p2Before, 'P2 money increased on P2 submit');
    assert.equal(game.getState().money[1], p1After, 'P1 money unchanged on P2 submit');
  });
});
