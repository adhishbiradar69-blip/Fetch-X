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

/* GET /principal/students?search=&page=&page_size=
   → { students:[{id,name,class_id,class_name,avg,trend,attendance_pct,
        rank_in_school}], total, page, page_size } */
export async function fetchStudents({ search = '', page = 1, pageSize = 30 } = {}) {
  const data = await get('/principal/students', {
    params: { search: search || undefined, page, page_size: pageSize },
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


/* POST /principal/ai/analyze → { answer, source, tools_used } */
export const analyze = (question) =>
  api.post('/principal/ai/analyze', { question }).then((r) => r.data);
