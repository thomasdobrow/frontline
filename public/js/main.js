// ── Client state ──────────────────────────────────────────
let active       = null;
let selectedUnitId = null;
let myPlayer     = null;  // assigned by server (1 or 2)
let gameStarted  = false;

let boardState = {
  board: [], units: {}, territoryCounts: {},
  currentPlayer: 1, money: { 1: 0, 2: 0 },
  unitCosts: { large: 125, medium: 75, small: 35, tower: 70 },
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

function hasMoved(id)  { return boardState.turn.movedUnitIds?.includes(id); }
function hasPlaced(id) { return boardState.turn.placedUnitIds?.includes(id); }
function actionsLeft() { return boardState.turn.maxActions - boardState.turn.actionCount; }
function isMyTurn()    { return myPlayer === boardState.currentPlayer; }

function validMoveTargets(unitId) {
  if (hasMoved(unitId)) return new Set();
  const unit = boardState.units[unitId];
  if (!unit) return new Set();
  if (unit.type === 'tower') return new Set();
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

// ── Socket setup ──────────────────────────────────────────
const roomId = window.location.pathname.split('/').pop();
const socket = io();

socket.on('connect', () => {
  socket.emit('join-room', roomId);
});

socket.on('player-assigned', (num) => {
  myPlayer = num;

  // Mark which player we are in the stats panel
  const statsBlock = document.getElementById(`stats-row-${num}`);
  statsBlock.classList.add('my-player');
  const badge = document.createElement('span');
  badge.className = 'you-badge';
  badge.textContent = 'you';
  statsBlock.querySelector('.stats-player-label').appendChild(badge);

  // Update overlay code/link now that we have roomId
  document.getElementById('overlay-code').textContent = roomId;
});

socket.on('waiting', () => {
  showOverlay(`Waiting for opponent…`, 'Share this link or code with your opponent', true);
});

socket.on('game-started', () => {
  gameStarted = true;
  hideOverlay();
});

socket.on('state-update', (state) => {
  boardState = state;
  renderBoard();
});

socket.on('action-error', (msg) => {
  console.warn('Action error:', msg);
  if (msg && msg.startsWith('Server error')) {
    document.getElementById('error-banner-text').textContent =
      'Unexpected error — please restart your turn and continue.';
    document.getElementById('error-banner').classList.remove('hidden');
  } else {
    const boardEl = document.getElementById('board');
    boardEl.classList.add('error-flash');
    setTimeout(() => boardEl.classList.remove('error-flash'), 300);
  }
});

socket.on('opponent-disconnected', () => {
  gameStarted = false;
  showOverlay('Opponent disconnected', 'Waiting for them to reconnect…', false);
});

socket.on('room-error', (msg) => {
  showOverlay('Room error', msg, false);
  document.getElementById('overlay-box')?.insertAdjacentHTML(
    'beforeend',
    '<a class="overlay-home-link" href="/">← Back to lobby</a>'
  );
});

// ── Overlay helpers ───────────────────────────────────────
function showOverlay(title, body, showCode) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-body').textContent  = body;
  document.getElementById('overlay-code').textContent  = roomId;
  document.getElementById('copy-btn').style.display    = showCode ? '' : 'none';
  document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
  document.getElementById('overlay').classList.remove('visible');
}

document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
  });
});

// ── Board rendering ───────────────────────────────────────
function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  const targets = selectedUnitId ? validMoveTargets(selectedUnitId) : new Set();
  const rows    = boardState.board.length;
  const cols    = boardState.board[0]?.length ?? 0;

  boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  boardEl.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { unitId, territory, contested } = boardState.board[row][col];

      const cell = document.createElement('div');
      cell.className = 'cell';
      if (territory)                           cell.classList.add(`territory-${territory}`);
      else if (contested)                      cell.classList.add('territory-contested');
      if (unitId && unitId === selectedUnitId) cell.classList.add('selected');
      if (targets.has(`${row},${col}`))        cell.classList.add('move-target');
      cell.dataset.row = row;
      cell.dataset.col = col;

      if (unitId) {
        const unit   = boardState.units[unitId];
        const marker = document.createElement('div');
        marker.className = `unit-marker ${unit.type} player-${unit.player}`;
        if (hasMoved(unitId))  marker.classList.add('moved');
        if (hasPlaced(unitId)) marker.classList.add('placed');
        cell.appendChild(marker);

        const isMyUnit = unit.player === myPlayer && isMyTurn();

        if (hasMoved(unitId) && isMyUnit) {
          cell.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            selectedUnitId = null;
            socket.emit('undo-move', { unitId });
          });
        }

        if (hasPlaced(unitId) && isMyUnit) {
          cell.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            selectedUnitId = null;
            socket.emit('undo-placement', { unitId });
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
  const cp       = boardState.currentPlayer;
  const counts   = boardState.territoryCounts;
  const mon      = boardState.money;
  const costs    = boardState.unitCosts;
  const ni       = boardState.nextIncome ?? {};
  const { actionCount, maxActions, hasMovedAny } = boardState.turn;

  const indicator = document.getElementById('turn-indicator');
  indicator.textContent = `Player ${cp}'s Turn`;
  indicator.className   = `turn-indicator player-${cp}`;

  document.getElementById('action-count').textContent = `${actionCount} / ${maxActions}`;

  document.getElementById('money-1').textContent     = `$${mon[1] ?? 0}`;
  document.getElementById('money-2').textContent     = `$${mon[2] ?? 0}`;
  document.getElementById('territory-1').textContent = counts[1] ?? 0;
  document.getElementById('territory-2').textContent = counts[2] ?? 0;

  // Territory delta vs opponent
  const t1 = counts[1] ?? 0;
  const t2 = counts[2] ?? 0;
  const deltaEl1 = document.getElementById('territory-delta-1');
  const deltaEl2 = document.getElementById('territory-delta-2');
  if (deltaEl1 && deltaEl2) {
    const diff = t1 - t2;
    deltaEl1.textContent = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '0';
    deltaEl1.className   = `territory-delta ${diff > 0 ? 'delta-pos-1' : diff < 0 ? 'delta-neg-1' : 'delta-zero'}`;
    deltaEl2.textContent = diff < 0 ? `+${-diff}` : diff > 0 ? `${-diff}` : '0';
    deltaEl2.className   = `territory-delta ${diff < 0 ? 'delta-pos-2' : diff > 0 ? 'delta-neg-2' : 'delta-zero'}`;
  }

  // Income preview + breakdown
  [1, 2].forEach(p => {
    const inc = ni[p];
    document.getElementById(`income-preview-${p}`).textContent =
      inc != null ? `(+$${inc.total})` : '';
    const bdEl = document.getElementById(`income-breakdown-${p}`);
    if (bdEl) {
      bdEl.innerHTML = inc != null
        ? `$${inc.base} base +<br>$${inc.terrBonus} territory +<br>$${inc.towerBonus} towers`
        : '';
    }
  });

  document.getElementById('stats-row-1').classList.toggle('active-turn', cp === 1);
  document.getElementById('stats-row-2').classList.toggle('active-turn', cp === 2);

  // Update button cost labels dynamically from server costs
  if (costs) {
    [1, 2].forEach(p => {
      ['large', 'medium', 'small', 'tower'].forEach(t => {
        const el = document.getElementById(`cost-${p}-${t}`);
        if (el) el.textContent = `$${costs[t]}`;
      });
    });
  }

  document.querySelectorAll('.unit-btn').forEach(btn => {
    const btnPlayer = parseInt(btn.dataset.player);
    const btnType   = btn.dataset.type;
    const notMe     = btnPlayer !== myPlayer;
    const offTurn   = btnPlayer !== cp;
    const noFunds   = !offTurn && (mon[cp] ?? 0) < (costs?.[btnType] ?? 0);
    const noActions = !offTurn && actionsLeft() <= 0;
    const postMove  = !offTurn && hasMovedAny; // placement locked after first move
    const disabled  = notMe || offTurn || noFunds || noActions || postMove;
    btn.classList.toggle('off-turn', disabled);
    if (disabled && btn.classList.contains('active')) {
      btn.classList.remove('active');
      active = null;
    }
  });
}

// ── Cell click ────────────────────────────────────────────
function onCellClick(e) {
  if (!gameStarted || !isMyTurn()) return;

  const row    = parseInt(e.currentTarget.dataset.row);
  const col    = parseInt(e.currentTarget.dataset.col);
  const { unitId } = boardState.board[row][col];

  // Mode 1: placement button active
  if (active) {
    if (actionsLeft() <= 0) return;
    socket.emit('place-unit', { type: active.type, row, col });
    clearActive();
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
        if (actionsLeft() <= 0) return;
        socket.emit('move-unit', { unitId: selectedUnitId, row, col });
        selectedUnitId = null;
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
    if (actionsLeft() <= 0) return;
    socket.emit('move-unit', { unitId: selectedUnitId, row, col });
    selectedUnitId = null;
    return;
  }

  // Mode 3: nothing selected — select one of MY units
  if (unitId) {
    const unit = boardState.units[unitId];
    if (unit.player === myPlayer && isMyTurn()) {
      selectedUnitId = unitId;
      renderBoard();
    }
  }
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

  document.getElementById('submit-btn').addEventListener('click', () => {
    if (!isMyTurn()) return;
    clearActive(); selectedUnitId = null;
    socket.emit('submit-turn');
  });

  document.getElementById('restart-btn').addEventListener('click', () => {
    if (!isMyTurn()) return;
    clearActive(); selectedUnitId = null;
    document.getElementById('error-banner').classList.add('hidden');
    socket.emit('restart-turn');
  });

  document.getElementById('error-banner-dismiss').addEventListener('click', () => {
    document.getElementById('error-banner').classList.add('hidden');
  });
}

// ── Init ──────────────────────────────────────────────────
initButtons();
showOverlay('Connecting…', '', false);
