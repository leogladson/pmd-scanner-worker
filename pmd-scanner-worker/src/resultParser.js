import path from 'node:path';
import {
  bucketFromSeverity,
  emptySeverityCounts,
  incrementSeverityCounts,
  maxSeverity
} from './severity.js';

/**
 * @param {object} analyzerJson - Code Analyzer JSON output
 * @param {Map<string, { id: string, name: string }>} classByFileName - keys like "MyClass.cls"
 */
export function parseAnalyzerResults(analyzerJson, classByFileName) {
  const violations = Array.isArray(analyzerJson?.violations)
    ? analyzerJson.violations
    : [];

  const severityCounts = emptySeverityCounts();
  const perFile = new Map();

  for (const classMeta of classByFileName.values()) {
    perFile.set(classMeta.name, {
      apexClassId: classMeta.id,
      fileName: classMeta.name,
      fileType: 'ApexClass',
      scanStatus: 'SCANNED',
      violationCount: 0,
      highestSeverity: 'NONE',
      failureMessage: null
    });
  }

  for (const violation of violations) {
    const location = violation?.locations?.[violation?.primaryLocationIndex ?? 0];
    const filePath = location?.file;
    if (!filePath) {
      continue;
    }

    const fileName = path.basename(filePath);
    const classMeta = classByFileName.get(fileName);
    if (!classMeta) {
      continue;
    }

    const bucket = bucketFromSeverity(violation.severity);
    incrementSeverityCounts(severityCounts, bucket);

    const fileResult = perFile.get(classMeta.name);
    fileResult.violationCount += 1;
    fileResult.highestSeverity = maxSeverity(
      fileResult.highestSeverity,
      bucket
    );
  }

  const files = [...perFile.values()];
  const filesWithViolations = files.filter((f) => f.violationCount > 0).length;
  const totalViolations = violations.length;

  const analyzerVersion =
    analyzerJson?.versions?.['code-analyzer'] ||
    analyzerJson?.versions?.codeAnalyzer ||
    'unknown';
  const pmdVersion = analyzerJson?.versions?.pmd;
  const rulesetVersion = pmdVersion ? `pmd-${pmdVersion}` : 'pmd';

  return {
    files,
    filesWithViolations,
    totalViolations,
    severityCounts,
    analyzerVersion,
    rulesetVersion,
    rawViolationCount: violations.length
  };
}
