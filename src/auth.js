import { config } from './config.js';

/**
 * Validates inbound calls from Salesforce Named Credential (Bearer or custom header).
 */
export function authenticateWorkerRequest(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  const apiKey = bearer || req.get('x-api-key') || '';

  if (!apiKey || apiKey !== config.workerApiToken) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  next();
}
