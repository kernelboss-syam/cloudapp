// Script di inizializzazione DB: crea schema e utenti di default
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./pool');

async function init() {
  console.log('[init-db] Avvio inizializzazione database...');

  try {
    // 1. Esegui schema SQL
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schema);
    console.log('[init-db] Schema creato/verificato.');

    // 2. Crea utenti di default se non esistono
    const defaultUsers = [
      { username: 'admin',      password: 'Admin123!',     role: 'central',  full_name: 'Amministratore Centrale' },
      { username: 'centrale',   password: 'Centrale123!',  role: 'central',  full_name: 'Sala Operativa' },
      { username: 'operatore1', password: 'Operatore123!', role: 'operator', full_name: 'Mario Rossi' },
      { username: 'operatore2', password: 'Operatore123!', role: 'operator', full_name: 'Lucia Bianchi' },
    ];

    for (const u of defaultUsers) {
      const existing = await db.query('SELECT id FROM users WHERE username = $1', [u.username]);
      if (existing.rows.length === 0) {
        const hash = await bcrypt.hash(u.password, 10);
        await db.query(
          'INSERT INTO users (username, password_hash, role, full_name) VALUES ($1, $2, $3, $4)',
          [u.username, hash, u.role, u.full_name]
        );
        console.log(`[init-db] Utente creato: ${u.username} (${u.role})`);
      } else {
        console.log(`[init-db] Utente ${u.username} già esistente, salto.`);
      }
    }

    console.log('[init-db] Inizializzazione completata correttamente.');
    process.exit(0);
  } catch (err) {
    console.error('[init-db] Errore:', err);
    process.exit(1);
  }
}

init();
