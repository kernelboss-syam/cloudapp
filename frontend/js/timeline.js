// Logica pagina linea del tempo
document.addEventListener('DOMContentLoaded', async () => {
  Auth.requireAuth();
  renderHeader();

  const container = document.getElementById('timeline-track');
  const headerEl = document.querySelector('.timeline-header');

  try {
    const res = await Auth.fetch('/api/timeline');
    if (!res.ok) throw new Error('Impossibile caricare i dati');
    const data = await res.json();

    // Aggiorna intestazione
    document.querySelector('.course-name').textContent = data.course_name;
    const startDate = new Date(data.start_date);
    const endDate = new Date(data.end_date);
    document.querySelector('.course-range').textContent =
      `Da ${startDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })} a ${endDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`;

    // Determina mese corrente per evidenziare il nodo
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const monthNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

    container.innerHTML = '<div class="timeline-line"></div>';

    data.months.forEach((m, idx) => {
      const [year, monthNum] = m.date.split('-');
      const monthIdx = parseInt(monthNum) - 1;

      // Determina classe (past/current/future)
      let cls = 'future';
      if (m.date < currentMonthKey) cls = 'past';
      else if (m.date === currentMonthKey) cls = 'current';

      const node = document.createElement('div');
      node.className = `timeline-node ${cls}`;
      node.innerHTML = `
        <span class="node-month">${monthNames[monthIdx]} ${year}</span>
        <div class="node-dot" tabindex="0" role="button" aria-label="${m.title}"></div>
        <span class="node-label">${m.title.length > 20 ? m.title.slice(0,18) + '…' : m.title}</span>
        <div class="node-tooltip">
          <div class="tooltip-date">${monthNames[monthIdx]} ${year}</div>
          <div class="tooltip-title">${m.title}</div>
          <ul class="tooltip-subjects">
            ${m.subjects.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      `;
      // Per touch device: tap-to-toggle
      const dot = node.querySelector('.node-dot');
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.timeline-node.tooltip-active').forEach(n => {
          if (n !== node) n.classList.remove('tooltip-active');
        });
        node.classList.toggle('tooltip-active');
      });
      container.appendChild(node);
    });

    // Chiudi tooltip cliccando fuori
    document.addEventListener('click', () => {
      document.querySelectorAll('.timeline-node.tooltip-active').forEach(n => n.classList.remove('tooltip-active'));
    });

    // Scroll al nodo corrente
    const currentNode = container.querySelector('.timeline-node.current');
    if (currentNode) {
      setTimeout(() => {
        currentNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }, 200);
    }

  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="alert alert-error">Errore caricamento timeline: ${err.message}</div>`;
  }
});
