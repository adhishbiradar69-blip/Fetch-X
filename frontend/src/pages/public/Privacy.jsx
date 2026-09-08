/* Fetch-X /privacy — v16 rebuild on the landing's design vocabulary
   (Public16Shell + .lx-root classes). The policy copy below is unchanged. */
import Public16Shell, { PubSection } from './Public16Shell';

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

export default function Privacy() {
  return (
    <Public16Shell title="Privacy">
      <PubSection
        eyebrow="PRIVACY"
        title="Privacy first, always"
        lead="What Fetch-X collects, how it is protected, and the rights your school and its people keep."
      >
        {/* designer .priv block as the lead-in */}
        <div className="priv">
          <div className="fic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z" /><path d="M9 12l2 2 4-4.5" /></svg>
          </div>
          <div>
            <h3>No trackers, no data sale</h3>
            <p>This demo runs entirely in your browser — no accounts are created, no data leaves your device, and no third-party trackers are used. Saved students, folders, and theme preferences live in local storage and stay under your control.</p>
          </div>
        </div>
      </PubSection>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="rv" style={{ padding: '0 0 26px' }}>
          <div className="wrap">
            <div className="card legal-card" style={{ padding: '22px 26px', borderRadius: 16 }}>
              <h2 style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 19, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{s.title}</h2>
              {s.body.map((p, j) => (
                <p key={j} style={{ marginTop: j === 0 ? 10 : 8, fontSize: 13.5, lineHeight: 1.75, color: 'var(--body)' }}>{p}</p>
              ))}
            </div>
          </div>
        </section>
      ))}
    </Public16Shell>
  );
}
