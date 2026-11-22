import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from '../lib/txt.js';
const U = '/mnt/user-data/uploads/';
const find = (suffix) => fs.readdirSync(U).find((f) => f.endsWith(suffix) && !f.endsWith('.lock') && !f.endsWith('.bak'));
const files = { rules: find('filename_rules.txt'), recent: find('recent_folders.txt'), work: find('recent_work_files.txt'), fixed: find('folder_path.txt') };
let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok', n); };
const raw = (k) => new Uint8Array(fs.readFileSync(U + files[k]));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

for (const k of Object.keys(files)) t('왕복 바이트 동일: ' + k, () => {
  const b = raw(k); const d = T.parseDoc(b);
  assert.ok(same(T.docToBytes(d), b), k + ' roundtrip');
});
t('규칙 파싱', () => {
  const r = T.listRules(T.parseDoc(raw('rules')));
  assert.equal(r.length, 49);
  assert.equal(r[0].name, '입사자 신분증_신민섭'); assert.equal(r[0].count, 8);
  assert.ok(r.some((x) => x.name.startsWith('주간업무보고서 2026-48주차')));
});
t('규칙 사용횟수 증가/추가/삭제', () => {
  let d = T.parseDoc(raw('rules'));
  d = T.touchRule(d, '입사자 신분증_신민섭', '20261123073200');
  const r0 = T.listRules(d)[0]; assert.equal(r0.count, 9); assert.equal(r0.used, '20261123073200');
  d = T.addRule(d, '새 규칙|테스트%1', '', '20261123073300');
  const r = T.listRules(d); assert.equal(r.at(-1).name, '새 규칙|테스트%1');
  assert.ok(d.lines.at(-1).startsWith('@TEXT@새 규칙%7C테스트%251'));
  d = T.deleteRule(d, r.at(-1).line); assert.equal(T.listRules(d).length, 49);
});
t('최근 폴더', () => {
  const d = T.parseDoc(raw('recent'));
  assert.ok(T.parseRecentFolders(d).length >= 590);
  const root = T.learnPcRoot(T.parseRecentFolders(d)); assert.equal(root, 'C:\\Users\\bangd\\OneDrive');
  const d2 = T.addRecentFolder(d, 'C:\\Users\\bangd\\OneDrive\\Desktop\\AHK', '20261123080000');
  assert.ok(d2.lines[0].startsWith('20261123080000|C:\\Users\\bangd\\OneDrive\\Desktop\\AHK'));
  assert.equal(d2.lines.filter((l) => l.toLowerCase().endsWith('onedrive\\desktop\\ahk')).length, 1);
});
t('작업 파일', () => {
  const d = T.parseDoc(raw('work'));
  assert.equal(T.parseWorkFiles(d).length, 292);
  const d2 = T.addWorkFiles(d, [{ path: 'C:\\Users\\bangd\\OneDrive\\Desktop\\a.pdf', source: '모바일 저장' }], '20261123080000');
  assert.equal(d2.lines[0], '20261123080000|모바일 저장|C:\\Users\\bangd\\OneDrive\\Desktop\\a.pdf||||');
});
t('고정 폴더 + 경로 분류', () => {
  const f = T.parseFolderPath(T.parseDoc(raw('fixed'))); assert.equal(f.length, 9);
  const ctx = { pcRoot: 'C:\\Users\\bangd\\OneDrive' };
  assert.deepEqual(T.classifyPath('{Desktop}\\AHK', ctx).rel, 'Desktop/AHK');
  assert.equal(T.classifyPath('G:\\내 드라이브\\기획처', ctx).kind, 'google');
  assert.equal(T.classifyPath('W:\\공용 드라이브\\01.통합교육처', ctx).kind, 'naver');
  assert.equal(T.classifyPath('C:\\Scan', ctx).kind, 'local');
  assert.equal(T.classifyPath('C:\\Users\\bangd\\OneDrive\\문서\\건축', ctx).rel, '문서/건축');
  assert.equal(T.classifyPath('C:\\Users\\bangd\\OneDrive', ctx).rel, '');
});
t('이름/별칭', () => {
  assert.deepEqual(T.splitName('스캔.pdf'), { base: '스캔', ext: '.pdf' });
  assert.deepEqual(T.relVariants('Desktop/AHK'), ['Desktop/AHK', '바탕 화면/AHK']);
  assert.equal(T.sanitizeName('a:b?c.pdf'), 'a_b_c.pdf');
  assert.equal(T.relToPc('Desktop/AHK', 'C:\\Users\\bangd\\OneDrive'), 'C:\\Users\\bangd\\OneDrive\\Desktop\\AHK');
});
console.log(ok + ' tests passed');
