
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

/**
 * Writes Apex sources to a workspace and runs Salesforce Code Analyzer.
 *
 * @param {object} options
 * @param {string} options.workspaceDir
 * @param {Array<{ id?: string, name: string, body: string }>} options.classes
 * @param {(child: import('node:child_process').ChildProcess) => void} [options.onSpawn]
 * @returns {Promise<{ jsonPath: string, report: object }>}
 */
export async function runCodeAnalyzer({
  workspaceDir,
  classes,
  onSpawn
}) {
  if (!Array.isArray(classes) || classes.length === 0) {
    throw new Error('No Apex classes were provided for analysis.');
  }

  await fs.mkdir(workspaceDir, { recursive: true });

  const targetFiles = [];

  for (const apexClass of classes) {
    if (
      !apexClass ||
      typeof apexClass.name !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(apexClass.name)
    ) {
      throw new Error('Each Apex class must have a valid class name.');
    }

    if (typeof apexClass.body !== 'string') {
      throw new Error(
        `Apex source is missing or invalid for class ${apexClass.name}.`
      );
    }

    const fileName = `${apexClass.name}.cls`;
    const filePath = path.join(workspaceDir, fileName);

    await fs.writeFile(filePath, apexClass.body, 'utf8');
    targetFiles.push(filePath);
  }

  const jsonPath = path.join(workspaceDir, 'analyzer-results.json');

  // Remove a previous report so stale results cannot be mistaken
  // for the results of the current scan.
  await fs.rm(jsonPath, { force: true });

  const args = [
    'code-analyzer',
    'run',
    '--workspace',
    workspaceDir,
    ...targetFiles.flatMap((file) => ['--target', file]),
    '--rule-selector',
    config.codeAnalyzer.ruleSelector,
    '--config-file',
    config.codeAnalyzer.configFile,
    '--output-file',
    jsonPath
  ];

  log.info('Starting Code Analyzer CLI', {
    bin: config.codeAnalyzer.bin,
    classCount: classes.length
  });

  await runProcess(config.codeAnalyzer.bin, args, {
    timeoutMs: config.codeAnalyzer.timeoutMs,
    onSpawn
  });

  let raw;

  try {
    raw = await fs.readFile(jsonPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Code Analyzer did not produce the expected JSON report: ${error.message}`
    );
  }

  let report;

  try {
    report = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Code Analyzer produced invalid JSON: ${error.message}`
    );
  }

  log.info('Code Analyzer finished successfully', {
    classCount: classes.length,
    reportPath: jsonPath
  });

  return { jsonPath, report };
}

/**
 * Runs a child process and rejects if it fails, errors, or times out.
 */
function runProcess(command, args, { timeoutMs, onSpawn }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    if (onSpawn) {
      onSpawn(child);
    }

    let stderr = '';
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();

      // Prevent excessive memory growth from very large error output.
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');

      finish(
        new Error(
          `Code Analyzer timed out after ${timeoutMs}ms. ${stderr.slice(-4000)}`
        )
      );
    }, timeoutMs);

    child.on('error', (error) => {
      finish(
        new Error(`Failed to start Code Analyzer: ${error.message}`)
      );
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }

      finish(
        new Error(
          `Code Analyzer failed (exit code: ${code}, signal: ${signal || 'none'}). ` +
          stderr.slice(-4000)
        )
      );
    });
  });
}
