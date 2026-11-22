// Microsoft Graph (OneDrive) — 브라우저에서 PKCE로 로그인, 서버 없이 동작
import { getSettings } from './store.js';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';
const SCOPE = 'Files.ReadWrite offline_access User.Read';
const TK = 'dc.token', PK = 'dc.pkce';

export const baseUrl = () => new URL('./', location.href).href;
export const clientId = () => (getSettings().clientId || window.DC_CONFIG?.clientId || '').trim();
export const isLoggedIn = () => !!localStorage.getItem(TK);

const rnd = (n = 48) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); };
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(s) { return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }

export class AuthError extends Error { constructor(m, code) { super(m); this.code = code || 'auth'; } }

export async function login() {
  const cid = clientId();
  if (!cid) throw new AuthError('Azure 앱(Client ID)을 먼저 설정하세요.', 'no_client');
  const verifier = rnd(64), state = rnd(16);
  localStorage.setItem(PK, JSON.stringify({ verifier, state }));
  const p = new URLSearchParams({
    client_id: cid, response_type: 'code', redirect_uri: baseUrl(), response_mode: 'query',
    scope: SCOPE, state, code_challenge: await sha256(verifier), code_challenge_method: 'S256', prompt: 'select_account',
  });
  location.href = `${AUTH}/authorize?${p}`;
}

export function logout() { localStorage.removeItem(TK); localStorage.removeItem(PK); }

async function tokenRequest(params) {
  const r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError(j.error_description || j.error || '로그인 실패', j.error === 'invalid_grant' ? 'login_required' : 'auth');
  const old = JSON.parse(localStorage.getItem(TK) || '{}');
  const t = { access_token: j.access_token, refresh_token: j.refresh_token || old.refresh_token, expires_at: Date.now() + (j.expires_in - 120) * 1000 };
  localStorage.setItem(TK, JSON.stringify(t));
  return t;
}

// 로그인 후 돌아온 주소(?code=...) 처리. 처리했으면 true
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  const saved = JSON.parse(localStorage.getItem(PK) || '{}');
  history.replaceState(null, '', baseUrl());
  if (q.has('error')) throw new AuthError(q.get('error_description') || q.get('error'));
  if (q.get('state') !== saved.state) throw new AuthError('로그인 상태값이 맞지 않습니다. 다시 시도하세요.');
  localStorage.removeItem(PK);
  await tokenRequest({ client_id: clientId(), grant_type: 'authorization_code', code: q.get('code'), redirect_uri: baseUrl(), code_verifier: saved.verifier, scope: SCOPE });
  return true;
}

async function token() {
  const t = JSON.parse(localStorage.getItem(TK) || 'null');
  if (!t) throw new AuthError('OneDrive 로그인이 필요합니다.', 'login_required');
  if (t.expires_at > Date.now()) return t.access_token;
  if (!t.refresh_token) throw new AuthError('다시 로그인하세요.', 'login_required');
  const n = await tokenRequest({ client_id: clientId(), grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: SCOPE });
  return n.access_token;
}

export class GraphError extends Error { constructor(status, body) { super(body?.error?.message || `HTTP ${status}`); this.status = status; this.code = body?.error?.code; } }

async function gf(url, opts = {}, retry = true) {
  const h = { Authorization: 'Bearer ' + await token(), ...(opts.headers || {}) };
  const r = await fetch(url, { ...opts, headers: h });
  if (r.status === 401 && retry) { const t = JSON.parse(localStorage.getItem(TK) || '{}'); t.expires_at = 0; localStorage.setItem(TK, JSON.stringify(t)); return gf(url, opts, false); }
  if (!r.ok) throw new GraphError(r.status, await r.json().catch(() => null));
  return r;
}

const enc = (rel) => rel.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const ref = (rel) => (rel ? `${GRAPH}/root:/${enc(rel)}` : `${GRAPH}/root`);
const SEL = '$select=id,name,eTag,size,webUrl,folder,file,lastModifiedDateTime';

export async function me() { const r = await gf('https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName'); return r.json(); }

export async function getItem(rel) {
  try { return await (await gf(`${ref(rel)}?${SEL}`)).json(); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
export async function downloadById(id) { return (await gf(`${GRAPH}/items/${id}/content`)).arrayBuffer(); }

export async function listChildren(rel, foldersOnly = false) {
  const base = rel ? `${ref(rel)}:/children` : `${GRAPH}/root/children`;
  let url = `${base}?$top=200&${SEL}`, out = [];
  for (let i = 0; i < 5 && url; i++) {
    const j = await (await gf(url)).json();
    out.push(...j.value); url = j['@odata.nextLink'];
  }
  out = foldersOnly ? out.filter((x) => x.folder) : out;
  return out.sort((a, b) => (!!b.folder - !!a.folder) || a.name.localeCompare(b.name, 'ko'));
}

// 텍스트 파일: 기존이면 If-Match, 새 파일이면 충돌 시 실패
export async function putText(rel, bytes, cur) {
  if (cur?.id) {
    return (await gf(`${GRAPH}/items/${cur.id}/content`, { method: 'PUT', headers: { 'If-Match': cur.etag, 'Content-Type': 'text/plain' }, body: bytes })).json();
  }
  return (await gf(`${ref(rel)}:/content?@microsoft.graph.conflictBehavior=fail`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: bytes })).json();
}

const CHUNK = 10 * 327680;
export async function upload(rel, blob, conflict = 'replace', onProgress = () => {}) {
  if (blob.size <= 4 * 1024 * 1024) {
    onProgress(0);
    const r = await gf(`${ref(rel)}:/content?@microsoft.graph.conflictBehavior=${conflict}`, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    onProgress(1); return r.json();
  }
  const s = await (await gf(`${ref(rel)}:/createUploadSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflict } }) })).json();
  let pos = 0, last = null;
  while (pos < blob.size) {
    const end = Math.min(pos + CHUNK, blob.size);
    const r = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${pos}-${end - 1}/${blob.size}` }, body: blob.slice(pos, end) });
    if (!r.ok && r.status !== 202) throw new GraphError(r.status, await r.json().catch(() => null));
    last = r.status === 202 ? null : await r.json(); pos = end; onProgress(pos / blob.size);
  }
  return last;
}
