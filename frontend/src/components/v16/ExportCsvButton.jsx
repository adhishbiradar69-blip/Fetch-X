/* Fetch-X — EXPORT CSV pill shared by the CP org lists and the AD rosters.
   Sits inside the designer's .searchbar (after the count). Fetching the
   full filtered list can take a few pages, so the label streams progress
   and the console's own toast confirms the download. */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '../../lib/csv';

export default function ExportCsvButton({ fetcher, onDone, onError, disabled }) {
  /* null | {done,total} — truthy while pages are streaming in */
  const [busy, setBusy] = useState(null);

  const run = async () => {
    if (busy || !fetcher) return;
    setBusy({ done: 0, total: 0 });
    try {
      const { filename, headers, rows } = await fetcher((done, total) => setBusy({ done, total }));
      downloadCsv(filename, headers, rows);
      onDone?.(rows.length);
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <button
      type="button"
      className="exe"
      disabled={!!busy || disabled}
      data-busy={busy ? '' : undefined}
      onClick={run}
      title="Download the full filtered list as a CSV file"
    >
      <Download strokeWidth={2.4} aria-hidden="true" />
      <span aria-live="polite">
        {busy
          ? (busy.total ? `EXPORTING ${busy.done.toLocaleString('en-IN')}/${busy.total.toLocaleString('en-IN')}` : 'EXPORTING…')
          : 'EXPORT CSV'}
      </span>
    </button>
  );
}
