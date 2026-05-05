// Logica dashboard centrale operativa
let map = null;
let markers = {};
let socket = null;
let allEmergencies = [];

document.addEventListener('DOMContentLoaded', () => {
  Auth.requireAuth(['central']);
  renderHeader();

  initMap();
  connectWebSocket();
  loadAll();

  // Refresh stats ogni 5 secondi
  setInterval(loadStats, 5000);
});

function initMap() {
  // Cesena come centro di default
  map = L.map('map').setView([44.1391, 12.2431], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
}

function connectWebSocket() {
  socket = io();
  socket.on('connect', () => {
    document.getElementById('ws-status').innerHTML =
      '<span class="live-dot"></span><span>Live</span>';
  });
  socket.on('disconnect', () => {
    document.getElementById('ws-status').innerHTML =
      '<span style="color:var(--accent)">Disconnesso</span>';
  });
  socket.on('emergency:new', (e) => {
    allEmergencies.unshift(e);
    renderTable();
    renderMap();
    showToast(`Nuova segnalazione: ${e.type}`, 'error', 6000);
    // Suono opzionale
    playBeep();
  });
  socket.on('emergency:update', (e) => {
    const idx = allEmergencies.findIndex(x => x.id === e.id);
    if (idx >= 0) allEmergencies[idx] = e;
    renderTable();
    renderMap();
    loadStats();
  });
  socket.on('emergency:delete', ({ id }) => {
    allEmergencies = allEmergencies.filter(x => x.id !== id);
    renderTable();
    renderMap();
  });
}

async function loadAll() {
  await Promise.all([loadEmergencies(), loadStats()]);
}

async function loadEmergencies() {
  try {
    const res = await Auth.fetch('/api/emergencies');
    allEmergencies = await res.json();
    renderTable();
    renderMap();
  } catch (err) {
    showToast('Errore caricamento segnalazioni', 'error');
  }
}

async function loadStats() {
  try {
    const res = await Auth.fetch('/api/emergencies/stats');
    const stats = await res.json();
    document.getElementById('stat-open').textContent = stats.open;
    document.getElementById('stat-in-progress').textContent = stats.in_progress;
    document.getElementById('stat-closed').textContent = stats.closed;
    document.getElementById('stat-avg-duration').textContent =
      formatDuration(stats.avg_duration_seconds);
    renderTypesChart(stats.by_type);
  } catch (err) {
    console.error(err);
  }
}

function renderTable() {
  const tbody = document.querySelector('#emergencies-table tbody');
  // Mostra solo non chiuse + ultime 50
  const visible = allEmergencies
    .filter(e => e.status !== 'chiusa' && e.status !== 'annullata')
    .concat(allEmergencies.filter(e => e.status === 'chiusa' || e.status === 'annullata').slice(0, 30))
    .slice(0, 50);

  if (visible.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-secondary); padding: 32px;">Nessuna segnalazione</td></tr>';
    return;
  }

  tbody.innerHTML = visible.map(e => `
    <tr>
      <td><strong>#${e.id}</strong></td>
      <td>${escapeHtml(e.type)}</td>
      <td><span class="status-badge ${e.status}">${e.status.replace('_',' ')}</span></td>
      <td>${escapeHtml(e.created_by_name || '—')}</td>
      <td>${timeAgo(e.created_at)}</td>
      <td class="actions">
        ${actionsForStatus(e)}
      </td>
    </tr>
  `).join('');
}

function actionsForStatus(e) {
  const buttons = [];
  if (e.status === 'aperta') {
    buttons.push(`<button class="btn-mini primary" onclick="updateStatus(${e.id},'in_carico')">Prendi in carico</button>`);
    buttons.push(`<button class="btn-mini" onclick="updateStatus(${e.id},'annullata')">Annulla</button>`);
  } else if (e.status === 'in_carico') {
    buttons.push(`<button class="btn-mini success" onclick="updateStatus(${e.id},'chiusa')">Chiudi</button>`);
    buttons.push(`<button class="btn-mini" onclick="updateStatus(${e.id},'aperta')">Rimetti aperta</button>`);
  }
  buttons.push(`<button class="btn-mini" onclick="showDetail(${e.id})">Dettagli</button>`);
  return buttons.join('');
}

window.updateStatus = async function(id, status) {
  try {
    const res = await Auth.fetch(`/api/emergencies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Errore aggiornamento');
    showToast(`Segnalazione #${id} aggiornata a ${status.replace('_',' ')}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.showDetail = function(id) {
  const e = allEmergencies.find(x => x.id === id);
  if (!e) return;
  alert(
    `SEGNALAZIONE #${e.id}\n` +
    `Tipo: ${e.type}\n` +
    `Stato: ${e.status}\n` +
    `Priorità: ${e.priority}\n` +
    `Operatore: ${e.created_by_name || '—'}\n` +
    `Posizione: ${e.latitude || '—'}, ${e.longitude || '—'}\n` +
    `Creata: ${new Date(e.created_at).toLocaleString('it-IT')}\n` +
    `Aggiornata: ${new Date(e.updated_at).toLocaleString('it-IT')}\n\n` +
    `Descrizione:\n${e.description || '(nessuna)'}`
  );
};

function renderMap() {
  // Pulisci marker esistenti
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  // Mostra solo aperte e in_carico
  const visible = allEmergencies.filter(e =>
    (e.status === 'aperta' || e.status === 'in_carico') && e.latitude && e.longitude
  );

  visible.forEach(e => {
    const color = e.status === 'aperta' ? 'aperta' : 'in_carico';
    const icon = L.divIcon({
      className: '',
      html: `<div class="custom-marker ${color}">${e.id}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const marker = L.marker([e.latitude, e.longitude], { icon }).addTo(map);
    marker.bindPopup(`
      <strong>#${e.id} - ${escapeHtml(e.type)}</strong><br>
      Stato: ${e.status.replace('_',' ')}<br>
      Operatore: ${escapeHtml(e.created_by_name || '—')}<br>
      ${e.description ? '<em>' + escapeHtml(e.description) + '</em>' : ''}
    `);
    markers[e.id] = marker;
  });

  // Adatta vista solo se ci sono marker
  if (visible.length > 0) {
    const group = L.featureGroup(Object.values(markers));
    if (Object.keys(markers).length === 1) {
      map.setView(group.getBounds().getCenter(), 13);
    } else {
      map.fitBounds(group.getBounds().pad(0.2));
    }
  }
}

function renderTypesChart(byType) {
  const container = document.getElementById('types-chart');
  if (!byType || byType.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary); font-size:13px;">Nessun dato</p>';
    return;
  }
  const max = Math.max(...byType.map(t => t.n));
  container.innerHTML = byType.map(t => `
    <div class="chart-bar">
      <div class="chart-bar-label">
        <span>${escapeHtml(t.type)}</span>
        <strong>${t.n}</strong>
      </div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width:${(t.n / max * 100).toFixed(1)}%"></div>
      </div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Beep audio per nuove segnalazioni (Web Audio API)
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}
