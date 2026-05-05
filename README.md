# 🌥️ Cloud Lab — Progetto AWS

Webapp containerizzata progettata per essere deployata su AWS con scalabilità automatica. Espone due servizi attraverso un'interfaccia stile Google Classroom:

1. **📅 Storia del corso** — Linea del tempo interattiva, con un nodo per ogni mese del corso. I dati sono letti da `frontend/data/timeline.json`, modificabile a mano.
2. **🚨 Gestione Emergenze** — Sistema realtime con due viste:
   - **Operatore (mobile)**: form per creare segnalazioni con geolocalizzazione (reale o simulata)
   - **Centrale operativa (PC)**: dashboard con KPI, mappa Leaflet, tabella interattiva e aggiornamenti via WebSocket

---

## 🎯 Stack tecnologico

| Livello       | Tecnologia                                |
|---------------|-------------------------------------------|
| Frontend      | HTML/CSS/JS vanilla, Leaflet (mappa), Socket.IO client |
| Backend       | Node.js 20, Express, Socket.IO            |
| Database      | PostgreSQL 16 (RDS in produzione)         |
| Auth          | JWT + bcrypt                              |
| Reverse proxy | Nginx                                     |
| Container     | Docker + Docker Compose                   |
| Cloud         | AWS: EC2, ASG, ALB, RDS, CloudWatch, S3, AMI |
| Stress test   | Locust                                    |

---

## 📁 Struttura del progetto

```
aws-cloud-project/
├── backend/              # API Node.js + Socket.IO
│   ├── routes/           # Endpoint REST
│   ├── middleware/       # Auth JWT
│   ├── db/               # Connessione DB, schema, init
│   ├── server.js
│   ├── Dockerfile
│   └── package.json
├── frontend/             # SPA statica (servita dal backend)
│   ├── index.html        # Login
│   ├── home.html         # Pagina con i 2 tile
│   ├── timeline.html     # Servizio 1 - Storia corso
│   ├── operator.html     # Servizio 2A - operatore mobile
│   ├── dashboard.html    # Servizio 2B - centrale operativa
│   ├── css/
│   ├── js/
│   └── data/
│       └── timeline.json # 📝 Modifica qui i dati della timeline
├── nginx/
│   └── nginx.conf        # Reverse proxy (TLS terminato dall'ALB)
├── aws/
│   ├── user-data.sh      # Script di boot per Launch Template
│   └── DEPLOYMENT.md     # 📖 Guida passo-passo per il deploy AWS
├── locust/
│   └── locustfile.py     # Stress test per simulare picchi di traffico
├── docker-compose.yml
├── .env.example
└── README.md             # questo file
```

---

## 🚀 Quickstart locale

Prerequisiti: **Docker** e **Docker Compose** (già inclusi in Docker Desktop).

```bash
# 1. Clona il progetto e copia il file env
cp .env.example .env

# 2. Avvia tutto (con database PostgreSQL in container)
docker compose --profile local up --build

# 3. In un altro terminale, inizializza schema e utenti demo
docker compose exec backend node db/init.js

# 4. Apri http://localhost nel browser
```

### Credenziali demo

| Utente        | Password        | Ruolo                      |
|---------------|----------------|----------------------------|
| `admin`       | `Admin123!`    | Centrale operativa         |
| `centrale`    | `Centrale123!` | Centrale operativa         |
| `operatore1`  | `Operatore123!`| Operatore (mobile)         |
| `operatore2`  | `Operatore123!`| Operatore (mobile)         |

---

## ☁️ Deploy su AWS

Tutto il dettaglio è in **[`aws/DEPLOYMENT.md`](aws/DEPLOYMENT.md)**. Riassunto:

1. **RDS PostgreSQL** — crea l'istanza con db `cloudproject`, user `postgres`, password `Vmware1!`
2. **Security Group** — uno per ALB, uno per EC2, uno per RDS (con riferimenti incrociati)
3. **AMI** — istanza temporanea con Docker preinstallato e codice clonato → snapshot
4. **Application Load Balancer** + Target Group con health check su `/health` e *Stickiness* attiva (per WebSocket)
5. **Launch Template** che usa l'AMI e lo `user-data.sh` come boot script
6. **Auto Scaling Group** collegato all'ALB con scaling target su CPU 60%
7. **CloudWatch** — metriche e allarmi automatici dell'ASG
8. **Locust** — lancia il test e guarda l'ASG creare nuove istanze

---

## 📝 Personalizzazione

### Modificare la timeline
Modifica `frontend/data/timeline.json`:

```json
{
  "course_name": "Nome del tuo corso",
  "start_date": "2024-09-01",
  "end_date": "2026-12-31",
  "months": [
    {
      "date": "2025-01",
      "title": "Titolo del mese",
      "subjects": [
        "Materia 1",
        "Tecnologia 2"
      ]
    }
  ]
}
```

Su AWS, ogni istanza ha la sua copia. Se vuoi una sola fonte di verità, sposta il file su **S3** e modifica `backend/routes/timeline.js` per leggerlo da lì con il SDK AWS (`@aws-sdk/client-s3`).

### Cambiare credenziali demo
Modifica `backend/db/init.js` e rilancia `node db/init.js`.

### Aggiungere nuovi tipi di emergenza
Modifica le `<option>` in `frontend/operator.html` e nel pool di Locust in `locust/locustfile.py`.

---

## 🔌 API Endpoints

| Metodo | Endpoint                       | Auth     | Descrizione                              |
|--------|--------------------------------|----------|------------------------------------------|
| POST   | `/api/auth/login`              | —        | Login, restituisce JWT                   |
| GET    | `/api/auth/me`                 | JWT      | Info utente corrente                     |
| GET    | `/api/timeline`                | JWT      | Dati JSON della linea del tempo          |
| GET    | `/api/emergencies`             | JWT      | Lista segnalazioni (filtro `?status=`)   |
| GET    | `/api/emergencies/stats`       | JWT central | Statistiche dashboard                  |
| POST   | `/api/emergencies`             | JWT      | Crea nuova segnalazione                  |
| PATCH  | `/api/emergencies/:id`         | JWT      | Aggiorna stato/note                      |
| DELETE | `/api/emergencies/:id`         | JWT central | Elimina segnalazione                  |
| GET    | `/health`                      | —        | Healthcheck per ALB                      |

**WebSocket** (Socket.IO su `/socket.io`):
- `emergency:new` — emesso quando un operatore crea una segnalazione
- `emergency:update` — emesso quando lo stato cambia
- `emergency:delete` — emesso quando viene eliminata

---

## 🧪 Test di carico (Locust)

```bash
cd locust
pip install locust
locust -f locustfile.py --host=http://<DNS-ALB>
```

Apri `http://localhost:8089`, imposta 200-500 utenti, spawn rate 10-20/sec e osserva l'ASG scalare in CloudWatch.

---

## 🔐 Note di sicurezza

In produzione vera (oltre questo progetto didattico):
- **JWT_SECRET** deve essere generato random (`openssl rand -base64 32`) e conservato in **AWS Secrets Manager**
- Le credenziali DB vanno in **Secrets Manager** o **Parameter Store**, MAI nel `user-data` in chiaro
- Aggiungere un certificato **ACM** all'ALB e forzare HTTPS
- Restringere il Security Group SSH al solo IP dell'amministratore
- Rate limit più aggressivi (lo trovi già attivo in `server.js`)
- Aggiungere refresh token e logout server-side

---

## 📜 Licenza

Progetto didattico — usa, modifica e distribuisci liberamente.
