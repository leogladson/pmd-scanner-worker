
/**
 * Salesforce client is not required.
 *
 * The worker receives Apex source code from the Salesforce application
 * and runs Salesforce Code Analyzer locally.
 *
 * No Connected App, OAuth credentials, or refresh token is required.
 */

export async function getSalesforceConnection() {
  throw new Error(
    'Salesforce API connection is disabled. ' +
    'Pass Apex source code to the worker instead of retrieving it from Salesforce.'
  );
}
