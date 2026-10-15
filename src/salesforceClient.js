import jsforce from 'jsforce';
import { config } from './config.js';
import { log } from './logger.js';

let cachedConnection;

export async function getSalesforceConnection() {
  if (cachedConnection) {
    return cachedConnection;
  }

  const conn = new jsforce.Connection({
    oauth2: {
      loginUrl: config.sf.loginUrl,
      clientId: config.sf.clientId,
      clientSecret: config.sf.clientSecret
    },
    refreshToken: config.sf.refreshToken,
    version: config.sf.apiVersion
  });

  const tokenResponse = await conn.oauth2.refreshToken(config.sf.refreshToken);
  conn.accessToken = tokenResponse.access_token;
  if (tokenResponse.instance_url) {
    conn.instanceUrl = tokenResponse.instance_url;
  }
  cachedConnection = conn;
  log.info('Connected to Salesforce for worker operations.');
  return conn;
}

const APEX_CLASS_FIELDS = 'Id, Name, NamespacePrefix, Body';

function escapeSoqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Loads Apex class bodies from the Tooling API.
 *
 * @param {string[]} apexClassIds - 15/18-char Ids; empty means full org scan
 * @returns {Promise<Array<{ id: string, name: string, body: string }>>}
 */
export async function fetchApexClasses(apexClassIds) {
  const conn = await getSalesforceConnection();
  const classes = [];

  if (!apexClassIds || apexClassIds.length === 0) {
    const soql = `SELECT ${APEX_CLASS_FIELDS} FROM ApexClass ORDER BY Name, Id`;
    let result = await conn.tooling.query(soql);

    while (true) {
      for (const record of result.records || []) {
        classes.push(normalizeApexClass(record));
      }

      if (result.done) {
        break;
      }
      result = await conn.queryMore(result.nextRecordsUrl);
    }

    return classes;
  }

  const idChunks = chunkArray(apexClassIds, 200);
  for (const chunk of idChunks) {
    const quoted = chunk.map((id) => `'${escapeSoqlString(id)}'`).join(',');
    const soql = `SELECT ${APEX_CLASS_FIELDS} FROM ApexClass WHERE Id IN (${quoted})`;
    const result = await conn.tooling.query(soql);
    for (const record of result.records || []) {
      classes.push(normalizeApexClass(record));
    }
  }

  return classes;
}

function normalizeApexClass(record) {
  const prefix = record.NamespacePrefix
    ? `${record.NamespacePrefix}_`
    : '';
  const name = `${prefix}${record.Name}`;
  return {
    id: record.Id,
    name,
    body: record.Body || ''
  };
}

/**
 * Uploads the analyzer report JSON as a ContentVersion linked to the scan.
 *
 * @returns {Promise<string>} ContentVersion Id (18-char)
 */
export async function uploadReportContentVersion({
  title,
  pathOnClient,
  versionDataBase64
}) {
  const conn = await getSalesforceConnection();
  const result = await conn.sobject('ContentVersion').create({
    Title: title,
    PathOnClient: pathOnClient,
    VersionData: versionDataBase64,
    FirstPublishLocationId: null
  });

  if (!result.success) {
    throw new Error(
      `ContentVersion insert failed: ${JSON.stringify(result.errors || [])}`
    );
  }

  return result.id;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
