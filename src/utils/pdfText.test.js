import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // Node build of PDF.js
import { groupIntoLines, readPdfPages } from './pdfText';
import { parseStatement } from './pdfStatement';

// A PDF.js text item: x, y and width are what groupIntoLines uses.
const item = (str, x, y, width = str.length * 5) => ({
  str,
  width,
  transform: [10, 0, 0, 10, x, y],
});

/** Builds a tiny real PDF: pages of [x, y, text] drawn in Helvetica 10pt. */
function makePdf(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const kids = [];
  for (const texts of pages) {
    const stream = texts
      .map(([x, y, t]) => `BT /F1 10 Tf ${x} ${y} Td (${t.replace(/[()\\]/g, '\\$&')}) Tj ET`)
      .join('\n');
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`,
    );
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe('groupIntoLines', () => {
  it('orders lines top to bottom and joins items that sit on the same line', () => {
    const lines = groupIntoLines([
      item('second', 40, 680),
      item('WALMART', 90, 700.6), // slightly different y, same line
      item('10/15', 40, 700),
      item('84.52', 350, 700),
      item('  ', 200, 700), // whitespace-only items are dropped
    ]);
    expect(lines.map((l) => l.cells.map((c) => c.text))).toEqual([
      ['10/15', 'WALMART', '84.52'],
      ['second'],
    ]);
  });

  it('merges close items into one cell and splits at column gaps', () => {
    const [line] = groupIntoLines([
      item('ONLINE', 90, 700, 30),
      item('TRANSFER', 123, 700, 40),
      item('9.99', 300, 700, 20),
    ]);
    expect(line.cells).toEqual([
      { text: 'ONLINE TRANSFER', x: 90, right: 163 },
      { text: '9.99', x: 300, right: 320 },
    ]);
  });
});

describe('readPdfPages with a real PDF', () => {
  it('extracts lines from each page and feeds the statement parser', async () => {
    const pdf = makePdf([
      [
        [40, 760, 'Statement period 10/01/2026 - 10/31/2026'],
        [40, 720, 'Date'],
        [90, 720, 'Description'],
        [330, 720, 'Withdrawals'],
        [420, 720, 'Deposits'],
        [510, 720, 'Balance'],
        [40, 700, '10/03'],
        [90, 700, 'GROCERY OUTLET'],
        [350, 700, '45.10'],
        [520, 700, '954.90'],
        [280, 40, 'Page 1 of 2'],
      ],
      [
        [40, 720, 'Date'],
        [90, 720, 'Description'],
        [330, 720, 'Withdrawals'],
        [420, 720, 'Deposits'],
        [510, 720, 'Balance'],
        [40, 700, '10/15'],
        [90, 700, 'PAYROLL'],
        [430, 700, '2,000.00'],
        [510, 700, '2,954.90'],
      ],
    ]);
    const pages = await readPdfPages(pdf, pdfjs);
    expect(pages.map((p) => p.number)).toEqual([1, 2]);
    expect(pages[0].lines[2].cells.map((c) => c.text)).toEqual([
      '10/03',
      'GROCERY OUTLET',
      '45.10',
      '954.90',
    ]);

    const { drafts } = parseStatement(pages);
    expect(
      drafts.map((d) => [d.date, d.description, d.money.type, d.money.amount, d.review]),
    ).toEqual([
      ['2026-10-03', 'GROCERY OUTLET', 'expense', 45.1, undefined],
      ['2026-10-15', 'PAYROLL', 'income', 2000, undefined],
    ]);
  });

  it('rejects files that are not PDFs', async () => {
    await expect(readPdfPages(new TextEncoder().encode('not a pdf'), pdfjs)).rejects.toThrow();
  });
});
