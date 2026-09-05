import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { EASE } from '../../lib/motion.jsx';

/* Fetch-X Privacy Policy — realistic legal-ish copy.
   Sections: Information We Collect, How We Use It, Data Security, Student Data,
   Cookies, Your Rights, Children's Privacy, Changes, Contact. */

const SECTIONS = [
  {
    id: 'information',
    title: '1. Information We Collect',
    body: [
      'We collect the minimum information needed to operate the Service for your school:',
      '• Account information: name, email address, role, and the school or class you are linked to. This is provided by your school administrator.',
      '• Student records: name, roll number, class, attendance, marks, and assessment data entered by teachers or administrators.',
      '• Usage data: aggregated, anonymized metrics about feature usage to help us improve the Service. We do not track individual page views for marketing purposes.',
      '• Authentication tokens: stored locally in your browser to keep you signed in. We do not store your password in any reversible form — passwords are hashed and salted before storage.',
    ],
  },
  {
    id: 'use',
    title: '2. How We Use Your Information',
    body: [
      'We use the information we collect to:',
      '• Operate, maintain, and improve the features of the Service.',
      '• Compute analytics, dashboards, and AI-generated insights about school performance.',
      '• Authenticate users and enforce role-based access controls.',
      '• Communicate with school administrators about account changes, security updates, and service incidents.',
      '• We do not sell student or user data to third parties. We do not use student data to train advertising models.',
    ],
  },
  {
    id: 'security',
    title: '3. Data Security',
    body: [
      'We use industry-standard safeguards to protect your data: salted password hashing, role-based access control at every API endpoint, scoped database queries that filter by school_id and role, and session tokens with expiration.',
      'No method of transmission over the Internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your data, we cannot guarantee absolute security.',
      'In the event of a data breach affecting your school, we will notify your school administrator without undue delay.',
    ],
  },
  {
    id: 'student-data',
    title: '4. Student Data',
    body: [
      'Student data is treated with special care. The Service is designed for use in K-12 and similar educational settings.',
      'Student records are only accessible to roles explicitly authorized by the school: the student\'s class teacher, the school principal and chairperson, the student\'s parent or guardian (linked to the specific student only), and school administrators.',
      'We do not use student data to develop profiles for non-educational purposes, and we do not share student data with third-party marketers or data brokers.',
      'Schools retain ownership of all student data. Upon request, we will export or delete student data in accordance with the school\'s instructions.',
    ],
  },
  {
    id: 'cookies',
    title: '5. Cookies & Local Storage',
    body: [
      'The Service uses local storage — not cookies — to remember your authentication token, theme preference, and basic UI state. This data never leaves your browser unless you explicitly sign in.',
      'We do not use tracking cookies, advertising pixels, or third-party analytics scripts. There is no cross-site tracking on Fetch-X.',
    ],
  },
  {
    id: 'rights',
    title: '6. Your Rights',
    body: [
      'Depending on your jurisdiction, you may have the right to:',
      '• Request access to the personal data we hold about you.',
      '• Request correction of inaccurate personal data.',
      '• Request deletion of your personal data, subject to the school\'s record-retention obligations.',
      '• Object to or restrict certain processing of your data.',
      'To exercise these rights, contact your school administrator first. They can route your request to the Fetch-X team.',
    ],
  },
  {
    id: 'childrens-privacy',
    title: '7. Children\'s Privacy',
    body: [
      'The Service is designed for use by schools to manage student information. Students are not direct users of the Service and do not create their own accounts.',
      'Student data is entered and managed by authorized adults — teachers, administrators, and parents. We do not knowingly collect personal information directly from children under 13 for marketing purposes.',
      'If you believe a student\'s data has been entered in error, please contact the school administrator to request correction or deletion.',
    ],
  },
  {
    id: 'changes',
    title: '8. Changes to This Policy',
    body: [
      'We may update this Privacy Policy from time to time. When we do, we will revise the "last updated" date and notify school administrators of any material changes.',
      'Continued use of the Service after changes take effect constitutes acceptance of the revised policy.',
    ],
  },
  {
    id: 'contact',
    title: '9. Contact',
    body: [
      'If you have questions about this Privacy Policy or the data practices of the Service, please contact your school administrator.',
      'For direct privacy inquiries, you may reach us at: privacy@fetchx.example',
    ],
  },
];

const field = (delay) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay },
});

export default function Privacy() {
  return (
    <div className="public-page legal-page">
      <motion.section className="public-hero" {...field(0)}>
        <span className="public-hero-badge"><Shield size={14} /> Legal</span>
        <h1>Privacy Policy</h1>
        <p className="public-hero-sub">
          Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </motion.section>

      <div className="legal-body glass">
        <nav className="legal-toc">
          {SECTIONS.map(s => (
            <a key={s.id} href={`#${s.id}`}>{s.title}</a>
          ))}
        </nav>

        {SECTIONS.map((s, i) => (
          <motion.section
            key={s.id}
            id={s.id}
            className="legal-section"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, ease: EASE, delay: Math.min(i * 0.04, 0.3) }}
          >
            <h2>{s.title}</h2>
            {s.body.map((p, j) => <p key={j}>{p}</p>)}
          </motion.section>
        ))}
      </div>
    </div>
  );
}
