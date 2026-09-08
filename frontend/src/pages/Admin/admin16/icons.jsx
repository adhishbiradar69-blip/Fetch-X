/* Designer SVGs for the v16 admin console — copied 1:1 from upload/admin.html
   (renderAdDash stat cells + row-action glyphs + searchbar icon).
   Pure data module (no components) so react-refresh never complains. */

export const ICO_SEARCH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

/* stat-cell icons — verbatim from renderAdDash() in admin.html */
export const ICO_STU_TOTAL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M15.5 3.13a4 4 0 0 1 0 7.75" /></svg>
);

export const ICO_CLS_TOTAL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M3 10l9-6.5L21 10z" /></svg>
);

export const ICO_RANK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4" /><path d="M7 4h10v6a5 5 0 0 1-10 0V4z" /><path d="M7 5H4a3 3 0 0 0 3 5.5M17 5h3a3 3 0 0 1-3 5.5" /></svg>
);

export const ICO_ATT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10.5h17" /></svg>
);

export const ICO_TASKS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" /><path d="M8.5 12.2l2.6 2.6 4.9-5.4" /></svg>
);

export const ICO_MARKS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4.5h6.5A3.5 3.5 0 0 1 12 8v12a3 3 0 0 0-3-3H2z" /><path d="M22 4.5h-6.5A3.5 3.5 0 0 0 12 8v12a3 3 0 0 1 3-3h7z" /></svg>
);

/* row glyphs — admin.html constants PERSON_SVG / EDIT_SVG / X_SVG / ARR_SVG */
export const ICO_PERSON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.7-3.2 3.3-5 6.5-5s5.8 1.8 6.5 5" /></svg>
);

export const ICO_EDIT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
);

export const ICO_X = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);

export const ICO_ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
);
