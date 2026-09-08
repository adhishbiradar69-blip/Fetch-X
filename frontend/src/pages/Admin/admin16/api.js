/* Admin console data layer — Task 2-d contracts (verified live):
   GET  /admin/stats                → {students,teachers,classes,subjects,attendance_pct,
                                       avg_score,tasks_total,tasks_completed,
                                       task_completion_pct,at_risk,school_rank,
                                       school_rank_of,school{id,name}}
   GET  /admin/students             ?search&grade&class_id&page&page_size (cap 200)
                                    → {students:[{id,name,roll_no,class_id,grade,section,
                                       class_label,class_name,notes}],total,page,page_size}
   PUT  /admin/students/{id}        {name?,class_id?|grade?+section?,notes?} → {ok,student{…}}
   DELETE /admin/students/{id}      → {ok,deleted_id}
   GET  /principal/teachers         → {teachers:[{id,name,email,subject,subject_id,is_hod,
                                       is_ct,ct_class_id,ct_class_label,classes_count,
                                       classes_assigned,notes,…,rank,of}]}
   PUT  /admin/staff/{id}           {full_name?,subject_id?,ct_class_id|null,notes?}
                                    → {ok,teacher:{…full post-save staff state}}
   GET  /admin/subjects             → [{id,name,color}]
   GET  /admin/classes              → [{id,school_id,grade,section,label,
                                       class_teacher:{id,name}|null}]  */
import api from '../../../api/client';

const PAGE_SIZE = 50; // server cap is 200; 50 keeps infinite-scroll pages light

export const fetchStats = () => api.get('/admin/stats').then((r) => r.data);

export const fetchTeachers = () =>
  api.get('/principal/teachers').then((r) => r.data.teachers || []);

export const fetchClasses = () =>
  api.get('/admin/classes').then((r) => r.data || []);

export const fetchSubjects = () =>
  api.get('/admin/subjects').then((r) => r.data || []);

/* one paginated loader serves BOTH "04 All Students" and the per-class
   roster view (?class_id=) — server-side search + pagination on both */
export const fetchStudentsPage = ({ search, grade, classId, page = 1, pageSize = PAGE_SIZE }) =>
  api.get('/admin/students', {
    params: {
      search: search || undefined,
      grade: grade || undefined,
      class_id: classId || undefined,
      page,
      page_size: pageSize,
    },
  }).then((r) => r.data);

/* light per-class enrolment probe for the Classes section chips — the
   classes endpoint carries no student count, so read ?page_size=1 total */
export const fetchClassCount = (classId) =>
  api.get('/admin/students', { params: { class_id: classId, page: 1, page_size: 1 } })
    .then((r) => r.data.total);

export const updateStudent = (id, body) => api.put(`/admin/students/${id}`, body).then((r) => r.data);

export const deleteStudent = (id) => api.delete(`/admin/students/${id}`).then((r) => r.data);

export const updateStaff = (id, body) => api.put(`/admin/staff/${id}`, body).then((r) => r.data);

/* designer helpers */
export const initialsOf = (n) =>
  String(n || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/* designer SUBJ_SHORT map extended to the seeded subject catalog */
const SUBJECT_SHORT = {
  Mathematics: 'MATH',
  English: 'ENG',
  Science: 'SCI',
  Hindi: 'HINDI',
  Social: 'SOCIAL',
  'Social Studies': 'SOCIAL',
  Computer: 'COMP',
  'Computer Science': 'COMP',
  'Physical Education': 'PE',
};

export const subjectShort = (name) =>
  SUBJECT_SHORT[name] || String(name || '—').slice(0, 4).toUpperCase();

export const errOf = (e, fallback) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
};

export { PAGE_SIZE };
