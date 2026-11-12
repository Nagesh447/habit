'use strict';
/* =========================================================
   Atomic Ascent: habit system built on the ideas of Atomic Habits
   ========================================================= */

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function dayKey(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function shiftKey(key, n) { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n, 12)); }
const today = () => dayKey();
function weekKey(key = today()) { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d, 12); const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day); return dayKey(dt); }
function hashSeed(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.6 3.3-1.4 5-3 7-1.4 1.8-2.5 3.6-2.5 6A5.5 5.5 0 0 0 12 21a5.5 5.5 0 0 0 5.5-5.5c0-2-1-3.6-2-4.8-.3 1.3-1 2.3-2.1 2.8.4-3.6-.4-7.6-1.4-11.5z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/></svg>',
  vote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M9 10V5h6v5M10 7.5h4"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>',
  chest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="10" width="18" height="10" rx="2"/><path d="M3 10a9 5 0 0 1 18 0M12 12v3"/></svg>'
};

/* ---------- State ---------- */
function freshState() {
  return {
    v: 1, rev: 0, by: '', created: today(),
    xp: 0, shields: 1,
    identities: [], habits: [],
    lessons: {}, lessonDays: {},
    achievements: {}, perfect: {}, chests: {}, quests: {},
    notes: {}, reviews: [], scorecard: [], contract: null, cheersSent: {},
    settings: { sound: true, remind: { on: false, morning: '07:00', evening: '20:30' } }
  };
}
let state = freshState();
const deviceId = (() => { try { let d = localStorage.getItem('ascent-device'); if (!d) { d = uid(); localStorage.setItem('ascent-device', d); } return d; } catch { return uid(); } })();
let ui = { buildMode: 'good', editId: null, draft: null, learnOpen: null };

/* ---------- Persistence: Supabase (login, private data, partner) with a per-user local cache ---------- */
const CFG = window.APP_CONFIG || {};
const CACHE = 'atomic-ascent-cache';
let sb = null, me = null, profile = null, partner = null, partnerProg = null, chan = null;
let saving = false, dirty = false, saveTimer = null, syncStatus = 'local';
const cacheKey = () => CACHE + ':' + (me ? me.id : 'anon');
function cacheLocal() { try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch {} }
function readCache() { try { const s = JSON.parse(localStorage.getItem(cacheKey())); return s && s.v ? s : null; } catch { return null; } }
function normalize(s) { const f = freshState(); return Object.assign(f, s, { settings: Object.assign(f.settings, s.settings || {}) }); }
function save() {
  state.rev = (state.rev || 0) + 1; state.by = deviceId;
  pruneOld(); cacheLocal(); dirty = true;
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600);
}
function progressRow() {
  const t = today(), lvl = levelOf(state.xp);
  return { user_id: me.id, name: (profile && profile.display_name) || '', level: lvl, rank: rankOf(lvl), xp: state.xp,
    votes_today: votesOn(t), total_today: activeHabits(t).length, streak: overallStreak(),
    perfect_dates: Object.keys(state.perfect).sort().slice(-60), day: t, updated_at: new Date().toISOString() };
}
let retryTimer = null;
async function flush() {
  if (!sb || !me || saving || !dirty) return;
  saving = true; dirty = false;
  const body = JSON.parse(JSON.stringify(state));
  try {
    const [a, b] = await Promise.all([
      sb.from('app_state').upsert({ user_id: me.id, state: body, updated_at: new Date().toISOString() }),
      sb.from('progress').upsert(progressRow())
    ]);
    if (a.error || b.error) throw (a.error || b.error);
    setSync('ok');
  } catch (e) {
    dirty = true; setSync(navigator.onLine === false ? 'offline' : 'err');
    clearTimeout(retryTimer); retryTimer = setTimeout(flush, 5000);
  }
  saving = false;
  if (dirty && syncStatus === 'ok') flush();
}
function setSync(s) { syncStatus = s; const el = $('#sync'); if (el) paintSync(el); }
function paintSync(el) {
  const map = { ok: ['ok', 'Synced'], err: ['err', 'Not saved yet, retrying'], offline: ['err', 'Offline, will sync'], local: ['', 'Connecting…'] };
  const [c, t] = map[syncStatus] || map.local; el.className = 'sync ' + c; el.textContent = '● ' + t;
}
function pruneOld() {
  const cutoff = shiftKey(today(), -60);
  for (const k of Object.keys(state.quests)) if (k.slice(0, 10) < cutoff) delete state.quests[k];
  for (const k of Object.keys(state.lessonDays)) if (k < cutoff) delete state.lessonDays[k];
  for (const k of Object.keys(state.cheersSent || {})) if (k.slice(0, 10) < cutoff) delete state.cheersSent[k];
}

/* ---------- Auth screens ---------- */
function showAuth(mode = 'signin', msg = '') {
  document.body.classList.add('signed-out');
  const signup = mode === 'signup';
  $('#hero').innerHTML = `<div class="lvl">Atomic Ascent</div><div class="small muted">Small habits, compounded.</div>`;
  $('#view').innerHTML = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY
    ? `<section class="alert"><b>Setup needed.</b> Open config.js, paste your Supabase Project URL and publishable (anon) key, then upload it again.</section>`
    : `<section class="card"><h2>${signup ? 'Create your account' : 'Sign in'}</h2>
      ${signup ? '<div><label for="a-name">First name</label><input type="text" id="a-name" autocomplete="given-name" placeholder="Nagesh"></div>' : ''}
      <div><label for="a-email">Email</label><input type="text" inputmode="email" id="a-email" autocomplete="email" placeholder="you@example.com"></div>
      <div><label for="a-pass">Password (at least 6 characters)</label><input type="password" id="a-pass" autocomplete="${signup ? 'new-password' : 'current-password'}" style="width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);font-size:16px"></div>
      <div class="err" id="a-err"></div><div class="small" id="a-msg" style="color:var(--good)">${esc(msg)}</div>
      <button class="btn ember full" data-act="${signup ? 'do-signup' : 'do-signin'}">${signup ? 'Create account' : 'Sign in'}</button>
      <button class="btn ghost full" data-act="${signup ? 'to-signin' : 'to-signup'}">${signup ? 'I already have an account' : 'Create a new account'}</button></section>`;
}
function readCreds(needName) {
  const email = ($('#a-email').value || '').trim(), password = $('#a-pass').value || '', name = needName ? ($('#a-name').value || '').trim() : '';
  const err = m => { $('#a-err').textContent = m; return null; };
  if (needName && !name) return err('Enter your first name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return err('Enter a valid email address.');
  if (password.length < 6) return err('Password must be at least 6 characters.');
  return { email, password, name };
}
async function doSignin(btn) {
  const c = readCreds(false); if (!c) return;
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: c.email, password: c.password });
  btn.disabled = false;
  if (error) $('#a-err').textContent = /confirm/i.test(error.message) ? 'Confirm your email first: open the link Supabase sent you.' : error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message;
}
async function doSignup(btn) {
  const c = readCreds(true); if (!c) return;
  btn.disabled = true;
  const { data, error } = await sb.auth.signUp({ email: c.email, password: c.password, options: { data: { name: c.name }, emailRedirectTo: location.origin + location.pathname } });
  btn.disabled = false;
  if (error) { $('#a-err').textContent = error.message; return; }
  if (!data.session) showAuth('signin', 'Account created. Open the confirmation email, tap the link, then sign in here.');
}

/* ---------- Session ---------- */
async function onSession(session) {
  const u = session ? session.user : null;
  if (u && me && u.id === me.id) return;
  if (chan) { sb.removeChannel(chan); chan = null; }
  me = u; partner = null; partnerProg = null; profile = null;
  if (!me) { state = freshState(); document.body.classList.remove('all-done'); showAuth(); return; }
  document.body.classList.remove('signed-out');
  const cached = readCache(); state = cached ? normalize(cached) : freshState();
  setSync('local'); render();
  let { data: p } = await sb.from('profiles').select('*').eq('id', me.id).maybeSingle();
  if (!p) { const ins = await sb.from('profiles').insert({ id: me.id, display_name: (me.user_metadata && me.user_metadata.name) || me.email.split('@')[0] }).select().single(); p = ins.data; }
  profile = p;
  const { data: row, error } = await sb.from('app_state').select('state').eq('user_id', me.id).maybeSingle();
  if (error) setSync('err');
  else if (row && row.state && row.state.v) {
    const localNewer = cached && cached.by === deviceId && (cached.rev || 0) > (row.state.rev || 0);
    if (localNewer) dirty = true; else state = normalize(row.state);
    cacheLocal(); setSync('ok');
  }
  else { dirty = true; }
  await loadPartner();
  subscribe(); await showUnseenCheers();
  save(); render();
}
async function loadPartner() {
  partner = null; partnerProg = null;
  if (!profile || !profile.partner_id) return;
  const [pp, pg] = await Promise.all([
    sb.from('profiles').select('id,display_name').eq('id', profile.partner_id).maybeSingle(),
    sb.from('progress').select('*').eq('user_id', profile.partner_id).maybeSingle()
  ]);
  partner = pp.data || null; partnerProg = pg.data || null;
}
function subscribe() {
  if (chan) sb.removeChannel(chan);
  chan = sb.channel('ascent-' + me.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_state', filter: `user_id=eq.${me.id}` }, p => {
      const d = p.new && p.new.state;
      if (d && d.by !== deviceId && !dirty && !saving && (d.rev || 0) >= (state.rev || 0)) { state = normalize(d); cacheLocal(); render(); }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${me.id}` }, async p => {
      const changed = (p.new.partner_id || null) !== (profile.partner_id || null);
      profile = p.new;
      if (changed) { await loadPartner(); subscribe(); if (partner) toast(ICON.star, `You're linked with ${partner.display_name}. Keep each other going.`); render(); }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cheers', filter: `to_id=eq.${me.id}` }, p => showCheer(p.new));
  if (profile && profile.partner_id) {
    chan.on('postgres_changes', { event: '*', schema: 'public', table: 'progress', filter: `user_id=eq.${profile.partner_id}` }, p => {
      const prev = partnerProg; partnerProg = p.new;
      const t = today();
      const nowPerfect = partnerProg && partnerProg.day === t && partnerProg.total_today > 0 && partnerProg.votes_today >= partnerProg.total_today;
      const wasPerfect = prev && prev.day === t && prev.total_today > 0 && prev.votes_today >= prev.total_today;
      if (nowPerfect && !wasPerfect && partner) { toast(ICON.star, `${partner.display_name} just finished every habit today.`); sfx('badge'); }
      if (prev && partnerProg.level > prev.level && partner) toast(ICON.star, `${partner.display_name} reached level ${partnerProg.level}.`);
      render();
    });
  }
  chan.subscribe();
}
async function showUnseenCheers() {
  const { data } = await sb.from('cheers').select('*').eq('to_id', me.id).eq('seen', false).order('created_at').limit(5);
  if (data && data.length) { showCheer(data[data.length - 1], data.length); }
}
async function showCheer(c, count = 1) {
  const from = partner && c.from_id === partner.id ? partner.display_name : 'Your partner';
  toast(ICON.star, count > 1 ? `${from} sent you ${count} cheers. Latest: "${c.kind}"` : `${from}: "${c.kind}"`);
  sfx('chest'); buzz([30, 40, 30]);
  await sb.from('cheers').update({ seen: true }).eq('to_id', me.id).eq('seen', false);
}
const CHEERS = ['Proud of you', 'Let\'s go!', 'Don\'t miss twice', 'Your turn now'];
async function sendCheer(kind, btn) {
  if (!partner) return;
  btn.disabled = true;
  const { error } = await sb.from('cheers').insert({ from_id: me.id, to_id: partner.id, kind });
  if (error) { btn.disabled = false; toast(ICON.ban, 'Couldn\'t send. Check your connection.'); return; }
  state.cheersSent = state.cheersSent || {}; state.cheersSent[today() + ':' + kind] = true;
  gainXP(5, btn, '+5 XP · cheer'); sfx('tick'); checkQuests(btn); checkAchievements(); save(); render();
}
function duoStreak() {
  if (!partnerProg) return 0;
  const theirs = new Set(partnerProg.perfect_dates || []);
  let k = today(); if (!(state.perfect[k] && theirs.has(k))) k = shiftKey(k, -1);
  let n = 0; while (state.perfect[k] && theirs.has(k)) { n++; k = shiftKey(k, -1); }
  return n;
}
function partnerCard() {
  if (!me || !partner) return '';
  const p = partnerProg, t = today(), fresh = p && p.day === t;
  const done = fresh ? p.votes_today : 0, total = p ? p.total_today : 0, duo = duoStreak();
  const pClosed = total > 0 && done >= total, pr = 19, pC = 2 * Math.PI * pr, pcol = pClosed ? 'var(--done)' : 'var(--ring)';
  const mini = `<svg viewBox="0 0 46 46" width="46" height="46" style="transform:rotate(-90deg)" aria-hidden="true"><circle cx="23" cy="23" r="${pr}" fill="none" stroke="${pcol}" stroke-width="7" opacity=".13"/>${done ? `<circle cx="23" cy="23" r="${pr}" fill="none" stroke="${pcol}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${total ? pC * done / total : 0} ${pC}"/>` : ''}</svg>`;
  const next = CHEERS.find(k => !(state.cheersSent && state.cheersSent[t + ':' + k]));
  return `<section class="card" id="partner"><div class="row" style="gap:12px">
    <div class="minring">${mini}</div>
    <div style="flex:1;min-width:0"><div class="hname">${esc(partner.display_name)}</div>
      <div class="hmeta num">${!p ? 'Not started yet' : total && done >= total ? 'Circle closed ✓' : `${done}/${total} today`}${p && p.streak ? ` · ${p.streak}-day streak` : ''}${duo ? ` · <b style="color:#FF7A00">${duo}-day duo streak</b>` : ''}</div></div>
    ${next ? `<button class="btn soft sm" data-act="cheer" data-k="${esc(next)}">Cheer</button>` : '<span class="small muted">Cheered</span>'}
  </div></section>`;
}
function partnerSettings() {
  if (!me || !profile) return '';
  return `<section class="card" id="link"><h2>Partner</h2>
    ${partner ? `<p>You're linked with <b>${esc(partner.display_name)}</b>. You see each other's level, today's progress and streak. Your notes, reviews and habit details stay private.</p>
      <button class="btn ghost sm" data-act="unlink" style="align-self:flex-start">Unlink</button>`
    : `<p class="small muted">Give your partner your code, or type theirs. Only the level, today's progress and streak are shared. Notes, reviews and habit details stay private.</p>
      <div class="row between"><span>Your code</span><span class="row" style="gap:8px"><b class="num" style="font-family:var(--font-display);font-size:20px;letter-spacing:.12em">${esc(profile.invite_code)}</b><button class="btn ghost sm" data-act="copy-code">Copy</button></span></div>
      <div class="row"><input type="text" id="partner-code" placeholder="Partner's code" maxlength="6" style="text-transform:uppercase"><button class="btn soft sm" data-act="link">Link</button></div>
      <div class="err" id="link-err"></div>`}
    <div><label for="my-name">Your name (what your partner sees)</label><div class="row"><input type="text" id="my-name" value="${esc(profile.display_name)}"><button class="btn ghost sm" data-act="rename">Save</button></div></div>
    <button class="btn ghost sm" data-act="signout" style="align-self:flex-start">Sign out (${esc(me.email)})</button></section>`;
}
async function cloudAction(a, t) {
  switch (a) {
    case 'do-signin': await doSignin(t); return true;
    case 'do-signup': await doSignup(t); return true;
    case 'to-signup': showAuth('signup'); return true;
    case 'to-signin': showAuth('signin'); return true;
    case 'cheer': await sendCheer(t.dataset.k, t); return true;
    case 'copy-code': try { await navigator.clipboard.writeText(profile.invite_code); toast(ICON.check, 'Code copied. Send it to your partner.'); } catch { toast(ICON.check, 'Your code is ' + profile.invite_code); } return true;
    case 'link': {
      const code = ($('#partner-code').value || '').trim(), err = $('#link-err');
      if (code.length !== 6) { err.textContent = 'Codes are 6 characters.'; return true; }
      t.disabled = true;
      const { data, error } = await sb.rpc('link_partner', { code });
      t.disabled = false;
      if (error) { err.textContent = error.message; return true; }
      const { data: p } = await sb.from('profiles').select('*').eq('id', me.id).single(); profile = p;
      await loadPartner(); subscribe(); gainXP(25, t, '+25 XP · team up'); sfx('perfect'); confetti();
      toast(ICON.star, `Linked with ${data}. Now keep each other going.`); unlock('team'); save(); render(); return true;
    }
    case 'unlink': if (await confirmBox(`Unlink from ${partner.display_name}? You'll stop seeing each other's progress.`, 'Unlink')) {
      await sb.rpc('unlink_partner'); const { data: p } = await sb.from('profiles').select('*').eq('id', me.id).single(); profile = p; await loadPartner(); subscribe(); render(); } return true;
    case 'rename': {
      const v = ($('#my-name').value || '').trim(); if (!v) return true;
      const { error } = await sb.from('profiles').update({ display_name: v }).eq('id', me.id);
      if (!error) { profile.display_name = v; save(); toast(ICON.check, 'Name saved.'); } return true;
    }
    case 'signout': if (dirty) await flush(); await sb.auth.signOut(); return true;
    case 'r-on': await remindersOn(t); return true;
    case 'r-save': await remindersSave(); return true;
    case 'r-off': await remindersOff(); return true;
    case 'r-test': await remindersTest(); return true;
  }
  return false;
}

/* ---------- Phone reminders (Web Push via Supabase Edge Function) ---------- */
function b64ToU8(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function pushSupportMsg() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return isIOS() && !isStandalone() ? 'On iPhone, first tap Share → Add to Home Screen, open the app from that icon, then turn reminders on.' : 'This browser can\'t receive reminders. Try Chrome on Android or the home-screen app on iPhone.';
  if (!CFG.VAPID_PUBLIC_KEY) return 'The reminder key is missing from config.js.';
  return '';
}
async function currentSub() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } }
function reminderCard() {
  if (!me) return '';
  const r = state.settings.remind || {}, on = !!r.on, unsupported = pushSupportMsg();
  return `<section class="card" id="reminders"><div class="row between"><h2>Reminders</h2><span class="tag ${on ? 'good' : ''}">${on ? 'On' : 'Off'}</span></div>
    <div class="two"><div><label for="r-morning">Morning</label><input type="time" id="r-morning" value="${esc(r.morning || '07:00')}"></div>
      <div><label for="r-evening">Evening, if circle is open</label><input type="time" id="r-evening" value="${esc(r.evening || '20:30')}"></div></div>
    <div class="err" id="r-err">${on || !unsupported ? '' : esc(unsupported)}</div>
    <div class="row" style="flex-wrap:wrap">${on ? `<button class="btn ember sm" data-act="r-save">Save times</button><button class="btn ghost sm" data-act="r-test">Send a test</button><button class="btn ghost sm" data-act="r-off">Turn off</button>`
      : `<button class="btn ember sm" data-act="r-on" ${unsupported ? 'disabled' : ''}>Turn on reminders</button>`}</div></section>`;
}
async function remindersOn(btn) {
  const err = $('#r-err'), msg = pushSupportMsg(); if (msg) { err.textContent = msg; return; }
  btn.disabled = true; err.textContent = '';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this app in your phone settings, then try again.');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CFG.VAPID_PUBLIC_KEY) });
    const j = sub.toJSON(), morning = $('#r-morning').value || '07:00', evening = $('#r-evening').value || '20:30';
    const { error } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: me.id, p256dh: j.keys.p256dh, auth: j.keys.auth,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', morning_at: morning, evening_at: evening });
    if (error) throw new Error('Couldn\'t save reminders: ' + error.message);
    state.settings.remind = { on: true, morning, evening }; save(); render();
    toast(ICON.check, `Reminders on: ${morning} and ${evening}.`);
  } catch (e) { btn.disabled = false; err.textContent = e.message || 'Couldn\'t turn on reminders.'; }
}
async function remindersSave() {
  const morning = $('#r-morning').value || '07:00', evening = $('#r-evening').value || '20:30', sub = await currentSub();
  if (!sub) { state.settings.remind = { on: false, morning, evening }; save(); render(); $('#r-err').textContent = 'Reminders were switched off on this phone. Turn them on again.'; return; }
  const { error } = await sb.from('push_subs').update({ morning_at: morning, evening_at: evening, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }).eq('endpoint', sub.endpoint);
  if (error) { $('#r-err').textContent = 'Couldn\'t save: ' + error.message; return; }
  state.settings.remind = { on: true, morning, evening }; save(); toast(ICON.check, 'Reminder times saved.');
}
async function remindersOff() {
  const sub = await currentSub();
  if (sub) { await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); try { await sub.unsubscribe(); } catch {} }
  state.settings.remind = Object.assign({}, state.settings.remind, { on: false }); save(); render();
}
async function remindersTest() {
  try {
    const reg = await navigator.serviceWorker.ready, t = today(), left = activeHabits(t).length - votesOn(t);
    await reg.showNotification('Close your circle', { body: left > 0 ? `${left} left today. This is what your reminder looks like.` : 'Circle closed today. This is what your reminder looks like.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'ascent-test' });
  } catch { $('#r-err').textContent = 'Couldn\'t show a notification. Check notification permission for this app.'; }
}

function startCloud() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) { showAuth(); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((_e, session) => { setTimeout(() => onSession(session), 0); });
  window.addEventListener('online', () => { if (dirty) flush(); });
}

/* ---------- Levels & XP ---------- */
const xpFor = n => 25 * n * (n - 1);           // total XP needed to reach level n
const levelOf = xp => { let n = 1; while (xpFor(n + 1) <= xp) n++; return n; };
const RANKS = [[1, 'Spark'], [3, 'Kindling'], [5, 'Ember'], [8, 'Flame'], [12, 'Blaze'], [17, 'Phoenix'], [23, 'Ascendant'], [30, 'Sovereign']];
const rankOf = lvl => RANKS.filter(r => lvl >= r[0]).pop()[1];

function gainXP(n, anchorEl, label) {
  if (!n) return;
  const before = levelOf(state.xp);
  state.xp = Math.max(0, state.xp + n);
  if (n > 0 && anchorEl) floatText(anchorEl, (label || '+' + n + ' XP'));
  const after = levelOf(state.xp);
  if (after > before) setTimeout(() => levelUp(after), 450);
}
function floatText(el, text) {
  const r = el.getBoundingClientRect(), f = document.createElement('div');
  f.className = 'plus'; f.textContent = text;
  f.style.left = clamp(r.left + r.width / 2 - 30, 8, innerWidth - 120) + 'px'; f.style.top = (r.top - 8) + 'px';
  document.body.appendChild(f); setTimeout(() => f.remove(), 1050);
}

/* ---------- Sound (synthesized, no files) ---------- */
let actx = null;
function tone(freq, start, dur, type = 'sine', vol = 0.12) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, actx.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, actx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + start + dur);
  o.connect(g).connect(actx.destination); o.start(actx.currentTime + start); o.stop(actx.currentTime + start + dur + 0.05);
}
function sfx(kind) {
  if (!state.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const seqs = {
      tick: [[880, 0, .12], [1320, .07, .18]],
      mini: [[660, 0, .15]],
      perfect: [[523, 0, .2], [659, .1, .2], [784, .2, .2], [1047, .3, .35]],
      level: [[392, 0, .18, 'triangle'], [523, .15, .18, 'triangle'], [659, .3, .18, 'triangle'], [784, .45, .5, 'triangle'], [1047, .6, .6]],
      chest: [[1568, 0, .1], [1760, .08, .1], [2093, .16, .1], [2637, .24, .3]],
      badge: [[988, 0, .15], [1319, .12, .3]],
      undo: [[440, 0, .12, 'triangle']]
    };
    (seqs[kind] || []).forEach(([f, s, d, t]) => tone(f, s, d, t));
  } catch {}
}
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ---------- Habit logic ---------- */
const activeHabits = (key = today()) => state.habits.filter(h => !h.archived && h.created <= key);
const isVote = e => e && e.k !== 'shield';
function streak(h, upto = today()) {
  let k = h.log[upto] ? upto : shiftKey(upto, -1), n = 0;
  while (h.log[k]) { if (isVote(h.log[k])) n++; k = shiftKey(k, -1); }
  return n;
}
function bestStreak(h) {
  const days = Object.keys(h.log).sort(); let best = 0, run = 0, prev = null;
  for (const d of days) { run = (prev && shiftKey(prev, 1) === d) ? run + (isVote(h.log[d]) ? 1 : 0) : (isVote(h.log[d]) ? 1 : 0); best = Math.max(best, run); prev = d; }
  return best;
}
const totalVotes = () => state.habits.reduce((n, h) => n + Object.values(h.log).filter(isVote).length, 0);
const votesOn = key => activeHabits(key).filter(h => isVote(h.log[key])).length;
const isPerfect = key => { const a = activeHabits(key); return a.length > 0 && a.every(h => isVote(h.log[key])); };
const activeDays = () => { const s = new Set(); state.habits.forEach(h => Object.keys(h.log).forEach(k => isVote(h.log[k]) && s.add(k))); return s.size; };

function logHabit(id, kind, btn) {
  const h = state.habits.find(x => x.id === id); if (!h) return;
  const t = today(), cur = h.log[t];
  if (cur && cur.k === kind) {                      // undo
    gainXP(-cur.xp); delete h.log[t]; sfx('undo'); save(); render(); return;
  }
  const missedYesterday = h.created < shiftKey(t, -1) && !h.log[shiftKey(t, -1)];
  const s = streak(h, shiftKey(t, -1));
  const xp = kind === 'mini' ? 6 : 10 + Math.min(s, 10);
  if (cur) gainXP(-cur.xp);
  h.log[t] = { k: kind, xp, at: Date.now() };
  render();
  const b = document.querySelector(`[data-log="${id}"][data-kind="${kind}"]`) || btn;
  if (b) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  gainXP(xp, b, `+${xp} XP · vote`);
  sfx(kind === 'mini' ? 'mini' : 'tick'); buzz(25);
  if (missedYesterday) unlock('comeback');
  // shields at every 7-day streak milestone
  const ns = streak(h);
  h.shieldAt = h.shieldAt || [];
  if (ns > 0 && ns % 7 === 0 && !h.shieldAt.includes(ns)) {
    h.shieldAt.push(ns);
    if (state.shields < 3) { state.shields++; toast(ICON.shield, `${ns}-day streak on "${h.name}". You earned a streak shield.`); }
  }
  afterAction();
  save(); render();
}

function useShield(id) {
  const h = state.habits.find(x => x.id === id); const y = shiftKey(today(), -1);
  if (!h || state.shields < 1 || h.log[y]) return;
  h.log[y] = { k: 'shield', xp: 0, at: Date.now() }; state.shields--;
  unlock('shielded'); sfx('badge'); save(); render();
  toast(ICON.shield, `Shield used. Yesterday is covered for "${h.name}". Now don't miss today.`);
}

/* ---------- Perfect day, chests, quests ---------- */
function afterAction() {
  const t = today();
  if (isPerfect(t) && !state.perfect[t]) {
    state.perfect[t] = true; state.chests[t] = { status: 'ready' };
    gainXP(20, $('#ring'), '+20 Perfect day');
    sfx('perfect'); confetti(); buzz([30, 50, 30]);
  }
  checkQuests(); checkAchievements();
}

const QUESTS = {
  all: { t: 'Cast a vote for every habit', xp: 20, ok: k => isPerfect(k) },
  early: { t: 'Finish any habit before 9:00 AM', xp: 15, ok: k => state.habits.some(h => h.log[k] && isVote(h.log[k]) && new Date(h.log[k].at).getHours() < 9) },
  lesson: { t: 'Learn one lesson', xp: 15, ok: k => !!state.lessonDays[k] },
  full: { t: 'Do the full version of every build habit', xp: 15, ok: k => { const a = activeHabits(k).filter(h => h.type === 'build'); return a.length > 0 && a.every(h => h.log[k] && h.log[k].k === 'full'); } },
  note: { t: 'Write today\'s one-line note', xp: 10, ok: k => !!(state.notes[k] || '').trim() },
  env: { t: 'Make one change to your environment (then tick here)', xp: 10, manual: true },
  cheer: { t: 'Send your partner a cheer', xp: 10, ok: k => Object.keys(state.cheersSent || {}).some(x => x.startsWith(k)) },
  review: { t: 'Do your weekly review', xp: 15, ok: k => state.reviews.some(r => r.week === weekKey(k)) }
};
function questsFor(k) {
  const pool = ['early', 'lesson', 'full', 'env'].concat(partner ? ['cheer', 'cheer'] : []);
  const r = hashSeed(k); const a = pool[r % pool.length]; const rest = pool.filter(p => p !== a); const b = rest[(r >> 8) % rest.length];
  const isSunday = (new Date(...k.split('-').map((v, i) => i === 1 ? v - 1 : +v)).getDay()) === 0;
  return ['all', isSunday ? 'review' : a, b];
}
function checkQuests(anchor) {
  const k = today();
  for (const q of questsFor(k)) {
    const key = k + ':' + q, def = QUESTS[q];
    if (state.quests[key] || def.manual) continue;
    if (def.ok(k)) { state.quests[key] = true; gainXP(def.xp, anchor || $('#quests'), `+${def.xp} XP · quest`); toast(ICON.star, `Quest complete: ${def.t}`); sfx('badge'); }
  }
}

function rollLoot() {
  const r = Math.random();
  if (r < 0.01) return { rar: 'legendary', xp: 250, shield: true, label: 'Legendary' };
  if (r < 0.08) return { rar: 'epic', xp: 100, shield: true, label: 'Epic' };
  if (r < 0.30) return { rar: 'rare', xp: 40 + Math.floor(Math.random() * 21), label: 'Rare' };
  return { rar: 'common', xp: 10 + Math.floor(Math.random() * 21), label: 'Common' };
}
function openChest() {
  const t = today(), c = state.chests[t];
  if (!c || c.status !== 'ready') return;
  const loot = rollLoot();
  const lesson = LESSONS[Math.floor(Math.random() * LESSONS.length)];
  modal(`<div class="chest-wrap">
      <svg class="chest shake" id="chestsvg" viewBox="0 0 120 100" aria-hidden="true">
        <rect x="14" y="44" width="92" height="48" rx="8" fill="#c9762b"/><rect x="14" y="62" width="92" height="8" fill="#9a5418"/>
        <rect x="52" y="56" width="16" height="20" rx="3" fill="#f2c14e"/>
        <g class="lid"><path d="M14 46 Q60 6 106 46 Z" fill="#e08a3a"/><rect x="14" y="40" width="92" height="8" rx="3" fill="#9a5418"/></g>
      </svg>
      <div id="lootbox" class="hidden">
        <div class="tag rar-${loot.rar}" style="background:var(--bg)">${loot.label}</div>
        <div class="loot rar-${loot.rar} num">+${loot.xp} XP</div>
        ${loot.shield ? '<div class="small">+1 streak shield</div>' : ''}
        <div class="doit" style="margin-top:8px;text-align:left"><b>Wisdom card · ${esc(lesson.t)}</b><br>${esc(lesson.b)}</div>
      </div>
    </div>
    <button class="btn ember full" data-act="close-modal">Collect</button>`, { onOpen: () => {
      setTimeout(() => { const s = $('#chestsvg'); if (!s) return; s.classList.remove('shake'); s.classList.add('open'); $('#lootbox').classList.remove('hidden'); sfx('chest'); buzz([20, 40, 60]); confetti(); }, 1500);
    } });
  c.status = 'opened'; c.loot = loot;
  if (loot.shield && state.shields < 3) state.shields++;
  setTimeout(() => gainXP(loot.xp, null), 1500);
  unlock('chest'); if (loot.rar === 'legendary' || loot.rar === 'epic') unlock('jackpot');
  save(); setTimeout(render, 1600);
}

/* ---------- Achievements ---------- */
const ACH = [
  { id: 'first', t: 'First vote', d: 'Cast your first vote', ok: () => totalVotes() >= 1 },
  { id: 'perfect1', t: 'Perfect day', d: 'Every habit done in one day', ok: () => Object.keys(state.perfect).length >= 1 },
  { id: 's3', t: 'Three in a row', d: '3-day streak', ok: () => maxStreakNow() >= 3 },
  { id: 's7', t: 'One week', d: '7-day streak', ok: () => maxStreakNow() >= 7 },
  { id: 's21', t: 'Three weeks', d: '21-day streak', ok: () => maxStreakNow() >= 21 },
  { id: 's30', t: 'Thirty days', d: '30-day streak', ok: () => maxStreakNow() >= 30 },
  { id: 's66', t: 'Automatic', d: '66-day streak', ok: () => maxStreakNow() >= 66 },
  { id: 's100', t: 'Hundred club', d: '100-day streak', ok: () => maxStreakNow() >= 100 },
  { id: 'v100', t: '100 votes', d: '100 total votes', ok: () => totalVotes() >= 100 },
  { id: 'v500', t: '500 votes', d: '500 total votes', ok: () => totalVotes() >= 500 },
  { id: 'comeback', t: 'Showed up anyway', d: 'Voted right after a missed day', ok: null },
  { id: 'shielded', t: 'Protected', d: 'Used a streak shield', ok: null },
  { id: 'chest', t: 'Treasure', d: 'Opened a reward chest', ok: null },
  { id: 'jackpot', t: 'Jackpot', d: 'Found an epic or legendary chest', ok: null },
  { id: 'l5', t: 'Student', d: 'Learned 5 lessons', ok: () => Object.keys(state.lessons).length >= 5 },
  { id: 'lall', t: 'Scholar', d: 'Learned every lesson', ok: () => Object.keys(state.lessons).length >= LESSONS.length },
  { id: 'identity', t: 'New identity', d: 'Wrote an identity statement', ok: () => state.identities.length >= 1 },
  { id: 'score', t: 'Self-aware', d: 'Scored 5+ daily habits', ok: () => state.scorecard.length >= 5 },
  { id: 'contract', t: 'Signed', d: 'Signed a habit contract', ok: () => !!(state.contract && state.contract.signed) },
  { id: 'review1', t: 'Reflector', d: 'Did a weekly review', ok: () => state.reviews.length >= 1 },
  { id: 'breaker', t: 'Chain breaker', d: 'Set up a bad-habit breaker', ok: () => state.habits.some(h => h.type === 'break') },
  { id: 'team', t: 'Team up', d: 'Linked with your partner', ok: () => !!partner },
  { id: 'cheer1', t: 'Cheerleader', d: 'Sent your first cheer', ok: () => Object.keys(state.cheersSent || {}).length > 0 },
  { id: 'duo7', t: 'Power couple', d: '7-day duo streak', ok: () => duoStreak() >= 7 },
  { id: 'lv5', t: 'Ember', d: 'Reached level 5', ok: () => levelOf(state.xp) >= 5 },
  { id: 'lv12', t: 'Blaze', d: 'Reached level 12', ok: () => levelOf(state.xp) >= 12 },
  { id: 'lv17', t: 'Phoenix', d: 'Reached level 17', ok: () => levelOf(state.xp) >= 17 }
];
const maxStreakNow = () => Math.max(0, ...state.habits.filter(h => !h.archived).map(h => streak(h)));
function unlock(id) {
  if (state.achievements[id]) return;
  const a = ACH.find(x => x.id === id); if (!a) return;
  state.achievements[id] = today();
  setTimeout(() => { toast(ICON.star, `Achievement unlocked: ${a.t}`); sfx('badge'); }, 700);
  gainXP(15, null);
}
function checkAchievements() { ACH.forEach(a => { if (a.ok && !state.achievements[a.id] && a.ok()) unlock(a.id); }); }

/* ---------- Celebrations ---------- */
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#e0602c', '#4a42c2', '#d4537e', '#1d8a5a', '#f2c14e'];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('div'); c.className = 'confetti';
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 180;
    c.style.cssText = `background:${colors[i % 5]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--r:${Math.random() * 720}deg;animation-delay:${Math.random() * .1}s`;
    document.body.appendChild(c); setTimeout(() => c.remove(), 1500);
  }
}
function levelUp(lvl) {
  const prevRank = rankOf(lvl - 1), rank = rankOf(lvl);
  $('#lu-num').textContent = lvl;
  $('#lu-title').textContent = rank !== prevRank ? `New rank: ${rank}` : rank;
  const idn = state.identities[0];
  $('#lu-sub').textContent = idn ? `More proof that you are a person who ${idn.text}.` : 'Every vote is proof of who you are becoming.';
  const colors = ['#ef9f27', '#7f77dd', '#d4537e', '#5dcaa5', '#fac775'];
  $('#sparks').innerHTML = Array.from({ length: 36 }, (_, i) => { const a = i / 36 * Math.PI * 2, d = 120 + Math.random() * 120;
    return `<span class="spark" style="background:${colors[i % 5]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--r:${Math.random() * 720}deg"></span>`; }).join('');
  $('#motes').innerHTML = Array.from({ length: 26 }, () => { const z = 4 + Math.random() * 10;
    return `<span class="mote" style="left:${Math.random() * 100}%;width:${z}px;height:${z}px;--d:${4 + Math.random() * 4}s;--delay:${Math.random() * 3}s;--sx:${(Math.random() - .5) * 80}px"></span>`; }).join('');
  const o = $('#levelup'); o.classList.remove('show'); void o.offsetWidth; o.classList.add('show');
  sfx('level'); buzz([40, 60, 40, 60, 120]);
  checkAchievements(); save();
}
$('#levelup').addEventListener('click', () => $('#levelup').classList.remove('show'));

/* ---------- Toast & modal ---------- */
function toast(icon, text) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = icon + '<span></span>'; t.querySelector('span').textContent = text;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3600);
}
function modal(html, opts = {}) {
  closeModal();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m && !opts.sticky) closeModal(); });
  document.body.appendChild(m); opts.onOpen && opts.onOpen(m);
  return m;
}
function closeModal() { const m = $('#modal'); if (m) m.remove(); }
function confirmBox(text, yesLabel = 'Yes') {
  return new Promise(res => {
    const m = modal(`<p>${esc(text)}</p><div class="row"><button class="btn ghost" id="cb-no" style="flex:1">Cancel</button><button class="btn ember" id="cb-yes" style="flex:1">${esc(yesLabel)}</button></div>`);
    m.querySelector('#cb-no').onclick = () => { closeModal(); res(false); };
    m.querySelector('#cb-yes').onclick = () => { closeModal(); res(true); };
  });
}

/* ---------- Coach (Claude) ---------- */
let sampleFn = null;
async function initCoach() {
  try { if (window.claude && window.claude.use) sampleFn = await window.claude.use('sample'); } catch { sampleFn = null; }
  if (sampleFn) render();
}
function contextSummary() {
  const t = today();
  return JSON.stringify({
    today: t, level: levelOf(state.xp), totalVotes: totalVotes(), shields: state.shields,
    identities: state.identities.map(i => i.text),
    habits: activeHabits().map(h => ({ name: h.name, type: h.type, twoMinute: h.two, anchor: h.stack, time: h.time, place: h.place,
      streak: streak(h), last14: Array.from({ length: 14 }, (_, i) => { const e = h.log[shiftKey(t, i - 13)]; return e ? e.k[0] : '-'; }).join('') })),
    recentNotes: Object.entries(state.notes).sort().slice(-5),
    lastReview: state.reviews[state.reviews.length - 1] || null
  });
}
const COACH_RULES = 'You are a direct, warm habit coach who applies the ideas of the book Atomic Habits: identity-based habits and votes, the habit loop, the four laws (obvious, attractive, easy, satisfying) and their inversions for bad habits, implementation intentions, habit stacking, environment design, temptation bundling, the two-minute rule, never miss twice, habit contracts, the Goldilocks zone, and reflection. Do not quote the book; explain in your own words. Be specific to the user\'s data. Give at most 3 concrete actions. Keep it under 160 words. Plain text, no markdown headings.';

/* ---------- Rendering ---------- */
function render() {
  if (!me) return;
  renderHero();
  const route = (location.hash || '#today').slice(1);
  const view = ['today', 'learn', 'build', 'you'].includes(route) ? route : 'today';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === view));
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && view !== 'today') return;
  $('#view').innerHTML = ({ today: viewToday, learn: viewLearn, build: viewBuild, you: viewYou })[view]();
  if (view === 'you') drawChart();
  if (view === 'learn' && ui.learnOpen) { const d = document.getElementById('lesson-' + ui.learnOpen); if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); } ui.learnOpen = null; }
}

function renderHero() {
  applyDayColor();
  const lvl = levelOf(state.xp), lo = xpFor(lvl), hi = xpFor(lvl + 1), pct = Math.round((state.xp - lo) / (hi - lo) * 100), os = overallStreak();
  $('#hero').innerHTML = `<div class="row between" style="align-items:flex-end">
      <div class="stack" style="gap:4px"><span class="row" style="gap:8px"><span class="lvpill num">LV ${lvl}</span><span class="lvl">${rankOf(lvl)}</span></span><span id="sync"></span></div>
      <div class="streakbig" title="Days in a row with every habit done (2-min versions and shields count)">${ICON.flame}<b class="num">${os}</b><span>day<br>streak</span></div></div>
    <div class="xpbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="XP to next level"><div style="width:${pct}%"></div></div>
    <div class="row between small muted num"><span>${state.xp - lo} / ${hi - lo} XP</span><span class="row hstat" style="gap:3px" title="Shields: each covers one missed day">${ICON.shield}${state.shields} shield${state.shields === 1 ? '' : 's'}</span></div>`;
  paintSync($('#sync'));
}
function drawSky() {}

function chainDots(h) {
  const t = today();
  return Array.from({ length: 14 }, (_, i) => { const k = shiftKey(t, i - 13), e = h.log[k];
    const c = !e ? '' : e.k === 'shield' ? 'shield' : e.k === 'mini' ? 'mini' : 'on';
    return `<span class="dot ${c} ${i === 13 ? 'today' : ''}" title="${k}${e ? ' · ' + e.k : ''}"></span>`; }).join('');
}

// One color per day of the week (green is reserved for a closed circle).
const DAY_COLORS = ['#F59E0B', '#6C4DFF', '#3A86FF', '#FF5DA2', '#FF7A00', '#00B4D8', '#FF4D6D'];
const DAY_NAMES = ['Amber Sunday', 'Violet Monday', 'Blue Tuesday', 'Pink Wednesday', 'Orange Thursday', 'Cyan Friday', 'Red Saturday'];
function dayColor(k = today()) { const [y, m, d] = k.split('-').map(Number); return DAY_COLORS[new Date(y, m - 1, d, 12).getDay()]; }
function applyDayColor() { const c = dayColor(); const r = document.documentElement.style; r.setProperty('--ring', c); r.setProperty('--ember', c); }
// Overall streak: consecutive days where every habit got a vote (full or 2-min) or a shield.
function dayKept(k) { const a = activeHabits(k); return a.length > 0 && a.every(h => !!h.log[k]); }
function overallStreak() { let k = today(); if (!dayKept(k)) k = shiftKey(k, -1); let n = 0; while (dayKept(k) && n < 3650) { n++; k = shiftKey(k, -1); } return n; }
function bestOverall() {
  const days = new Set(); state.habits.forEach(h => Object.keys(h.log).forEach(d => days.add(d)));
  let best = 0; for (const d of [...days].sort()) { if (!dayKept(d) || dayKept(shiftKey(d, -1))) continue; let n = 0, k = d; while (dayKept(k)) { n++; k = shiftKey(k, 1); } best = Math.max(best, n); }
  return best;
}
const PAL = ['#FF4D6D', '#FF9F1C', '#F5B700', '#06D6A0', '#3A86FF', '#8338EC', '#FF5DA2', '#00B4D8'];
function sortedActive(t = today()) {
  return activeHabits(t).sort((a, b) => (a.type === b.type ? 0 : a.type > b.type ? -1 : 1) || (a.time || '99').localeCompare(b.time || '99') || (a.created || '').localeCompare(b.created || ''));
}
function ringSVG(segs, size, stroke, cls = '') {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, n = Math.max(segs.length, 1);
  const gap = n > 1 ? Math.min(10, Math.max(2, C / n * (n > 12 ? 0.12 : 0.18))) : 0, len = C / n - gap;
  const base = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}" opacity=".5"/>`;
  const arcs = segs.map((g, i) => `<circle class="seg ${g.state}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${g.color}" stroke-width="${stroke}" stroke-linecap="${n > 1 ? 'butt' : 'round'}"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-(i * C / n + gap / 2)}" opacity="${g.state === 'full' ? 1 : g.state === 'mini' ? .6 : .16}"/>`).join('');
  return `<svg class="ringsvg ${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg)" aria-hidden="true">${segs.length ? arcs : base}</svg>`;
}
function nestedRings(states, closed) {
  const n = Math.max(states.length, 1), size = n >= 7 ? 240 : 220;
  const stroke = n >= 7 ? 8 : n >= 5 ? 10 : 13, gap = 3, outer = size / 2 - stroke / 2 - 2;
  const col = closed ? 'var(--done)' : 'var(--ring)';
  const rings = states.map((st, i) => {
    const r = outer - i * (stroke + gap), C = 2 * Math.PI * r, frac = st === 'full' ? 1 : st === 'mini' ? .5 : 0;
    return `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" opacity=".13"/>
      ${frac ? `<circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${C * frac} ${C}" style="--len:${C * frac}"/>` : ''}`;
  }).join('');
  return { svg: `<svg class="ringsvg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg)" aria-hidden="true">${rings}</svg>`, size };
}
function viewToday() {
  const t = today(), act = sortedActive(t), done = votesOn(t), total = act.length, chest = state.chests[t];
  if (!state.habits.filter(h => !h.archived).length) return `<section class="card ringcard">
      <div class="ringwrap">${ringSVG([1, 2, 3, 4, 5, 6].map(() => ({ color: 'var(--ring)', state: 'none' })), 220, 22)}<div class="ringmid"><b>0</b></div></div>
      <h2>Build your circle</h2><p class="muted small">Each habit is one piece. Finish them all to close it.</p>
      <div class="row" style="flex-wrap:wrap;justify-content:center"><button class="btn ember" data-act="load-pushups">Use push-up example</button><a class="btn ghost" href="#build" style="text-decoration:none">Add a habit</a></div></section>`;
  const closed = total > 0 && done >= total;
  document.body.classList.toggle('all-done', closed);
  const col = closed ? 'var(--done)' : 'var(--ring)';
  const segs = act.map(h => { const e = h.log[t]; return { color: col, state: e && isVote(e) ? (e.k === 'mini' ? 'mini' : 'full') : 'none' }; });
  let html = `<section class="card ringcard ${closed ? 'closed' : ''}" id="ring" aria-label="${done} of ${total} habits done today">
    <div class="ringwrap">${ringSVG(segs, 220, 22)}<div class="ringmid"><b class="num">${done}/${total}</b><span>${closed ? 'closed' : esc(DAY_NAMES[new Date().getDay()].split(' ')[1])}</span></div></div>
    <div class="ringline">${closed ? (chest && chest.status === 'ready' ? `<button class="btn ember chest-btn" data-act="open-chest">${ICON.chest.replace('<svg', '<svg width="18" height="18" style="vertical-align:-4px;margin-right:6px"')}Open your reward</button>` : '<b>Circle closed.</b> See you tomorrow.')
      : `<b>${total - done} left</b> to close your circle`}</div></section>`;

  const y = shiftKey(t, -1);
  act.filter(h => h.created < y && !h.log[y] && !h.log[t]).forEach(h => {
    html += `<section class="alert" role="alert"><div><b>${esc(h.name)}</b> · missed yesterday. Don't miss twice.</div>
      <div class="btns">${h.type === 'build' ? `<button class="btn sm ember" data-log="${h.id}" data-kind="mini">Do 2-min</button>` : ''}
      ${state.shields > 0 ? `<button class="btn sm ghost" data-act="shield" data-id="${h.id}">Use shield (${state.shields})</button>` : ''}</div></section>`;
  });

  html += `<section class="card list">` + act.map((h, i) => {
    const e = h.log[t], s = streak(h), on = e && isVote(e);
    const cue = h.type === 'build' ? (h.stack ? `After I ${esc(h.stack)}` : h.time ? `At ${esc(h.time)}` : '') : 'Avoid today';
    const goldilocks = h.type === 'build' && s >= 14 && s % 14 === 0 && h.raisedAt !== t;
    return `<div class="hrow ${on ? 'on' : ''}">
      <button class="check ${on ? (e.k === 'mini' ? 'mini' : 'done') : ''}" data-log="${h.id}" data-kind="${h.type === 'break' ? 'avoid' : 'full'}"
        aria-label="${h.type === 'break' ? 'I avoided' : 'I did'} ${esc(h.name)} today" aria-pressed="${!!on}">${h.type === 'break' ? ICON.ban : ICON.check}</button>
      <div style="flex:1;min-width:0"><div class="hname">${esc(h.name)}</div>
        ${cue ? `<div class="hmeta">${cue}</div>` : ''}
        ${h.type === 'build' && h.two && !(e && e.k === 'full') ? `<button class="linkbtn" data-log="${h.id}" data-kind="mini" aria-pressed="${!!(e && e.k === 'mini')}">${e && e.k === 'mini' ? '2-min done ✓' : 'Only 2 min: ' + esc(h.two)}</button>` : ''}
        ${goldilocks ? `<button class="linkbtn" data-act="edit" data-id="${h.id}">${s} days. Too easy? Level it up</button>` : ''}
      </div>${s ? `<span class="flame num">${ICON.flame}${s}</span>` : ''}</div>`;
  }).join('') + `</section>`;

  // Daily lesson: next unread one (in order); once all are read, a different one each day for review.
  const allRead = LESSONS.every(l => state.lessons[l.id]);
  let lesson = state.lessonOfDay && state.lessonOfDay.day === t && LESSONS.find(l => l.id === state.lessonOfDay.id);
  if (!lesson) { lesson = allRead ? LESSONS[hashSeed(t) % LESSONS.length] : LESSONS.find(l => !state.lessons[l.id]); state.lessonOfDay = { day: t, id: lesson.id }; }
  const learned = !!state.lessons[lesson.id];
  html += `<details class="card lessoncard" id="daily-lesson"><summary class="row between" style="gap:10px">
      <span style="min-width:0"><span class="small muted">${allRead && learned ? 'Today\'s review' : `Lesson ${LESSONS.indexOf(lesson) + 1} of ${LESSONS.length}`}</span><br><b>${esc(lesson.t)}</b></span>
      <span class="small" style="color:var(--ember);font-weight:700;white-space:nowrap">${learned ? 'Read ✓' : 'Read · +25'}</span></summary>
    <p style="margin-top:8px">${esc(lesson.b)}</p><div class="doit small"><b>Try today:</b> ${esc(lesson.d)}</div>
    ${learned ? '' : `<button class="btn ember sm" data-act="learn-today" data-id="${lesson.id}" style="align-self:flex-start">Got it · +25 XP</button>`}</details>`;

  html += partnerCard();

  const qs = questsFor(t), qd = qs.filter(q => state.quests[t + ':' + q]).length;
  html += `<details class="card quests" id="quests"><summary class="row between"><span style="font-weight:700">Quests</span><span class="muted small num">${qd}/3 · bonus XP</span></summary>
    ${qs.map(q => { const d = QUESTS[q], ok = !!state.quests[t + ':' + q];
      return `<div class="quest ${ok ? 'done' : ''}">${d.manual && !ok ? `<button class="qbox" data-act="quest-manual" data-q="${q}" aria-label="Mark done"></button>` : `<span class="qbox">${ok ? ICON.check.replace('<svg', '<svg width="14" height="14"') : ''}</span>`}
        <span class="qtext">${esc(d.t)}</span><span class="qxp">+${d.xp}</span></div>`; }).join('')}</details>`;
  return html;
}

function viewLearn() {
  const n = Object.keys(state.lessons).length;
  let html = `<section class="card"><h2>The Atomic Habits playbook</h2>
    
    <div class="progress"><div style="width:${n / LESSONS.length * 100}%"></div></div>
    <span class="small muted num">${n} of ${LESSONS.length} learned</span></section>`;
  let i = 0;
  for (const sec of SECTIONS) {
    const ls = LESSONS.filter(l => l.s === sec.id);
    html += `<section class="card"><div><h2>${esc(sec.title)}</h2><span class="small muted">${esc(sec.sub)} · ${ls.filter(l => state.lessons[l.id]).length}/${ls.length}</span></div><div>`;
    for (const l of ls) {
      i++; const done = !!state.lessons[l.id];
      html += `<details class="lesson ${done ? 'learned' : ''}" id="lesson-${l.id}"><summary><span class="lnum">${done ? ICON.check.replace('<svg', '<svg width="14" height="14"') : i}</span>${esc(l.t)}</summary>
        <div class="lbody"><p>${esc(l.b)}</p><div class="doit"><b>Do this:</b> ${esc(l.d)}</div>
        <div class="row" style="flex-wrap:wrap">${done ? '<span class="tag good">Learned</span>' : `<button class="btn ember sm" data-act="learn" data-id="${l.id}">Mark learned · +25 XP</button>`}
        ${l.go ? `<a class="btn ghost sm" href="#${l.go}" style="text-decoration:none">Open ${l.go === 'you' ? 'You' : l.go[0].toUpperCase() + l.go.slice(1)}</a>` : ''}</div></div></details>`;
    }
    html += '</div></section>';
  }
  html += `<p class="small muted" style="padding:0 4px">Lessons summarize the book's ideas in my own words. For the full stories and research, read Atomic Habits by James Clear.</p>`;
  return html;
}

function habitForm() {
  const d = ui.draft || {};
  const f = (id, label, ph, val, type = 'text') => `<div><label for="${id}">${label}</label><input type="${type}" id="${id}" placeholder="${esc(ph)}" value="${esc(val || '')}"></div>`;
  const idOpts = state.identities.map(i => `<option value="${i.id}" ${d.identityId === i.id ? 'selected' : ''}>${esc(i.text)}</option>`).join('');
  const identityField = `<div><label for="h-identity">I am a person who…</label>
    ${state.identities.length ? `<select id="h-identity"><option value="">Choose…</option>${idOpts}<option value="__new">+ New</option></select>` : ''}
    <input type="text" id="h-identity-new" class="${state.identities.length ? 'hidden' : ''}" placeholder="moves every morning" value="${esc(d.identityNew || '')}" style="margin-top:6px"></div>`;
  const more = inner => `<details class="more" ${d.env || d.bundle || d.prep || d.reward || d.replace || d.hard || d.cost || d.identityId || d.identityNew ? 'open' : ''}><summary>More (optional)</summary><div class="stack" style="gap:12px;margin-top:12px">${inner}</div></details>`;
  if (ui.buildMode === 'good') return `
    ${f('h-name', 'Habit', '10 push-ups', d.name)}
    ${f('h-stack', 'After I…', 'get out of bed', d.stack)}
    <div class="two">${f('h-time', 'Time', '', d.time, 'time')}${f('h-place', 'Place', 'beside the bed', d.place)}</div>
    ${f('h-two', '2-minute version', '1 push-up', d.two)}
    ${more(identityField + f('h-env', 'Put in sight', 'Mat open by the bed', d.env) + f('h-bundle', 'Only while doing it, I get to…', 'play my favorite song', d.bundle)
      + f('h-prep', 'Prepare tonight', 'Clear the floor', d.prep) + f('h-reward', 'Reward after', 'Coffee', d.reward))}`;
  return `
    ${f('h-name', 'Habit to break', 'Phone in bed', d.name)}
    ${f('h-cue', 'Trigger', 'Phone on the nightstand', d.cue)}
    ${f('h-invisible', 'Remove the trigger', 'Charge it in the kitchen', d.invisible)}
    ${more(identityField + f('h-replace', 'Do this instead', 'Read one page', d.replace) + f('h-hard', 'Make it harder', 'App limit after 10 PM', d.hard)
      + f('h-cost', 'Who holds you to it?', 'My wife; a slip costs $5', d.cost))}`;
}

function viewBuild() {
  const editing = ui.editId && state.habits.find(h => h.id === ui.editId);
  let html = `<section class="card">
    <div class="row between"><h2>${editing ? 'Edit habit' : 'New habit'}</h2>${editing ? '<button class="linkbtn" data-act="cancel-edit">Cancel</button>' : ''}</div>
    ${editing ? '' : `<div class="seg" role="tablist"><button class="${ui.buildMode === 'good' ? 'on' : ''}" data-act="mode" data-m="good" role="tab" aria-selected="${ui.buildMode === 'good'}">Build</button>
      <button class="${ui.buildMode === 'break' ? 'on' : ''}" data-act="mode" data-m="break" role="tab" aria-selected="${ui.buildMode === 'break'}">Break</button></div>`}
    ${sampleFn && !editing ? `<div class="doit stack"><label for="coach-goal" style="margin:0">Let the coach draft it: what do you want to change?</label>
      <div class="row"><input type="text" id="coach-goal" placeholder="${ui.buildMode === 'good' ? 'Get stronger in the mornings' : 'Stop late-night scrolling'}"><button class="btn soft sm" data-act="coach-draft">Draft</button></div>
      <span class="small muted" id="coach-draft-msg"></span></div>` : ''}
    <div class="stack" style="gap:14px">${habitForm()}</div>
    <div class="err" id="h-err"></div>
    <button class="btn ember full" data-act="save-habit">${editing ? 'Save changes' : 'Add habit'}</button>
  </section>`;

  const live = state.habits.filter(h => !h.archived);
  if (live.length) html += `<section class="card"><h2>Your habits</h2>${live.map(h => `<div class="row between" style="border-top:1px solid var(--line);padding-top:8px">
      <div style="min-width:0"><div style="font-weight:700">${esc(h.name)}</div><div class="small muted">${h.type === 'break' ? 'Breaking' : `2-min: ${esc(h.two)}`} · best streak ${bestStreak(h)}</div></div>
      <div class="row" style="gap:4px"><button class="btn ghost sm" data-act="edit" data-id="${h.id}">Edit</button><button class="btn ghost sm" data-act="archive" data-id="${h.id}" aria-label="Remove ${esc(h.name)}">Remove</button></div></div>`).join('')}
    <p class="small muted">Keep it to 1–3 habits.</p></section>`;

  // Scorecard
  const sc = state.scorecard, plus = sc.filter(s => s.r === '+').length, minus = sc.filter(s => s.r === '-').length;
  html += `<section class="card"><div class="row between"><h2>Habit scorecard</h2><span class="small muted num">${plus} good · ${minus} bad</span></div>
    <p class="small muted">Your normal day. + good, − bad, = neutral.</p>
    <div>${sc.map(s => `<div class="sc-item"><span>${esc(s.text)}</span><div class="rate">
      ${['+', '-', '='].map(r => `<button class="${s.r === r ? 'on ' : ''}${r === '+' ? 'p' : r === '-' ? 'm' : 'z'}" data-act="rate" data-id="${s.id}" data-r="${r}" aria-label="Rate ${r === '+' ? 'good' : r === '-' ? 'bad' : 'neutral'}">${r === '-' ? '−' : r}</button>`).join('')}
      </div><button class="x" data-act="sc-del" data-id="${s.id}" aria-label="Delete">×</button></div>`).join('') || '<p class="small muted">Nothing yet. Start with waking up.</p>'}</div>
    <div class="row"><input type="text" id="sc-new" placeholder="Wake up, check phone"><button class="btn soft sm" data-act="sc-add">Add</button></div>
</section>`;

  // Contract
  const c = state.contract || {};
  html += `<section class="card"><h2>Habit contract</h2>
    <p class="small muted">A promise, a witness, a price.</p>
    <div><label for="ct-commit">I commit to…</label><input type="text" id="ct-commit" value="${esc(c.commit || '')}" placeholder="doing at least 1 push-up every morning for 30 days"></div>
    <div class="two"><div><label for="ct-partner">Accountability partner</label><input type="text" id="ct-partner" value="${esc(c.partner || '')}" placeholder="Ravi"></div>
      <div><label for="ct-cost">If I miss twice in a row, I will…</label><input type="text" id="ct-cost" value="${esc(c.cost || '')}" placeholder="pay Ravi $10"></div></div>
    <div class="err" id="ct-err"></div>
    <div class="row" style="flex-wrap:wrap">${c.signed ? `<span class="tag good">Signed ${esc(c.signed)}</span>` : '<button class="btn ember sm" data-act="ct-sign">Sign contract · +30 XP</button>'}
      <button class="btn ghost sm" data-act="ct-copy">Copy to send to partner</button></div></section>`;
  return html;
}

function viewYou() {
  const days = activeDays(), mult = Math.pow(1.01, days);
  const perfectN = Object.keys(state.perfect).length;
  const best = Math.max(0, ...state.habits.map(bestStreak));
  let html = partnerSettings() + reminderCard() + `<section class="card"><h2>Who you are becoming</h2>
    
    ${state.identities.map(i => { const v = state.habits.filter(h => h.identityId === i.id).reduce((n, h) => n + Object.values(h.log).filter(isVote).length, 0);
      return `<div class="idbar"><div class="row between"><span>I am a person who <b>${esc(i.text)}</b></span><span class="row" style="gap:6px"><span class="small num muted">${v} votes</span><button class="x" data-act="id-del" data-id="${i.id}" aria-label="Delete identity">×</button></span></div>
        <div class="progress"><div style="width:${Math.min(100, v)}%"></div></div></div>`; }).join('') || ''}
    <div class="row"><input type="text" id="id-new" placeholder="keeps promises to myself"><button class="btn soft sm" data-act="id-add">Add</button></div></section>`;

  html += `<section class="card"><div class="row between"><h2>1% better, compounded</h2><span class="tag ember num">${days} active day${days === 1 ? '' : 's'}</span></div>
    <p class="small muted">You: <b class="num">${mult.toFixed(2)}×</b>. Flat for months, then it bends. Don't quit before the bend.</p>
    <canvas id="chart" role="img" aria-label="Compounding curve: 1.01 to the power of days, from 1x at day 0 to 37.8x at day 365, with your position marked at day ${days}"></canvas></section>`;

  html += `<section class="card"><h2>Stats</h2><div class="stats num">
      <div class="stat"><b>${totalVotes()}</b><span>Total votes</span></div>
      <div class="stat"><b>${bestOverall()}</b><span>Best streak</span></div>
      <div class="stat"><b>${perfectN}</b><span>Perfect days</span></div>
      <div class="stat"><b>${state.xp}</b><span>Total XP</span></div></div></section>`;

  const got = ACH.filter(a => state.achievements[a.id]).length;
  html += `<section class="card"><div class="row between"><h2>Achievements</h2><span class="small muted num">${got}/${ACH.length}</span></div>
    <div class="badges">${ACH.map(a => `<div class="badge ${state.achievements[a.id] ? '' : 'locked'}" title="${esc(a.d)}"><span style="color:var(--gold)">${ICON.star}</span><b>${esc(a.t)}</b><span class="muted">${esc(a.d)}</span></div>`).join('')}</div></section>`;

  // Weekly review
  const wk = weekKey(), doneWk = state.reviews.find(r => r.week === wk);
  html += `<section class="card"><div class="row between"><h2>Weekly review</h2>${doneWk ? '<span class="tag good">Done this week</span>' : '<span class="tag ember">+40 XP</span>'}</div>
    ${doneWk ? `<p class="small muted">Next review opens Monday. Last answers:</p><div class="doit small">${['What went well', 'What didn\'t', 'One change for next week'].map((q, i) => `<b>${q}:</b> ${esc(doneWk.a[i] || '')}`).join('<br>')}</div>`
    : `<div><label for="rv-0">What went well this week?</label><textarea id="rv-0"></textarea></div>
      <div><label for="rv-1">What didn't go well, and why?</label><textarea id="rv-1"></textarea></div>
      <div><label for="rv-2">One change for next week (make it obvious, attractive, easy or satisfying)</label><textarea id="rv-2"></textarea></div>
      <div class="err" id="rv-err"></div><button class="btn ember" data-act="review">Save review</button>`}</section>`;

  if (sampleFn) html += `<section class="card"><h2>Ask your coach</h2>
    <p class="small muted">Your coach sees your habits, streaks and notes, and answers using the book's principles.</p>
    <textarea id="coach-q" placeholder="I keep skipping push-ups when I wake up late. What should I change?"></textarea>
    <div class="row" style="flex-wrap:wrap"><button class="btn ember sm" data-act="coach-ask">Ask</button><button class="btn ghost sm" data-act="coach-report">Review my last 2 weeks</button></div>
    <div class="coach-out hidden" id="coach-out" aria-live="polite"></div></section>`;

  html += `<section class="card"><h2>Settings</h2>
    <div class="row between"><span>Sound effects</span><button class="btn ghost sm" data-act="sound" aria-pressed="${state.settings.sound}">${state.settings.sound ? 'On' : 'Off'}</button></div>
    <div class="row between"><span>Where your data lives</span><span class="small muted" style="text-align:right">Your account, synced to every device you sign in on</span></div>
    <div class="row" style="flex-wrap:wrap"><button class="btn ghost sm" data-act="backup">Copy backup</button><button class="btn ghost sm" data-act="restore">Restore backup</button><button class="btn ghost sm" data-act="reset" style="color:#c0362c">Reset everything</button></div></section>`;
  return html;
}

function drawChart() {
  const c = $('#chart'); if (!c) return;
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; c.width = r.width * dpr; c.height = r.height * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim(), ember = cs.getPropertyValue('--ember').trim(), indigo = cs.getPropertyValue('--indigo').trim();
  const L = 34, R = 12, T = 10, B = 24, W = r.width - L - R, H = r.height - T - B, maxY = 40;
  const px = d => L + d / 365 * W, py = v => T + H - v / maxY * H;
  x.font = '11px Figtree, system-ui'; x.fillStyle = ink; x.strokeStyle = line; x.lineWidth = 1;
  [0, 10, 20, 30, 40].forEach(v => { x.beginPath(); x.moveTo(L, py(v)); x.lineTo(L + W, py(v)); x.stroke(); x.fillText(v + '×', 4, py(v) + 4); });
  [0, 90, 180, 270, 365].forEach(d => x.fillText(d === 0 ? 'Day 0' : d, px(d) - (d === 365 ? 18 : d === 0 ? 0 : 8), T + H + 16));
  x.beginPath(); for (let d = 0; d <= 365; d++) x.lineTo(px(d), py(Math.pow(1.01, d))); x.lineTo(px(365), py(0)); x.lineTo(px(0), py(0)); x.closePath();
  x.fillStyle = ember + '22'; x.fill();
  x.beginPath(); for (let d = 0; d <= 365; d++) x.lineTo(px(d), py(Math.pow(1.01, d))); x.strokeStyle = ember; x.lineWidth = 2.5; x.stroke();
  x.beginPath(); for (let d = 0; d <= 365; d++) x.lineTo(px(d), py(Math.pow(0.99, d))); x.strokeStyle = ink; x.setLineDash([4, 4]); x.lineWidth = 1.2; x.stroke(); x.setLineDash([]);
  x.fillStyle = ink; x.fillText('1% worse daily', px(250), py(0) - 6);
  x.fillStyle = ember; x.fillText('37.8× at day 365', px(365) - 92, py(37.8) + 4);
  const d = Math.min(activeDays(), 365), v = Math.pow(1.01, d);
  x.beginPath(); x.arc(px(d), py(v), 6, 0, 7); x.fillStyle = indigo; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke();
  x.fillStyle = indigo; x.font = 'bold 12px Figtree, system-ui'; x.fillText('You', px(d) + 9, py(v) - 8);
}

/* ---------- Actions ---------- */
function readForm() {
  const g = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const sel = document.getElementById('h-identity');
  const f = { name: g('h-name'), identityId: sel ? sel.value : '', identityNew: g('h-identity-new') };
  if (ui.buildMode === 'good') Object.assign(f, { stack: g('h-stack'), time: g('h-time'), place: g('h-place'), env: g('h-env'), bundle: g('h-bundle'), getto: g('h-getto'), two: g('h-two'), prep: g('h-prep'), reward: g('h-reward') });
  else Object.assign(f, { cue: g('h-cue'), invisible: g('h-invisible'), ugly: g('h-ugly'), hard: g('h-hard'), replace: g('h-replace'), cost: g('h-cost') });
  return f;
}
function saveHabit(btn) {
  const f = readForm(), err = $('#h-err');
  if (!f.name) { err.textContent = 'Give the habit a name first.'; $('#h-name').focus(); return; }
  if (ui.buildMode === 'good') {
    if (!f.two) { err.textContent = 'Add a two-minute version. It is your safety net for hard days.'; $('#h-two').focus(); return; }
    if (!f.stack && !f.time) { err.textContent = 'Add an "After I…" anchor or a time. A habit needs a clear cue.'; $('#h-stack').focus(); return; }
  } else if (!f.invisible) { err.textContent = 'Write how you will remove the cue. That is the strongest lever for breaking a habit.'; $('#h-invisible').focus(); return; }
  let identityId = f.identityId && f.identityId !== '__new' ? f.identityId : '';
  if (!identityId && f.identityNew) { const i = { id: uid(), text: f.identityNew.replace(/^i am a person who\s*/i, '') }; state.identities.push(i); identityId = i.id; }
  const data = Object.assign({}, f, { identityId }); delete data.identityNew;
  const editing = ui.editId && state.habits.find(h => h.id === ui.editId);
  if (editing) { Object.assign(editing, data); editing.raisedAt = today(); toast(ICON.check, 'Habit updated.'); }
  else {
    state.habits.push(Object.assign({ id: uid(), type: ui.buildMode === 'good' ? 'build' : 'break', created: today(), log: {}, archived: false }, data));
    gainXP(15, btn, '+15 XP · habit designed'); sfx('badge');
  }
  ui.editId = null; ui.draft = null; checkAchievements(); save();
  location.hash = '#today'; render();
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act],[data-log]'); if (!t) return;
  if (t.dataset.log) { logHabit(t.dataset.log, t.dataset.kind, t); return; }
  const a = t.dataset.act, id = t.dataset.id;
  if (await cloudAction(a, t)) return;
  switch (a) {
    case 'close-modal': closeModal(); break;
    case 'open-chest': openChest(); break;
    case 'shield': useShield(id); break;
    case 'quest-manual': { const k = today() + ':' + t.dataset.q; if (!state.quests[k]) { state.quests[k] = true; gainXP(QUESTS[t.dataset.q].xp, t, `+${QUESTS[t.dataset.q].xp} XP · quest`); sfx('badge'); save(); render(); } break; }
    case 'load-pushups': {
      ui.buildMode = 'good'; ui.editId = null;
      ui.draft = { name: '10 push-ups', identityNew: '', stack: 'get out of bed', place: 'beside the bed',
        env: 'Mat open by the bed', bundle: 'play my favorite song',
        two: '1 push-up', prep: '', reward: 'Coffee' };
      location.hash = '#build'; break;
    }
    case 'goto-lesson': ui.learnOpen = id; if (location.hash === '#learn') render(); else location.hash = '#learn'; break;
    case 'learn-today': if (!state.lessons[id]) { state.lessons[id] = today(); state.lessonDays[today()] = true; gainXP(25, t, '+25 XP · lesson'); sfx('tick'); checkQuests(t); checkAchievements(); save(); render(); const d = $('#daily-lesson'); if (d) d.open = true; } break;
    case 'learn': if (!state.lessons[id]) { state.lessons[id] = today(); state.lessonDays[today()] = true; gainXP(25, t, '+25 XP · lesson'); sfx('tick'); checkQuests(t); checkAchievements(); save(); ui.learnOpen = id; render(); } break;
    case 'mode': ui.buildMode = t.dataset.m; ui.draft = null; render(); break;
    case 'save-habit': saveHabit(t); break;
    case 'edit': { const h = state.habits.find(x => x.id === id); if (!h) break; ui.editId = id; ui.buildMode = h.type === 'break' ? 'break' : 'good'; ui.draft = Object.assign({}, h); location.hash = '#build'; render(); scrollTo(0, 0); break; }
    case 'cancel-edit': ui.editId = null; ui.draft = null; render(); break;
    case 'archive': { const h = state.habits.find(x => x.id === id); if (h && await confirmBox(`Remove "${h.name}"? Your earned XP and votes stay.`, 'Remove')) { h.archived = true; save(); render(); } break; }
    case 'rate': { const s = state.scorecard.find(x => x.id === id); if (s) { s.r = t.dataset.r; save(); render(); } break; }
    case 'sc-add': { const v = $('#sc-new').value.trim(); if (!v) { $('#sc-new').focus(); break; } state.scorecard.push({ id: uid(), text: v, r: '' }); checkAchievements(); save(); render(); $('#sc-new') && $('#sc-new').focus(); break; }
    case 'sc-del': state.scorecard = state.scorecard.filter(x => x.id !== id); save(); render(); break;
    case 'ct-sign': {
      const c = { commit: $('#ct-commit').value.trim(), partner: $('#ct-partner').value.trim(), cost: $('#ct-cost').value.trim() };
      if (!c.commit || !c.partner || !c.cost) { $('#ct-err').textContent = 'Fill in all three lines before signing.'; break; }
      state.contract = Object.assign(c, { signed: today() }); gainXP(30, t, '+30 XP · contract'); checkAchievements(); save(); render(); break;
    }
    case 'ct-copy': {
      const c = { commit: $('#ct-commit').value.trim(), partner: $('#ct-partner').value.trim(), cost: $('#ct-cost').value.trim() };
      const text = `HABIT CONTRACT\nI commit to ${c.commit || '…'}.\nMy accountability partner is ${c.partner || '…'}.\nIf I miss twice in a row, I will ${c.cost || '…'}.\nDate: ${today()}\nSigned: ____________   Partner: ____________`;
      try { await navigator.clipboard.writeText(text); toast(ICON.check, 'Contract copied. Paste it into a message to your partner.'); }
      catch { modal(`<h3>Copy this</h3><textarea style="min-height:160px" readonly>${esc(text)}</textarea><button class="btn full" data-act="close-modal">Done</button>`); }
      state.contract = Object.assign(state.contract || {}, c); save(); break;
    }
    case 'id-add': { const v = $('#id-new').value.trim().replace(/^i am a person who\s*/i, ''); if (!v) { $('#id-new').focus(); break; } state.identities.push({ id: uid(), text: v }); gainXP(10, t); checkAchievements(); save(); render(); break; }
    case 'id-del': if (await confirmBox('Delete this identity statement? Linked habits keep their votes.', 'Delete')) { state.identities = state.identities.filter(i => i.id !== id); save(); render(); } break;
    case 'review': {
      const ans = [0, 1, 2].map(i => $('#rv-' + i).value.trim());
      if (ans.some(x => !x)) { $('#rv-err').textContent = 'Answer all three questions. One honest line each is enough.'; break; }
      state.reviews.push({ week: weekKey(), day: today(), a: ans }); gainXP(40, t, '+40 XP · review'); sfx('perfect'); checkQuests(t); checkAchievements(); save(); render(); break;
    }
    case 'sound': state.settings.sound = !state.settings.sound; save(); render(); if (state.settings.sound) sfx('tick'); break;
    case 'backup': {
      const text = JSON.stringify(state);
      try { await navigator.clipboard.writeText(text); toast(ICON.check, 'Backup copied. Paste it into a note or email to yourself.'); }
      catch { modal(`<h3>Your backup</h3><textarea style="min-height:160px" readonly>${esc(text)}</textarea><button class="btn full" data-act="close-modal">Done</button>`); }
      break;
    }
    case 'restore': {
      const m = modal(`<h3>Restore a backup</h3><p class="small muted">Paste a backup you copied earlier. This replaces your current data.</p><textarea id="rs-text" style="min-height:140px"></textarea><div class="err" id="rs-err"></div>
        <div class="row"><button class="btn ghost" data-act="close-modal" style="flex:1">Cancel</button><button class="btn ember" id="rs-go" style="flex:1">Restore</button></div>`);
      m.querySelector('#rs-go').onclick = () => { try { const s = JSON.parse(m.querySelector('#rs-text').value); if (!s || !s.v || !Array.isArray(s.habits)) throw 0; state = normalize(s); save(); closeModal(); render(); toast(ICON.check, 'Backup restored.'); } catch { m.querySelector('#rs-err').textContent = 'That text is not a valid backup. Copy it again from Settings → Copy backup.'; } };
      break;
    }
    case 'reset': if (await confirmBox('Erase every habit, vote, XP and achievement? This cannot be undone.', 'Erase everything')) { state = freshState(); save(); location.hash = '#today'; render(); } break;
    case 'coach-draft': coachDraft(t); break;
    case 'coach-ask': coachAsk(); break;
    case 'coach-report': coachAsk('Review my last 14 days of data. What is working, what is slipping, and what are the 3 most useful changes using the four laws?'); break;
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'h-identity') $('#h-identity-new').classList.toggle('hidden', e.target.value !== '__new');
  if (e.target.id === 'note') { const v = e.target.value.trim(), k = today(); if ((state.notes[k] || '') !== v) { state.notes[k] = v; checkQuests(e.target); save(); renderHero(); const q = $('#quests'); if (q) render(); } }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const map = { 'sc-new': 'sc-add', 'id-new': 'id-add', 'coach-goal': 'coach-draft' };
  if (map[e.target.id]) { e.preventDefault(); const b = document.querySelector(`[data-act="${map[e.target.id]}"]`); b && b.click(); }
  if (e.target.id === 'note') e.target.blur();
  if (e.target.id === 'a-pass' || e.target.id === 'a-email') { e.preventDefault(); const b = document.querySelector('[data-act="do-signin"],[data-act="do-signup"]'); b && b.click(); }
  if (e.target.id === 'partner-code') { e.preventDefault(); const b = document.querySelector('[data-act="link"]'); b && b.click(); }
});
document.addEventListener('input', e => { if (e.target.id && e.target.id.startsWith('h-')) { const err = $('#h-err'); if (err) err.textContent = ''; } if (e.target.id && e.target.id.startsWith('rv-')) { const er = $('#rv-err'); if (er) er.textContent = ''; } if (e.target.id && e.target.id.startsWith('ct-')) { const er = $('#ct-err'); if (er) er.textContent = ''; } });

async function coachDraft(btn) {
  const goal = $('#coach-goal').value.trim(), msg = $('#coach-draft-msg');
  if (!goal) { msg.textContent = 'Type what you want to change first.'; return; }
  btn.disabled = true; msg.textContent = 'Drafting your habit…';
  const good = ui.buildMode === 'good';
  const keys = good ? 'name, identity, stack, time (HH:MM or empty), place, env, bundle, getto, two, prep, reward' : 'name, cue, identity, invisible, ugly, hard, replace, cost';
  try {
    const out = await sampleFn.json(`${COACH_RULES}\n\nDesign ONE ${good ? 'new habit to build' : 'bad-habit breaker'} for this goal: "${goal}".\nCurrent data: ${contextSummary()}\n` +
      `Return only a JSON object with string fields: ${keys}. "identity" completes "I am a person who…". ${good ? '"two" is a version that takes under two minutes. "stack" completes "After I…". "bundle" completes "only while doing this, I get to…". "getto" is a "I get to… because…" reframe. "prep" completes "tonight I will prepare…".' : '"invisible" removes the cue, "ugly" names the real cost, "hard" adds friction, "replace" is a better habit, "cost" names an accountability partner and consequence.'} Keep each field under 12 words.`);
    const d = Object.assign({}, out); d.identityNew = (d.identity || '').replace(/^i am a person who\s*/i, ''); delete d.identity;
    if (good && d.time && !/^\d{2}:\d{2}$/.test(d.time)) d.time = '';
    ui.draft = d; render(); toast(ICON.check, 'Draft ready. Edit anything, then add it.');
  } catch (err) {
    btn.disabled = false;
    msg.textContent = err && err.code === 'rate_limited' ? 'The coach is busy. Try again in a minute.' : err && err.code === 'not_granted' ? 'The coach needs your permission. Allow it when asked.' : 'Couldn\'t draft that. Try rewording, or fill the form yourself.';
  }
}
let coachAbort = null;
async function coachAsk(preset) {
  const q = preset || ($('#coach-q') ? $('#coach-q').value.trim() : '');
  const out = $('#coach-out');
  if (!q) { out.classList.remove('hidden'); out.textContent = 'Type a question first.'; return; }
  if (coachAbort) coachAbort.abort(); coachAbort = new AbortController();
  out.classList.remove('hidden'); out.textContent = 'Thinking…';
  try {
    const r = await sampleFn(`${COACH_RULES}\n\nMy data: ${contextSummary()}\n\nMy question: ${q}`, { signal: coachAbort.signal, cache: false, onText: ({ text }) => { out.textContent = text; } });
    out.textContent = r.text;
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    out.textContent = err && err.code === 'rate_limited' ? 'The coach is busy. Try again in a minute.' : 'The coach couldn\'t answer right now. Try again shortly.';
  }
}

/* ---------- Boot ---------- */
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
(function boot() {
  startCloud();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
