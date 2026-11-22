// 설정(localStorage)과 공유받은 파일(IndexedDB) 저장소
const SKEY = 'dc.settings';
export function getSettings() { try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { return {}; } }
export function setSettings(patch) { const s = { ...getSettings(), ...patch }; localStorage.setItem(SKEY, JSON.stringify(s)); return s; }

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('drivecontrol', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('shares', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = async (mode, fn) => {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction('shares', mode); const st = t.objectStore('shares');
    const out = fn(st);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
};
export const putShare = (s) => tx('readwrite', (st) => st.put(s));
export const getShare = (id) => tx('readonly', (st) => st.get(id));
export const delShare = (id) => tx('readwrite', (st) => st.delete(id));
export async function pruneShares(maxAgeMs = 3 * 86400000) {
  const all = await tx('readonly', (st) => st.getAll());
  for (const s of all || []) if (Date.now() - s.at > maxAgeMs) await delShare(s.id);
}
