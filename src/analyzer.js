import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

/**
 * Writes Apex sources to a workspace and runs Salesforce Code Analyzer (PMD).
 *
 * @param {object} options
 * @param {string} options.workspaceDir
 * @param {Array<{ name: string, body: string }>} options.classes
 * @param {() => void} [options.onSpawn] - receives child for cancellation
 * @returns {Promise<{ jsonPath: string, report: object }>}
 */
export async function runCodeAnalyzer({ workspaceDir, classes, onSpawn }) {
  await fs.mkdir(workspaceDir, { recursive: true });

  const targetFiles = [];
  for (const apexClass of classes) {
    const fileName = `${apexClass.name}.cls`;
    const filePath = path.join(workspaceDir, fileName);
    await fs.writeFile(filePath, apexClass.body || '', 'utf8');
    targetFiles.push(filePath);
  }

  if (targetFiles.length === 0) {
    throw new Error('No Apex classes were available to analyze.');
  }

  const jsonPath = path.join(workspaceDir, 'analyzer-results.json');
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

  const raw = await fs.readFile(jsonPath, 'utf8');
  const report = JSON.parse(raw);
  return { jsonPath, report };
}

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
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Code Analyzer timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Code Analyzer exited with code ${code}. ${stderr.slice(0, 4000)}`
        )
      );
    });
  });
}
