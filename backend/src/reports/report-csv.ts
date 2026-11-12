import type { ReportData } from './report-data.service';

function csvCell(input: string) {
  const normalized = input.normalize('NFKC');
  const mayBeFormula = /^[\p{White_Space}\p{Cc}\p{Cf}]*[=+@-]/u.test(normalized) || /^[\t\r\n]/.test(normalized);
  const value = input.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replaceAll('"', '""');
  return `"${mayBeFormula ? 'Văn bản: ' : ''}${value}"`;
}

export function encodeReportCsv(report: ReportData) {
  const lines = [report.headers, ...report.rows].map(row => row.map(csvCell).join(','));
  // A UTF-8 BOM lets spreadsheet applications recognize the Vietnamese headers.
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
}
