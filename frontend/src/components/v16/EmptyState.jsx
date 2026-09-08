/* Fetch-X — v16 empty state for filtered lists (CP org lists, AD rosters).
   Upgrades the bare `.noresult` text line to the card vocabulary: soft
   dashed glyph tile, title, hint. `tone` defaults to the tier color the
   same way the .exe pill does (--tD → --lvlD → base). */
import { SearchX } from 'lucide-react';

export default function EmptyState({ title = 'Nothing matches this filter', hint }) {
  return (
    <div className="noresult empty-v16" role="status">
      <span className="nv-glyph" aria-hidden="true"><SearchX strokeWidth={2} /></span>
      <span className="nv-title">{title}</span>
      {hint && <span className="nv-hint">{hint}</span>}
    </div>
  );
}
