const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { authenticate, signToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username e password obbligatori' });
  }
  try {
    const result = await db.query(
      'SELECT id, username, password_hash, role, full_name FROM users WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Errore interno server' });
  }
});

// GET /api/auth/me - info sull'utente corrente
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
