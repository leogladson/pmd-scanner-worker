import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';
import { runCodeAnalyzer } from './analyzer.js';
import { postCallback, toApexDatetime } from './callbackClient.js';
import { parseAnalyzerResults } from './resultParser.js';
import {
  fetchApexClasses,
  uploadReportContentVersion
} from './salesforceClient.js';

const jobs = new Map();
let activeJobs = 0;
const waitQueue = [];

/**
 * @typedef {object} WorkerStartRequest
 * @property {string} scanId
 * @property {string} scanNumber
 * @property {string} scanType
 * @property {string} environment
 * @property {string} requestHash
 * @property {string} correlationId
 * @property {string[]} apexClassIds
 * @property {string} callbackEndpoint
 */

export function createJob(startRequest) {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    request: startRequest,
    status: 'QUEUED',
    cancelRequested: false,
    analyzerChild: null,
    createdAt: new Date()
  };
  jobs.set(jobId, job);
  enqueueJob(job);
  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId);
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    return false;
  }
  job.cancelRequested = true;
  if (job.analyzerChild) {
    job.analyzerChild.kill('SIGKILL');
  }
  job.status = 'CANCELLED';
  return true;
}

function enqueueJob(job) {
  if (activeJobs < config.maxConcurrentJobs) {
    activeJobs += 1;
    runJob(job)
      .catch((err) => {
        log.error('Unhandled job failure', { jobId: job.id, error: err.message });
      })
      .finally(() => {
        activeJobs -= 1;
        const next = waitQueue.shift();
        if (next) {
          enqueueJob(next);
        }
      });
    return;
  }
  waitQueue.push(job);
}

async function runJob(job) {
  const { request } = job;
  const startedDate = new Date();
  job.status = 'RETRIEVING_SOURCE';

  const workDir = path.join(
    config.jobWorkRoot,
    `${request.scanId || 'scan'}-${job.id}`
  );

  try {
    await safeCallback(job, {
      status: 'RETRIEVING_SOURCE',
      startedDate: toApexDatetime(startedDate)
    });

    if (job.cancelRequested) {
      await finishCancelled(job, startedDate);
      return;
    }

    const apexClasses = await fetchApexClasses(request.apexClassIds || []);
    const classByFileName = new Map(
      apexClasses.map((c) => [`${c.name}.cls`, { id: c.id, name: c.name }])
    );

    job.status = 'SCANNING';
    await safeCallback(job, { status: 'SCANNING' });

    if (job.cancelRequested) {
      await finishCancelled(job, startedDate);
      return;
    }

    const { report } = await runCodeAnalyzer({
      workspaceDir: path.join(workDir, 'workspace'),
      classes: apexClasses,
      onSpawn: (child) => {
        job.analyzerChild = child;
      }
    });
    job.analyzerChild = null;

    job.status = 'PARSING_RESULTS';
    await safeCallback(job, { status: 'PARSING_RESULTS' });

    const parsed = parseAnalyzerResults(report, classByFileName);
    const filesRequested = apexClasses.length;
    const filesScanned = parsed.files.filter(
      (f) => f.scanStatus === 'SCANNED'
    ).length;
    const hadFileFailures = parsed.files.some((f) => f.scanStatus === 'FAILED');

    job.status = 'GENERATING_REPORT';
    await safeCallback(job, { status: 'GENERATING_REPORT' });

    const reportJson = JSON.stringify(report, null, 2);
    const reportTitle = `PMD Scan ${request.scanNumber || job.id}`;
    const reportFileName = `${reportTitle.replace(/[^\w.-]+/g, '_')}.json`;

    job.status = 'UPLOADING_REPORT';
    await safeCallback(job, { status: 'UPLOADING_REPORT' });

    const contentVersionId = await uploadReportContentVersion({
      title: reportTitle,
      pathOnClient: reportFileName,
      versionDataBase64: Buffer.from(reportJson, 'utf8').toString('base64')
    });

    const terminalStatus = hadFileFailures
      ? 'COMPLETED_WITH_WARNINGS'
      : 'COMPLETED';

    await safeCallback(job, {
      status: terminalStatus,
      startedDate: toApexDatetime(startedDate),
      completedDate: toApexDatetime(new Date()),
      filesRequested,
      filesScanned,
      filesWithViolations: parsed.filesWithViolations,
      totalViolations: parsed.totalViolations,
      highCount: parsed.severityCounts.HIGH,
      moderateCount: parsed.severityCounts.MODERATE,
      lowCount: parsed.severityCounts.LOW,
      infoCount: parsed.severityCounts.INFO,
      analyzerVersion: parsed.analyzerVersion,
      rulesetVersion: parsed.rulesetVersion || config.rulesetVersion,
      reportContentVersionId: contentVersionId,
      files: parsed.files
    });

    job.status = terminalStatus;
  } catch (error) {
    job.status = 'FAILED';
    log.error('Scan job failed', { jobId: job.id, error: error.message });
    await safeCallback(job, {
      status: 'FAILED',
      startedDate: toApexDatetime(startedDate),
      completedDate: toApexDatetime(new Date()),
      errorSummary: error.message
    });
  } finally {
    job.analyzerChild = null;
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function finishCancelled(job, startedDate) {
  await safeCallback(job, {
    status: 'CANCELLED',
    startedDate: toApexDatetime(startedDate),
    completedDate: toApexDatetime(new Date())
  });
}

async function safeCallback(job, partial) {
  const payload = {
    jobId: job.id,
    correlationId: job.request.correlationId,
    ...partial
  };

  try {
    await postCallback(job.request.callbackEndpoint, payload);
  } catch (error) {
    log.error('Callback failed', {
      jobId: job.id,
      status: partial.status,
      error: error.message
    });
    if (partial.status === 'FAILED' || partial.status === 'COMPLETED') {
      throw error;
    }
  }
}

export function getAnalyzerVersionLabel() {
  return process.env.ANALYZER_VERSION_LABEL || 'code-analyzer-worker-1.0.0';
}
