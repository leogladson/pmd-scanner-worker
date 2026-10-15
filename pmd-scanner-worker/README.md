# Apex PMD Scanner — Node.js worker

HTTP worker that implements the contract expected by Salesforce `PMDScanCalloutService`:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/jobs` | Start scan (`PMDScanDTO.WorkerStartRequest`) |
| `POST` | `/jobs/:jobId/cancel` | Cancel in-flight scan |
| `GET` | `/jobs/:jobId` | Optional status polling |
| `GET` | `/health` | Liveness (no auth) |

The worker:

1. Accepts the job payload from your org (Named Credential `PMD_Scanner_Worker`).
2. Retrieves Apex class bodies from the **Tooling API** (selected Ids or full org when `apexClassIds` is empty / full scan).
3. Writes sources to a temp workspace and runs **`sf code-analyzer run`** with the **PMD** rule selector.
4. Parses Code Analyzer JSON and POSTs progress + completion to `callbackEndpoint` (`PMDScanCallbackRest`).
5. Uploads the raw analyzer JSON as a **ContentVersion** and returns its Id in `reportContentVersionId`.

## Prerequisites

- **Node.js 20+**
- **Salesforce CLI** with the Code Analyzer plugin (`sf code-analyzer --help` works on the host)
- A Salesforce **integration user** with:
  - `PMD_Scanner_Callback` custom permission (for REST callback)
  - Tooling API access to read `ApexClass`
  - Create on `ContentVersion`
- Connected app with **refresh token** for that user

## Setup

```bash
cd tools/pmd-scanner-worker
cp .env.example .env
# Edit .env — WORKER_API_TOKEN, SF_* values
npm install
npm start
```

### Salesforce Named Credential

Point Named Credential **`PMD_Scanner_Worker`** at your worker’s public HTTPS base URL (no `/jobs` suffix). Source metadata uses `https://example.com` only so deploy validates; **change the URL in Setup per sandbox** after deploy.

1. Deploy and run this worker on a **public HTTPS** endpoint (Azure App Service, internal ingress, or `ngrok http 8080` for local dev). Salesforce cannot call `localhost`, `127.0.0.1`, or placeholder hosts such as `pmd-scanner.internal`.
2. In **Setup → Named Credentials → PMD Scanner Worker**, set **URL** to that base URL (for example `https://your-worker.example.com`).

Configure the external credential so Salesforce sends:

`Authorization: Bearer <same value as WORKER_API_TOKEN>`

#### Fixing `503` / `ERR_DNS_FAIL`

If scans fail with *DNS resolution failed*, the Named Credential URL still points at an unreachable host. Update **PMD_Scanner_Worker** URL in Setup, verify `GET https://<host>/health` returns `{"status":"ok"}` from outside your VPN, then retry a scan.

`PMDScanCalloutService` already sends `X-Correlation-Id` on start/cancel; the worker echoes it on callbacks.

### OAuth for Tooling + callback

Use a connected app and complete the refresh-token flow once. Set in `.env`:

- `SF_LOGIN_URL` — `https://test.salesforce.com` (sandbox) or `https://login.salesforce.com`
- `SF_CLIENT_ID` / `SF_CLIENT_SECRET`
- `SF_REFRESH_TOKEN`

The worker uses the same connection to query Apex and to `POST` the Apex REST callback URL provided in each job.

## Request / response shapes

**Start (`POST /jobs`)** — body matches Apex `JSON.serialize` of `WorkerStartRequest`:

```json
{
  "scanId": "a0X...",
  "scanNumber": "PS-0001",
  "scanType": "Selected",
  "environment": "UAT",
  "requestHash": "...",
  "correlationId": "...",
  "apexClassIds": ["01p..."],
  "callbackEndpoint": "https://myorg.my.salesforce.com/services/apexrest/pmdscanner/callback"
}
```

**Immediate response (`WorkerStartResponse`):**

```json
{
  "jobId": "uuid",
  "status": "QUEUED",
  "analyzerVersion": "code-analyzer-worker-1.0.0",
  "rulesetVersion": "pmd-recommended"
}
```

Callbacks use `PMDScanDTO.CallbackRequest` field names (`highCount`, `reportContentVersionId`, `files`, etc.).

## Configuration

| Variable | Description |
|----------|-------------|
| `WORKER_API_TOKEN` | Shared secret for inbound Salesforce callouts |
| `CODE_ANALYZER_SF_BIN` | CLI binary (default `sf`) |
| `CODE_ANALYZER_CONFIG_FILE` | Path to `code-analyzer.yml` |
| `RULE_SELECTOR` | Default `pmd` |
| `ANALYZER_TIMEOUT_MS` | CLI timeout (default 30 min) |
| `MAX_CONCURRENT_JOBS` | Parallel scans (default 2) |

Customize PMD rules in `config/code-analyzer.yml` to align with your Daikin standards.

## Security notes

- API key required on all routes except `/health`.
- Code Analyzer is executed via `spawn` with a fixed argument list (no shell).
- Per-job workspaces under `.work/` are deleted after completion.
- Do not deploy this service to production orgs for user-facing scans; the Apex app already blocks production scanner use.

## Local smoke test

With the worker running and `.env` filled in, you can POST a job with curl (replace host and key):

```bash
curl -s -X POST http://localhost:8080/jobs \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d "{\"scanId\":\"a0X000000000001\",\"scanNumber\":\"TEST\",\"scanType\":\"Selected\",\"correlationId\":\"test-corr\",\"apexClassIds\":[\"01p000000000001\"],\"callbackEndpoint\":\"https://your-sandbox.my.salesforce.com/services/apexrest/pmdscanner/callback\"}"
```

Use real Ids from your sandbox for a meaningful run.
