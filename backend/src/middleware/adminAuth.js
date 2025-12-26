/**
 * Admin authentication middleware
 * Requires a dedicated ADMIN_API_KEY for all admin operations
 * This ensures that admin endpoints cannot be accessed with regular service API keys
 */
async function authenticateAdmin(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const adminApiKey = process.env.ADMIN_API_KEY;
  
  // Always require ADMIN_API_KEY to be set
  if (!adminApiKey) {
    console.error('ADMIN_API_KEY environment variable is not set');
    return res.status(500).json({ 
      error: 'Server configuration error: ADMIN_API_KEY is required' 
    });
  }
  
  // Check if API key is provided
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }
  
  // Verify the API key matches the admin key
  if (apiKey === adminApiKey) {
    req.isAdmin = true;
    return next();
  }
  
  // Access denied if key doesn't match
  return res.status(403).json({ error: 'Admin access denied' });
}

module.exports = { authenticateAdmin };
