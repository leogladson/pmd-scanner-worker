
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

export const config = {
  // HTTP server
  port: Number(process.env.PORT || 8080),
  workerApiToken: process.env.WORKER_API_TOKEN || '',

  // Salesforce Code Analyzer CLI
  codeAnalyzer: {
    bin: process.env.CODE_ANALYZER_SF_BIN || 'sf',
    configFile:
      process.env.CODE_ANALYZER_CONFIG_FILE ||
      path.join(packageRoot, 'config', 'code-analyzer.yml'),
    ruleSelector: process.env.RULE_SELECTOR || 'pmd',
    timeoutMs: Number(
      process.env.ANALYZER_TIMEOUT_MS || 30 * 60 * 1000
    )
  },

  // Scan configuration
  rulesetVersion: process.env.RULESET_VERSION || 'pmd-recommended',
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 2),

  jobWorkRoot: path.resolve(
    process.env.JOB_WORK_ROOT || path.join(packageRoot, '.work')
  ),

  // Workspace for scan jobs
  scanWorkspace: path.resolve(
    process.env.SCAN_WORKSPACE || path.join(packageRoot, 'workspace')
  )
};

export function assertRuntimeConfig() {
  if (!config.workerApiToken) {
    throw new Error('WORKER_API_TOKEN must be set.');
  }
}
