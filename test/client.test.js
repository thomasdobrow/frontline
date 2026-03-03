// ── Client-side logic tests ────────────────────────────────────────────────
// Tests for pure functions in public/js/logic.js: BEATS, canCapture, manhattan,
// and validMoveTargets. No DOM or browser required.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BEATS, canCapture, manhattan, validMoveTargets } = require('../public/js/logic');

// ── BEATS table ───────────────────────────────────────────
describe('BEATS table', () => {
  it('small beats large and tower', () => {
    assert.ok(BEATS.small.includes('large'));
    assert.ok(BEATS.small.includes('tower'));
    assert.equal(BEATS.small.length, 2);
  });

  it('large beats medium and tower', () => {
    assert.ok(BEATS.large.includes('medium'));
    assert.ok(BEATS.large.includes('tower'));
    assert.equal(BEATS.large.length, 2);
  });

  it('medium beats small and tower', () => {
    assert.ok(BEATS.medium.includes('small'));
    assert.ok(BEATS.medium.includes('tower'));
    assert.equal(BEATS.medium.length, 2);
  });

  it('tower beats nothing', () => {
    assert.equal(BEATS.tower.length, 0);
  });
});

// ── canCapture ────────────────────────────────────────────
describe('canCapture', () => {
  // Winning matchups
  it('small captures large', ()  => assert.ok(canCapture('small',  'large')));
  it('small captures tower', ()  => assert.ok(canCapture('small',  'tower')));
  it('large captures medium', () => assert.ok(canCapture('large',  'medium')));
  it('large captures tower', ()  => assert.ok(canCapture('large',  'tower')));
  it('medium captures small', () => assert.ok(canCapture('medium', 'small')));
  it('medium captures tower', () => assert.ok(canCapture('medium', 'tower')));

  // Losing matchups (would-be attacker loses)
  it('large cannot capture small',  () => assert.ok(!canCapture('large',  'small')));
  it('medium cannot capture large', () => assert.ok(!canCapture('medium', 'large')));
  it('small cannot capture medium', () => assert.ok(!canCapture('small',  'medium')));
  it('tower cannot capture anything', () => {
    ['small', 'medium', 'large', 'tower'].forEach(t =>
      assert.ok(!canCapture('tower', t))
    );
  });

  // Same-type: canCapture is false (same-type attacks are handled separately)
  it('same-type returns false', () => {
    ['small', 'medium', 'large'].forEach(t =>
      assert.ok(!canCapture(t, t), `canCapture(${t}, ${t}) should be false`)
    );
  });
});

// ── manhattan distance ────────────────────────────────────
describe('manhattan distance', () => {
  it('same cell = 0',         () => assert.equal(manhattan(0, 0, 0, 0), 0));
  it('horizontal 3 = 3',      () => assert.equal(manhattan(0, 0, 0, 3), 3));
  it('vertical 4 = 4',        () => assert.equal(manhattan(0, 0, 4, 0), 4));
  it('diagonal 3+4 = 7',      () => assert.equal(manhattan(0, 0, 3, 4), 7));
  it('negative delta = abs',  () => assert.equal(manhattan(5, 5, 3, 3), 4));
  it('symmetric',             () => assert.equal(manhattan(1, 2, 4, 6), manhattan(4, 6, 1, 2)));
});

// ── validMoveTargets ──────────────────────────────────────

// Build a minimal board for tests: BOARD_SIZE × BOARD_SIZE of empty cells,
// with select cells populated via the `units` and `occupied` args.
function makeBoard(size = 11, mountains = []) {
  const mountainSet = new Set(mountains.map(([r, c]) => `${r},${c}`));
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => ({
      unitId: null,
      territory: null,
      mountain: mountainSet.has(`${r},${c}`),
    }))
  );
}

// Place a unit on a board, returning the updated board + units map.
function placeOn(board, units, id, type, player, row, col) {
  board[row][col].unitId = id;
  units[id] = { id, type, player, position: { row, col }, hp: 2 };
}

// Default empty turn state
const EMPTY_TURN = { movedUnitIds: [], attackedUnitIds: [] };

describe('validMoveTargets', () => {
  it('returns empty set for a unit that has already moved', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'small', 1, 5, 5);
    const bs = { board, units };
    const turn = { movedUnitIds: ['u1'], attackedUnitIds: [] };
    assert.equal(validMoveTargets('u1', bs, turn).size, 0);
  });

  it('returns empty set for a unit that has already attacked', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'small', 1, 5, 5);
    const bs = { board, units };
    const turn = { movedUnitIds: [], attackedUnitIds: ['u1'] };
    assert.equal(validMoveTargets('u1', bs, turn).size, 0);
  });

  it('returns empty set for a tower', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'tower', 1, 5, 5);
    const bs = { board, units };
    assert.equal(validMoveTargets('u1', bs, EMPTY_TURN).size, 0);
  });

  it('returns empty set for unknown unit id', () => {
    const bs = { board: makeBoard(), units: {} };
    assert.equal(validMoveTargets('nonexistent', bs, EMPTY_TURN).size, 0);
  });

  it('includes all empty cells within distance 2', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'medium', 1, 5, 5);
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);

    // Every target should have manhattan dist 1 or 2 from [5,5]
    for (const key of targets) {
      const [r, c] = key.split(',').map(Number);
      const dist = Math.abs(r - 5) + Math.abs(c - 5);
      assert.ok(dist >= 1 && dist <= 2, `cell ${key} has dist ${dist}, expected 1-2`);
    }
  });

  it('does not include cells beyond distance 2', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'medium', 1, 5, 5);
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);

    // [5,8] is dist 3 — should not be a target
    assert.ok(!targets.has('5,8'), 'distance-3 cell should not be reachable');
  });

  it('excludes friendly-occupied cells', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'small', 1, 5, 5);
    placeOn(board, units, 'u2', 'small', 1, 5, 6); // friendly at dist 1
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);
    assert.ok(!targets.has('5,6'), 'friendly cell should not be a target');
  });

  it('includes capturable enemy cells', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'small', 1, 5, 5);  // small (P1)
    placeOn(board, units, 'u2', 'large', 2, 5, 6); // large (P2) — small beats large
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);
    assert.ok(targets.has('5,6'), 'capturable enemy cell should be a target');
  });

  it('excludes enemy cells where attacker would lose', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'small', 1, 5, 5);  // small (P1)
    placeOn(board, units, 'u2', 'medium', 2, 5, 6); // medium (P2) — small loses to medium
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);
    assert.ok(!targets.has('5,6'), 'cell with losing matchup should not be a target');
  });

  it('includes same-type enemy cells (same-type attack allowed)', () => {
    const board = makeBoard();
    const units = {};
    placeOn(board, units, 'u1', 'medium', 1, 5, 5);
    placeOn(board, units, 'u2', 'medium', 2, 5, 6); // same type, different player
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);
    assert.ok(targets.has('5,6'), 'same-type enemy should be a valid attack target');
  });

  it('mountain bonus: unit on mountain can reach distance-3 cells', () => {
    const board = makeBoard(11, [[5, 5]]); // [5,5] is a mountain
    const units = {};
    placeOn(board, units, 'u1', 'medium', 1, 5, 5);
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);
    assert.ok(targets.has('5,8'), 'mountain bonus: dist-3 cell should be reachable');
  });

  it('unit NOT on mountain cannot reach distance-3 cells', () => {
    const board = makeBoard(); // no mountains
    const units = {};
    placeOn(board, units, 'u1', 'medium', 1, 5, 5);
    const bs = { board, units };
    const targets = validMoveTargets('u1', bs, EMPTY_TURN);
    assert.ok(!targets.has('5,8'), 'without mountain bonus, dist-3 should be out of range');
  });
});
