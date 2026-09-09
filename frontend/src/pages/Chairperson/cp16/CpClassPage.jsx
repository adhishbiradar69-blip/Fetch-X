/* CpClassPage (v17) — the chairperson's full class drill-down.
   Wraps the Principal dashboard's ClassDetail (built for exactly this
   reuse: `fetcher` + `embedded` + `backLabel` props) and points the
   fetcher at GET /chairperson/classes/{id}/inspect — the same response
   contract as /principal/class-detail, group-scoped.

   `classesAll` narrows to the class's own school so the "rank / N classes"
   pills mean the same thing the principal sees. onOpenReport opens the
   shared ReportCardModal (the principal's student-report endpoint admits
   the chairperson role via the object-level guard).

   Known honest gaps inside ClassDetail (shared component, not editable
   here): the scoped attendance trend calls /principal/attendance-series
   and the timetable calls /timetable/class/{id} — both are school-scoped
   endpoints that 403 for a chairperson account, so those two blocks show
   their own "no data" states. The overview / subjects / students data all
   comes from the CP inspect payload. */
import ClassDetail from '../../Principal/dashboard/ClassDetail';
import { fetchCpClassInspect } from './data';

export default function CpClassPage({
  classId, classesAll = [], onBack, onOpenReport, savedIds, onBookmark,
}) {
  return (
    <ClassDetail
      classId={classId}
      classesAll={classesAll}
      fetcher={fetchCpClassInspect}
      embedded={false}
      backLabel="CHAIRPERSON DASHBOARD"
      onBack={onBack}
      onOpenReport={onOpenReport}
      savedIds={savedIds}
      onBookmark={onBookmark}
    />
  );
}
