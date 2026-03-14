# Sprawl

A real-time two-player territory control game played on an 11×11 grid. Place and move units to capture territory and eliminate your opponent.

## Play

Live at [sprawl-tomtom-0f1bf6b2.koyeb.app](https://sprawl-tomtom-0f1bf6b2.koyeb.app)

## Stack

- Node.js + Express + Socket.io
- Vanilla JS frontend
- Deployed on [Koyeb](https://koyeb.com)

---

## Rules

### Board

- **11×11 grid**
- **4 mountains** at (3,3), (3,7), (7,3), (7,7) — units cannot be placed on mountains, but a unit starting its move on a mountain gets +1 movement range
- **Water tiles** block movement and placement

### Units

| Unit | Cost | Range | Notes |
|------|------|-------|-------|
| Small | $25 | 1 | Fast, counters Large |
| Medium | $60 | 2 | Counters Small |
| Large | $100 | 3 | Counters Medium |
| Tower | $50 | 2 | Immovable; always projects territory |

Range applies to both movement and attacks.

### Combat

Each unit defeats a specific type (rock-paper-scissors):

- **Small** defeats Large and Tower
- **Medium** defeats Small and Tower
- **Large** defeats Medium and Tower
- **Tower** defeats nothing (defensive only)

Same-type attacks: both units take 1 damage and the attacker stays in place. All units start with 2 HP.

Capture attacks: attacker moves into the target cell; target is destroyed.

### Territory

A unit projects territory when **activated** — a unit is active if it is within distance 2 of any friendly unit or building. Towers are always active.

- Territory radius equals the unit's range (1/2/3 cells)
- A cell is owned by a player only if claimed by exactly one player (contested cells belong to neither)
- **Income bonus:** $1 per territory cell you control

### Money & Income

- **Starting money:** Player 1 = $60 · Player 2 = $70
- **Income** is collected at the end of each player's turn
- **Income formula:** $10 base + territory cells + $3 per tower

Units can only be placed in friendly territory.

### Actions & Escalation

- Players start with **3 actions per turn**
- Every 17 global turns the action limit increases: 3 → 4 → 5 → …
- One action = one placement, one move, or one attack
- Units placed this turn cannot move until next turn

### Turn Structure

1. Place units (costs money, costs actions)
2. Move / attack units (costs actions)
3. Submit turn → income collected → opponent's turn

**Restart Turn** undoes all changes made this turn.

### Winning

The game ends when one player has **zero units** (elimination), or a player **resigns**.

---

## Local development

```bash
npm install
npm start        # starts on port 3737
npm test         # run test suite
```
