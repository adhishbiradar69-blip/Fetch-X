import { motion } from 'framer-motion';
import { Compass, Heart, Shield, Target, Mail, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EASE } from '../../lib/motion.jsx';

/* Fetch-X about page — brand story with the founding duo as the centerpiece.
   Reuses the landing kit classes (.person/.pav/.pname/.prole/.pbio) plus the
   public/legal page classes — no local styling. */

/* Prototype .rv reveal (same feel as the landing page). */
const RV_EASE = [0.25, 0.7, 0.3, 1];
const rv = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.7, ease: RV_EASE, delay },
});

const field = (delay) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay },
});

/* The founding team — roles per the approved Fetch-X brand decisions. */
const TEAM = [
  {
    initial: 'K',
    avatar: 'a',
    krole: false,
    name: 'kishor kudre',
    role: 'CEO · VISION & GROWTH',
    bio: "Multi-talented CEO driving product vision and execution. From pitching and presentation to scaling — Kishor turns Fetch-X's capability into impact for every school it reaches.",
  },
  {
    initial: 'A',
    avatar: 'k',
    krole: true,
    name: 'Adhish Biradar',
    role: 'CTO · BACKEND & OPERATIONS',
    bio: 'Adhish is the Nerdy CTO who brings vision into reality by architecting the data engine, keeping every metric honest, and operating the platform end-to-end to keep Fetch-X operating smoothly.',
  },
];

const VALUES = [
  {
    Icon: Compass,
    title: 'Mission-driven',
    body: 'We exist to give every educator the tools to spot struggling students early — and to celebrate the ones who shine.',
  },
  {
    Icon: Heart,
    title: 'Human-first',
    body: "Software should respect teachers' time. Every interaction is tuned to reduce clicks, not add them.",
  },
  {
    Icon: Shield,
    title: 'Privacy by default',
    body: 'Student data is sacred. Role-based access at every layer, and we never expose more than each role needs.',
  },
  {
    Icon: Target,
    title: 'Outcomes over output',
    body: 'We measure success in improved averages and lower at-risk counts — not pageviews or vanity metrics.',
  },
];

export default function About() {
  return (
    <div className="public-page about-page">
      <motion.section className="public-hero" {...field(0)}>
        <span className="public-hero-badge">About Fetch-X</span>
        <h1>We turn school data into decisions.</h1>
        <p className="public-hero-sub">
          Fetch-X started with a simple observation: schools have more data than
          ever, but the people running them have less time than ever to make sense
          of it. Spreadsheets don't surface at-risk students. Paper attendance
          doesn't predict dropouts. Fetch-X does.
        </p>
      </motion.section>

      {/* Founding duo — the centerpiece of the page */}
      <section className="about-team">
        <motion.div className="section-headline" {...field(0.08)}>
          <h2>The people behind Fetch-X</h2>
          <p>Two builders, one mission — make school data actually useful.</p>
        </motion.div>
        <div className="team-grid">
          {TEAM.map((p, i) => (
            <motion.div className={`person${p.krole ? ' krole' : ''}`} {...rv(i * 0.1)} key={p.name}>
              <div className={`pav ${p.avatar}`}>{p.initial}</div>
              <div className="pname">{p.name}</div>
              <span className="prole">{p.role}</span>
              <p className="pbio">{p.bio}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <motion.section className="about-mission" {...rv()}>
        <div className="about-mission-icon">
          <Target size={26} />
        </div>
        <div>
          <h2>What is Fetch-X?</h2>
          <p>
            A role-based school intelligence platform. Class teachers take
            attendance and track tasks in seconds. Principals see every grade,
            subject, section, and student with term-wise rollups and at-risk
            detection. Chairpersons compare schools side by side. And an AI
            assistant reads your school's real data and answers questions in plain
            English — one platform, every role.
          </p>
        </div>
      </motion.section>

      <section className="about-values">
        <motion.div className="section-headline" {...rv()}>
          <h2>What we believe</h2>
          <p>The principles behind every product decision we make.</p>
        </motion.div>
        <div className="values-grid">
          {VALUES.map((v, i) => {
            const VIcon = v.Icon;
            return (
              <motion.div
                key={v.title}
                className="value-card"
                {...rv(i * 0.08)}
              >
                <div className="value-icon"><VIcon size={22} /></div>
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      <motion.section className="about-contact glass" {...rv()}>
        <div className="about-mission-icon">
          <Mail size={26} />
        </div>
        <div>
          <h2>Get in touch</h2>
          <p>
            For general inquiries, support, or legal matters, reach us at
            <a href="mailto:adhishbiradar69@gmail.com" className="contact-email">
              adhishbiradar69@gmail.com
            </a>
          </p>
          <Link to="/login" className="contact-cta">
            Sign in to your account <ArrowRight size={16} />
          </Link>
        </div>
      </motion.section>
    </div>
  );
}
