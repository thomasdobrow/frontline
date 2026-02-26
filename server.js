const express    = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');
const { createGame } = require('./game/state');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);
const PORT       = process.env.PORT || 3737;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Room management ───────────────────────────────────────────────────────
//
// rooms: Map<roomId, { game, players: Map<socketId, playerNum (1|2)>, started: bool }>

const rooms = new Map();

const STARTING_UNITS = [
  { type: 'medium', row: 1,  col: 2,  player: 1 },
  { type: 'medium', row: 2,  col: 1,  player: 1 },
  { type: 'medium', row: 17, col: 18, player: 2 },
  { type: 'medium', row: 18, col: 17, player: 2 },
];

function createRoom() {
  const roomId = crypto.randomUUID().slice(0, 8);
  const game   = createGame();
  STARTING_UNITS.forEach(u => game.placeInitialUnit(u.type, u.row, u.col, u.player));
  rooms.set(roomId, { game, players: new Map(), started: false });
  return roomId;
}

// ── HTTP routes ───────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

app.get('/game/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.post('/api/rooms', (req, res) => {
  const roomId = createRoom();
  res.json({ roomId });
});

// ── Socket.io ─────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // ── join-room ────────────────────────────────────────────────────────────
  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('room-error', 'Game not found. Check the code and try again.');
      return;
    }

    const taken = [...room.players.values()];
    if (taken.length >= 2) {
      socket.emit('room-error', 'This game is already full.');
      return;
    }

    const playerNum = taken.includes(1) ? 2 : 1;
    room.players.set(socket.id, playerNum);
    socket.data.roomId = roomId;
    socket.data.player = playerNum;
    socket.join(roomId);

    socket.emit('player-assigned', playerNum);

    if (room.players.size === 2 && !room.started) {
      room.started = true;
      room.game.startTurn();
      io.to(roomId).emit('game-started');
      io.to(roomId).emit('state-update', room.game.getState());
    } else {
      socket.emit('waiting');
    }
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  function getRoom() {
    const { roomId } = socket.data;
    return roomId ? rooms.get(roomId) : null;
  }

  function act(fn) {
    const room = getRoom();
    if (!room || !room.started) { socket.emit('action-error', 'Game not started'); return; }
    const result = fn(room.game);
    if (result?.error) { socket.emit('action-error', result.error); return; }
    io.to(socket.data.roomId).emit('state-update', room.game.getState());
  }

  // ── game actions ──────────────────────────────────────────────────────────

  socket.on('place-unit',      ({ type, row, col })  => act(g => g.addUnit(type, row, col, socket.data.player)));
  socket.on('move-unit',       ({ unitId, row, col }) => act(g => g.moveUnit(unitId, row, col)));
  socket.on('undo-move',       ({ unitId })           => act(g => g.undoUnitMove(unitId)));
  socket.on('undo-placement',  ({ unitId })           => act(g => g.undoUnitPlacement(unitId)));
  socket.on('submit-turn',     ()                     => act(g => g.submitTurn()));
  socket.on('restart-turn',    ()                     => act(g => g.restartTurn()));

  // ── disconnect ────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    room.players.delete(socket.id);
    io.to(socket.data.roomId).emit('opponent-disconnected');
    if (room.players.size === 0) rooms.delete(socket.data.roomId);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Frontline running at http://localhost:${PORT}`);
});
