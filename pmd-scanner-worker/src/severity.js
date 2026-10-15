/**
 * Maps Salesforce Code Analyzer numeric severity (1–5) to PMD_Scan__c bucket fields.
 */
export function bucketFromSeverity(severity) {
  const level = Number(severity);
  if (level <= 2) {
    return 'HIGH';
  }
  if (level === 3) {
    return 'MODERATE';
  }
  if (level === 4) {
    return 'LOW';
  }
  return 'INFO';
}

const RANK = { HIGH: 4, MODERATE: 3, LOW: 2, INFO: 1, NONE: 0 };

export function maxSeverity(current, candidate) {
  if (!candidate || candidate === 'NONE') {
    return current || 'NONE';
  }
  if (!current || current === 'NONE') {
    return candidate;
  }
  return RANK[candidate] > RANK[current] ? candidate : current;
}

export function emptySeverityCounts() {
  return { HIGH: 0, MODERATE: 0, LOW: 0, INFO: 0 };
}

export function incrementSeverityCounts(counts, bucket) {
  if (counts[bucket] !== undefined) {
    counts[bucket] += 1;
  }
}
