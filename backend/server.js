// Server principale: Express + Socket.IO + serve frontend statico
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const timelineRoutes = require('./routes/timeline');
const emergenciesRoutesFactory = require('./routes/emergencies');

const PORT = parseInt(process.env.PORT || '3000');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // L'ALB di AWS supporta WebSocket: ricordare di abilitare sticky sessions
});

// ============= MIDDLEWARE GLOBALI =============
app.use(helmet({
  contentSecurityPolicy: false, // disabilitato per servire HTML inline / mappa Leaflet
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// Rate limit globale (utile per simulazione carico Locust)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000, // 1000 richieste/minuto per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// ============= HEALTHCHECK PER ALB =============
// L'Application Load Balancer interroga questo endpoint per verificare l'istanza
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    instance: process.env.INSTANCE_ID || require('os').hostname(),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ============= API ROUTES =============
app.use('/api/auth', authRoutes);
app.use('/api/timeline', timelineRoutes);
app.use('/api/emergencies', emergenciesRoutesFactory(io));

// ============= FRONTEND STATICO =============
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// Fallback per SPA-like behavior
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// ============= WEBSOCKET =============
io.on('connection', (socket) => {
  console.log(`[WS] Client connesso: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnesso: ${socket.id}`);
  });
});

// ============= AVVIO =============
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Backend in ascolto sulla porta ${PORT}`);
  console.log(`[server] Istanza: ${process.env.INSTANCE_ID || require('os').hostname()}`);
  console.log(`[server] DB: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
});

// Graceful shutdown (importante per ASG che termina istanze)
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM ricevuto, chiusura...');
  server.close(() => process.exit(0));
});
