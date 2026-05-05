// Logica pagina operatore (creazione segnalazioni da cellulare)
let currentPosition = null;
let geoMode = 'real'; // 'real' o 'simulated'
let geoWatchId = null;

document.addEventListener('DOMContentLoaded', () => {
  Auth.requireAuth();
  renderHeader();

  setupGeolocation();
  setupForm();
  loadMyReports();

  // Auto-refresh ogni 10 secondi delle proprie segnalazioni
  setInterval(loadMyReports, 10000);
});

function setupGeolocation() {
  document.getElementById('geo-real').addEventListener('click', () => {
    geoMode = 'real';
    updateGeoToggle();
    startRealGeolocation();
  });
  document.getElementById('geo-simulated').addEventListener('click', () => {
    geoMode = 'simulated';
    updateGeoToggle();
    stopGeolocation();
    simulateGeolocation();
  });

  // Default: prova reale
  startRealGeolocation();
}

function updateGeoToggle() {
  document.querySelectorAll('.geo-toggle button').forEach(b => b.classList.remove('active'));
  document.getElementById(`geo-${geoMode}`).classList.add('active');
}

function startRealGeolocation() {
  const dot = document.querySelector('.geo-dot');
  const text = document.getElementById('geo-text');
  const coords = document.querySelector('.coords');

  if (!navigator.geolocation) {
    dot.className = 'geo-dot error';
    text.textContent = 'Geolocalizzazione non supportata';
    return;
  }
  text.textContent = 'Acquisizione posizione...';
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      dot.className = 'geo-dot active';
      text.textContent = 'Posizione GPS attiva';
      coords.textContent = `${currentPosition.lat.toFixed(5)}, ${currentPosition.lng.toFixed(5)}`;
    },
    (err) => {
      dot.className = 'geo-dot error';
      text.textContent = 'GPS non disponibile - usa Simulata';
      console.warn('Geo error:', err.message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

function stopGeolocation() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

function simulateGeolocation() {
  // Posizioni simulate intorno a Cesena (Emilia-Romagna)
  const baseLat = 44.1391;
  const baseLng = 12.2431;
  const offsetLat = (Math.random() - 0.5) * 0.05;
  const offsetLng = (Math.random() - 0.5) * 0.05;
  currentPosition = {
    lat: baseLat + offsetLat,
    lng: baseLng + offsetLng,
  };
  document.querySelector('.geo-dot').className = 'geo-dot active';
  document.getElementById('geo-text').textContent = 'Posizione simulata';
  document.querySelector('.coords').textContent =
    `${currentPosition.lat.toFixed(5)}, ${currentPosition.lng.toFixed(5)}`;
}

function setupForm() {
  const form = document.getElementById('emergency-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentPosition) {
      showToast('Posizione non disponibile, attiva GPS o Simulata', 'error');
      return;
    }
    const payload = {
      type: document.getElementById('type').value,
      description: document.getElementById('description').value.trim(),
      priority: document.getElementById('priority').value,
      latitude: currentPosition.lat,
      longitude: currentPosition.lng,
    };
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Invio...';
    try {
      const res = await Auth.fetch('/api/emergencies', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore invio');
      showToast('Segnalazione inviata correttamente', 'success');
      form.reset();
      // Se siamo in modalità simulata, rigenera posizione
      if (geoMode === 'simulated') simulateGeolocation();
      loadMyReports();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Invia segnalazione';
    }
  });
}

async function loadMyReports() {
  const container = document.getElementById('my-reports-list');
  try {
    const res = await Auth.fetch('/api/emergencies?limit=20');
    const all = await res.json();
    const user = Auth.getUser();
    const mine = all.filter(e => e.created_by === user.id);
    if (mine.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); font-size: 14px;">Nessuna segnalazione ancora inviata.</p>';
      return;
    }
    container.innerHTML = mine.map(e => `
      <div class="report-item status-${e.status}">
        <div class="report-header">
          <span class="report-type">${e.type}</span>
          <span class="status-badge ${e.status}">${e.status.replace('_',' ')}</span>
        </div>
        ${e.description ? `<div class="report-description">${escapeHtml(e.description)}</div>` : ''}
        <div class="report-meta">
          ID #${e.id} · Priorità: ${e.priority} · Inviata ${timeAgo(e.created_at)}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
