const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDatabase } = require('./database');
const { authenticate } = require('./middleware/auth');
const { authenticateAdmin } = require('./middleware/adminAuth');
const logRoutes = require('./routes/logs');
const serviceRoutes = require('./routes/services');
const adminRoutes = require('./routes/admin');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate required environment variables
if (!process.env.ADMIN_API_KEY) {
  console.error('ERROR: ADMIN_API_KEY environment variable is required');
  console.error('Please set ADMIN_API_KEY in your .env file or environment');
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files for web UI (if built)
const webUiPath = path.join(__dirname, '../../web-ui/dist');
if (require('fs').existsSync(webUiPath)) {
  app.use(express.static(webUiPath));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/api/services', serviceRoutes);
app.use('/api/logs', authenticate, logRoutes);
app.use('/api/admin', authenticateAdmin, adminRoutes);

// Serve web UI for all other routes (if built)
const webUiIndexPath = path.join(__dirname, '../../web-ui/dist/index.html');
if (require('fs').existsSync(webUiIndexPath)) {
  app.get('*', (req, res) => {
    res.sendFile(webUiIndexPath);
  });
}

// Initialize database and start server
initDatabase().then(() => {
  // Start archive scheduler
  startScheduler();
  
  app.listen(PORT, () => {
    console.log(`Logging platform backend running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
