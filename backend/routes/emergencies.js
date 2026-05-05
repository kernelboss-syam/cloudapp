const express = require('express');
const db = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

module.exports = (io) => {
  const router = express.Router();

  // GET /api/emergencies - lista segnalazioni (filtri opzionali)
  router.get('/', authenticate, async (req, res) => {
    const { status, limit = 200 } = req.query;
    try {
      let query = `
        SELECT e.*, u.full_name AS assigned_to_name
        FROM emergencies e
        LEFT JOIN users u ON e.assigned_to = u.id
      `;
      const params = [];
      if (status) {
        query += ' WHERE e.status = $1';
        params.push(status);
      }
      query += ` ORDER BY e.created_at DESC LIMIT ${parseInt(limit)}`;
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (err) {
      console.error('[emergencies/list]', err);
      res.status(500).json({ error: 'Errore lettura segnalazioni' });
    }
  });

  // GET /api/emergencies/stats - dashboard centrale operativa
  router.get('/stats', authenticate, requireRole('central'), async (req, res) => {
    try {
      const [openCount, takenCount, closedCount, avgDuration, byType, byPriority] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS n FROM emergencies WHERE status = 'aperta'`),
        db.query(`SELECT COUNT(*)::int AS n FROM emergencies WHERE status = 'in_carico'`),
        db.query(`SELECT COUNT(*)::int AS n FROM emergencies WHERE status = 'chiusa'`),
        db.query(`
          SELECT COALESCE(EXTRACT(EPOCH FROM AVG(closed_at - created_at)), 0)::int AS avg_seconds
          FROM emergencies WHERE status = 'chiusa' AND closed_at IS NOT NULL
        `),
        db.query(`
          SELECT type, COUNT(*)::int AS n
          FROM emergencies
          GROUP BY type ORDER BY n DESC
        `),
        db.query(`
          SELECT priority, COUNT(*)::int AS n
          FROM emergencies
          WHERE status IN ('aperta','in_carico')
          GROUP BY priority
        `),
      ]);

      res.json({
        open: openCount.rows[0].n,
        in_progress: takenCount.rows[0].n,
        closed: closedCount.rows[0].n,
        avg_duration_seconds: avgDuration.rows[0].avg_seconds,
        by_type: byType.rows,
        by_priority: byPriority.rows,
      });
    } catch (err) {
      console.error('[emergencies/stats]', err);
      res.status(500).json({ error: 'Errore calcolo statistiche' });
    }
  });

  // POST /api/emergencies - crea nuova segnalazione (operatore da cellulare)
  router.post('/', authenticate, async (req, res) => {
    const { type, description, latitude, longitude, priority } = req.body || {};
    if (!type) {
      return res.status(400).json({ error: 'Tipologia obbligatoria' });
    }
    try {
      const result = await db.query(
        `INSERT INTO emergencies
         (type, description, latitude, longitude, status, priority, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, 'aperta', $5, $6, $7)
         RETURNING *`,
        [
          type,
          description || null,
          latitude || null,
          longitude || null,
          priority || 'media',
          req.user.id,
          req.user.full_name || req.user.username,
        ]
      );
      const emergency = result.rows[0];

      // Notifica via WebSocket alla centrale operativa
      io.emit('emergency:new', emergency);

      res.status(201).json(emergency);
    } catch (err) {
      console.error('[emergencies/create]', err);
      res.status(500).json({ error: 'Errore creazione segnalazione' });
    }
  });

  // PATCH /api/emergencies/:id - aggiorna stato/note (centrale operativa)
  router.patch('/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const { status, notes, assigned_to } = req.body || {};

    const validStatuses = ['aperta', 'in_carico', 'annullata', 'chiusa'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Stato non valido' });
    }

    try {
      const fields = [];
      const params = [];
      let i = 1;

      if (status !== undefined)      { fields.push(`status = $${i++}`);      params.push(status); }
      if (notes !== undefined)       { fields.push(`notes = $${i++}`);       params.push(notes); }
      if (assigned_to !== undefined) { fields.push(`assigned_to = $${i++}`); params.push(assigned_to); }

      if (fields.length === 0) {
        return res.status(400).json({ error: 'Nessun campo da aggiornare' });
      }

      params.push(id);
      const query = `
        UPDATE emergencies SET ${fields.join(', ')}
        WHERE id = $${i}
        RETURNING *
      `;
      const result = await db.query(query, params);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Segnalazione non trovata' });
      }
      const updated = result.rows[0];
      io.emit('emergency:update', updated);
      res.json(updated);
    } catch (err) {
      console.error('[emergencies/update]', err);
      res.status(500).json({ error: 'Errore aggiornamento' });
    }
  });

  // DELETE /api/emergencies/:id - solo central per ripulire
  router.delete('/:id', authenticate, requireRole('central'), async (req, res) => {
    try {
      await db.query('DELETE FROM emergencies WHERE id = $1', [req.params.id]);
      io.emit('emergency:delete', { id: parseInt(req.params.id) });
      res.json({ deleted: true });
    } catch (err) {
      console.error('[emergencies/delete]', err);
      res.status(500).json({ error: 'Errore cancellazione' });
    }
  });

  return router;
};
