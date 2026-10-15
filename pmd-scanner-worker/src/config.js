import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  workerApiToken: process.env.WORKER_API_TOKEN || '',
  sf: {
    loginUrl: process.env.SF_LOGIN_URL || 'https://test.salesforce.com',
    clientId: process.env.SF_CLIENT_ID || '',
    clientSecret: process.env.SF_CLIENT_SECRET || '',
    refreshToken: process.env.SF_REFRESH_TOKEN || '',
    apiVersion: process.env.SF_API_VERSION || '67.0'
  },
  codeAnalyzer: {
    bin: process.env.CODE_ANALYZER_SF_BIN || 'sf',
    configFile:
      process.env.CODE_ANALYZER_CONFIG_FILE ||
      path.join(packageRoot, 'config', 'code-analyzer.yml'),
    ruleSelector: process.env.RULE_SELECTOR || 'pmd',
    timeoutMs: Number(process.env.ANALYZER_TIMEOUT_MS || 30 * 60 * 1000)
  },
  rulesetVersion: process.env.RULESET_VERSION || 'pmd-recommended',
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 2),
  jobWorkRoot: path.resolve(
    process.env.JOB_WORK_ROOT || path.join(packageRoot, '.work')
  )
};

export function assertRuntimeConfig() {
  if (!config.workerApiToken) {
    throw new Error('WORKER_API_TOKEN must be set.');
  }
  required('SF_CLIENT_ID');
  required('SF_CLIENT_SECRET');
  required('SF_REFRESH_TOKEN');
}
