import * as T from './lib/txt.js';
import * as G from './lib/graph.js';
import * as S from './lib/store.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = {
  save: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5H5V6h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};
const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const TXT = { fixed: 'folder_path.txt', recent: 'recent_folders.txt', rules: 'filename_rules.txt', work: 'recent_work_files.txt', pins: 'pinned_work_files.txt' };

const st = {
  tab: 'save', settings: S.getSettings(), user: null, ahkDir: '', loading: false, loadedAt: 0, txt: {},
  share: null, items: [], active: 0, dest: '', pickedRule: {}, saveRules: {},
  rulesQ: '', rulesSort: 'used', worksQ: '', worksTab: 'recent', worksExt: 'all', worksOpen: '', worksMore: 150,
  done: null, busy: false,
};

// ---------- 유틸 ----------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }
async function copy(text, msg = '복사했습니다') {
  try { await navigator.clipboard.writeText(text); }
  catch { const a = document.createElement('textarea'); a.value = text; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast(msg);
}
const tokens = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matchAll = (hay, q) => { const h = hay.toLowerCase(); return tokens(q).every((t) => h.includes(t)); };
function fmtStamp(s) {
  const d = T.stampToDate(s); if (!d) return '';
  const now = new Date(), p = (n) => String(n).padStart(2, '0');
  const same = d.toDateString() === now.toDateString();
  return same ? `오늘 ${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');

// ---------- 파생 데이터 ----------
const doc = (k) => st.txt[k]?.doc;
const rules = () => (doc('rules') ? T.listRules(doc('rules')) : []);
const recents = () => (doc('recent') ? T.parseRecentFolders(doc('recent')) : []);
const pcRoot = () => (st.settings.pcRoot || T.learnPcRoot(recents()) || '').replace(/\\+$/, '');
const ctx = () => ({ pcRoot: pcRoot(), ahkPc: pcRoot() && st.ahkDir ? T.relToPc(st.ahkDir, pcRoot()) : '' });
const classify = (p) => T.classifyPath(p, ctx());
function fixedDirs() {
  return doc('fixed') ? T.parseFolderPath(doc('fixed')).map((f) => ({ ...f, ...classify(f.path) })) : [];
}
function destSuggestions(q) {
  const seen = new Set(), out = [];
  const add = (rel, label) => { if (!rel || seen.has(rel.toLowerCase())) return; seen.add(rel.toLowerCase()); out.push({ rel, label }); };
  for (const f of fixedDirs()) if (f.kind === 'onedrive') add(f.rel, f.label);
  for (const r of recents()) { const c = classify(r.path); if (c.kind === 'onedrive') add(c.rel); }
  const list = q ? out.filter((o) => matchAll(o.rel + ' ' + (o.label || ''), q)) : out;
  return list.slice(0, 6);
}
function destInfo() {
  const v = st.dest.trim();
  if (!v) return { rel: '', pc: pcRoot() };
  if (/^[A-Za-z]:\\/.test(v) || v.startsWith('{') || v.startsWith('%')) {
    const c = classify(v);
    if (c.kind !== 'onedrive') return { err: { google: '구글 드라이브', naver: '네이버웍스', local: 'PC 로컬' }[c.kind] + ' 경로에는 저장할 수 없습니다. (경로 복사만 가능)' };
    return { rel: c.rel };
  }
  return { rel: T.normRel(v) };
}

// ---------- 데이터 읽기/쓰기 ----------
async function readTxt(key) {
  const it = await G.getItem(st.ahkDir + '/' + TXT[key]);
  if (!it) return (st.txt[key] = { doc: T.emptyDoc(true), etag: null, id: null, missing: true });
  const buf = await G.downloadById(it.id);
  return (st.txt[key] = { doc: T.parseDoc(buf), etag: it.eTag, id: it.id });
}
async function writeTxt(key, mutate) {
  if (!st.ahkDir) throw new Error('AHK 폴더를 찾지 못했습니다. [설정]에서 지정하세요.');
  for (let i = 0; i < 3; i++) {
    const cur = st.txt[key] || await readTxt(key);
    const nd = mutate(cur.doc);
    if (nd === cur.doc) return;
    try {
      const r = await G.putText(st.ahkDir + '/' + TXT[key], T.docToBytes(nd), cur.id ? { id: cur.id, etag: cur.etag } : null);
      st.txt[key] = { doc: nd, etag: r.eTag, id: r.id };
      return;
    } catch (e) {
      if (e.status === 412 || e.status === 409) { await readTxt(key); continue; }
      throw e;
    }
  }
  throw new Error('다른 기기에서 동시에 수정 중입니다. 잠시 후 다시 시도하세요.');
}
async function findAhkDir() {
  const names = [TXT.rules, TXT.fixed, TXT.recent];
  const cands = [...new Set([st.settings.ahkDir, 'Desktop/AHK', '바탕 화면/AHK', 'AHK', 'Documents/AHK', '문서/AHK'].filter(Boolean))];
  for (const c of cands) {
    const r = await Promise.all(names.map((n) => G.getItem(c + '/' + n).catch(() => null)));
    if (r.some(Boolean)) return c;
  }
  return '';
}
async function loadData() {
  if (!G.isLoggedIn() || st.loading) return;
  st.loading = true; render();
  try {
    if (!st.user) st.user = await G.me().catch(() => null);
    st.ahkDir = await findAhkDir();
    if (st.ahkDir) await Promise.all(Object.keys(TXT).map((k) => readTxt(k)));
    st.loadedAt = Date.now();
  } catch (e) { handleErr(e); }
  st.loading = false; render();
}
function handleErr(e) {
  console.error(e);
  if (e.code === 'login_required') { toast('로그인이 만료되었습니다. [설정]에서 다시 로그인하세요.'); return; }
  toast(e.message || '오류가 발생했습니다');
}
async function resolveFolderRel(rel) {
  if (!rel) return '';
  const first = rel.split('/')[0];
  for (const v of T.relVariants(first)) { if (await G.getItem(v)) return [v, ...rel.split('/').slice(1)].join('/'); }
  return rel;
}
async function resolveItem(rel) {
  for (const v of T.relVariants(rel)) { const it = await G.getItem(v); if (it) return it; }
  return null;
}

// ---------- 화면 ----------
const head = (t, sub = '') => `<header class="top"><h1>${t}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
const tabs = () => `<nav class="tabs" aria-label="메뉴">${[['save', '저장', 'save'], ['rules', '파일명', 'tag'], ['files', '파일', 'folder'], ['settings', '설정', 'gear']]
  .map(([k, t, i]) => `<button data-act="tab" data-t="${k}" class="${st.tab === k || (k === 'save' && st.tab === 'done') ? 'on' : ''}">${ic(i)}<span>${t}</span></button>`).join('')}</nav>`;

function render() {
  const v = { save: viewSave, done: viewDone, rules: viewRules, files: viewFiles, settings: viewSettings }[st.tab]();
  $('#app').innerHTML = v + tabs();
  if (st.tab === 'save') updateSuggest();
}

function loginCard() {
  if (!G.clientId()) return `<div class="card"><p class="lbl">처음 한 번 설정이 필요합니다</p><p class="small">[설정] 탭에서 Azure 앱의 Client ID를 입력하세요. 안내가 거기에 있습니다.</p><button class="btn p" data-act="tab" data-t="settings">설정으로 이동</button></div>`;
  if (!G.isLoggedIn()) return `<div class="card"><p class="lbl">OneDrive 로그인이 필요합니다</p><button class="btn p" data-act="login">Microsoft 계정으로 로그인</button></div>`;
  return '';
}

function viewSave() {
  const sub = st.user ? `OneDrive · ${esc(st.user.userPrincipalName || st.user.displayName)}` : 'OneDrive에 저장';
  const lc = loginCard();
  const items = st.items.map((it, i) => `
    <div class="card">
      <div class="row" style="flex-wrap:nowrap;align-items:center;margin-bottom:8px">
        <div class="small" style="flex:1;word-break:break-all">${esc(it.orig)} · ${fmtSize(it.file.size)}</div>
        <button class="ibtn" data-act="rmItem" data-i="${i}" aria-label="목록에서 빼기">✕</button>
      </div>
      <p class="lbl">파일명 (${esc(it.ext || '확장자 없음')} 유지)</p>
      <div class="row" style="flex-wrap:nowrap;align-items:center"><input type="text" data-in="name" data-i="${i}" value="${esc(it.base)}" autocomplete="off"><span class="small">${esc(it.ext)}</span></div>
      <div class="row" style="margin-top:8px">${rules().slice().sort((a, b) => (b.used > a.used ? 1 : -1)).slice(0, 5).map((r) =>
        `<button class="chip" data-act="useRule" data-i="${i}" data-n="${esc(r.name)}">${esc(r.name.length > 14 ? r.name.slice(0, 14) + '…' : r.name)}</button>`).join('')}
        <button class="chip" data-act="ruleList" data-i="${i}">${ic('search').replace('class="ic"', 'class="ic" style="width:14px;height:14px"')}&nbsp;규칙 전체</button>
        <button class="chip ${st.saveRules[i] ? 'on' : ''}" data-act="saveRuleToggle" data-i="${i}">+ 규칙으로 저장</button></div>
    </div>`).join('');
  const empty = `<div class="card"><p class="lbl">저장할 파일이 없습니다</p><p class="small">다른 앱에서 [공유] → Drive Control을 누르거나, 아래에서 직접 선택하세요.</p>
    <button class="btn" data-act="pick">${ic('plus')}파일 선택</button><input id="pick" type="file" multiple hidden></div>`;
  const dir = fixedDirs().filter((f) => f.kind === 'onedrive');
  const info = destInfo();
  const pcPrev = info.err ? `<span class="err">${esc(info.err)}</span>` : (pcRoot() ? esc(T.relToPc(info.rel, pcRoot())) : 'OneDrive/' + esc(info.rel));
  return head('Drive Control', sub) + `<main>${lc}${st.items.length ? items : empty}
    ${st.items.length ? `<div class="card">
      <p class="lbl">저장 위치 (OneDrive)</p>
      <input type="text" id="dest" data-in="dest" value="${esc(st.dest)}" placeholder="예: Desktop/AHK  또는  C:\\Users\\…\\OneDrive\\…" autocomplete="off" autocapitalize="off">
      <div class="small mono" id="pcprev" style="margin:6px 2px">PC 경로: ${pcPrev}</div>
      <div class="row">${dir.map((f) => `<button class="chip ${T.normRel(st.dest) === f.rel ? 'on' : ''}" data-act="setDest" data-r="${esc(f.rel)}">${esc(f.label)}</button>`).join('')}
        <button class="chip" data-act="browse">${ic('folder').replace('class="ic"', 'class="ic" style="width:14px;height:14px"')}&nbsp;폴더 찾아보기</button></div>
      <div class="sugg" id="sugg"></div></div>` : ''}
    ${st.loading ? '<p class="small">txt 불러오는 중…</p>' : (G.isLoggedIn() && !st.ahkDir ? '<p class="small warn">AHK 폴더를 찾지 못해 최근/규칙 목록이 비어 있습니다. [설정]에서 폴더를 지정하세요.</p>' : '')}
  </main>${st.items.length ? `<div style="padding:10px 16px;background:#fff;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px">
      <button class="btn p" data-act="save" ${st.busy ? 'disabled' : ''}>${ic('save')}OneDrive에 저장</button>
      <div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="copyDest">${ic('copy')}경로만 복사</button><button class="btn sm" data-act="copyDestPc">${ic('copy')}PC형 경로 복사</button></div></div>` : ''}`;
}

function updateSuggest() {
  const box = $('#sugg'); if (!box) return;
  const l = destSuggestions(st.dest);
  box.innerHTML = l.map((s) => `<button data-act="setDest" data-r="${esc(s.rel)}">${esc(s.rel)}${s.label ? ` <span class="small">· ${esc(s.label)}</span>` : ''}</button>`).join('');
}

function viewDone() {
  const d = st.done;
  const paths = d.files.map((f) => (d.rel ? d.rel + '/' : '') + f.name);
  const pcs = d.files.map((f) => (pcRoot() ? T.relToPc(d.rel, pcRoot()) + '\\' + f.name : ''));
  return head('Drive Control', 'OneDrive에 저장') + `<main>
    <div style="text-align:center;padding:8px 0"><div style="width:64px;height:64px;border-radius:32px;background:#E3F4EA;color:var(--ok);display:inline-flex;align-items:center;justify-content:center"><svg class="ic" style="width:34px;height:34px" viewBox="0 0 24 24">${ICONS.check}</svg></div>
      <h2 style="margin:8px 0 2px">저장했습니다</h2><div class="small">${d.files.length}개 파일</div></div>
    <div class="card"><div class="small" style="margin-bottom:6px">저장된 경로</div><div class="mono" style="font-size:14px;line-height:1.6">${paths.map(esc).join('<br>')}</div>
      ${pcs[0] ? `<div class="sp"></div><div class="small">PC형</div><div class="mono small" style="line-height:1.6">${pcs.map(esc).join('<br>')}</div>` : ''}</div>
    <div class="card small">${d.log.map((l) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>${esc(l.name)}</span><span class="${l.ok ? 'ok' : 'err'}">${esc(l.msg)}</span></div>`).join('')}</div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:8px">
      <button class="btn p" data-act="copyDone">${ic('copy')}경로 복사</button>
      <div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="copyDonePc">${ic('copy')}PC형 복사</button><button class="btn sm" data-act="copyDoneLink">${ic('link')}링크 복사</button></div>
      <div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="openDone">${ic('open')}파일 열기</button><button class="btn sm" data-act="newSave">새 파일</button></div>
    </div></main>`;
}

function viewRules() {
  let l = rules();
  if (st.rulesQ) l = l.filter((r) => matchAll(r.name + ' ' + r.cat, st.rulesQ));
  const cmp = { used: (a, b) => (b.used > a.used ? 1 : b.used < a.used ? -1 : 0), name: (a, b) => a.name.localeCompare(b.name, 'ko'), count: (a, b) => b.count - a.count }[st.rulesSort];
  l = l.slice().sort(cmp).slice(0, 200);
  return head('파일명 규칙', 'F2+N · filename_rules.txt') + `<main>
    <input type="search" data-in="rulesQ" value="${esc(st.rulesQ)}" placeholder="이름 검색" autocomplete="off">
    <div class="seg">${[['used', '최근 사용'], ['name', '이름순'], ['count', '많이 사용']].map(([k, t]) => `<button data-act="rulesSort" data-k="${k}" class="${st.rulesSort === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div id="rulelist" style="display:flex;flex-direction:column;gap:8px">${ruleRows(l)}</div>
    ${!doc('rules') ? '<p class="small">로그인 후 불러옵니다.</p>' : ''}</main>
    <button class="fab" data-act="ruleNew">${ic('plus')}새 이름 저장</button>`;
}
function ruleRows(l) {
  return l.map((r) => `<div class="item"><div class="row" style="flex-wrap:nowrap;align-items:flex-start"><div style="flex:1;min-width:0"><div class="t">${esc(r.name)}</div>
    <div class="s">${esc(r.cat || '분류 없음')} · ${fmtStamp(r.used) || '-'} · ${r.count}회</div></div>
    <button class="ibtn" data-act="ruleCopy" data-l="${r.line}" aria-label="복사">${ic('copy')}</button><button class="ibtn" data-act="ruleEdit" data-l="${r.line}" aria-label="편집">${ic('edit')}</button></div></div>`).join('') || '<p class="small">결과가 없습니다.</p>';
}

const EXT = { doc: ['doc', 'docx', 'hwp', 'hwpx', 'txt', 'ppt', 'pptx'], pdf: ['pdf'], xls: ['xls', 'xlsx', 'xlsm', 'csv'], img: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] };
function worksList() {
  const d = doc(st.worksTab === 'recent' ? 'work' : 'pins'); if (!d) return [];
  let l = st.worksTab === 'recent' ? T.parseWorkFiles(d).map((x) => ({ path: x.path, name: T.baseName(x.path), source: x.source, stamp: x.stamp }))
    : T.parsePins(d).map((p) => ({ path: p.path, name: p.name || T.baseName(p.path), source: '고정', stamp: '' }));
  if (st.worksQ) l = l.filter((x) => matchAll(x.path, st.worksQ));
  if (st.worksExt !== 'all') l = l.filter((x) => { const e = (T.splitName(x.name).ext || '').slice(1).toLowerCase(); return st.worksExt === 'etc' ? !Object.values(EXT).flat().includes(e) : EXT[st.worksExt].includes(e); });
  return l;
}
const KIND = { onedrive: ['OneDrive', ''], google: ['구글 드라이브', 'w'], naver: ['네이버웍스', 'w'], local: ['PC 전용', 'w'] };
function viewFiles() {
  const all = worksList(), l = all.slice(0, st.worksMore);
  const pins = doc('pins') ? T.parsePins(doc('pins')) : [];
  const rows = l.map((x) => {
    const c = classify(x.path), k = KIND[c.kind], key = T.pathKey(x.path), open = st.worksOpen === key;
    const pinned = pins.some((p) => T.pathKey(p.path) === key);
    const acts = !open ? '' : `<div class="row" style="margin-top:10px">
      ${c.kind === 'onedrive' ? `<button class="btn sm p" data-act="fOpen" data-p="${esc(x.path)}">${ic('open')}열기</button><button class="btn sm" data-act="fLink" data-p="${esc(x.path)}">${ic('link')}링크</button>` : ''}
      <button class="btn sm" data-act="fCopy" data-p="${esc(x.path)}">${ic('copy')}경로</button>
      <button class="btn sm" data-act="fCopyDir" data-p="${esc(x.path)}">${ic('copy')}폴더</button>
      <button class="btn sm" data-act="fPin" data-p="${esc(x.path)}" data-n="${esc(x.name)}">${pinned ? '고정 해제' : '고정'}</button></div>
      ${c.kind !== 'onedrive' ? `<div class="small warn" style="margin-top:8px">${c.kind === 'google' ? '구글 드라이브' : c.kind === 'naver' ? '네이버웍스' : 'PC'} 파일이라 폰에서 열 수 없고 경로 복사만 가능합니다.</div>` : ''}`;
    return `<div class="item ${open ? 'open' : ''}" data-act="fToggle" data-k="${esc(key)}"><div class="row" style="flex-wrap:nowrap;justify-content:space-between;gap:8px"><div class="t" style="font-weight:700">${esc(x.name)}</div><span class="badge ${k[1]}">${k[0]}</span></div>
      <div class="s">${esc(T.dirName(x.path))}</div><div class="s">${esc(x.source)}${x.stamp ? ' · ' + fmtStamp(x.stamp) : ''}</div>${acts}</div>`;
  }).join('');
  return head('파일 조회', 'F2+F · recent_work_files.txt') + `<main>
    <div class="seg"><button data-act="worksTab" data-k="recent" class="${st.worksTab === 'recent' ? 'on' : ''}">최근 파일</button><button data-act="worksTab" data-k="pins" class="${st.worksTab === 'pins' ? 'on' : ''}">고정 파일</button></div>
    <input type="search" data-in="worksQ" value="${esc(st.worksQ)}" placeholder="파일 이름·경로 검색" autocomplete="off">
    <div class="row">${[['all', '전체'], ['doc', '문서'], ['pdf', 'PDF'], ['xls', '엑셀'], ['img', '사진'], ['etc', '기타']].map(([k, t]) => `<button class="chip ${st.worksExt === k ? 'on' : ''}" data-act="worksExt" data-k="${k}">${t}</button>`).join('')}</div>
    <div id="worklist" style="display:flex;flex-direction:column;gap:8px">${rows || '<p class="small">결과가 없습니다.</p>'}${all.length > l.length ? `<button class="btn" data-act="more">더 보기 (${all.length - l.length}개)</button>` : ''}</div></main>`;
}

function viewSettings() {
  const cid = G.clientId();
  const row = (a, b, c = '') => `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)"><div><div style="font-weight:700;font-size:14px">${a}</div><div class="small">${b}</div></div><div class="small ${c}" style="text-align:right">${''}</div></div>`;
  return head('설정', '연결과 동기화') + `<main>
    <div class="card"><p class="lbl">1. Azure 앱 (Client ID)</p>
      <input type="text" data-in="clientId" value="${esc(st.settings.clientId || '')}" placeholder="애플리케이션(클라이언트) ID" autocomplete="off" autocapitalize="off">
      <details style="margin-top:8px"><summary class="small" style="min-height:32px">등록 방법 보기</summary><ol class="small" style="padding-left:18px;line-height:1.7">
        <li>PC 브라우저에서 entra.microsoft.com → 앱 등록 → 새 등록</li>
        <li>지원 계정: "모든 조직 디렉터리 및 개인 Microsoft 계정"</li>
        <li>리디렉션 URI: <b>단일 페이지 애플리케이션(SPA)</b> 으로 아래 주소 입력</li>
        <li>등록 후 "애플리케이션(클라이언트) ID"를 위 칸에 입력</li></ol>
        <div class="mono small" style="background:var(--bg);padding:8px;border-radius:8px">${esc(G.baseUrl())}</div>
        <button class="btn sm" style="margin-top:8px" data-act="copyRedirect">${ic('copy')}주소 복사</button></details></div>
    <div class="card"><p class="lbl">2. OneDrive 로그인</p>
      <div class="small" style="margin-bottom:8px">${G.isLoggedIn() ? `<span class="ok">연결됨</span> · ${esc(st.user?.userPrincipalName || '')}` : '연결 안 됨'}</div>
      ${G.isLoggedIn() ? `<div class="row"><button class="btn sm" data-act="login">다른 계정으로 다시 로그인</button><button class="btn sm d" data-act="logout">로그아웃</button></div>` : `<button class="btn p" data-act="login" ${cid ? '' : 'disabled'}>Microsoft 계정으로 로그인</button>`}
      <p class="small" style="margin-bottom:0">로그인은 하루 이상 쓰지 않으면 다시 해야 할 수 있습니다.</p></div>
    <div class="card"><p class="lbl">3. PC 연동 (AHK txt)</p>
      <div class="small" style="line-height:1.9">AHK 폴더: <b class="mono">${esc(st.ahkDir ? 'OneDrive/' + st.ahkDir : '못 찾음')}</b><br>PC의 OneDrive 경로: <b class="mono">${esc(pcRoot() || '못 찾음')}</b><br>마지막 동기화: ${st.loadedAt ? fmtStamp(T.stamp(new Date(st.loadedAt))) : '-'}</div>
      <div class="sp"></div>
      <input type="text" data-in="ahkDir" value="${esc(st.settings.ahkDir || '')}" placeholder="AHK 폴더 직접 지정 (예: 바탕 화면/AHK)" autocomplete="off">
      <input type="text" data-in="pcRoot" style="margin-top:8px" value="${esc(st.settings.pcRoot || '')}" placeholder="PC OneDrive 경로 직접 지정 (예: C:\\Users\\bangd\\OneDrive)" autocomplete="off">
      <button class="btn" style="margin-top:8px" data-act="reload">${st.loading ? '불러오는 중…' : 'txt 다시 읽기'}</button></div>
    <div class="card"><p class="lbl">PC 경로 변환</p><div class="mono small" style="line-height:1.9">…\\OneDrive\\… → OneDrive (저장·열기 가능)<br>G:\\ → 구글 드라이브 (경로 복사만)<br>W:\\ → 네이버웍스 (경로 복사만)<br>그 외 C:\\ D:\\ → PC 전용 (경로 복사만)</div>
      <div class="sp"></div><div class="small">같은 이름 파일이 있으면 항상 먼저 묻습니다. (덮어쓰기 / 다른 이름 / 취소)</div></div></main>`;
}

// ---------- 모달 ----------
const modal = (h, sticky = false) => { $('#modal').innerHTML = `<div class="sheetbg" ${sticky ? '' : 'data-act="modalBg"'}><div class="sheet" role="dialog">${h}</div></div>`; };
const closeModal = () => { $('#modal').innerHTML = ''; };

function ruleSheet(i) {
  const l = rules().slice().sort((a, b) => (b.used > a.used ? 1 : -1)).slice(0, 100);
  modal(`<h2>파일명 규칙</h2><input type="search" id="rq" data-in="rq" data-i="${i}" placeholder="검색" autocomplete="off">
    <div id="rqlist" style="display:flex;flex-direction:column;gap:6px">${l.map((r) => `<button class="item t" style="text-align:left;font:inherit;font-size:14px" data-act="useRule" data-i="${i}" data-n="${esc(r.name)}">${esc(r.name)}</button>`).join('')}</div>
    <button class="btn" data-act="closeModal">닫기</button>`);
}
function ruleEditSheet(line) {
  const r = line == null ? { name: '', cat: '' } : rules().find((x) => x.line === line);
  modal(`<h2>${line == null ? '새 파일명 저장' : '파일명 편집'}</h2>
    <textarea id="rname" rows="3" placeholder="파일명(확장자 제외)">${esc(r.name)}</textarea>
    <input type="text" id="rcat" value="${esc(r.cat)}" placeholder="분류 (선택)">
    <button class="btn p" data-act="ruleSave" data-l="${line ?? ''}">저장</button>
    ${line != null ? `<button class="btn d" data-act="ruleDel" data-l="${line}">삭제</button>` : ''}
    <button class="btn" data-act="closeModal">취소</button>`);
}
async function browseSheet(rel) {
  modal(`<h2>폴더 찾아보기</h2><div class="small mono">OneDrive/${esc(rel)}</div><div id="blist" class="small">불러오는 중…</div>`);
  try {
    const l = await G.listChildren(rel, true);
    const up = rel ? rel.split('/').slice(0, -1).join('/') : null;
    $('#modal .sheet').innerHTML = `<h2>폴더 찾아보기</h2><div class="small mono">OneDrive/${esc(rel)}</div>
      <button class="btn p" data-act="browsePick" data-r="${esc(rel)}">이 폴더 선택</button>
      <div style="display:flex;flex-direction:column;gap:6px">${up !== null ? `<button class="item t" style="text-align:left;font:inherit" data-act="browseGo" data-r="${esc(up)}">⬆ 상위 폴더</button>` : ''}
      ${l.map((f) => `<button class="item t" style="text-align:left;font:inherit" data-act="browseGo" data-r="${esc(rel ? rel + '/' + f.name : f.name)}">📁 ${esc(f.name)}</button>`).join('') || '<p class="small">하위 폴더가 없습니다.</p>'}</div>
      <button class="btn" data-act="closeModal">닫기</button>`;
  } catch (e) { closeModal(); handleErr(e); }
}
function askConflict(name, ex, file) {
  return new Promise((res) => {
    modal(`<h2>같은 이름의 파일이 있습니다</h2><div class="mono" style="background:var(--bg);padding:10px;border-radius:10px;font-size:13px">${esc(name)}</div>
      <div class="small" style="line-height:1.7">기존: ${esc((ex.lastModifiedDateTime || '').slice(0, 16).replace('T', ' '))} · ${fmtSize(ex.size || 0)}<br>새 파일: ${fmtSize(file.size)}</div>
      <label class="small"><input type="checkbox" id="cAll"> 남은 파일에도 같은 선택 적용</label>
      <button class="btn d" data-c="overwrite">덮어쓰기</button><button class="btn p" data-c="rename">다른 이름으로 저장</button><button class="btn" data-c="cancel">취소</button>`, true);
    $('#modal').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; $('#modal').onclick = null; const all = $('#cAll')?.checked; closeModal(); res({ v: b.dataset.c, all }); };
  });
}
function progress(text, f = 0) {
  if (!$('#pbar')) modal(`<h2 id="ptxt"></h2><div class="bar"><i id="pbar"></i></div>`, true);
  $('#ptxt').textContent = text; $('#pbar').style.width = Math.round(f * 100) + '%';
}

// ---------- 동작 ----------
async function freeName(rel, name) {
  const { base, ext } = T.splitName(name);
  for (let n = 1; n < 100; n++) { const c = `${base} (${n})${ext}`; if (!await G.getItem((rel ? rel + '/' : '') + c)) return c; }
  return `${base}_${Date.now()}${ext}`;
}

async function doSave() {
  if (st.busy) return;
  if (!G.isLoggedIn()) { toast('먼저 OneDrive에 로그인하세요'); return; }
  const info = destInfo(); if (info.err) { toast(info.err); return; }
  const files = st.items.map((it) => ({ it, name: T.sanitizeName(it.base) + it.ext }));
  if (files.some((f) => !T.sanitizeName(f.it.base))) { toast('파일명을 입력하세요'); return; }
  st.busy = true;
  try {
    progress('확인 중…');
    const rel = await resolveFolderRel(info.rel);
    const saved = [], log = []; let all = null;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; let name = f.name, conflict = 'fail';
      const full = (n) => (rel ? rel + '/' : '') + n;
      const ex = await G.getItem(full(name));
      if (ex) {
        const c = all || await askConflict(name, ex, f.it.file);
        if (c.all) all = c;
        if (c.v === 'cancel') { log.push({ name, ok: false, msg: '취소' }); continue; }
        if (c.v === 'rename') name = await freeName(rel, name); else conflict = 'replace';
        progress(`업로드 중 ${i + 1}/${files.length}`);
      }
      progress(`업로드 중 ${i + 1}/${files.length} · ${name}`, 0);
      const r = await G.upload(full(name), f.it.file, conflict, (p) => progress(`업로드 중 ${i + 1}/${files.length} · ${name}`, p));
      saved.push({ name, webUrl: r?.webUrl, id: r?.id, base: f.it.base });
      log.push({ name, ok: true, msg: conflict === 'replace' ? '덮어씀' : '저장됨' });
    }
    if (!saved.length) { closeModal(); toast('저장하지 않았습니다'); st.busy = false; return; }
    // PC 공유 txt 갱신 (실패해도 업로드는 유효)
    progress('PC 기록 갱신 중…', 1);
    const root = pcRoot();
    if (st.ahkDir && root) {
      const pcDir = T.relToPc(rel, root);
      const tryW = async (label, key, fn) => { try { await writeTxt(key, fn); log.push({ name: label, ok: true, msg: '갱신' }); } catch (e) { log.push({ name: label, ok: false, msg: '실패' }); console.error(e); } };
      await tryW(TXT.recent, 'recent', (d) => T.addRecentFolder(d, pcDir));
      await tryW(TXT.work, 'work', (d) => T.addWorkFiles(d, saved.map((s) => ({ path: pcDir + '\\' + s.name, source: '모바일 저장' }))));
      const used = saved.map((s) => s.base).filter((b) => rules().some((r) => r.name.toLowerCase() === b.toLowerCase()));
      const adds = files.map((f, i) => (st.saveRules[i] ? f.it.base : null)).filter(Boolean);
      if (used.length || adds.length) await tryW(TXT.rules, 'rules', (d) => { let x = d; for (const n of used) x = T.touchRule(x, n); for (const n of adds) x = T.addRule(x, n); return x; });
    } else log.push({ name: 'PC 기록', ok: false, msg: st.ahkDir ? 'PC 경로 모름' : 'AHK 폴더 없음' });
    closeModal();
    if (st.share) { S.delShare(st.share.id).catch(() => {}); st.share = null; }
    st.done = { rel, files: saved, log };
    st.tab = 'done'; st.items = []; st.saveRules = {};
  } catch (e) { closeModal(); handleErr(e); }
  st.busy = false; render();
}

function setItemsFromFiles(files) {
  st.items = [...files].map((f) => { const n = T.splitName(f.name || 'file'); return { file: f.blob || f, orig: f.name, base: n.base, ext: n.ext }; });
  st.active = 0;
}

const H = {
  tab: (d) => { st.tab = d.t; render(); if (d.t !== 'settings' && G.isLoggedIn() && Date.now() - st.loadedAt > 60000) loadData(); },
  login: () => { if (st.share) localStorage.setItem('dc.pendingShare', st.share.id); G.login().catch(handleErr); },
  logout: () => { G.logout(); st.user = null; st.txt = {}; st.ahkDir = ''; render(); },
  pick: () => { const p = $('#pick'); p.onchange = () => { setItemsFromFiles(p.files); render(); }; p.click(); },
  rmItem: (d) => { st.items.splice(+d.i, 1); render(); },
  useRule: (d) => { st.items[+d.i].base = d.n; closeModal(); render(); },
  ruleList: (d) => ruleSheet(+d.i),
  saveRuleToggle: (d) => { st.saveRules[d.i] = !st.saveRules[d.i]; render(); },
  setDest: (d) => { st.dest = d.r; render(); },
  browse: () => browseSheet(T.normRel(st.dest)),
  browseGo: (d) => browseSheet(d.r),
  browsePick: (d) => { st.dest = d.r; closeModal(); render(); },
  save: doSave,
  copyDest: () => { const i = destInfo(); if (i.err) return toast(i.err); copy(st.items.map((it) => (i.rel ? i.rel + '/' : '') + T.sanitizeName(it.base) + it.ext).join('\n')); },
  copyDestPc: () => { const i = destInfo(); if (i.err) return toast(i.err); if (!pcRoot()) return toast('PC OneDrive 경로를 모릅니다'); copy(st.items.map((it) => T.relToPc(i.rel, pcRoot()) + '\\' + T.sanitizeName(it.base) + it.ext).join('\n')); },
  copyDone: () => copy(st.done.files.map((f) => (st.done.rel ? st.done.rel + '/' : '') + f.name).join('\n')),
  copyDonePc: () => (pcRoot() ? copy(st.done.files.map((f) => T.relToPc(st.done.rel, pcRoot()) + '\\' + f.name).join('\n')) : toast('PC OneDrive 경로를 모릅니다')),
  copyDoneLink: () => copy(st.done.files.map((f) => f.webUrl).filter(Boolean).join('\n') || '', '링크를 복사했습니다'),
  openDone: () => { const u = st.done.files[0]?.webUrl; if (u) window.open(u, '_blank'); },
  newSave: () => { st.tab = 'save'; st.done = null; st.dest = ''; render(); },
  rulesSort: (d) => { st.rulesSort = d.k; render(); },
  ruleCopy: (d) => copy(rules().find((r) => r.line === +d.l).name),
  ruleEdit: (d) => ruleEditSheet(+d.l),
  ruleNew: () => ruleEditSheet(null),
  ruleSave: async (d) => {
    const name = $('#rname').value.replace(/\r?\n/g, ' ').trim(), cat = $('#rcat').value.trim();
    if (!name) return toast('이름을 입력하세요');
    try { await writeTxt('rules', (x) => (d.l === '' ? T.addRule(x, name, cat) : T.updateRule(x, +d.l, { name, cat }))); closeModal(); toast('저장했습니다'); render(); } catch (e) { handleErr(e); }
  },
  ruleDel: async (d) => { if (!confirm('삭제할까요?')) return; try { await writeTxt('rules', (x) => T.deleteRule(x, +d.l)); closeModal(); render(); } catch (e) { handleErr(e); } },
  worksTab: (d) => { st.worksTab = d.k; st.worksMore = 150; render(); },
  worksExt: (d) => { st.worksExt = d.k; st.worksMore = 150; render(); },
  more: () => { st.worksMore += 150; render(); },
  fToggle: (d, el, ev) => { if (ev.target.closest('button')) return; st.worksOpen = st.worksOpen === d.k ? '' : d.k; render(); },
  fCopy: (d) => copy(d.p),
  fCopyDir: (d) => copy(T.dirName(d.p)),
  fOpen: async (d) => { const c = classify(d.p); try { const it = await resolveItem(c.rel); if (!it) return toast('OneDrive에서 찾지 못했습니다 (동기화 전이거나 이동됨)'); window.open(it.webUrl, '_blank'); } catch (e) { handleErr(e); } },
  fLink: async (d) => { const c = classify(d.p); try { const it = await resolveItem(c.rel); if (!it) return toast('OneDrive에서 찾지 못했습니다'); copy(it.webUrl, '링크를 복사했습니다'); } catch (e) { handleErr(e); } },
  fPin: async (d) => {
    const pinned = doc('pins') && T.parsePins(doc('pins')).some((p) => T.pathKey(p.path) === T.pathKey(d.p));
    try { await writeTxt('pins', (x) => (pinned ? T.removePin(x, d.p) : T.addPin(x, d.n, d.p))); toast(pinned ? '고정 해제' : '고정했습니다'); render(); } catch (e) { handleErr(e); }
  },
  copyRedirect: () => copy(G.baseUrl()),
  reload: () => { st.txt = {}; loadData(); },
  closeModal: () => closeModal(),
  modalBg: (d, el, ev) => { if (ev.target === el) closeModal(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const h = H[el.dataset.act]; if (h) h(el.dataset, el, e);
});
let inT;
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-in]'); if (!el) return;
  const k = el.dataset.in, v = el.value;
  if (k === 'name') { st.items[+el.dataset.i].base = v; st.active = +el.dataset.i; }
  else if (k === 'dest') { st.dest = v; updateSuggest(); const i = destInfo(); const p = $('#pcprev'); if (p) p.innerHTML = 'PC 경로: ' + (i.err ? `<span class="err">${esc(i.err)}</span>` : esc(pcRoot() ? T.relToPc(i.rel, pcRoot()) : 'OneDrive/' + i.rel)); }
  else if (k === 'rulesQ') { st.rulesQ = v; let l = rules().filter((r) => !v || matchAll(r.name + ' ' + r.cat, v)); l = l.sort((a, b) => (b.used > a.used ? 1 : -1)).slice(0, 200); $('#rulelist').innerHTML = ruleRows(l); }
  else if (k === 'worksQ') { st.worksQ = v; st.worksMore = 150; clearTimeout(inT); inT = setTimeout(() => { const pos = el.selectionStart; render(); const n = $('[data-in="worksQ"]'); n.focus(); n.setSelectionRange(pos, pos); }, 250); }
  else if (k === 'rq') { const l = rules().filter((r) => !v || matchAll(r.name, v)).slice(0, 100); $('#rqlist').innerHTML = l.map((r) => `<button class="item t" style="text-align:left;font:inherit;font-size:14px" data-act="useRule" data-i="${el.dataset.i}" data-n="${esc(r.name)}">${esc(r.name)}</button>`).join(''); }
  else if (k === 'clientId') st.settings = S.setSettings({ clientId: v.trim() });
  else if (k === 'ahkDir') st.settings = S.setSettings({ ahkDir: T.normRel(v) });
  else if (k === 'pcRoot') st.settings = S.setSettings({ pcRoot: v.trim() });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && G.isLoggedIn() && st.items.length === 0 && Date.now() - st.loadedAt > 120000) loadData(); });

// ---------- 시작 ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try { await G.handleRedirect(); } catch (e) { handleErr(e); }
  S.pruneShares().catch(() => {});
  const q = new URLSearchParams(location.search);
  let sid = q.get('shared') || localStorage.getItem('dc.pendingShare');
  if (q.get('shareError')) toast('공유 받은 파일을 읽지 못했습니다');
  if (q.has('shared') || q.has('shareError')) history.replaceState(null, '', G.baseUrl());
  if (sid) {
    const s = await S.getShare(sid).catch(() => null);
    if (s) {
      st.share = s;
      if (s.files.length) setItemsFromFiles(s.files);
      else if (s.text || s.url) {
        const text = [s.title, s.text, s.url].filter(Boolean).join('\n');
        st.items = [{ file: new Blob([text], { type: 'text/plain' }), orig: '공유 텍스트', base: '공유텍스트_' + T.stamp().slice(0, 8), ext: '.txt' }];
      }
    }
    localStorage.removeItem('dc.pendingShare');
  }
  render();
  loadData();
}
boot();
