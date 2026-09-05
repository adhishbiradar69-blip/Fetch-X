import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';
import { EASE } from '../../lib/motion.jsx';

/* Fetch-X Terms of Service — realistic legal-ish copy.
   Sections: Acceptance, Accounts, Acceptable Use, Privacy, Disclaimers,
   Limitation of Liability, Changes, Contact. */

const SECTIONS = [
  {
    id: 'acceptance',
    title: '1. Acceptance of Terms',
    body: [
      'By accessing or using the Fetch-X platform ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use the Service.',
      'The Service is provided to schools, educators, administrators, and authorized family members for the purpose of managing student attendance, academic performance, and related activities.',
    ],
  },
  {
    id: 'accounts',
    title: '2. Accounts',
    body: [
      'Accounts on Fetch-X are created by school administrators — there is no public self-registration. Your administrator will assign your role (Class Teacher, Principal, Chairperson, Parent, School Admin, or Super Admin) and link your account to the appropriate school, class, or student record.',
      'You are responsible for safeguarding your login credentials and for all activity that occurs under your account. Notify your administrator immediately if you suspect any unauthorized access.',
      'Each role grants a specific scope of access. You may not attempt to access data outside the scope of your assigned role.',
    ],
  },
  {
    id: 'acceptable-use',
    title: '3. Acceptable Use',
    body: [
      'You agree to use the Service only for lawful school administration purposes. You will not:',
      '• Upload, store, or transmit content that is unlawful, harmful, defamatory, or infringes the rights of others.',
      '• Attempt to reverse-engineer, decompile, or otherwise extract source code or underlying data structures.',
      '• Use the Service to send unsolicited communications, or to harass, discriminate against, or harm any student, family, or staff member.',
      '• Share your credentials with any other person, including colleagues or family members.',
      '• Use automated scripts, bots, or scrapers to extract data without express written permission.',
    ],
  },
  {
    id: 'privacy',
    title: '4. Privacy',
    body: [
      'Our handling of student and user data is described in detail in our Privacy Policy. By using the Service, you consent to the data practices outlined there.',
      'Student data — including names, attendance, marks, and demographic information — is treated as confidential and is only accessible to roles explicitly authorized by your school administration.',
    ],
  },
  {
    id: 'disclaimers',
    title: '5. Disclaimers',
    body: [
      'The Service is provided "as is" and "as available" without warranties of any kind, whether express or implied. We do not warrant that the Service will be uninterrupted, error-free, or secure.',
      'AI-generated insights are produced by automated analysis of school data and may contain errors or omissions. AI insights are advisory in nature and should not be the sole basis for personnel, disciplinary, or admissions decisions.',
      'You are responsible for verifying the accuracy of marks, attendance records, and other data entered into the Service before relying on them for official purposes.',
    ],
  },
  {
    id: 'liability',
    title: '6. Limitation of Liability',
    body: [
      'To the maximum extent permitted by law, Fetch-X and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, arising out of your use of the Service.',
      'Our total aggregate liability for any claim arising out of or relating to these Terms or the Service shall not exceed the amount paid by your school to Fetch-X in the twelve (12) months preceding the claim.',
    ],
  },
  {
    id: 'changes',
    title: '7. Changes to These Terms',
    body: [
      'We may modify these Terms from time to time. When we do, we will revise the "last updated" date at the bottom of this page and notify school administrators of any material changes.',
      'Continued use of the Service after changes take effect constitutes acceptance of the revised Terms. If you do not agree to the revised Terms, you must stop using the Service and notify your administrator.',
    ],
  },
  {
    id: 'contact',
    title: '8. Contact',
    body: [
      'If you have questions about these Terms, please contact your school administrator first. They can route specific questions to the Fetch-X team.',
      'For legal inquiries, you may reach us at: legal@fetchx.example',
    ],
  },
];

const field = (delay) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay },
});

export default function Terms() {
  return (
    <div className="public-page legal-page">
      <motion.section className="public-hero" {...field(0)}>
        <span className="public-hero-badge"><FileText size={14} /> Legal</span>
        <h1>Terms of Service</h1>
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
