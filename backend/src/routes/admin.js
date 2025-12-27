const express = require('express');
const { archiveOldLogs, cleanupOldArchives } = require('../services/archive');
const { runArchiveNow } = require('../services/scheduler');
const logger = require('../logger');

const router = express.Router();

// POST /api/admin/archive - Manually trigger archive job
router.post('/archive', async (req, res) => {
  try {
    const { daysOld = 1 } = req.body;
    const count = await archiveOldLogs(parseInt(daysOld));
    res.json({ 
      success: true, 
      archived: count,
      message: `Archived ${count} logs` 
    });
  } catch (error) {
    logger.error({ err: error }, 'Archive error');
    res.status(500).json({ error: 'Failed to archive logs' });
  }
});

// POST /api/admin/archive-now - Run archive job immediately
router.post('/archive-now', async (req, res) => {
  try {
    const count = await runArchiveNow();
    res.json({ 
      success: true, 
      archived: count,
      message: `Archived ${count} logs` 
    });
  } catch (error) {
    logger.error({ err: error }, 'Archive error');
    res.status(500).json({ error: 'Failed to archive logs' });
  }
});

// POST /api/admin/cleanup - Manually trigger cleanup job
router.post('/cleanup', async (req, res) => {
  try {
    const count = await cleanupOldArchives();
    res.json({ 
      success: true, 
      deleted: count,
      message: `Deleted ${count} old archive directories` 
    });
  } catch (error) {
    logger.error({ err: error }, 'Cleanup error');
    res.status(500).json({ error: 'Failed to cleanup archives' });
  }
});

module.exports = router;
