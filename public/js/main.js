// ── Client state ──────────────────────────────────────────
let active       = null;
let selectedUnitId = null;
let myPlayer     = null;  // assigned by server (1 or 2)
let gameStarted  = false;

let boardState = {
  board: [], units: {}, territoryCounts: {},
  currentPlayer: 1, money: { 1: 0, 2: 0 },
  unitCosts: { large: 100, medium: 60, small: 25, tower: 50 },
  netWorth:  { 1: 0, 2: 0 },
  turnNumber: 0,
  turn: { actionCount: 0, maxActions: 3, turnsUntilActionBump: 21, nextMaxActions: 4,
          movedUnitIds: [], placedUnitIds: [], attackedUnitIds: [] },
};

// ── Helpers ───────────────────────────────────────────────
// BEATS, canCapture, manhattan, validMoveTargets are provided by logic.js,
// which is loaded via <script> before this file in game.html.

function hasMoved(id)    { return boardState.turn.movedUnitIds?.includes(id); }
function hasPlaced(id)   { return boardState.turn.placedUnitIds?.includes(id); }
function hasAttacked(id) { return boardState.turn.attackedUnitIds?.includes(id); }
function actionsLeft()   { return boardState.turn.maxActions - boardState.turn.actionCount; }
function isMyTurn()      { return myPlayer === boardState.currentPlayer; }


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
  if (boardState.winner) showGameOver(boardState.winner, boardState.winReason);
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

  const targets = selectedUnitId ? validMoveTargets(selectedUnitId, boardState, boardState.turn) : new Set();
  const rows    = boardState.board.length;
  const cols    = boardState.board[0]?.length ?? 0;

  boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  boardEl.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { unitId, territory, contested } = boardState.board[row][col];

      const cell = document.createElement('div');
      cell.className = 'cell';
      if (boardState.board[row][col].mountain)  cell.classList.add('mountain');
      if (territory)                             cell.classList.add(`territory-${territory}`);
      else if (contested)                        cell.classList.add('territory-contested');
      if (unitId && unitId === selectedUnitId)   cell.classList.add('selected');
      if (targets.has(`${row},${col}`))          cell.classList.add('move-target');
      cell.dataset.row = row;
      cell.dataset.col = col;

      if (unitId) {
        const unit   = boardState.units[unitId];
        const marker = document.createElement('div');
        marker.className = `unit-marker ${unit.type} player-${unit.player}`;
        if (hasMoved(unitId))    marker.classList.add('moved');
        if (hasPlaced(unitId))   marker.classList.add('placed');
        if (hasAttacked(unitId)) marker.classList.add('moved'); // dim after attacking
        if (unit.hp === 1)       marker.classList.add('damaged');
        cell.appendChild(marker);
        if (unit.hp === 1) {
          const pip = document.createElement('div');
          pip.className = 'damage-pip';
          cell.appendChild(pip);
        }

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

        if (hasAttacked(unitId) && isMyUnit) {
          cell.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            selectedUnitId = null;
            socket.emit('undo-attack', { unitId });
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
  const { actionCount, maxActions, turnsUntilActionBump, nextMaxActions, hasMovedAny } = boardState.turn;
  const turnNumber = boardState.turnNumber ?? 0;

  const indicator = document.getElementById('turn-indicator');
  indicator.textContent = `Player ${cp}'s Turn`;
  indicator.className   = `turn-indicator player-${cp}`;

  const roundNumber = turnNumber === 0 ? 1 : Math.ceil(turnNumber / 2);
  const turnCounterEl = document.getElementById('turn-counter');
  if (turnCounterEl) turnCounterEl.textContent = `Turn ${roundNumber}`;

  document.getElementById('action-count').textContent = `${actionCount} / ${maxActions}`;

  // ── Stage progress ring ───────────────────────────────────
  const STAGE_TOOLTIP =
    'Stages increase the action limit for all players. ' +
    'Every 17 moves, each player gains +1 action per turn. ' +
    'Stage 1: moves 1–17 (3 actions). Stage 2: moves 18–34 (4 actions). ' +
    'Stage 3 and beyond continue adding 1 action every 17 moves.';

  const bumpEl = document.getElementById('action-bump');
  const fillEl = document.getElementById('stage-ring-fill');
  if (bumpEl && fillEl) {
    const stageSize      = boardState.turn.stageSize ?? 17;
    const movesCompleted = stageSize - turnsUntilActionBump;
    const circumference  = 2 * Math.PI * 9;
    const fillFraction   = Math.max(0, Math.min(1, movesCompleted / stageSize));
    fillEl.style.strokeDasharray  = `${circumference.toFixed(3)} ${circumference.toFixed(3)}`;
    fillEl.style.strokeDashoffset = (circumference * (1 - fillFraction)).toFixed(3);
    fillEl.classList.toggle('stage-ring-soon', turnsUntilActionBump <= 3);
    bumpEl.title = STAGE_TOOLTIP;
  }

  document.getElementById('money-1').textContent     = `$${mon[1] ?? 0}`;
  document.getElementById('money-2').textContent     = `$${mon[2] ?? 0}`;
  document.getElementById('territory-1').textContent = counts[1] ?? 0;
  document.getElementById('territory-2').textContent = counts[2] ?? 0;

  // ── Territory bar + advantage number ─────────────────────
  const totalCells = boardState.board.length * (boardState.board[0]?.length ?? 0);
  const p1Cells    = counts[1] ?? 0;
  const p2Cells    = counts[2] ?? 0;
  const neutCells  = Math.max(0, totalCells - p1Cells - p2Cells);
  if (totalCells > 0) {
    const fmt = (n) => `${(n / totalCells * 100).toFixed(2)}%`;
    const p1Bar   = document.getElementById('territory-bar-p1');
    const neutBar = document.getElementById('territory-bar-neutral');
    const p2Bar   = document.getElementById('territory-bar-p2');
    if (p1Bar)   p1Bar.style.width   = fmt(p1Cells);
    if (neutBar) neutBar.style.width = fmt(neutCells);
    if (p2Bar)   p2Bar.style.width   = fmt(p2Cells);
  }
  const advEl = document.getElementById('territory-advantage');
  if (advEl) {
    const diff = p1Cells - p2Cells;
    advEl.textContent = diff === 0 ? '±0' : diff > 0 ? `+${diff}` : `${diff}`;
    advEl.className   = `territory-advantage ${diff > 0 ? 'terr-adv-p1' : diff < 0 ? 'terr-adv-p2' : 'terr-adv-zero'}`;
  }

  // ── Submit button highlight ───────────────────────────────
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) {
    submitBtn.classList.toggle('submit-ready', actionCount >= maxActions && actionCount > 0 && isMyTurn());
  }

  // Net worth
  const nw = boardState.netWorth ?? {};
  [1, 2].forEach(p => {
    const nwEl = document.getElementById(`net-worth-${p}`);
    if (nwEl) nwEl.textContent = `$${nw[p] ?? 0}`;
  });

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
    ['large', 'medium', 'small', 'tower'].forEach(t => {
      const el = document.getElementById(`cost-${t}`);
      if (el) el.textContent = `$${costs[t]}`;
    });
  }

  document.querySelectorAll('.unit-btn').forEach(btn => {
    const btnType   = btn.dataset.type;
    const offTurn   = !isMyTurn();
    const noFunds   = !offTurn && (mon[cp] ?? 0) < (costs?.[btnType] ?? 0);
    const noActions = !offTurn && actionsLeft() <= 0;
    const postMove  = !offTurn && hasMovedAny; // placement locked after first move
    const disabled  = offTurn || noFunds || noActions || postMove;
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

    const targets = validMoveTargets(selectedUnitId, boardState, boardState.turn);

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
function setActive(type) {
  document.querySelectorAll('.unit-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.type === type)
  );
  active = { type };
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
      const type          = btn.dataset.type;
      const alreadyActive = active?.type === type;
      alreadyActive ? clearActive() : setActive(type);
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

// ── Game over ─────────────────────────────────────────────
function showGameOver(winner, winReason) {
  const overlay  = document.getElementById('gameover-overlay');
  const resultEl = document.getElementById('gameover-result');
  const reasonEl = document.getElementById('gameover-reason');
  if (!overlay) return;

  const loserNum = winner === 1 ? 2 : 1;

  if (myPlayer === winner) {
    resultEl.textContent = 'YOU WIN';
    resultEl.style.color = `var(--p${winner}-color)`;
  } else {
    resultEl.textContent = 'YOU LOSE';
    resultEl.style.color = 'var(--text-dim)';
  }

  reasonEl.textContent = winReason === 'resignation'
    ? `Player ${loserNum} resigned`
    : `Player ${loserNum} has no units remaining`;

  overlay.classList.add('visible');
}

// ── Resign ────────────────────────────────────────────────
function initResign() {
  const btn = document.getElementById('resign-btn');
  if (!btn) return;
  let confirming     = false;
  let confirmTimeout = null;

  btn.addEventListener('click', () => {
    if (boardState.winner) return;
    if (confirming) {
      clearTimeout(confirmTimeout);
      confirming = false;
      btn.textContent = 'Resign';
      btn.classList.remove('confirming');
      socket.emit('resign');
    } else {
      confirming = true;
      btn.textContent = 'Confirm?';
      btn.classList.add('confirming');
      confirmTimeout = setTimeout(() => {
        confirming = false;
        btn.textContent = 'Resign';
        btn.classList.remove('confirming');
      }, 3000);
    }
  });
}

// ── Rules modal ───────────────────────────────────────────
function initRules() {
  const overlay  = document.getElementById('rules-overlay');
  const closeBtn = document.getElementById('rules-close');
  const openBtn  = document.getElementById('rules-btn');
  if (!overlay) return;
  openBtn?.addEventListener('click', () => overlay.classList.add('visible'));
  closeBtn?.addEventListener('click', () => overlay.classList.remove('visible'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.classList.remove('visible'); });
}

// ── Init ──────────────────────────────────────────────────
initButtons();
initRules();
initResign();
showOverlay('Connecting…', '', false);
