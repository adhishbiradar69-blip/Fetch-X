/* Saved-students folder store for the admin console (v17). A thin wrapper
   over the Principal dashboard's localStorage folder system — the real
   storage lives in the shared util ('fx-folders' via loadFolders /
   saveFolders) and is NOT re-implemented here. The admin console therefore
   bookmarks into the same per-user folder list the principal console uses,
   which is the designer's intent: Saved is one list per person, not per
   role. Every mutation helper takes the current folders array and returns
   the NEXT array (already persisted) so the page can setFolders(next) in
   one step. */
import { loadFolders, saveFolders } from '../../Principal/dashboard/util';

export { loadFolders as loadStudentFolders };

/* id → Set — drives the sidebar .scount and which .bm buttons render .on */
export const savedIdsOf = (folders) => new Set(folders.flatMap((f) => f.studentIds));

export const createStudentFolder = (folders, name) => {
  const n = (name || '').trim();
  if (!n) return null;
  const next = [...folders, { id: `f${Date.now()}${Math.floor(Math.random() * 999)}`, name: n, studentIds: [] }];
  saveFolders(next);
  return next;
};

export const deleteStudentFolder = (folders, id) => {
  const next = folders.filter((f) => f.id !== id);
  saveFolders(next);
  return next;
};

export const toggleStudentInFolder = (folders, folderId, sid) => {
  const next = folders.map((f) => (
    f.id === folderId
      ? { ...f, studentIds: f.studentIds.includes(sid) ? f.studentIds.filter((x) => x !== sid) : [...f.studentIds, sid] }
      : f
  ));
  saveFolders(next);
  return next;
};
