import express from 'express';
import { authenticateWorkerRequest } from './auth.js';
import { assertRuntimeConfig, config } from './config.js';
import {
  cancelJob,
  createJob,
  getAnalyzerVersionLabel,
  getJob
} from './jobManager.js';
import { log } from './logger.js';

assertRuntimeConfig();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(authenticateWorkerRequest);

app.post('/jobs', (req, res) => {
  const body = req.body || {};
  if (!body.scanId || !body.correlationId || !body.callbackEndpoint) {
    res.status(400).json({
      message:
        'scanId, correlationId, and callbackEndpoint are required on the worker start request.'
    });
    return;
  }

  const correlationHeader = req.get('x-correlation-id');
  if (correlationHeader && correlationHeader !== body.correlationId) {
    res.status(400).json({ message: 'X-Correlation-Id header mismatch.' });
    return;
  }

  const job = createJob(body);
  res.status(202).json({
    jobId: job.id,
    status: job.status,
    analyzerVersion: getAnalyzerVersionLabel(),
    rulesetVersion: config.rulesetVersion
  });
});

app.post('/jobs/:jobId/cancel', (req, res) => {
  const cancelled = cancelJob(req.params.jobId);
  if (!cancelled) {
    res.status(404).json({ message: 'Job not found.' });
    return;
  }
  res.json({ jobId: req.params.jobId, status: 'CANCELLED' });
});

app.get('/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ message: 'Job not found.' });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    scanId: job.request.scanId,
    correlationId: job.request.correlationId
  });
});

app.listen(config.port, () => {
  log.info(`PMD scanner worker listening on port ${config.port}`);
});
