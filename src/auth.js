
import { config } from './config.js';

/**
 * Authenticates incoming requests from the Salesforce application
 * using a shared worker token.
 */
export function authenticateWorkerRequest(req, res, next) {
  const authHeader = req.get('authorization') || '';

  const bearer = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';

  const token = bearer || req.get('x-api-key') || '';

  if (!config.workerApiToken || token !== config.workerApiToken) {
    return res.status(401).json({
      message: 'Unauthorized'
    });
  }

  next();
}
