// Reads the text of a PDF with PDF.js, inside the browser (nothing is uploaded).
// Output: [{ number, lines: [{ y, cells: [{ text, x, right }] }] }], top to bottom,
// where a cell is a run of text separated from its neighbours by a column-sized gap.

export const MAX_PAGES = 50;
const LINE_TOLERANCE = 2; // points; items this close vertically share a line
const CELL_GAP = 8; // points; a wider horizontal gap starts a new cell

/** Groups PDF.js text items into lines of cells. Pure, so it can be tested without a PDF. */
export function groupIntoLines(items) {
  const pieces = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      right: item.transform[4] + item.width,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x); // PDF y grows upward, so higher y = higher on the page

  const lines = [];
  for (const piece of pieces) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - piece.y) <= LINE_TOLERANCE) last.pieces.push(piece);
    else lines.push({ y: piece.y, pieces: [piece] });
  }

  return lines.map(({ y, pieces }) => {
    const cells = [];
    for (const p of pieces.sort((a, b) => a.x - b.x)) {
      const cell = cells.at(-1);
      const gap = cell ? p.x - cell.right : Infinity;
      if (gap > CELL_GAP) {
        cells.push({ text: p.text, x: p.x, right: p.right });
        continue;
      }
      const space = gap > 1 && !cell.text.endsWith(' ') && !p.text.startsWith(' ') ? ' ' : '';
      cell.text += space + p.text;
      cell.right = Math.max(cell.right, p.right);
    }
    return { y, cells: cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })) };
  });
}

/** Extracts every page's lines. `pdfjs` is the PDF.js module (browser or Node build). */
export async function readPdfPages(data, pdfjs) {
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PAGES)
      throw new Error(`This PDF has ${doc.numPages} pages; the limit is ${MAX_PAGES}.`);
    const pages = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const { items } = await page.getTextContent();
      pages.push({ number, lines: groupIntoLines(items) });
    }
    return pages;
  } finally {
    await task.destroy(); // frees the worker's copy of the document
  }
}

/** Browser entry point. PDF.js is loaded on demand so it isn't part of the main bundle. */
export async function readPdfFile(file) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return readPdfPages(new Uint8Array(await file.arrayBuffer()), pdfjs);
}
