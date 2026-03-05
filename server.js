const express    = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');
const { createGame, BOARD_SIZE } = require('./game/state');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);
const PORT       = process.env.PORT || 3737;

// ── Logger ────────────────────────────────────────────────────────────────
//
// All output goes to stderr, which is unbuffered in Node.js.
// stdout is line-buffered when piped (i.e. always on Render.com), so if the
// process crashes, any unflushed stdout is silently lost.  stderr is always
// flushed immediately, so crash logs reliably appear in Render's Application
// Logs panel regardless of how the process dies.

function ts() {
  return new Date().toISOString();
}

function formatArg(a) {
  if (a instanceof Error) return `${a.message}\n${a.stack}`;
  if (typeof a === 'object' && a !== null) return JSON.stringify(a);
  return String(a);
}

function log(level, ...args) {
  const line = `[${ts()}] [${level}] ${args.map(formatArg).join(' ')}\n`;
  process.stderr.write(line);
}

const logger = {
  info:  (...a) => log('INFO ', ...a),
  warn:  (...a) => log('WARN ', ...a),
  error: (...a) => log('ERROR', ...a),
};

// Wrap a function so errors are logged.  Does NOT rethrow — callers that want
// the server to die on error should call process.exit themselves.
function guard(label, fn) {
  try {
    return fn();
  } catch (err) {
    logger.error(`Exception in [${label}]:`, err);
    // Do not rethrow: a bug in one handler should not kill the whole server.
  }
}

// ── Global uncaught error hooks ───────────────────────────────────────────

process.on('uncaughtException', (err) => {
  // Write directly to stderr in case the logger itself is broken.
  process.stderr.write(`[${ts()}] [FATAL] uncaughtException: ${err && err.stack || err}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[${ts()}] [FATAL] unhandledRejection: ${reason && reason.stack || reason}\n`);
  process.exit(1);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Room management ───────────────────────────────────────────────────────
//
// rooms: Map<roomId, { game, players: Map<socketId, playerNum (1|2)>, started: bool }>

const rooms = new Map();

// P1 anchor positions; P2 is the exact 180° rotation: [BOARD_SIZE-1-row, BOARD_SIZE-1-col].
// This formula is always correct regardless of board size — no manual adjustment needed.
const P1_START = [
  { type: 'medium', row: 1, col: 3 },
  { type: 'medium', row: 3, col: 1 },
  { type: 'small',  row: 2, col: 2 },
];

const STARTING_UNITS = [
  ...P1_START.map(({ type, row, col }) => ({ type, row, col, player: 1 })),
  ...P1_START.map(({ type, row, col }) => ({
    type,
    row: BOARD_SIZE - 1 - row,
    col: BOARD_SIZE - 1 - col,
    player: 2,
  })),
];

logger.info(
  `BOARD_SIZE=${BOARD_SIZE}; ` +
  `P1 at ${P1_START.map(p => `[${p.row},${p.col}](${p.type})`).join(',')}; ` +
  `P2 at ${P1_START.map(p => `[${BOARD_SIZE-1-p.row},${BOARD_SIZE-1-p.col}](${p.type})`).join(',')}`
);

function createRoom() {
  const roomId = crypto.randomUUID().slice(0, 8);
  logger.info(`Creating room roomId=${roomId}`);
  const game = createGame();
  STARTING_UNITS.forEach(u => {
    logger.info(`  placeInitialUnit type=${u.type} row=${u.row} col=${u.col} player=${u.player}`);
    game.placeInitialUnit(u.type, u.row, u.col, u.player);
  });
  rooms.set(roomId, { game, players: new Map(), started: false });
  logger.info(`Room ${roomId} created. Total rooms: ${rooms.size}`);
  return roomId;
}

// ── HTTP routes ───────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

app.get('/game/:roomId', (req, res) => {
  logger.info(`GET /game/${req.params.roomId}`);
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.post('/api/rooms', (req, res) => {
  guard('POST /api/rooms', () => {
    const roomId = createRoom();
    logger.info(`POST /api/rooms → roomId=${roomId}`);
    res.json({ roomId });
  });
});

// ── Socket.io ─────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  logger.info(`Socket connected  socketId=${socket.id}`);

  // ── join-room ─────────────────────────────────────────────────────────────

  socket.on('join-room', (roomId) => {
    guard(`join-room socketId=${socket.id}`, () => {
      logger.info(`join-room  socketId=${socket.id}  roomId=${roomId}`);
      const room = rooms.get(roomId);
      if (!room) {
        logger.warn(`join-room: room not found roomId=${roomId}`);
        socket.emit('room-error', 'Game not found. Check the code and try again.');
        return;
      }

      const taken = [...room.players.values()];
      if (taken.length >= 2) {
        logger.warn(`join-room: room full roomId=${roomId}`);
        socket.emit('room-error', 'This game is already full.');
        return;
      }

      const playerNum = taken.includes(1) ? 2 : 1;
      room.players.set(socket.id, playerNum);
      socket.data.roomId = roomId;
      socket.data.player = playerNum;
      socket.join(roomId);
      logger.info(`Player ${playerNum} joined room ${roomId}  socketId=${socket.id}`);

      socket.emit('player-assigned', playerNum);

      if (room.players.size === 2 && !room.started) {
        room.started = true;
        room.game.startTurn();
        logger.info(`Game started in room ${roomId}`);
        io.to(roomId).emit('game-started');
        io.to(roomId).emit('state-update', room.game.getState());
      } else {
        logger.info(`Player ${playerNum} waiting in room ${roomId}`);
        socket.emit('waiting');
      }
    });
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  function getRoom() {
    const { roomId } = socket.data;
    return roomId ? rooms.get(roomId) : null;
  }

  function act(eventName, fn) {
    const room = getRoom();
    if (!room || !room.started) {
      logger.warn(`act:${eventName} — game not started  socketId=${socket.id}`);
      socket.emit('action-error', 'Game not started');
      return;
    }
    try {
      logger.info(`act:${eventName}  player=${socket.data.player}  room=${socket.data.roomId}`);
      const result = fn(room.game);
      if (result?.error) {
        logger.warn(`act:${eventName} → rejected="${result.error}"  player=${socket.data.player}`);
        socket.emit('action-error', result.error);
        return;
      }
      const st = room.game.getState();
      logger.info(`act:${eventName} → ok  currentPlayer=${st.currentPlayer}  actions=${st.turn.actionCount}/${st.turn.maxActions}  money=${JSON.stringify(st.money)}`);
      io.to(socket.data.roomId).emit('state-update', st);
    } catch (err) {
      // Log the full exception but do NOT crash the server — one bad move
      // should never bring down the game for both players.
      logger.error(`Exception in act:${eventName}  player=${socket.data.player}  room=${socket.data.roomId}:`, err);
      socket.emit('action-error', `Server error in ${eventName}: ${err.message}`);
    }
  }

  // ── game actions ──────────────────────────────────────────────────────────

  socket.on('place-unit', ({ type, row, col }) => {
    logger.info(`place-unit  player=${socket.data.player}  type=${type}  row=${row}  col=${col}`);
    act('place-unit', g => g.addUnit(type, row, col, socket.data.player));
  });

  socket.on('move-unit', ({ unitId, row, col }) => {
    logger.info(`move-unit  player=${socket.data.player}  unitId=${unitId}  to=[${row},${col}]`);
    act('move-unit', g => g.moveUnit(unitId, row, col));
  });

  socket.on('undo-move', ({ unitId }) => {
    logger.info(`undo-move  player=${socket.data.player}  unitId=${unitId}`);
    act('undo-move', g => g.undoUnitMove(unitId));
  });

  socket.on('undo-placement', ({ unitId }) => {
    logger.info(`undo-placement  player=${socket.data.player}  unitId=${unitId}`);
    act('undo-placement', g => g.undoUnitPlacement(unitId));
  });

  socket.on('undo-attack', ({ unitId }) => {
    logger.info(`undo-attack  player=${socket.data.player}  unitId=${unitId}`);
    act('undo-attack', g => g.undoUnitAttack(unitId));
  });

  socket.on('submit-turn', () => {
    logger.info(`submit-turn  player=${socket.data.player}  room=${socket.data.roomId}`);
    act('submit-turn', g => g.submitTurn());
  });

  socket.on('restart-turn', () => {
    logger.info(`restart-turn  player=${socket.data.player}  room=${socket.data.roomId}`);
    act('restart-turn', g => g.restartTurn());
  });

  socket.on('resign', () => {
    logger.info(`resign  player=${socket.data.player}  room=${socket.data.roomId}`);
    act('resign', g => g.resign(socket.data.player));
  });

  // ── disconnect ────────────────────────────────────────────────────────────

  socket.on('disconnect', (reason) => {
    guard(`disconnect socketId=${socket.id}`, () => {
      logger.info(`Socket disconnected  socketId=${socket.id}  player=${socket.data.player ?? '?'}  reason=${reason}`);
      const room = getRoom();
      if (!room) return;
      room.players.delete(socket.id);
      logger.info(`Player removed from room ${socket.data.roomId}. Players remaining: ${room.players.size}`);
      io.to(socket.data.roomId).emit('opponent-disconnected');
      if (room.players.size === 0) {
        rooms.delete(socket.data.roomId);
        logger.info(`Room ${socket.data.roomId} deleted (empty). Total rooms: ${rooms.size}`);
      }
    });
  });
});

// ── Start ─────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  logger.info(`Frontline running at http://localhost:${PORT}`);
});
