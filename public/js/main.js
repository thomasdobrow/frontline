// ── Client state ─────────────────────────────────────────
let active = null;
let selectedUnitId = null;
let boardState = {
  board: [], units: {}, territoryCounts: {},
  currentPlayer: 1, money: { 1: 0, 2: 0 },
  unitCosts: { large: 30, medium: 20, small: 10 },
  turn: { actionCount: 0, maxActions: 3, movedUnitIds: [], placedUnitIds: [] },
};

// ── Helpers ───────────────────────────────────────────────
const manhattan = (r1, c1, r2, c2) => Math.abs(r1 - r2) + Math.abs(c1 - c2);
const BEATS = {
  small:  ['large', 'tower'],
  large:  ['medium'],
  medium: ['small', 'tower'],
  tower:  [],
};
const canCapture = (at, dt) => (BEATS[at] || []).includes(dt);

function hasMoved(id)   { return boardState.turn.movedUnitIds?.includes(id); }
function hasPlaced(id)  { return boardState.turn.placedUnitIds?.includes(id); }
function actionsLeft()  { return boardState.turn.maxActions - boardState.turn.actionCount; }

function validMoveTargets(unitId) {
  if (hasMoved(unitId)) return new Set();
  const unit = boardState.units[unitId];
  if (!unit) return new Set();
  if (unit.type === 'tower') return new Set(); // towers cannot move
  const { row, col } = unit.position;
  const targets = new Set();

  boardState.board.forEach((rowArr, r) =>
    rowArr.forEach((cell, c) => {
      const dist = manhattan(row, col, r, c);
      if (dist === 0 || dist > 2) return;
      if (!cell.unitId) {
        targets.add(`${r},${c}`);
      } else {
        const occ = boardState.units[cell.unitId];
        if (occ.player !== unit.player && canCapture(unit.type, occ.type))
          targets.add(`${r},${c}`);
      }
    })
  );
  return targets;
}

// ── API ──────────────────────────────────────────────────
async function fetchState() {
  const res = await fetch('/api/state');
  boardState = await res.json();
}

async function apiPlaceUnit(player, type, row, col) {
  const res = await fetch('/api/units', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player, type, row, col }),
  });
  return res.json();
}

async function apiMoveUnit(id, row, col) {
  const res = await fetch(`/api/units/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row, col }),
  });
  return res.json();
}

async function apiUndoMove(id) {
  const res = await fetch(`/api/units/${id}/undo-move`, { method: 'POST' });
  return res.json();
}

async function apiUndoPlacement(id) {
  const res = await fetch(`/api/units/${id}/undo-placement`, { method: 'POST' });
  return res.json();
}

async function apiSubmitTurn() {
  const res = await fetch('/api/turn/submit', { method: 'POST' });
  boardState = await res.json();
}

async function apiRestartTurn() {
  const res = await fetch('/api/turn/restart', { method: 'POST' });
  boardState = await res.json();
}

// ── Board rendering ───────────────────────────────────────
function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  const targets = selectedUnitId ? validMoveTargets(selectedUnitId) : new Set();
  const rows    = boardState.board.length;
  const cols    = boardState.board[0]?.length ?? 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { unitId, territory } = boardState.board[row][col];

      const cell = document.createElement('div');
      cell.className = 'cell';
      if (territory)                        cell.classList.add(`territory-${territory}`);
      if (unitId && unitId === selectedUnitId) cell.classList.add('selected');
      if (targets.has(`${row},${col}`))     cell.classList.add('move-target');
      cell.dataset.row = row;
      cell.dataset.col = col;

      if (unitId) {
        const unit   = boardState.units[unitId];
        const marker = document.createElement('div');
        marker.className = `unit-marker ${unit.type} player-${unit.player}`;
        if (hasMoved(unitId))   marker.classList.add('moved');
        if (hasPlaced(unitId))  marker.classList.add('placed');
        cell.appendChild(marker);

        const isCurrentPlayerUnit = unit.player === boardState.currentPlayer;

        // Double-click on a moved unit → undo the move
        if (hasMoved(unitId) && isCurrentPlayerUnit) {
          cell.addEventListener('dblclick', async (e) => {
            e.stopPropagation();
            const result = await apiUndoMove(unitId);
            if (result.error) { console.warn('Undo move failed:', result.error); return; }
            boardState = result;
            selectedUnitId = null;
            renderBoard();
          });
        }

        // Double-click on a placed unit → undo the placement
        if (hasPlaced(unitId) && isCurrentPlayerUnit) {
          cell.addEventListener('dblclick', async (e) => {
            e.stopPropagation();
            const result = await apiUndoPlacement(unitId);
            if (result.error) { console.warn('Undo placement failed:', result.error); return; }
            boardState = result;
            selectedUnitId = null;
            renderBoard();
          });
        }
      }

      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }

  renderHUD();
}

function renderHUD() {
  const cp     = boardState.currentPlayer;
  const counts = boardState.territoryCounts;
  const mon    = boardState.money;
  const costs  = boardState.unitCosts;
  const { actionCount, maxActions } = boardState.turn;

  const indicator = document.getElementById('turn-indicator');
  indicator.textContent = `Player ${cp}'s Turn`;
  indicator.className   = `turn-indicator player-${cp}`;

  document.getElementById('action-count').textContent = `${actionCount} / ${maxActions}`;

  document.getElementById('money-1').textContent     = `$${mon[1] ?? 0}`;
  document.getElementById('money-2').textContent     = `$${mon[2] ?? 0}`;
  document.getElementById('territory-1').textContent = counts[1] ?? 0;
  document.getElementById('territory-2').textContent = counts[2] ?? 0;
  document.getElementById('stats-row-1').classList.toggle('active-turn', cp === 1);
  document.getElementById('stats-row-2').classList.toggle('active-turn', cp === 2);

  document.querySelectorAll('.unit-btn').forEach(btn => {
    const btnPlayer = parseInt(btn.dataset.player);
    const btnType   = btn.dataset.type;
    const offTurn   = btnPlayer !== cp;
    const noFunds   = !offTurn && (mon[cp] ?? 0) < (costs?.[btnType] ?? 0);
    const disabled  = offTurn || noFunds;
    btn.classList.toggle('off-turn', disabled);
    if (disabled && btn.classList.contains('active')) {
      btn.classList.remove('active');
      active = null;
    }
  });
}

// ── Cell click ────────────────────────────────────────────
async function onCellClick(e) {
  const row    = parseInt(e.currentTarget.dataset.row);
  const col    = parseInt(e.currentTarget.dataset.col);
  const { unitId } = boardState.board[row][col];

  // Mode 1: placement button active
  if (active) {
    if (actionsLeft() <= 0) { console.warn('No actions remaining'); return; }
    const result = await apiPlaceUnit(active.player, active.type, row, col);
    if (result.error) { console.warn('Place failed:', result.error); return; }
    clearActive();
    await fetchState();
    renderBoard();
    return;
  }

  // Mode 2: a unit is already selected
  if (selectedUnitId) {
    if (unitId === selectedUnitId) {
      selectedUnitId = null;
      renderBoard();
      return;
    }

    const targets = validMoveTargets(selectedUnitId);

    if (unitId) {
      const occ   = boardState.units[unitId];
      const mover = boardState.units[selectedUnitId];
      if (occ.player === mover.player) {
        selectedUnitId = unitId;
        renderBoard();
      } else if (targets.has(`${row},${col}`)) {
        if (actionsLeft() <= 0) { console.warn('No actions remaining'); return; }
        const result = await apiMoveUnit(selectedUnitId, row, col);
        if (result.error) { console.warn('Capture failed:', result.error); return; }
        selectedUnitId = null;
        await fetchState();
        renderBoard();
      } else {
        selectedUnitId = null;
        renderBoard();
      }
      return;
    }

    if (!targets.has(`${row},${col}`)) {
      selectedUnitId = null;
      renderBoard();
      return;
    }
    if (actionsLeft() <= 0) { console.warn('No actions remaining'); return; }
    const result = await apiMoveUnit(selectedUnitId, row, col);
    if (result.error) { console.warn('Move failed:', result.error); return; }
    selectedUnitId = null;
    await fetchState();
    renderBoard();
    return;
  }

  // Mode 3: nothing selected — select a current-player unit
  if (unitId) {
    const unit = boardState.units[unitId];
    if (unit.player === boardState.currentPlayer) {
      selectedUnitId = unitId;
      renderBoard();
    }
    return;
  }

  console.log(`Cell clicked: row=${row}, col=${col}`);
}

// ── Button activation ─────────────────────────────────────
function setActive(player, type) {
  document.querySelectorAll('.unit-btn').forEach(btn =>
    btn.classList.toggle('active',
      btn.dataset.player === String(player) && btn.dataset.type === type)
  );
  active = { player, type };
  selectedUnitId = null;
  renderBoard();
}

function clearActive() {
  document.querySelectorAll('.unit-btn').forEach(btn => btn.classList.remove('active'));
  active = null;
}

function initButtons() {
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('off-turn')) return;
      const player = parseInt(btn.dataset.player);
      const type   = btn.dataset.type;
      const alreadyActive = active?.player === player && active?.type === type;
      alreadyActive ? clearActive() : setActive(player, type);
    });
  });

  document.getElementById('submit-btn').addEventListener('click', async () => {
    clearActive(); selectedUnitId = null;
    await apiSubmitTurn(); renderBoard();
  });

  document.getElementById('restart-btn').addEventListener('click', async () => {
    clearActive(); selectedUnitId = null;
    await apiRestartTurn(); renderBoard();
  });
}

// ── Init ──────────────────────────────────────────────────
async function init() {
  initButtons();
  await fetchState();
  renderBoard();
}

init();
