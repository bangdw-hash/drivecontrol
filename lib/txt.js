// AHK 동반 txt 파일(UTF-8, CRLF, BOM 유지)을 읽고 쓰는 순수 함수 모음. 브라우저/Node 공용.

export function decodeBytes(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let off = 0, bom = false;
  if (u.length >= 3 && u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) { bom = true; off = 3; }
  return { bom, text: new TextDecoder('utf-8').decode(u.subarray(off)) };
}

export function parseDoc(buf) {
  const { bom, text } = decodeBytes(buf);
  const eol = text.includes('\r\n') ? '\r\n' : (text.includes('\n') ? '\n' : '\r\n');
  const lines = text.split(/\r\n|\n|\r/);
  let trailing = false;
  if (lines.length && lines[lines.length - 1] === '') { lines.pop(); trailing = true; }
  return { bom, eol, lines, trailing: trailing || lines.length === 0 };
}

export function emptyDoc(bom = true) { return { bom, eol: '\r\n', lines: [], trailing: true }; }

export function docToBytes(d) {
  const s = d.lines.join(d.eol) + (d.lines.length && d.trailing ? d.eol : '');
  const body = new TextEncoder().encode(s);
  if (!d.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xEF, 0xBB, 0xBF], 0); out.set(body, 3);
  return out;
}

const clone = (d, lines) => ({ ...d, lines });
const cleanLine = (l) => l.replace(/^\ufeff/, '').trim();

// ---------- 시간 ----------
export function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export function stampToDate(s) {
  if (!/^\d{14}$/.test(s || '')) return null;
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}

// ---------- 파일명 규칙 (filename_rules.txt) ----------
export function ruleEncode(t) {
  return '@TEXT@' + t.replace(/%/g, '%25').replace(/\|/g, '%7C').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
export function ruleDecode(t) {
  if (!t.startsWith('@TEXT@')) return t;
  return t.slice(6).replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%7C/g, '|').replace(/%25/g, '%');
}
export function ruleLine(name, cat, created, used, count) {
  return `${ruleEncode(name)}|${cat || ''}|${created || ''}|${used || ''}|${count || 0}`;
}
export function listRules(doc) {
  const out = [];
  doc.lines.forEach((raw, i) => {
    const t = cleanLine(raw);
    if (!t || t.startsWith(';')) return;
    const p = t.split('|');
    const name = ruleDecode((p[0] || '').trim());
    if (!name) return;
    const ok14 = (x) => (x && /^\d{14}$/.test(x.trim()) ? x.trim() : '');
    out.push({
      line: i, name, cat: (p[1] || '').trim(),
      created: ok14(p[2]), used: ok14(p[3]),
      count: p[4] && /^\d+$/.test(p[4].trim()) ? parseInt(p[4].trim(), 10) : 0,
    });
  });
  return out;
}
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
export function touchRule(doc, name, now = stamp()) {
  const it = listRules(doc).find((r) => sameName(r.name, name));
  if (!it) return doc;
  const lines = doc.lines.slice();
  lines[it.line] = ruleLine(it.name, it.cat, it.created, now, it.count + 1);
  return clone(doc, lines);
}
export function addRule(doc, name, cat = '', now = stamp()) {
  const it = listRules(doc).find((r) => sameName(r.name, name));
  if (it) return touchRule(doc, name, now);
  return clone(doc, [...doc.lines, ruleLine(name, cat, now, now, 1)]);
}
export function updateRule(doc, line, { name, cat }) {
  const it = listRules(doc).find((r) => r.line === line);
  if (!it) return doc;
  const lines = doc.lines.slice();
  lines[line] = ruleLine(name ?? it.name, cat ?? it.cat, it.created, it.used, it.count);
  return clone(doc, lines);
}
export function deleteRule(doc, line) {
  const lines = doc.lines.slice();
  lines.splice(line, 1);
  return clone(doc, lines);
}

// ---------- 고정 폴더 (folder_path.txt) ----------
export function parseFolderPath(doc) {
  const out = [];
  for (const raw of doc.lines) {
    const t = cleanLine(raw);
    if (!t || t.startsWith(';')) continue;
    const i = t.indexOf('|');
    if (i < 0) continue;
    out.push({ label: t.slice(0, i).trim(), path: t.slice(i + 1).trim() });
  }
  return out;
}
export function addFolderPath(doc, label, path) {
  return clone(doc, [...doc.lines, `${label}|${path}`]);
}

// ---------- 최근 폴더 (recent_folders.txt: 14자리|경로) ----------
export const pathKey = (p) => p.replace(/\\+$/, '').toLowerCase();
export function parseRecentFolders(doc) {
  const out = [];
  for (const raw of doc.lines) {
    const t = cleanLine(raw);
    const i = t.indexOf('|');
    if (i < 0) continue;
    const st = t.slice(0, i);
    if (!/^\d{14}$/.test(st)) continue;
    out.push({ stamp: st, path: t.slice(i + 1) });
  }
  return out;
}
export function addRecentFolder(doc, path, st = stamp()) {
  const map = new Map();
  for (const it of parseRecentFolders(doc)) {
    const k = pathKey(it.path);
    if (!map.has(k) || map.get(k).stamp < it.stamp) map.set(k, it);
  }
  const k = pathKey(path);
  if (!map.has(k) || map.get(k).stamp < st) map.set(k, { stamp: st, path });
  const list = [...map.values()].sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0)).slice(0, 1000);
  return clone(doc, list.map((x) => `${x.stamp}|${x.path}`));
}

// ---------- 최근 작업 파일 (recent_work_files.txt: 스탬프|출처|경로|그룹|처음|마지막|구성원) ----------
export function parseWorkFiles(doc) {
  const out = [];
  for (const raw of doc.lines) {
    const t = cleanLine(raw);
    const f = t.split('|');
    if (f.length < 3 || !/^\d{14}$/.test(f[0])) continue;
    out.push({ stamp: f[0], source: f[1], path: f[2] });
  }
  return out;
}
export function addWorkFiles(doc, entries, st = stamp()) {
  const keys = new Set(entries.map((e) => pathKey(e.path)));
  const kept = doc.lines.filter((raw) => {
    const f = cleanLine(raw).split('|');
    return !(f.length >= 3 && /^\d{14}$/.test(f[0]) && keys.has(pathKey(f[2])));
  });
  const fresh = entries.map((e) => `${st}|${e.source}|${e.path}||||`);
  return clone(doc, [...fresh, ...kept].slice(0, 2000));
}

// ---------- 고정 파일 (pinned_work_files.txt: 이름|경로) ----------
export function parsePins(doc) {
  const out = [];
  for (const raw of doc.lines) {
    const t = cleanLine(raw);
    const i = t.indexOf('|');
    if (i < 0) continue;
    out.push({ name: t.slice(0, i), path: t.slice(i + 1) });
  }
  return out;
}
export function addPin(doc, name, path) {
  if (parsePins(doc).some((p) => pathKey(p.path) === pathKey(path))) return doc;
  return clone(doc, [...doc.lines, `${name}|${path}`]);
}
export function removePin(doc, path) {
  return clone(doc, doc.lines.filter((raw) => {
    const t = cleanLine(raw); const i = t.indexOf('|');
    return !(i >= 0 && pathKey(t.slice(i + 1)) === pathKey(path));
  }));
}

// ---------- 경로 변환 ----------
export const DEFAULT_DRIVES = { G: 'google', W: 'naver' };
const OD_RE = /^[A-Za-z]:\\Users\\[^\\]+\\OneDrive(?: - [^\\]+)?(?:\\(.*))?$/i;

export function learnPcRoot(recents) {
  const cnt = new Map();
  for (const r of recents) {
    const m = /^([A-Za-z]:\\Users\\[^\\]+\\OneDrive(?: - [^\\]+)?)(?:\\|$)/i.exec(r.path);
    if (m) cnt.set(m[1], (cnt.get(m[1]) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [k, v] of cnt) if (v > n) { best = k; n = v; }
  return best;
}

export function expandPlaceholders(p, ctx = {}) {
  const user = ctx.user || (/^[A-Za-z]:\\Users\\([^\\]+)/i.exec(ctx.pcRoot || '') || [])[1] || '';
  const prof = user ? `C:\\Users\\${user}` : '';
  let s = p;
  if (ctx.pcRoot) s = s.replace(/\{Desktop\}/g, ctx.pcRoot + '\\Desktop');
  if (prof) s = s.replace(/\{Downloads\}/g, prof + '\\Downloads').replace(/%USERPROFILE%/gi, prof);
  if (ctx.ahkPc) s = s.replace(/\{ScriptDir\}/g, ctx.ahkPc);
  if (ctx.pcRoot) s = s.replace(/%OneDrive%/gi, ctx.pcRoot);
  return s;
}

// 반환: {kind:'onedrive',rel} | {kind:'google'|'naver'|'local', path}
export function classifyPath(p, ctx = {}) {
  const s = expandPlaceholders(p.trim(), ctx);
  const m = OD_RE.exec(s);
  if (m) return { kind: 'onedrive', rel: (m[1] || '').replace(/\\/g, '/').replace(/\/+$/, ''), path: s };
  const d = /^([A-Za-z]):\\/.exec(s);
  if (d) {
    const k = (ctx.drives || DEFAULT_DRIVES)[d[1].toUpperCase()];
    if (k) return { kind: k, path: s };
  }
  return { kind: 'local', path: s };
}

export function relToPc(rel, pcRoot) {
  return pcRoot + (rel ? '\\' + rel.split('/').join('\\') : '');
}

export function splitName(name) {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})$/.exec(name);
  return m && m[1] ? { base: m[1], ext: m[2] } : { base: name, ext: '' };
}
export function baseName(p) { return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop(); }
export function dirName(p) { const a = p.replace(/[\\/]+$/, '').split(/[\\/]/); a.pop(); return a.join(p.includes('\\') ? '\\' : '/'); }
export function sanitizeName(n) { return n.replace(/["*:<>?/\\|]/g, '_').replace(/[. ]+$/, '').trim(); }
export function normRel(s) {
  return s.replace(/\\/g, '/').split('/').map((x) => x.trim()).filter(Boolean).join('/');
}
// 이름 앞 첫 폴더의 한글/영문 별칭
export const ALIASES = [['Desktop', '바탕 화면'], ['Documents', '문서'], ['Pictures', '사진']];
export function relVariants(rel) {
  const parts = rel.split('/');
  const out = [rel];
  for (const g of ALIASES) {
    const i = g.findIndex((x) => x.toLowerCase() === (parts[0] || '').toLowerCase());
    if (i >= 0) for (const alt of g) if (alt !== parts[0]) out.push([alt, ...parts.slice(1)].join('/'));
  }
  return [...new Set(out)];
}
