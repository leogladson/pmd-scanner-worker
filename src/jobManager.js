
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';
import { runCodeAnalyzer } from './analyzer.js';
import { postCallback, toApexDatetime } from './callbackClient.js';
import { parseAnalyzerResults } from './resultParser.js';

const jobs = new Map();
let activeJobs = 0;
const waitQueue = [];

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

  if (!job) return false;

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
        log.error('Unhandled job failure', {
          jobId: job.id,
          error: err.message
        });
      })
      .finally(() => {
        activeJobs -= 1;

        const next = waitQueue.shift();
        if (next) enqueueJob(next);
      });

    return;
  }

  waitQueue.push(job);
}

async function runJob(job) {
  const { request } = job;
  const startedDate = new Date();

  const workDir = path.join(
    config.jobWorkRoot,
    `${request.scanId || 'scan'}-${job.id}`
  );

  try {
    job.status = 'VALIDATING_SOURCE';

    await safeCallback(job, {
      status: 'VALIDATING_SOURCE',
      startedDate: toApexDatetime(startedDate)
    });

    if (job.cancelRequested) {
      await finishCancelled(job, startedDate);
      return;
    }

    const classes = request.classes;

    if (!Array.isArray(classes) || classes.length === 0) {
      throw new Error(
        'No Apex source provided. Supply a non-empty classes array.'
      );
    }

    for (const apexClass of classes) {
      if (
        !apexClass ||
        typeof apexClass.name !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(apexClass.name) ||
        typeof apexClass.source !== 'string'
      ) {
        throw new Error(
          'Each class must contain a valid name and source string.'
        );
      }
    }

    const classByFileName = new Map(
      classes.map((apexClass) => [
        `${apexClass.name}.cls`,
        {
          id: apexClass.id || apexClass.name,
          name: apexClass.name
        }
      ])
    );

    job.status = 'SCANNING';
    await safeCallback(job, { status: 'SCANNING' });

    if (job.cancelRequested) {
      await finishCancelled(job, startedDate);
      return;
    }

    const { report } = await runCodeAnalyzer({
      workspaceDir: path.join(workDir, 'workspace'),
      classes: classes.map((apexClass) => ({
        id: apexClass.id || apexClass.name,
        name: apexClass.name,
        body: apexClass.source
      })),
      onSpawn: (child) => {
        job.analyzerChild = child;
      }
    });

    job.analyzerChild = null;

    if (job.cancelRequested) {
      await finishCancelled(job, startedDate);
      return;
    }

    job.status = 'PARSING_RESULTS';
    await safeCallback(job, { status: 'PARSING_RESULTS' });

    const parsed = parseAnalyzerResults(report, classByFileName);

    const filesRequested = classes.length;
    const filesScanned = parsed.files.filter(
      (file) => file.scanStatus === 'SCANNED'
    ).length;

    const hadFileFailures = parsed.files.some(
      (file) => file.scanStatus === 'FAILED'
    );

    const terminalStatus = hadFileFailures
      ? 'COMPLETED_WITH_WARNINGS'
      : 'COMPLETED';

    job.status = 'GENERATING_REPORT';
    await safeCallback(job, { status: 'GENERATING_REPORT' });

    // Return report data through the callback instead of uploading
    // it to Salesforce Files.
    const reportJson = JSON.stringify(report);

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
      report,
      reportJson,
      files: parsed.files
    });

    job.status = terminalStatus;

    log.info('Scan job completed', {
      jobId: job.id,
      status: terminalStatus,
      filesScanned,
      totalViolations: parsed.totalViolations
    });
  } catch (error) {
    job.status = 'FAILED';

    log.error('Scan job failed', {
      jobId: job.id,
      error: error.message
    });

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

    if (
      ['FAILED', 'COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(
        partial.status
      )
    ) {
      throw error;
    }
  }
}

export function getAnalyzerVersionLabel() {
  return process.env.ANALYZER_VERSION_LABEL || 'code-analyzer-worker-1.0.0';
}
