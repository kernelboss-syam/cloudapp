#!/bin/bash
# ============================================================
# Script User Data per EC2 / Launch Template Auto Scaling Group
# ============================================================
# Questo script viene eseguito automaticamente al primo boot
# dell'istanza. Installa Docker, scarica il codice e avvia
# l'applicazione containerizzata.
#
# Variabili da impostare nel Launch Template come variabili
# d'ambiente o tramite Parameter Store / Secrets Manager:
#   RDS_ENDPOINT  = endpoint del database RDS PostgreSQL
#   JWT_SECRET    = stringa segreta per JWT (generala random)
#   APP_REPO_URL  = URL del repo Git o S3 con il codice
# ============================================================

set -e
exec > >(tee /var/log/user-data.log | logger -t user-data) 2>&1

echo "[user-data] Avvio configurazione istanza EC2..."

# ---------- Variabili ----------
# Modifica questi valori prima di creare il Launch Template,
# OPPURE passali via Instance Metadata / Parameter Store.
RDS_ENDPOINT="${RDS_ENDPOINT:-REPLACE_ME.eu-west-1.rds.amazonaws.com}"
DB_NAME="${DB_NAME:-cloudproject}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-Vmware1!}"
JWT_SECRET="${JWT_SECRET:-cambia-questa-stringa-con-una-random-32-char}"
APP_REPO_URL="${APP_REPO_URL:-https://github.com/USERNAME/aws-cloud-project.git}"
APP_DIR="/opt/cloudproject"

# Recupera l'instance ID per i log applicativi
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id || echo "unknown")

# ---------- Aggiornamento sistema ----------
echo "[user-data] Aggiornamento pacchetti..."
yum update -y || apt-get update -y

# ---------- Installazione Docker ----------
echo "[user-data] Installazione Docker..."
if command -v amazon-linux-extras &>/dev/null; then
    # Amazon Linux 2
    amazon-linux-extras install -y docker
    yum install -y git
elif command -v dnf &>/dev/null; then
    # Amazon Linux 2023
    dnf install -y docker git
else
    # Ubuntu
    apt-get install -y docker.io git
fi

systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user || usermod -aG docker ubuntu || true

# ---------- Installazione Docker Compose plugin ----------
DOCKER_CONFIG=${DOCKER_CONFIG:-/usr/local/lib/docker}
mkdir -p $DOCKER_CONFIG/cli-plugins
curl -SL https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-x86_64 \
    -o $DOCKER_CONFIG/cli-plugins/docker-compose
chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose

# ---------- Clone del codice applicativo ----------
echo "[user-data] Download codice applicativo..."
mkdir -p $APP_DIR
cd $APP_DIR
if [ -n "$APP_REPO_URL" ] && [[ "$APP_REPO_URL" == http* ]]; then
    git clone "$APP_REPO_URL" . || echo "[user-data] Git clone fallito - assumo codice già presente nell'AMI"
fi

# ---------- File .env per docker-compose ----------
cat > $APP_DIR/.env <<EOF
DB_HOST=${RDS_ENDPOINT}
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_SSL=true
JWT_SECRET=${JWT_SECRET}
INSTANCE_ID=${INSTANCE_ID}
EOF
chmod 600 $APP_DIR/.env

# ---------- Build e avvio container ----------
# Profilo "local" non attivato → niente DB locale, si usa RDS
echo "[user-data] Avvio container..."
cd $APP_DIR
docker compose pull || true
docker compose build
docker compose up -d backend nginx

# ---------- Inizializzazione DB (eseguita una sola volta dalla prima istanza) ----------
# Per evitare che tutte le istanze provino a inizializzare il DB contemporaneamente,
# usare un meccanismo esterno (es. job manuale, AWS Systems Manager Run Command, lambda)
# Qui lo facciamo "best-effort" con un retry che fallisce silenziosamente se già fatto
echo "[user-data] Inizializzazione DB (best-effort)..."
sleep 15
docker compose exec -T backend node db/init.js || echo "[user-data] DB già inizializzato o non raggiungibile"

# ---------- Configurazione CloudWatch agent (opzionale ma consigliato) ----------
# Per inviare le metriche personalizzate (es. richieste/sec) a CloudWatch e
# triggerare le policy dell'ASG. L'ASG può anche scalare semplicemente sulla CPU.
echo "[user-data] Configurazione completata. Istanza ${INSTANCE_ID} pronta."

# ---------- Verifica finale ----------
sleep 5
curl -s http://localhost/health && echo "[user-data] Healthcheck OK" || echo "[user-data] Healthcheck FALLITO"
