const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/timeline - restituisce i dati della linea del tempo
// Letti da JSON così Lorenzo li può modificare a mano facilmente
router.get('/', authenticate, (req, res) => {
  try {
    const dataPath = path.join(__dirname, '..', '..', 'frontend', 'data', 'timeline.json');
    const raw = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    console.error('[timeline]', err);
    res.status(500).json({ error: 'Impossibile leggere il file timeline.json' });
  }
});

module.exports = router;
