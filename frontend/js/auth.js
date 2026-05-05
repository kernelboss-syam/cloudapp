// Modulo condiviso per autenticazione e helpers
const Auth = {
  TOKEN_KEY: 'cloudproj_token',
  USER_KEY: 'cloudproj_user',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  getUser() {
    const raw = localStorage.getItem(this.USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  setSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    window.location.href = '/index.html';
  },

  // Reindirizza al login se non autenticato
  requireAuth(allowedRoles = null) {
    const token = this.getToken();
    const user = this.getUser();
    if (!token || !user) {
      window.location.href = '/index.html';
      return null;
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      alert('Non hai i permessi per accedere a questa pagina.');
      window.location.href = '/home.html';
      return null;
    }
    return user;
  },

  // Wrapper fetch con token
  async fetch(url, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      this.logout();
      throw new Error('Sessione scaduta');
    }
    return res;
  },
};

// Render header standard
function renderHeader(activeTab = '') {
  const user = Auth.getUser();
  if (!user) return;
  const initials = (user.full_name || user.username).split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase();
  const html = `
    <header class="app-header">
      <a href="/home.html" class="logo">
        <div class="logo-icon">CL</div>
        <span>Cloud Lab</span>
      </a>
      <nav>
        <div class="user-pill">
          <div class="user-avatar">${initials}</div>
          <span>${user.full_name || user.username}</span>
        </div>
        <button class="btn-logout" onclick="Auth.logout()">Esci</button>
      </nav>
    </header>
    <div class="aws-badge">
      <span class="dot"></span>
      <span>AWS Cloud</span>
    </div>
  `;
  const placeholder = document.getElementById('header-placeholder');
  if (placeholder) placeholder.outerHTML = html;
  else document.body.insertAdjacentHTML('afterbegin', html);
}

// Helper toast
function showToast(message, type = 'info', duration = 4000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Format relative time
function timeAgo(date) {
  const d = new Date(date);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s fa`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h fa`;
  const days = Math.floor(hours / 24);
  return `${days}g fa`;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
