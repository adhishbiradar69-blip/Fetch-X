/* Fetch-X /about — v16 rebuild on the landing's own design vocabulary
   (Public16Shell + .lx-root classes from landing-v16.css). Team copy is the
   designer's, verbatim (index(2).html team section). */
import Public16Shell, { PubSection } from './Public16Shell';

const TEAM = [
  {
    initial: 'K',
    krole: false,
    name: 'kishor kudre',
    role: 'CEO · VISION & GROWTH',
    bio: "Multi-talented CEO driving product vision and execution. From pitching and presentation to scaling — Kishor turns Fetch-X's capability into impact for every school it reaches.",
  },
  {
    initial: 'A',
    krole: true,
    name: 'Adhish Biradar',
    role: 'CTO · BACKEND & OPERATIONS',
    bio: 'Adhish is the Nerdy CTO who brings vision into reality by architecting the data engine, keeping every metric honest, and operating the platform end-to-end to keep Fetch-X operating smoothly.',
  },
];

const VALUES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" /></svg>
    ),
    title: 'Mission-driven',
    body: 'We exist to give every educator the tools to spot struggling students early — and to celebrate the ones who shine.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.3-9-8.5C1.5 8 3.5 5 6.5 5c2 0 3.5 1 4.5 2.5C12 6 13.5 5 15.5 5c3 0 5 3 3.5 6.5-2 4.2-7 8.5-7 8.5z" /></svg>
    ),
    title: 'Human-first',
    body: "Software should respect teachers' time. Every interaction is tuned to reduce clicks, not add them.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z" /><path d="M9 12l2 2 4-4.5" /></svg>
    ),
    title: 'Privacy by default',
    body: 'Student data is sacred. Role-based access at every layer, and we never expose more than each role needs.',
  },
];

const STATS = [
  { icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.7-3.2 3.3-5 6.5-5s5.8 1.8 6.5 5" /></svg>
    ), n: '2,700+', k: 'STUDENTS TRACKED' },
  { icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M3 10l9-6.5L21 10z" /></svg>
    ), n: '3', k: 'SCHOOLS, ONE GROUP' },
  { icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    ), n: '270', k: 'CLASSES · 3 HOUSE SECTIONS' },
  { icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.4L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.6L12 3z" /></svg>
    ), n: '33', k: 'AI TOOLS FOR LEADERSHIP' },
];

export default function About() {
  return (
    <Public16Shell title="About">
      <PubSection
        eyebrow="ABOUT FETCH-X"
        title="School management, finally intelligent."
        lead="Fetch-X is a school-intelligence platform: attendance, marks, tasks and timetables for every role — with an AI analyst that reads the data so leadership can act on it."
      >
        {/* landing .stats vocabulary */}
        <div className="stats rv">
          {STATS.map((s) => (
            <div className="stat" key={s.k}>
              <span className="sic">{s.icon}</span>
              <b style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-.01em' }}>{s.n}</b>
              <div className="slab">{s.k}</div>
            </div>
          ))}
        </div>

        {/* designer team section — markup + copy verbatim */}
        <div className="sec-head" style={{ margin: '38px auto 26px' }}>
          <h2 style={{ fontSize: 28 }}>The people behind Fetch-X</h2>
          <p>Two builders, one mission — make school data actually useful.</p>
        </div>
        <div className="team-grid">
          {TEAM.map((t) => (
            <div className={`person rv${t.krole ? ' krole' : ''}`} key={t.name}>
              <div className={`pav ${t.krole ? 'k' : 'a'}`}>{t.initial}</div>
              <div className="pname">{t.name}</div>
              <span className="prole">{t.role}</span>
              <p className="pbio">{t.bio}</p>
            </div>
          ))}
        </div>
      </PubSection>

      <PubSection
        eyebrow="WHAT WE BELIEVE"
        title="Principles we ship by"
      >
        <div className="feat-grid">
          {VALUES.map((v, i) => (
            <div className="fcard rv" key={v.title} style={{ transitionDelay: `${i * 0.08}s` }}>
              <div className="fic">{v.icon}</div>
              <h3>{v.title}</h3>
              <p>{v.body}</p>
            </div>
          ))}
        </div>
      </PubSection>

      {/* designer privacy block */}
      <section className="rv" style={{ padding: '10px 0 40px' }}>
        <div className="wrap">
          <div className="priv">
            <div className="fic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z" /><path d="M9 12l2 2 4-4.5" /></svg>
            </div>
            <div>
              <h3>Privacy first, always</h3>
              <p>This demo runs entirely in your browser — no accounts are created, no data leaves your device, and no third-party trackers are used. See the <a href="/privacy" style={{ color: 'var(--brand)', fontWeight: 700 }}>privacy note</a> for details.</p>
            </div>
          </div>
        </div>
      </section>
    </Public16Shell>
  );
}
