/* API layer for the Principal Dashboard — one function per endpoint.
   All calls go through the shared axios client (Bearer auth attached).
   The shapes match the Task 2-a backend contract exactly; a couple of
   light normalizers keep the UI resilient if fields are missing. */
import api from '../../../api/client';
import { mean } from './util';

const get = (url, config) => api.get(url, config).then((r) => r.data);

/* GET /principal/stats */
export const fetchStats = () => get('/principal/stats');

/* GET /principal/term-averages
   → { overall:{t1,t2,t3,all}, subjects:[{name,hod,t1,t2,t3,avg,rank,trend}] } */
export const fetchTermAverages = () => get('/principal/term-averages');

/* GET /principal/score-distribution
   → { bands:[{band,count}×5], total } */
export const fetchScoreDistribution = () => get('/principal/score-distribution');

/* GET /principal/attendance-series?range=30D|3M|6M|1Y
   → { points:[{date,pct}] } */
export const fetchAttendanceSeries = (range) =>
  get('/principal/attendance-series', { params: { range } });

/* GET /principal/class-comparison?metric=avg|attendance|tasks
   → { classes:[{id,name,grade,section,avg,attendance_pct,tasks_pct}] } */
export const fetchClassComparison = (metric) =>
  get('/principal/class-comparison', { params: { metric } });

/* GET /principal/classes?grade=all|1..10
   → { classes:[{id,grade,section,name,ct_name,ct_subject,students,avg,
        attendance_pct,tasks_pct,rank}] } */
export const fetchClasses = (grade = 'all') =>
  get('/principal/classes', { params: { grade } });

/* GET /principal/class-detail/{id} */
export const fetchClassDetail = (id) => get(`/principal/class-detail/${id}`);

/* GET /principal/students?search=&page=&page_size=&min_avg=
   → { students:[{id,name,class_id,class_name,avg,trend,attendance_pct,
        rank_in_school}], total, page, page_size } */
export async function fetchStudents({ search = '', page = 1, pageSize = 30, minAvg = 0 } = {}) {
  const data = await get('/principal/students', {
    params: {
      search: search || undefined,
      page,
      page_size: pageSize,
      min_avg: minAvg || undefined,
    },
  });
  const rows = (data.students || []).map((s) => ({
    id: s.id,
    name: s.name,
    classId: s.class_id,
    className: s.class_name || s.class_label || '—',
    avg: s.avg ?? s.average ?? 0,
    trend: s.trend ?? 0,
    attendance: s.attendance_pct ?? s.attendance_rate ?? 0,
    rank: s.rank_in_school ?? null,
  }));
  const total = data.total ?? rows.length;
  const p = data.page ?? page;
  return { students: rows, total, page: p, pageSize: data.page_size ?? pageSize };
}

/* GET /principal/tasks-summary → { total, completed, pct } */
export const fetchTasksSummary = () => get('/principal/tasks-summary');

/* GET /principal/school-rank → { rank, of, avg } */
export const fetchSchoolRank = () => get('/principal/school-rank');

/* GET /principal/student-report/{id} */
export async function fetchStudentReport(id) {
  const d = await get(`/principal/student-report/${id}`);
  /* derived aggregates the UI needs (contract provides raw parts) */
  const subjects = (d.subjects || []).map((s) => ({
    ...s,
    marksAvg: s.avg ?? mean([s.marks?.t1, s.marks?.t2, s.marks?.t3].filter(Number.isFinite)),
    tasksAvg: s.tasks_pct ?? 0,
  }));
  const marks = Math.round(mean(subjects.map((s) => s.marksAvg)));
  const tasks = Math.round(mean(subjects.map((s) => s.tasksAvg)));
  return {
    ...d,
    subjects,
    derived: {
      marks,
      tasks,
      attendance: d.attendance_pct ?? 0,
      overall: d.overall ?? Math.round((marks + tasks + (d.attendance_pct ?? 0)) / 3),
    },
  };
}

/* GET /principal/radar?scope=school|grade|class|student&grade=&class_id=&student_id=
   → { subjects:[6 names], terms:{ t1:[6], t2:[6], t3:[6] } } */
export const fetchRadar = ({ scope, grade, classId, studentId } = {}) =>
  get('/principal/radar', {
    params: {
      scope,
      grade: grade ?? undefined,
      class_id: classId ?? undefined,
      student_id: studentId ?? undefined,
    },
  });

/* GET /principal/teachers — v5 designer update: ranked faculty.
   → { teachers:[{id,name,subject,is_hod,ct_of,classes,students,avg,
        t1,t2,t3,trend,tasks_avg,rank,of}] } */
export const fetchTeachers = () => get('/principal/teachers');

/* GET /principal/teacher-report/{id}
   → { teacher:{...}, role, classes:[{id,name,students,rank,ct_name,avg,
        t1,t2,t3,tasks_pct}], series:[{label,term,pct}],
        students:[{id,name,class_name,score,rank}] } */
export const fetchTeacherReport = (id) => get(`/principal/teacher-report/${id}`);


/* POST /principal/ai/analyze → { answer, source, tools_used }
   `history` = recent panel turns (role: user|assistant, content) so the AI
   remembers the conversation across questions. */
export const analyze = (question, history = []) =>
  api.post('/principal/ai/analyze', { question, history }).then((r) => r.data);

/* ───────────────────────── v15 designer update ───────────────────────── */

/* GET /principal/subject-detail/{id} — subject page (v15) */
export const fetchSubjectDetail = (id) => get(`/principal/subject-detail/${id}`);

/* GET /principal/class-comparison?metric=avg&subject=<id|name> */
export const fetchClassComparisonBySubject = (subject) =>
  get('/principal/class-comparison', { params: { metric: 'avg', subject } });

/* GET /principal/students?min_avg= — rank-band filter (v15 tabs) */
export async function fetchStudentsFiltered({ search = '', page = 1, pageSize = 30, minAvg = 0 } = {}) {
  return fetchStudents({ search, page, pageSize, minAvg });
}

/* POST /principal/compare — multi-entity compare (v15, up to 7) */
export const compareEntities = (entities) =>
  api.post('/principal/compare', { entities }).then((r) => r.data);

/* GET /timetable/class/{id} — weekly class grid (NEW backend) */
export const fetchClassTimetable = (classId) => get(`/timetable/class/${classId}`);

/* GET /timetable/teacher/{id} — personal teacher grid (NEW backend) */
export const fetchTeacherTimetable = (teacherId) => get(`/timetable/teacher/${teacherId}`);

/* GET /attendance/series with scope — class / student attendance trend.
   The v15 class-detail + report cards use scoped series. */
export const fetchAttendanceSeriesScoped = ({ scope = 'school', id, days = 365 }) =>
  get('/principal/attendance/series', { params: { scope, id, days } });

/* ───────────── Class Teacher console (NEW /ct backend) ───────────── */

/* GET /ct/me → { teacher, class } */
export const fetchCtMe = () => get('/ct/me');

/* GET /ct/class-dashboard → same contract as /principal/class-detail */
export const fetchCtClassDashboard = (classId) =>
  get('/ct/class-dashboard', { params: classId ? { class_id: classId } : {} });

/* GET /ct/teaching-classes → { teacher, role, ct_class, classes } */
export const fetchCtTeachingClasses = () => get('/ct/teaching-classes');

/* GET /ct/teacher-report → same contract as /principal/teacher-report/{id},
   scoped to the console user (v15 CT console "My Report"). */
export const fetchCtTeacherReport = () => get('/ct/teacher-report');
