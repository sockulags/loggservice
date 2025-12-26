const { getDatabase } = require('../database');

/**
 * Admin authentication middleware
 * 
 * SECURITY WARNING: If ADMIN_API_KEY is not set in production, any valid service API key
 * can perform admin operations (archive, cleanup), allowing a compromised service key to
 * delete or manipulate logs across all services. This breaks service isolation and enables
 * log tampering.
 * 
 * Requires either:
 * 1. A specific admin API key set via ADMIN_API_KEY env variable (RECOMMENDED for production)
 * 2. Or falls back to any valid service API key (ONLY suitable for development/testing)
 * 
 * RECOMMENDATION: Always set ADMIN_API_KEY to a strong, unique value in production deployments.
 */
async function authenticateAdmin(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const adminApiKey = process.env.ADMIN_API_KEY;
  
  // If ADMIN_API_KEY is set, require it for admin operations
  if (adminApiKey) {
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }
    
    if (apiKey === adminApiKey) {
      // Admin API key is valid
      req.isAdmin = true;
      return next();
    }
    
    // If admin key is set but doesn't match, deny access
    return res.status(403).json({ error: 'Admin access denied' });
  }
  
  // If no ADMIN_API_KEY is set, fall back to regular API key authentication
  // This allows any valid service to perform admin operations
  const db = getDatabase();
  
  db.get('SELECT id, name FROM services WHERE api_key = ?', [apiKey], (err, service) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!service) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    // Attach service info to request
    req.service = service;
    req.isAdmin = true;
    return next();
  });
}

module.exports = { authenticateAdmin };
