# Guida al deploy su AWS

Questa guida ti accompagna passo-passo nella messa in produzione del progetto su AWS, sfruttando i seguenti servizi:

| Servizio AWS              | Ruolo                                                          |
|---------------------------|----------------------------------------------------------------|
| **EC2**                   | Istanze che eseguono i container Docker                        |
| **AMI**                   | Immagine pre-configurata per le istanze del ASG                |
| **Auto Scaling Group**    | Crea/elimina istanze in base al carico                         |
| **Launch Template**       | Configurazione delle istanze EC2                               |
| **Application Load Balancer** | Distribuisce il traffico tra le istanze + WebSocket        |
| **Target Group**          | Gestisce gli health check verso il backend                     |
| **RDS PostgreSQL**        | Database condiviso tra tutte le istanze                        |
| **Security Group**        | Firewall per istanze, ALB e RDS                                |
| **CloudWatch**            | Metriche, allarmi e log delle istanze                          |
| **CloudWatch Alarms**     | Trigger per le policy dell'ASG (CPU > 70%)                     |
| **S3**                    | Storage del codice (alternativa a Git) o file timeline.json    |
| **Secrets Manager**       | Credenziali DB e JWT secret (alternativa a env var)            |
| **Route 53** *(opzionale)*| DNS per dominio personalizzato                                 |

---

## Prerequisiti

- Account AWS con accesso alla console
- Una **VPC esistente** con almeno 2 subnet pubbliche in zone diverse (per ALB e ASG)
- Una **coppia di chiavi SSH** (per accedere alle EC2 in caso di debug)
- Il codice di questo progetto su un repository Git accessibile (GitHub pubblico, oppure S3)

---

## Passo 1 — Creare il database RDS PostgreSQL

1. Console AWS → **RDS** → *Create database*
2. Engine: **PostgreSQL** (versione 16.x consigliata)
3. Template: **Free Tier** (per prove) oppure *Dev/Test*
4. Settings:
   - DB instance identifier: `cloudproject-db`
   - Master username: `postgres`
   - Master password: `Vmware1!`
5. Instance class: `db.t3.micro` (o `db.t4g.micro` se disponibile)
6. Storage: 20 GB gp3
7. Connectivity:
   - VPC: la tua VPC esistente
   - Subnet group: scegli due subnet
   - Public access: **No** (le istanze EC2 si connettono dalla VPC)
   - VPC Security group: ne creiamo uno dedicato (vedi sotto)
8. Database options:
   - Initial database name: `cloudproject`
9. Crea il database e annota l'**endpoint** (es. `cloudproject-db.xxxx.eu-west-1.rds.amazonaws.com`)

### Security Group per RDS
- Crea un Security Group `sg-rds-cloudproject`
- Inbound: porta `5432` da `sg-ec2-cloudproject` (lo creeremo dopo)
- Outbound: tutto

---

## Passo 2 — Preparare l'AMI delle istanze EC2

Per evitare di reinstallare Docker e clonare il codice ad ogni nuova istanza creata dall'ASG, prepariamo una **AMI custom**.

### 2.1 Avvia un'istanza temporanea
1. EC2 → *Launch instance*
2. AMI: **Amazon Linux 2023** (consigliato) o Amazon Linux 2
3. Tipo: `t3.micro`
4. Key pair: la tua
5. Security Group: temporaneo, con SSH (22) aperta dal tuo IP
6. Storage: 10 GB gp3
7. Avvia

### 2.2 Connettiti via SSH e prepara l'ambiente

```bash
ssh -i tua-chiave.pem ec2-user@<IP-ISTANZA>

# Installa Docker e Git
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user

# Installa docker compose plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-x86_64 \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Clona il codice (sostituisci URL)
sudo mkdir -p /opt/cloudproject
sudo chown ec2-user:ec2-user /opt/cloudproject
cd /opt/cloudproject
git clone https://github.com/TUO-USER/aws-cloud-project.git .

# Pre-build delle immagini per velocizzare il primo avvio
docker compose build

# Esci e crea l'AMI
exit
```

### 2.3 Crea l'AMI
1. EC2 → seleziona l'istanza → **Actions → Image and templates → Create image**
2. Image name: `cloudproject-ami-v1`
3. Crea (impiega qualche minuto)
4. Annota l'**AMI ID** (es. `ami-0123456789abcdef`)
5. Termina l'istanza temporanea

---

## Passo 3 — Security Group per EC2 e ALB

### sg-alb-cloudproject (per il Load Balancer)
- Inbound: HTTP `80` da `0.0.0.0/0` (e HTTPS `443` se userai un certificato)
- Outbound: tutto

### sg-ec2-cloudproject (per le istanze EC2 dell'ASG)
- Inbound: porta `80` da `sg-alb-cloudproject` (solo l'ALB può raggiungere le istanze)
- Inbound: porta `22` SSH dal tuo IP (per debug)
- Outbound: tutto

Ricorda di aggiornare il Security Group RDS perché accetti connessioni da `sg-ec2-cloudproject` sulla porta 5432.

---

## Passo 4 — Application Load Balancer + Target Group

1. EC2 → **Target Groups** → *Create target group*
   - Type: Instances
   - Protocol: HTTP, Port: 80
   - VPC: la tua
   - Health check path: `/health`
   - Health check interval: 30s
   - Healthy threshold: 2, Unhealthy: 3
   - Nome: `tg-cloudproject`

2. EC2 → **Load Balancers** → *Create load balancer*
   - Tipo: **Application Load Balancer**
   - Nome: `alb-cloudproject`
   - Scheme: Internet-facing
   - VPC + 2 subnet pubbliche
   - Security group: `sg-alb-cloudproject`
   - Listener HTTP `80` → forward al target group `tg-cloudproject`

3. **Importante per WebSocket:** nelle proprietà del Target Group → *Attributes* → abilita **Stickiness** (durata 1h). Necessario perché Socket.IO mantenga la connessione sulla stessa istanza.

4. Annota il **DNS dell'ALB** (es. `alb-cloudproject-1234.eu-west-1.elb.amazonaws.com`). Sarà il punto d'accesso pubblico al sito.

---

## Passo 5 — Launch Template per ASG

1. EC2 → **Launch Templates** → *Create launch template*
   - Nome: `lt-cloudproject`
   - AMI: l'AMI creata al passo 2 (`cloudproject-ami-v1`)
   - Instance type: `t3.micro` (o `t3.small` per più tranquillità)
   - Key pair: la tua
   - Security group: `sg-ec2-cloudproject`
   - Storage: di default ereditato dalla AMI

2. **User data** (sezione Advanced details): incolla il contenuto di `aws/user-data.sh` modificando le variabili in alto (RDS endpoint e JWT secret).

   In alternativa più "pulita": usa **Secrets Manager** per le credenziali e nello user-data fai `aws secretsmanager get-secret-value`. Per farlo serve associare un **IAM Instance Profile** alla launch template con policy `SecretsManagerReadWrite`. (Se hai limitazioni IAM, salta questa parte e tieni le credenziali nello user-data.)

---

## Passo 6 — Auto Scaling Group

1. EC2 → **Auto Scaling Groups** → *Create*
   - Nome: `asg-cloudproject`
   - Launch template: `lt-cloudproject`
   - VPC + le 2 subnet pubbliche
   - **Attach to existing load balancer** → `tg-cloudproject`
   - Health check type: **ELB** (non solo EC2)
   - Health check grace period: 180 secondi (per dare tempo a Docker di partire)
   - Capacity:
     - Minimum: **1**
     - Desired: **1**
     - Maximum: **4**
   - Scaling policies:
     - **Target tracking** → Metric: *Average CPU utilization*, target: **60%**
     - In questo modo se la CPU media supera 60%, l'ASG aggiunge un'istanza; se scende sotto, ne toglie una.

2. Crea l'ASG. Dopo qualche minuto vedrai 1 istanza creata e registrata nel target group come *healthy*.

---

## Passo 7 — Verifica e accesso

1. Apri nel browser: `http://<DNS-ALB>`
2. Dovrebbe apparire la pagina di login
3. Accedi con `admin` / `Admin123!` (centrale) o `operatore1` / `Operatore123!`
4. Esplora i 2 servizi (Storia del corso e Gestione Emergenze)

> Se la pagina non carica: controlla i CloudWatch logs dell'istanza (`/var/log/user-data.log` via SSH) e l'health del target group.

---

## Passo 8 — Test di carico con Locust

Dalla tua macchina locale:

```bash
cd locust
pip install locust
locust -f locustfile.py --host=http://<DNS-ALB>
```

Apri `http://localhost:8089`:
- Number of users: **300**
- Spawn rate: **15**

Inizia il test. Tieni d'occhio:
- **CloudWatch metrics** dell'ASG: vedrai la CPU salire
- Dopo 3-5 minuti sopra il 60%, l'ASG avvierà nuove istanze
- Quando il carico cala, le istanze in eccesso vengono terminate

> 💡 Consiglio: prima di lanciare Locust, abbassa il *cooldown* dell'ASG a 60 secondi e la *health check grace period* a 60 per vedere lo scaling più velocemente durante la demo.

---

## Architettura risultante

```
                    ┌──────────────────┐
                    │   Route 53 (opt) │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
        Internet ──▶│      ALB         │ (sg-alb)
                    │  alb-cloudproj.  │
                    └────────┬─────────┘
                             │ HTTP/WS
                ┌────────────┼────────────┐
                │            │            │
          ┌─────▼─────┐┌─────▼─────┐┌─────▼─────┐
          │ EC2 (1)   ││ EC2 (2)   ││ EC2 (N)   │  (sg-ec2)
          │ Docker:   ││ Docker:   ││ Docker:   │
          │  nginx    ││  nginx    ││  nginx    │
          │  backend  ││  backend  ││  backend  │
          └─────┬─────┘└─────┬─────┘└─────┬─────┘
                │            │            │
                └────────────┼────────────┘
                             │ PG/5432
                    ┌────────▼─────────┐
                    │   RDS Postgres   │ (sg-rds)
                    │  cloudproject-db │
                    └──────────────────┘
                             ▲
                             │
                    ┌────────┴─────────┐
                    │   CloudWatch     │
                    │  metrics/alarms  │ → trigger ASG scale out/in
                    └──────────────────┘
```

---

## Costi stimati (regione eu-west-1, listino on-demand)

| Risorsa                      | Costo mensile approx. |
|------------------------------|----------------------|
| 1× EC2 t3.micro              | ~$8                  |
| RDS db.t3.micro              | ~$15                 |
| ALB                          | ~$18 + traffico      |
| Storage (10+20 GB gp3)       | ~$3                  |
| **Totale base (1 istanza)**  | **~$45-50/mese**     |

> ⚠️ **Ricorda di terminare le risorse** quando non le usi più: ASG (set desired=0), RDS (delete), ALB (delete). Le risorse non terminate generano addebiti continui.

---

## Troubleshooting

**Le istanze non passano l'health check**
- SSH nell'istanza: `sudo docker compose logs backend`
- Verifica che il backend si connetta a RDS (probabile errore SG o credenziali)

**WebSocket si disconnette in continuazione**
- Verifica che il target group abbia **Stickiness** abilitata
- Ispeziona il *deregistration delay* (impostalo a 30s)

**Il DB ha già dati delle prove precedenti**
- Connettiti manualmente: `psql -h <rds-endpoint> -U postgres -d cloudproject`
- Esegui `TRUNCATE emergencies;`

**ASG non scala**
- Controlla che l'allarme CloudWatch sia in stato *In alarm*
- Verifica le policy nella tab *Automatic scaling* dell'ASG
- Il *cooldown* di default è 5 minuti: aspetta o riducilo
