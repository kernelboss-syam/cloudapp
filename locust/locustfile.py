"""
Locust file per stress test della webapp Cloud AWS.

Uso:
    pip install locust
    locust -f locustfile.py --host=http://<ALB-DNS-NAME>

Poi apri http://localhost:8089 nel browser e configura:
    - Numero utenti virtuali (es. 200)
    - Spawn rate (es. 10/sec)
    - Durata: lascia vuoto per illimitato

Lo scopo è far salire la CPU delle istanze EC2 oltre la soglia
configurata sull'ASG (tipicamente 60-70%) per attivare lo
scaling-out e creare nuove istanze.
"""

import random
from locust import HttpUser, task, between


# Pool di utenti operatori usati per la simulazione
OPERATORS = [
    {"username": "operatore1", "password": "Operatore123!"},
    {"username": "operatore2", "password": "Operatore123!"},
]

EMERGENCY_TYPES = [
    "incidente stradale",
    "incendio",
    "terremoto",
    "alluvione",
    "emergenza sanitaria",
    "black-out",
    "aggressione",
    "dispersione persona",
]

PRIORITIES = ["bassa", "media", "alta", "critica"]

# Coordinate intorno a Cesena (Emilia-Romagna)
BASE_LAT, BASE_LNG = 44.1391, 12.2431


class OperatorUser(HttpUser):
    """Simula un operatore mobile che invia segnalazioni."""

    wait_time = between(1, 3)
    token = None

    def on_start(self):
        """Login iniziale."""
        creds = random.choice(OPERATORS)
        with self.client.post(
            "/api/auth/login",
            json=creds,
            catch_response=True,
            name="POST /api/auth/login",
        ) as r:
            if r.status_code == 200:
                self.token = r.json().get("token")
            else:
                r.failure(f"Login fallito: {r.status_code}")

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    @task(5)
    def create_emergency(self):
        """Crea una nuova segnalazione - task più frequente."""
        if not self.token:
            return
        payload = {
            "type": random.choice(EMERGENCY_TYPES),
            "description": f"Segnalazione di test #{random.randint(1, 100000)}",
            "priority": random.choice(PRIORITIES),
            "latitude": BASE_LAT + (random.random() - 0.5) * 0.1,
            "longitude": BASE_LNG + (random.random() - 0.5) * 0.1,
        }
        self.client.post(
            "/api/emergencies",
            json=payload,
            headers=self._headers(),
            name="POST /api/emergencies",
        )

    @task(3)
    def list_emergencies(self):
        """Lista segnalazioni recenti."""
        if not self.token:
            return
        self.client.get(
            "/api/emergencies?limit=50",
            headers=self._headers(),
            name="GET /api/emergencies",
        )

    @task(1)
    def get_timeline(self):
        """Carica i dati della timeline."""
        if not self.token:
            return
        self.client.get(
            "/api/timeline",
            headers=self._headers(),
            name="GET /api/timeline",
        )


class CentralUser(HttpUser):
    """Simula la centrale operativa che monitora la dashboard."""

    wait_time = between(2, 5)
    weight = 1  # 1 centrale per ogni N operatori
    token = None

    def on_start(self):
        with self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "Admin123!"},
            catch_response=True,
            name="POST /api/auth/login [central]",
        ) as r:
            if r.status_code == 200:
                self.token = r.json().get("token")

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    @task(3)
    def fetch_stats(self):
        if not self.token:
            return
        self.client.get(
            "/api/emergencies/stats",
            headers=self._headers(),
            name="GET /api/emergencies/stats",
        )

    @task(2)
    def fetch_emergencies(self):
        if not self.token:
            return
        self.client.get(
            "/api/emergencies",
            headers=self._headers(),
            name="GET /api/emergencies [central]",
        )
