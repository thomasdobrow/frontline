const express = require('express');
const path = require('path');
const { getState, addUnit, moveUnit, undoUnitMove, undoUnitPlacement, restartTurn, submitTurn } = require('./game/state');

const app = express();
const PORT = process.env.PORT || 3737;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Game API ──────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  res.json(getState());
});

app.post('/api/units', (req, res) => {
  const { player, type, row, col } = req.body;
  if (!type || row == null || col == null) {
    return res.status(400).json({ error: 'type, row, and col are required' });
  }
  const result = addUnit(type, row, col, player ?? 1);
  if (result.error) return res.status(409).json(result);
  res.json(result);
});

app.post('/api/units/:id/move', (req, res) => {
  const { row, col } = req.body;
  if (row == null || col == null) {
    return res.status(400).json({ error: 'row and col are required' });
  }
  const result = moveUnit(req.params.id, row, col);
  if (result.error) return res.status(409).json(result);
  res.json(result);
});

app.post('/api/turn/submit', (req, res) => {
  submitTurn();
  res.json(getState());
});

app.post('/api/units/:id/undo-move', (req, res) => {
  const result = undoUnitMove(req.params.id);
  if (result.error) return res.status(409).json(result);
  res.json(getState());
});

app.post('/api/units/:id/undo-placement', (req, res) => {
  const result = undoUnitPlacement(req.params.id);
  if (result.error) return res.status(409).json(result);
  res.json(getState());
});

app.post('/api/turn/restart', (req, res) => {
  const result = restartTurn();
  if (result.error) return res.status(400).json(result);
  res.json(getState());
});

app.listen(PORT, () => {
  console.log(`Frontline running at http://localhost:${PORT}`);
});
