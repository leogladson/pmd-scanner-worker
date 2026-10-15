
import { log } from './logger.js';

/**
 * Posts scan status / completion payloads to the Apex REST callback.
 *
 * The callback endpoint must accept the authentication method
 * configured by your Salesforce application.
 *
 * @param {string} callbackEndpoint
 * @param {object} payload
 */
export async function postCallback(callbackEndpoint, payload) {
  if (!callbackEndpoint) {
    throw new Error('callbackEndpoint is required.');
  }

  const response = await fetch(callbackEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': payload.correlationId || ''
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Callback failed with HTTP ${response.status}: ${responseText}`
    );
  }

  let result;

  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      result = null;
    }
  }

  if (result?.success === false) {
    throw new Error(result.message || 'Callback returned success=false');
  }

  log.info('Callback delivered', {
    status: payload.status,
    jobId: payload.jobId
  });
}

export function toApexDatetime(date = new Date()) {
  return date.toISOString();
}
