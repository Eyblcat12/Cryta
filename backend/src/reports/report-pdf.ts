import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { ReportData } from './report-data.service';

// PDFKit's CommonJS entry exports the constructor directly.
const PDFDocument = createRequire(__filename)('pdfkit') as typeof import('pdfkit');
const margin = 36;
const padding = 6;
const font = join(__dirname, '../../assets/report-font/NotoSans-Regular.ttf');

export async function encodeReportPdf(report: ReportData): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin, autoFirstPage: false, bufferPages: true,
    info: { Title: report.title, Author: 'Crypta' } });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.once('end', () => resolve(Buffer.concat(chunks)));
    pdf.once('error', reject);
  });
  pdf.font(font);
  let y = 0, width = 0, columnWidth = 0;

  function text(value: string, index: number, top: number) {
    pdf.text(value, margin + index * columnWidth + padding, top + padding, { width: columnWidth - 2 * padding });
  }
  function addPage() {
    pdf.addPage();
    width = pdf.page.width - 2 * margin;
    columnWidth = width / report.headers.length;
    pdf.fillColor('#172945').fontSize(19).text(report.title, margin, margin);
    pdf.fontSize(9).fillColor('#4a5c72').text(`Crypta  ·  Tổng số dòng: ${report.total}  ·  Múi giờ: ${report.timeZone}`, margin, margin + 28);
    y = margin + 54;
    pdf.rect(margin, y, width, 27).fill('#eaf0fb');
    pdf.fillColor('#172945').fontSize(9);
    report.headers.forEach((heading, index) => text(heading, index, y));
    y += 27;
  }

  addPage();
  for (const row of report.rows) {
    const clean = row.map(cell => cell.replace(/[\p{Cc}\p{Cf}]+/gu, ' '));
    pdf.fontSize(8.5);
    const height = Math.max(...clean.map(cell => pdf.heightOfString(cell, { width: columnWidth - 2 * padding }))) + 2 * padding;
    if (y + height > pdf.page.height - margin - 25) addPage();
    pdf.fontSize(8.5).fillColor('#162336');
    clean.forEach((cell, index) => text(cell, index, y));
    y += height;
    pdf.strokeColor('#ced7e5').lineWidth(0.5).moveTo(margin, y).lineTo(margin + width, y).stroke();
  }
  const pages = pdf.bufferedPageRange();
  for (let index = 0; index < pages.count; index++) {
    pdf.switchToPage(index + pages.start);
    pdf.fontSize(8).fillColor('#4a5c72').text(`Trang ${index + 1} / ${pages.count}`, margin, pdf.page.height - margin - 13,
      { width, align: 'right', height: 12, lineBreak: false });
  }
  pdf.end();
  return output;
}
