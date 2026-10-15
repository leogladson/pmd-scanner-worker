import { log } from './logger.js';
import { getSalesforceConnection } from './salesforceClient.js';

/**
 * Posts scan status / completion payloads to the Apex REST callback.
 *
 * @param {string} callbackEndpoint - Full URL from WorkerStartRequest.callbackEndpoint
 * @param {object} payload - PMDScanDTO.CallbackRequest shape
 */
export async function postCallback(callbackEndpoint, payload) {
  if (!callbackEndpoint) {
    throw new Error('callbackEndpoint is required.');
  }

  const conn = await getSalesforceConnection();
  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': payload.correlationId || ''
  };

  const response = await conn.requestPost(callbackEndpoint, payload, {
    headers
  });

  if (response?.success === false) {
    throw new Error(response.message || 'Callback returned success=false');
  }

  log.info('Callback delivered', {
    status: payload.status,
    jobId: payload.jobId
  });
}

export function toApexDatetime(date = new Date()) {
  return date.toISOString();
}
