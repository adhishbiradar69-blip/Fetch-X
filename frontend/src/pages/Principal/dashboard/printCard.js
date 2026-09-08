/* Fetch-X — shared "print just this card" helper for the v16 report and
   compare modals. The browser-print path used to be only a fallback of the
   PDF export; with styles/print.css it is a first-class export:

     • print.css scopes the printout to the OPEN modal (.report / .cmp),
       forces the light token set and flattens animations;
     • this helper does the parts CSS cannot: freezing animated chart
       state (donut dash-offsets, clipped line reveals), stamping the
       print letterhead (data-print-meta) and cleaning up after.

   The PDF exporters keep their own inline freeze (they also rasterise via
   html2canvas) — the logic intentionally mirrors exportPdf. */

export async function printCardEl(card, meta) {
  if (!card) return;

  /* 1 · freeze every animated element at its final state (same as PDF) */
  card.querySelectorAll('.donut .bar').forEach((b) => {
    if (b.dataset.off) b.style.strokeDashoffset = b.dataset.off;
  });
  card.querySelectorAll('.lrreveal').forEach((r) => {
    r.style.transition = 'none';
    r.style.clipPath = 'inset(0 -2% 0 0)';
  });
  card.querySelectorAll('.vbar i, .vbar2 i, .scorepill .bar i, .d-track i, .bc-fill').forEach((b) => {
    b.style.transition = 'none';
  });
  card.querySelectorAll('.ltip, .lxhair, .ldot').forEach((el) => el.classList.remove('on'));

  /* 2 · fonts settle before the snapshot */
  try { await document.fonts.ready; } catch { /* font API unavailable */ }
  await new Promise((r) => setTimeout(r, 250));

  /* 3 · letterhead + guaranteed light capture, then print */
  card.classList.add('force-light');
  card.setAttribute('data-print-meta', meta);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    card.classList.remove('force-light');
    card.removeAttribute('data-print-meta');
    window.removeEventListener('afterprint', cleanup);
  };
  /* afterprint is the happy path; the timer is the safety net for
     environments where the event never fires (cancelled dialogs,
     headless/webview quirks) — a stale .force-light would flash the
     card light in dark mode. */
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 20000);
  try { window.print(); } catch { cleanup(); }
}

/* print letterhead tail — "GENERATED 07 SEP 2026" style stamp */
export const printStamp = () => new Date()
  .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  .toUpperCase();
