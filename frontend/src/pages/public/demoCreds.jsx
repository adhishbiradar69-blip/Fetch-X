/* REAL demo accounts for the v16 landing cred-table + sign-in modal chips.
   Role art (SVG paths + colors) is the designer's verbatim; the logins map to
   the seed_demo.py accounts. Pure data module — no components (fast-refresh
   safe; kept out of Login.jsx so it stays component-only for react-refresh). */
export const DEMO_CREDS = [
  {
    id: 'chairperson', label: 'Chairperson',
    email: 'chairperson@schoolai.test', password: 'chair123',
    color: '#4f42dd', scope: 'Group-wide',
    icon: (<><path d="M3 17l-1-9 5.5 4L12 5l4.5 7L22 8l-1 9H3z" /><path d="M5 20.5h14" /></>),
  },
  {
    id: 'principal', label: 'Principal',
    email: 'principal@greenwood.test', password: 'principal123',
    color: '#0c7a6b', scope: 'School-wide',
    icon: (<><path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M3 10l9-6.5L21 10z" /></>),
  },
  {
    id: 'teacher', label: 'Class Teacher',
    email: 'teacher1.greenwood@schoolai.test', password: 'teacher123',
    color: '#b45f04', scope: 'Classroom',
    icon: (<><path d="M3 4h18" /><rect x="5" y="4" width="14" height="10" rx="2" /><path d="M12 14v4M9 21l3-3 3 3" /></>),
  },
  {
    id: 'admin', label: 'Admin',
    email: 'greenwood@admin.test', password: 'school123',
    color: '#c2255c', scope: 'System administration',
    icon: (<path d="M12 1l3 6 6.5 1-4.5 4.5L18 19l-6-3-6 3 .5-6.5L2 8l6.5-1z" />),
  },
];
