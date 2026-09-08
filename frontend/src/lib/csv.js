/* Fetch-X — CSV export helpers shared by the CP + AD consoles.
   The org rosters are server-paginated (page_size cap 200), so "export the
   full filtered list" means looping the pages until `total` is reached —
   the caller passes its page fetcher and gets progress callbacks so the
   button can stream "EXPORTING 600 / 2,698" while it works. */

/* RFC-4180-ish cell escaping: quotes, commas, newlines. */
export const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* Build + download a CSV from header/row arrays. BOM keeps Excel happy
   with UTF-8 names (Saanvika, Menon, …). */
export function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');
  const blob = new Blob([`\uFEFF${lines}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Loop a paginated fetcher until every row of the current filter is in.
   fetchPage(page, pageSize) → { items, total }
   onProgress(done, total) fires after each page (button label).
   Guards: 40-page hard cap (8,000 rows) so a bad contract can't loop forever. */
export async function fetchAllPages(fetchPage, onProgress, { pageSize = 200 } = {}) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const { items, total } = await fetchPage(page, pageSize);
    out.push(...items);
    onProgress?.(out.length, total);
    if (!items.length || out.length >= total) break;
  }
  return out;
}

/* fetchx-students-greenwood-2026-09-07.csv style names */
export const csvStamp = () => new Date().toISOString().slice(0, 10);
