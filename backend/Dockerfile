# Dockerfile per backend Node.js
FROM node:20-alpine

WORKDIR /app

# Installa dipendenze (sfrutta cache layer di Docker)
COPY package*.json ./
RUN npm install --omit=dev

# Copia codice applicativo
COPY . .

# Espone la porta del server
EXPOSE 3000

# Healthcheck (Docker / ECS / ALB compat)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
