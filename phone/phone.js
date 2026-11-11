'use strict';
/* AmeSSIST iPhone版（段階1: 閲覧、段階2: 「＋」で入力して、まとめてMacへ送る）。
   データは、Macの snapshot.py が書き出したJSON（api.build_state(readonly=True)）を1つ読み込み、端末内（IndexedDB）に保存する。
   「今日」と現在時刻は、端末の時計で決める（スナップショットの today は使わない）。
   取消・編集・Done・完了は作らない（Macで行う）。
   入力（段階2）: 「＋」で送信待ちに溜め（端末内。スナップショットとは別の場所）、「送信」で1つのテキストファイルにまとめ、
   共有シート（AirDrop）でMacへ送る。ファイルの形式は、ショートカットの入力ファイルと同じ（PROJECT.md 第5節）。 */

const APP_VER = '段階2 v1';
const WDJ = '日月火水木金土';
const WDE = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/* アイコン（Mac版 app.js の ICONS と同じ線画。load=読み込み） */
const ICONS = {
  events: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  tasks: '<path d="M5 21V4M5 4h12l-2.5 4 2.5 4H5"/>',
  todo: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  recurring: '<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>',
  ledger: '<circle cx="12" cy="12" r="9"/><path d="M9 7.5l3 4.5 3-4.5M12 12v5M9.5 12.5h5M9.5 15h5"/>',
  load: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
};
const icon = id => `<svg class="pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
const tri = d => `<svg class="tri" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const TRI_L = 'M7 1.5L2.5 5 7 8.5z', TRI_R = 'M3 1.5L7.5 5 3 8.5z';
/* 下タブ（左から）。ホームはない。最初に開くのは予定 */
const TABS = [['ledger', '収支'], ['todo', 'ToDo'], ['tasks', 'タスク'], ['recurring', '定期'], ['events', '予定']];
const PRI = { '高': 0, '中': 1, '低': 2 };
const HOR = { '短期': 0, '中期': 1, '長期': 2 };
const VT_HOUR = 60;   // 縦タイムラインの1時間の高さ（px）

let S = null;   // 読み込んだスナップショット
const ui = { page: 'events', selDay: null, calMonth: null, taskDay: null, evTasks: true, cal: false, sheet: null, kind: 'おまかせ' };
try { if (localStorage.getItem('evTasks') === '0') ui.evTasks = false; } catch (e) { /* 覚えられなくても動く */ }

/* ---------- 小さな道具 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const parseD = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmtMD = s => { const d = parseD(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtMDW = s => `${fmtMD(s)}(${WDJ[parseD(s).getDay()]})`;
const timeOf = s => (s && s.length > 10 ? s.slice(11, 16) : '');
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const yen = n => Number(n).toLocaleString('ja-JP') + '円';
const signed = n => (n > 0 ? '+' + yen(n) : n < 0 ? '−' + yen(-n) : yen(0));
const TODAY = () => ymd(new Date());                                   // 端末の「今日」
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const dowClass = d => (d === 6 ? 'sat' : d === 0 ? 'sun' : '');
/* 祝日は S.holidays（Macが計算）。日曜と同じ赤。土曜は青 */
const holName = key => ((S && S.holidays) || {})[key] || '';
const dayTone = key => (holName(key) ? 'sun' : dowClass(parseD(key).getDay()));
const itemDay = i => (i.kind === '予定' ? (i.start_at || '').slice(0, 10) : (i.due_date || ''));
const itemTime = i => (i.kind === '予定' ? timeOf(i.start_at) : (i.due_time || ''));
const todoSort = (a, b) => ((a.status === 'doing' ? 0 : 1) - (b.status === 'doing' ? 0 : 1)) || ((PRI[a.priority] ?? 3) - (PRI[b.priority] ?? 3)) || ((HOR[a.horizon] ?? 3) - (HOR[b.horizon] ?? 3)) || (a.id - b.id);
const live = i => i.status === 'open' || i.status === 'doing';
const byKind = k => S.items.filter(i => i.kind === k && live(i));
function dayEntries(day) {
  return S.items.filter(i => (i.kind === '予定' || i.kind === 'タスク') && live(i) && itemDay(i) === day)
    .sort((a, b) => (itemTime(a) || '99:99').localeCompare(itemTime(b) || '99:99'));
}
function toast(msg) {
  const t = $('toast'); if (!msg) return;
  t.hidden = true; void t.offsetWidth;
  t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- 保存（IndexedDB。だめなら localStorage） ----------
   1つの入れ物（kv）に、キーで分けて入れる: snapshot=Macのデータ、outbox=送信待ちの入力、lastsent=前回送った入力。
   スナップショットを読み込み直しても、送信待ちには触らない。 */
const DBN = 'amessist-phone', STORE = 'kv', KEY = 'snapshot';
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DBN, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function kvPut(key, val) {
  try {
    const d = await idb();
    await new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    d.close();
  } catch (e) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e2) { return false; } }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 任意 */ }
  return true;
}
async function kvGet(key) {
  try {
    const d = await idb();
    const v = await new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    d.close(); if (v !== undefined) return v;
  } catch (e) { /* 次へ */ }
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
const saveSnap = j => kvPut(KEY, j);
const loadSnap = () => kvGet(KEY);

/* ---------- スナップショットの読み込み ---------- */
function validate(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return 'AmeSSISTのiPhone用データではありません';
  if (!j.snapshot || j.snapshot.format !== 'amessist-snapshot') return 'AmeSSISTのiPhone用データではありません（snapshot.py で作ったファイルを選んでください）';
  if (j.snapshot.version > 1) return 'このデータは新しい形式です。アプリを一度閉じて、開き直してください';
  for (const k of ['today', 'generated_at']) if (!j[k]) return 'データが足りません（' + k + '）';
  for (const k of ['items', 'ledger', 'accounts', 'recurring']) if (!Array.isArray(j[k])) return 'データが足りません（' + k + '）';
  return '';
}
async function loadFile(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch (e) { toast('読み込めませんでした（ファイルの形式が違います）'); return; }
  const why = validate(j); if (why) { toast(why); return; }
  S = j; if (!(await saveSnap(j))) { toast('読み込みました。ただし端末に保存できませんでした'); } else toast(`読み込みました（最終更新 ${stamp(j.generated_at)}）`);
  ui.calMonth = TODAY().slice(0, 7); ui.selDay = TODAY(); ui.taskDay = null; render();
}
const stamp = g => `${g.slice(5, 10).replace('-', '/')} ${g.slice(11, 16)}`;
function ageMin() { const t = Date.parse(S.generated_at); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000)); }
function ageText() {
  const m = ageMin(); if (m == null) return '';
  return m < 60 ? `${m}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : `${Math.floor(m / 1440)}日前`;
}

/* ---------- 入力（段階2）: 送信待ち、ファイルの組み立て、共有 ---------- */
const KINDS = ['おまかせ', '予定', 'タスク', 'ToDo', '定期'];   // 「完了」は廃止（Macの画面のボタンで行う）
const DEF_ACCTS = ['財布', 'Suica', 'PayPay', '銀行'];
let OUT = { pending: [], last: null };   // pending=送信待ち、last={at, items}=前回送った分（1回分だけ残す。送れていなかったときの再送用）
const ID_RE = /^th_\d{14}_\d{4}$/;
const validRec = r => !!r && typeof r === 'object' && ID_RE.test(r.id || '') && !!r.created_at &&
  (r.kind === '収支' ? !!r.item && r.amount > 0 && 'from' in r && 'to' in r : typeof r.text === 'string' && !!r.text.trim() && KINDS.includes(r.kind));
const saveOut = async () => { const a = await kvPut('outbox', OUT.pending), b = await kvPut('lastsent', OUT.last); return a && b; };
async function loadOut() {
  const p = await kvGet('outbox'), l = await kvGet('lastsent');
  OUT.pending = Array.isArray(p) ? p.filter(validRec) : [];
  OUT.last = l && Array.isArray(l.items) && l.items.filter(validRec).length ? { at: String(l.at || ''), items: l.items.filter(validRec) } : null;
}
function isoLocal(d) {   // 2026-11-11T09:12:00+09:00（端末の時刻。「明日」「来週」などをMacが解釈する基準になる）
  const o = -d.getTimezoneOffset(), sg = o >= 0 ? '+' : '-', a = Math.abs(o);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sg}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function newId() {   // th_連番（yyyyMMddHHmmss）_乱数4桁。ショートカットと同じ形。Macは id で重複を無視する
  const d = new Date(), base = `th_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_`;
  const used = new Set(OUT.pending.concat(OUT.last ? OUT.last.items : []).map(r => r.id));
  let id; do { id = base + (1000 + Math.floor(Math.random() * 9000)); } while (used.has(id));
  return id;
}
/* 本文の途中に「id:」で始まる行があると、Macが別の入力の始まりと読むので、先頭に「・」を付ける（ごくまれ） */
const safeBody = t => String(t).replace(/\r\n?/g, '\n').split('\n').map(l => (/^\s*id\s*[:：]/i.test(l) ? '・' + l : l)).join('\n').trim();
const recText = r => (r.kind === '収支'
  ? ['id: ' + r.id, 'kind: 収支', 'created_at: ' + r.created_at, 'item: ' + r.item, 'amount: ' + r.amount, 'from: ' + r.from, 'to: ' + r.to]
  : ['id: ' + r.id, 'kind: ' + r.kind, 'created_at: ' + r.created_at, 'text: ' + safeBody(r.text)]).join('\n');
const filesText = recs => recs.map(recText).join('\n') + '\n';   // 複数件は、1つのファイルに続けて書く（Macは id: の行で区切って読む）
const describe = r => (r.kind === '収支' ? `${r.item}　${yen(r.amount)}　${r.from}→${r.to}` : r.text);
const acctNames = () => (S && S.accounts && S.accounts.length ? S.accounts.map(a => a.name) : DEF_ACCTS);

/* 共有シートで、1つのテキストファイルとして渡す（AirDropでMacへ）。user gesture の中で、最初の await より前に呼ぶ */
async function shareRecs(recs) {
  const d = new Date(), name = `th_send_${ymd(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.txt`;
  const text = filesText(recs), file = new File([text], name, { type: 'text/plain' });
  if (!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }))) return { r: 'unsupported', text };
  try { await navigator.share({ files: [file] }); return { r: 'ok', text }; }
  catch (e) { return { r: e && e.name === 'AbortError' ? 'cancel' : 'error', text }; }
}
let sending = false;
async function doSend(again) {
  if (sending) return;
  const recs = again ? (OUT.last ? OUT.last.items.slice() : []) : OUT.pending.slice();
  if (!recs.length) return;
  sending = true;
  try {
    const { r, text } = await shareRecs(recs);
    if (r === 'ok') {
      if (again) OUT.last.at = isoLocal(new Date());
      else { const ids = new Set(recs.map(x => x.id)); OUT.last = { at: isoLocal(new Date()), items: recs }; OUT.pending = OUT.pending.filter(x => !ids.has(x.id)); }
      const saved = await saveOut();
      closeSheet(); render();
      toast(saved ? `${recs.length}件を共有しました。Macが動いていれば、取り込まれます` : `${recs.length}件を共有しました（端末への記録に失敗）`);
    } else if (r === 'cancel') toast('送信をやめました（送信待ちは残っています）');
    else if (r === 'unsupported') {
      try { await navigator.clipboard.writeText(text); toast('この環境では共有できないため、文字をコピーしました（送信待ちは残しています）'); }
      catch (e) { toast('この環境では共有できません。ホーム画面のアイコンから開いてください'); }
    } else toast('共有できませんでした（送信待ちは残っています）');
  } finally { sending = false; }
}

/* 追加・送信のシート（画面の上側に出す。iPhoneのキーボードで隠れないように） */
const XICON = '<svg class="tri" viewBox="0 0 10 10" width="12" height="12" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
function addHtml() {
  if (ui.page === 'ledger') {
    const ac = acctNames(), opt = (list, sel) => list.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
    return `<h2>収支を追加</h2>
      <label class="sh-l">品目<input id="f-item" data-focus="1" maxlength="60" autocomplete="off" placeholder="例: 昼食"></label>
      <label class="sh-l">金額（円）<input id="f-amt" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="980"></label>
      <div class="sh-two"><label class="sh-l">出金元<select id="f-from">${opt(ac.concat('なし'), ac.includes('財布') ? '財布' : ac[0])}</select></label>
      <label class="sh-l">入金先<select id="f-to">${opt(['なし'].concat(ac), 'なし')}</select></label></div>
      <div class="note">出金元だけ=支出、入金先だけ=収入、両方=移動。</div>
      <div class="hint" id="f-hint"></div>
      <div class="sh-act"><button class="btn" data-sheet-close="1">閉じる</button><button class="btn pri" data-add-go="1">送信待ちに追加</button></div>`;
  }
  return `<h2>入力を追加</h2>
    <div class="sh-kinds" role="group" aria-label="種別">${KINDS.map(k => `<button type="button" class="sh-k ${k === ui.kind ? 'on' : ''}" data-kind="${k}">${k}</button>`).join('')}</div>
    <label class="sh-l">メモ<textarea id="f-text" data-focus="1" rows="4" maxlength="1000" placeholder="例: 来週木曜15時に歯医者"></textarea></label>
    <div class="note">日付や時刻は、文章に書いておくとMacが読み取ります。足りない分は、Macの「要確認」に入ります。完了の報告は、Macのボタンで行います。</div>
    <div class="hint" id="f-hint"></div>
    <div class="sh-act"><button class="btn" data-sheet-close="1">閉じる</button><button class="btn pri" data-add-go="1">送信待ちに追加</button></div>`;
}
function sendHtml() {
  const p = OUT.pending, l = OUT.last;
  const rows = p.map(r => `<div class="sh-item"><span class="sh-chip">${esc(r.kind)}</span><span class="sh-tx">${esc(describe(r))}</span>` +
    `<button class="ibtn sm" data-out-del="${esc(r.id)}" aria-label="この入力を削除">${XICON}</button></div>`).join('');
  const last = l ? `<h2>前回の送信（${l.items.length}件・${esc(stamp(l.at))}）</h2>
      <div class="note">Macに届いていないときだけ、もう一度送ってください（Macは同じ入力を二重に登録しません）。</div>
      <div class="sh-act"><button class="btn warn" data-last-clear="1">前回分を消す</button><button class="btn" data-send-again="1">もう一度送る</button></div>` : '';
  return `<h2>送信待ち（${p.length}件）</h2>
    ${rows || '<div class="note">送信待ちはありません。</div>'}
    ${p.length ? '<div class="note">間違いは、右の×で消せます。送ると、この一覧から消えます。</div>' : ''}
    <div class="sh-act"><button class="btn" data-sheet-close="1">閉じる</button><button class="btn pri" data-send-go="1" ${p.length ? '' : 'disabled'}>Macへ送る（${p.length}件）</button></div>${last}`;
}
function renderSheet() {
  const sh = $('sheet');
  if (!ui.sheet) { sh.hidden = true; $('shc').innerHTML = ''; return; }
  $('shc').innerHTML = ui.sheet === 'add' ? addHtml() : sendHtml();
  sh.hidden = false;
  const f = document.querySelector('#shc [data-focus]'); if (f && ui.sheet === 'add') f.focus();   // クリックの中で呼ぶので、iPhoneでもキーボードが出る
}
function openSheet(kind) { ui.sheet = kind; ui.cal = false; renderDrawer(); renderSheet(); }
function closeSheet() { ui.sheet = null; renderSheet(); }
function addSubmit() {
  const hint = $('f-hint'), bad = m => { hint.textContent = m; };
  let rec;
  if (ui.page === 'ledger') {
    const item = $('f-item').value.replace(/\s+/g, ' ').trim(), raw = $('f-amt').value.normalize('NFKC').replace(/[,\s円]/g, '');
    if (!item) return bad('品目を入力してください');
    if (!/^\d+$/.test(raw) || +raw < 1) return bad('金額は、1以上の数字で入力してください');
    rec = { id: newId(), created_at: isoLocal(new Date()), kind: '収支', item, amount: +raw, from: $('f-from').value, to: $('f-to').value };
  } else {
    const text = $('f-text').value.trim();
    if (!text) return bad('メモを入力してください');
    rec = { id: newId(), created_at: isoLocal(new Date()), kind: ui.kind, text };
  }
  OUT.pending.push(rec);
  saveOut().then(ok => { if (!ok) toast('端末に保存できませんでした。送るまで、アプリを閉じないでください'); });
  closeSheet(); render();
  toast(`追加しました（送信待ち ${OUT.pending.length}件）`);
}

/* ---------- 縦タイムライン（1日。重なる予定は横に並ぶ。〆は線） ---------- */
function vTimeline(day) {
  const evs = S.items.filter(i => i.kind === '予定' && live(i) && itemDay(i) === day && timeOf(i.start_at))
    .map(i => { const s = mins(timeOf(i.start_at)); const sameDay = (i.end_at || '').slice(0, 10) === day;
                const e = sameDay && timeOf(i.end_at) ? mins(timeOf(i.end_at)) : (i.end_at && !sameDay ? 1440 : s + 60);
                return { i, s, e: Math.min(Math.max(e, s + 30), 1440) }; })
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const cols = []; let cluster = []; let clusterEnd = -1; const placed = [];
  const flush = () => { const n = Math.max(...cluster.map(x => x.col)) + 1; cluster.forEach(x => { x.n = n; placed.push(x); }); cluster = []; cols.length = 0; clusterEnd = -1; };
  evs.forEach(ev => {
    if (cluster.length && ev.s >= clusterEnd) flush();
    let c = cols.findIndex(end => end <= ev.s); if (c < 0) { c = cols.length; cols.push(0); }
    cols[c] = ev.e; ev.col = c; cluster.push(ev); clusterEnd = Math.max(clusterEnd, ev.e);
  });
  if (cluster.length) flush();
  const H = VT_HOUR;
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="hr" style="top:${h * H}px">${pad(h)}:00</div>`).join('');
  const blocks = placed.map(ev => `<div class="ev" title="${esc(ev.i.title)}" style="top:${ev.s / 60 * H}px;height:${(ev.e - ev.s) / 60 * H}px;left:${ev.col / ev.n * 100}%;width:${100 / ev.n}%">` +
    `${esc(ev.i.title)}<br>${timeOf(ev.i.start_at)}${timeOf(ev.i.end_at) ? '–' + timeOf(ev.i.end_at) : ''}${ev.i.place ? ' ' + esc(ev.i.place) : ''}</div>`).join('');
  const due = S.items.filter(i => i.kind === 'タスク' && live(i) && i.due_date === day && i.due_time);
  const lines = due.map(i => `<div class="dueline" style="top:${mins(i.due_time) / 60 * H}px"></div>`).join('');
  const labs = due.map(i => `<div class="duelab" style="top:${mins(i.due_time) / 60 * H}px">〆 ${esc(i.title)} ${i.due_time}</div>`).join('');
  const now = day === TODAY() ? `<div class="now" style="top:${nowMin() / 60 * H}px"></div>` : '';
  return `<div class="vt-wrap"><div class="vt" style="height:${24 * H}px">${hours}${lines}<div class="lane">${blocks}</div>${labs}${now}</div></div>`;
}

/* ---------- 各ページ ---------- */
function viewEvents() {
  const day = ui.selDay, d = parseD(day), t = TODAY();
  const untimed = dayEntries(day).filter(i => !itemTime(i));
  const un = untimed.length ? `<div class="untimed">${untimed.map(i => `<div class="chip" title="${esc(i.title)}">${i.kind === 'タスク' ? '〆 ' : ''}${esc(i.title)}${i.place ? ' ' + esc(i.place) : ''}</div>`).join('')}</div>` : '';
  return `<div class="daybar"><button class="ibtn sm" data-daynav="-1" aria-label="前の日">${tri(TRI_L)}</button>
    <div class="dt">${d.getMonth() + 1}月${d.getDate()}日<span class="${dayTone(day)}">${WDE[d.getDay()]}</span></div>
    <button class="ibtn sm" data-daynav="1" aria-label="次の日">${tri(TRI_R)}</button></div>
    ${day !== t ? `<div style="text-align:center;margin:-4px 0 8px"><button class="btn sm" data-daytoday="1">今日へ</button></div>` : ''}
    ${un}${vTimeline(day)}`;
}
/* 期限切れ（未完了で、期限が端末の今日より前）のタスクは、先頭の丸印を×にする。色は変えない（Mac版と同じ） */
const OV_X = '<svg class="ov" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
function viewTasks() {
  const t = TODAY();
  let rows = byKind('タスク');
  if (ui.taskDay) rows = rows.filter(i => i.due_date === ui.taskDay);
  rows.sort((a, b) => ((a.due_date || '9') + (a.due_time || '')).localeCompare((b.due_date || '9') + (b.due_time || '')));
  const bar = ui.taskDay ? `<div class="fbar"><span>${fmtMDW(ui.taskDay)} の期限のみ</span><button class="btn sm" data-dayclear="1">解除</button></div>` : '';
  const row = i => {
    const od = i.due_date && i.due_date < t;
    return `<div class="rc"><div class="rl"><span class="sd open">${od ? OV_X : '<i class="dot"></i>'}<span class="r1">${i.recurring_id ? '↻ ' : ''}${esc(i.title)}</span></span></div>` +
      `<div class="rr">${i.due_date ? fmtMDW(i.due_date) + (i.due_time ? '<br>' + i.due_time : '') : '<span class="muted">期限なし</span>'}</div></div>`;
  };
  return `${bar}${rows.map(row).join('') || '<div class="card muted">該当するタスクはありません</div>'}`;
}
function viewTodo() {
  const rows = byKind('ToDo').sort(todoSort);
  const row = i => `<div class="rc"><div class="rl"><span class="sd ${i.status}"><i class="dot"></i><span class="r1">${esc(i.title)}</span></span></div>` +
    `<div class="rr">${esc([i.priority, i.horizon].filter(Boolean).join('・'))}${i.status === 'doing' ? '<br><span class="muted">進行中</span>' : ''}</div></div>`;
  return rows.map(row).join('') || '<div class="card muted">未着手・進行中のToDoはありません</div>';
}
/* 定期: 現行の期間のカードだけ（Done・管理・過去の記録はない）。今期の回数は、最終更新の時点のもの */
function viewRecurring() {
  const rules = S.recurring.filter(r => r.active && r.mode === 'window');
  const cards = ['daily', 'weekly', 'monthly'].map(f => {
    const lab = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[f];
    const rs = rules.filter(r => r.freq === f), per = rs.length ? rs[0].period_label : '';
    const body = rs.map(r => {
      const ok = r.count >= (r.target_count || 1);
      const last = r.last_done ? ` ・最終 ${fmtMDW(r.last_done)} ${timeOf(r.last_done)}` : '';
      return `<div class="rec-item ${ok ? 'ok' : ''}"><div><span class="rt">${ok ? '✓ ' : ''}${esc(r.title)}</span><span class="rm">今期 ${r.count}${r.target_count > 1 ? '/' + r.target_count : ''}回${last}</span></div></div>`;
    }).join('') || '<div class="muted">なし</div>';
    return `<div class="card"><div class="hd"><h2>${lab}</h2><span class="muted">${esc(per)}</span></div>${body}</div>`;
  }).join('');
  return `<div class="note">回数は、最終更新の時点のものです。Doneは、Macで押します。</div>${cards}`;
}
function viewLedger() {
  let lm = S.ledger_month;
  if (!lm) { const ym = S.today.slice(0, 7); lm = { ym, income: 0, expense: 0 }; S.ledger.forEach(e => { if (e.date.startsWith(ym)) { if (e.kind === '収入') lm.income += e.amount; else if (e.kind === '支出') lm.expense += e.amount; } }); }
  const diff = lm.income - lm.expense, total = S.accounts.reduce((a, b) => a + b.balance, 0);
  const rows = S.ledger.map(e => `<div class="rc"><div class="rl"><div class="r1">${esc(e.item)}</div><div class="r2">${fmtMDW(e.date)}　${esc(e.from_acct || '—')} → ${esc(e.to_acct || '—')}</div></div>` +
    `<div class="rr ${e.kind === '支出' ? 'neg' : e.kind === '収入' ? 'pos' : ''}">${yen(e.amount)}<br><span class="muted">${esc(e.kind)}</span></div></div>`).join('');
  return `<div class="card"><div class="hd"><span class="ph-big">${lm.ym.slice(0, 4)}年${+lm.ym.slice(5)}月</span><span class="ph-big ${diff >= 0 ? 'pos' : 'neg'}">${signed(diff)}</span></div>
      <div class="sumrow"><div><div>支出</div><div class="big neg">${yen(lm.expense)}</div></div><div><div>収入</div><div class="big pos">${yen(lm.income)}</div></div></div>
      <div class="muted" style="margin-top:8px">最終更新の時点（移動・残高調整は含みません）</div></div>
    <div class="card"><h2>残高</h2>${S.accounts.map(a => `<div class="kv"><span>${esc(a.name)}</span><span>${yen(a.balance)}</span></div>`).join('')}<div class="kv total"><span>合計</span><span>${yen(total)}</span></div></div>
    <h2>直近の記録</h2>${rows || '<div class="card muted">まだ記録はありません</div>'}`;
}
function emptyHtml() {
  return `<div class="card empty"><h2 style="margin-top:0">データがまだありません</h2>
    <p>1. Macで、ターミナルから <code>python3 snapshot.py</code> を実行します。</p>
    <p>2. できたファイルを、AirDropでiPhoneへ送り、「ファイル」に保存します。</p>
    <p>3. 下のボタンで、そのファイルを選びます。</p>
    <button class="btn pri lg" data-load="1">データを読み込む</button></div>`;
}
const VIEWS = { events: viewEvents, tasks: viewTasks, todo: viewTodo, recurring: viewRecurring, ledger: viewLedger };
const calPage = () => ui.page === 'events' || ui.page === 'tasks';

/* ---------- 月カレンダー（左から出る引き出し） ---------- */
function calBounds() {   // 予定は、スナップショットに入っている期間（過去1か月〜先3か月）の月まで
  const r = S && S.events_range;
  return ui.page === 'events' && r ? [r.from.slice(0, 7), r.to.slice(0, 7)] : null;
}
function drawerHtml() {
  const [y, m] = ui.calMonth.split('-').map(Number), isEv = ui.page === 'events';
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate(), total = Math.ceil((offset + days) / 7) * 7;
  const marks = {};
  const src = isEv ? S.items.filter(i => i.kind === '予定' && live(i)).concat(ui.evTasks ? S.items.filter(i => i.kind === 'タスク' && live(i)) : []) : S.items.filter(i => i.kind === 'タスク' && live(i));
  src.forEach(i => { const k = itemDay(i); if (k) (marks[k] = marks[k] || []).push(i); });
  const sel = isEv ? ui.selDay : ui.taskDay, t = TODAY();
  let cells = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((n, k) => `<div class="h ${k === 5 ? 'sat' : k === 6 ? 'sun' : ''}">${n}</div>`).join('');
  for (let k = 0; k < total; k++) {
    const dn = k - offset + 1;
    if (dn < 1 || dn > days) { cells += '<div class="cell out"></div>'; continue; }
    const key = `${y}-${pad(m)}-${pad(dn)}`, list = marks[key] || [];
    const dots = list.slice(0, 3).map(i => `<i class="${i.kind === 'タスク' ? 't' : ''}"></i>`).join('') + (list.length > 3 ? `<b>+${list.length - 3}</b>` : '');
    cells += `<div class="cell ${key === sel ? 'sel' : ''}" data-day="${key}"><span class="dn ${dayTone(key)} ${key === t ? 'today' : ''}">${dn}</span><div class="mk">${dots}</div></div>`;
  }
  const b = calBounds(), ym = ui.calMonth;
  const prevOff = b && ym <= b[0], nextOff = b && ym >= b[1];
  const sw = isEv ? `<div class="dr-sw"><button type="button" class="tgl ${ui.evTasks ? 'on' : ''}" role="switch" data-evtasks="1" aria-checked="${ui.evTasks}"><span class="knob"></span><span class="tl">〆 タスクも表示</span></button></div>` : '';
  return `<div class="dr-head"><h2 class="calttl">${y}年${m}月</h2><div class="dr-nav">
      <button class="ibtn sm" data-cal="-1" aria-label="前の月" ${prevOff ? 'disabled' : ''}>${tri(TRI_L)}</button><button class="btn sm" data-caltoday="1">今月</button>
      <button class="ibtn sm" data-cal="1" aria-label="次の月" ${nextOff ? 'disabled' : ''}>${tri(TRI_R)}</button>
      <button class="ibtn sm" data-close-cal="1" aria-label="閉じる"><svg class="tri" viewBox="0 0 10 10" width="12" height="12"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg></button></div></div>
    ${sw}<div class="cal">${cells}</div>
    <div class="dr-legend">${isEv ? '日を押すと、その日の予定が開きます' : '日を押すと、その日が期限のタスクだけに絞ります'}<br><i></i>${isEv ? '予定' : 'タスク'}${isEv && ui.evTasks ? '<i class="t"></i>タスク（〆）' : ''}</div>`;
}
function renderDrawer() {
  const open = ui.cal && calPage() && !!S;
  if (open) $('drp').innerHTML = drawerHtml();
  $('drawer').classList.toggle('open', open);
}

/* ---------- 描画 ---------- */
function topHtml() {
  const d = new Date(), key = ymd(d);
  const cal = S && calPage() ? `<button class="ibtn" data-open-cal="1" aria-label="カレンダー">${icon('events')}</button>` : '';
  const sub = S ? `最終更新: ${stamp(S.generated_at)}（${ageText()}）` : 'データ未読み込み';
  const stale = S && (ageMin() || 0) >= 2880, n = OUT.pending.length;
  return `<div class="th-row"><div class="th-date ${dayTone(key)}">${d.getMonth() + 1}/${d.getDate()}<span>${WDE[d.getDay()]}</span></div>
    <div class="th-btns">${cal}<button class="ibtn" data-load="1" aria-label="データを読み込む">${icon('load')}</button></div></div>
    <div class="th-subrow"><div class="th-sub ${stale ? 'stale' : ''}">${sub}${stale ? ' ・古くなっています' : ''}</div>
    <button class="sendbtn ${n ? 'on' : ''}" data-send="1" ${n || OUT.last ? '' : 'disabled'}>送信 (${n})</button></div>`;
}
let lastPage = null;
function render() {
  $('top').innerHTML = topHtml();
  $('tabs').innerHTML = TABS.map(([id, name]) => `<button class="tb ${ui.page === id ? 'on' : ''}" data-tab="${id}" aria-label="${name}">${icon(id)}<span>${name}</span></button>`).join('');
  const v = $('view'), keep = v.scrollTop;
  v.innerHTML = (S ? VIEWS[ui.page]() : emptyHtml()) + `<div class="foot">AmeSSIST iPhone ${APP_VER}　<button class="btn sm" data-update="1">更新を確認</button></div>`;
  v.scrollTop = lastPage === ui.page ? keep : 0; lastPage = ui.page;
  const w = document.querySelector('.vt-wrap');   // 今日なら今の時刻の少し前、ほかの日は7:30から
  if (w) w.scrollTop = VT_HOUR * (ui.selDay === TODAY() ? Math.max(0, nowMin() / 60 - 1.5) : 7.5);
  renderDrawer();
}

/* ---------- 操作 ---------- */
document.addEventListener('click', e => {
  const t = e.target; let el;
  /* 入力（段階2）: データを読み込んでいなくても使える */
  if (t.closest('[data-add]')) { openSheet('add'); return; }
  if (t.closest('[data-send]')) { openSheet('send'); return; }
  if (t.closest('[data-sheet-bg]')) {   // 背景を押して閉じるのは、入力が空のときだけ（打ちかけの文字を、うっかり消さない）
    const v = ($('f-text') || $('f-item') || {}).value; if (!v || !v.trim()) closeSheet(); return;
  }
  if (t.closest('[data-sheet-close]')) { closeSheet(); return; }
  if ((el = t.closest('[data-kind]'))) {
    ui.kind = el.dataset.kind;
    document.querySelectorAll('#shc .sh-k').forEach(b => b.classList.toggle('on', b === el)); return;
  }
  if (t.closest('[data-add-go]')) { addSubmit(); return; }
  if ((el = t.closest('[data-out-del]'))) {
    OUT.pending = OUT.pending.filter(r => r.id !== el.dataset.outDel); saveOut(); renderSheet(); render(); return;
  }
  if (t.closest('[data-send-go]')) { doSend(false); return; }
  if (t.closest('[data-send-again]')) { doSend(true); return; }
  if (t.closest('[data-last-clear]')) { OUT.last = null; saveOut(); renderSheet(); render(); return; }
  if ((el = t.closest('[data-tab]'))) { ui.page = el.dataset.tab; ui.cal = false; render(); return; }
  if (t.closest('[data-load]')) { $('pick').click(); return; }
  if (t.closest('[data-update]')) { checkUpdate(true); return; }
  if (!S) return;
  if (t.closest('[data-open-cal]')) { ui.cal = true; if (!ui.calMonth) ui.calMonth = TODAY().slice(0, 7); renderDrawer(); return; }
  if (t.closest('[data-close-cal]')) { ui.cal = false; renderDrawer(); return; }
  if ((el = t.closest('[data-cal]'))) {
    const [y, m] = ui.calMonth.split('-').map(Number), d = new Date(y, m - 1 + +el.dataset.cal, 1);
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, b = calBounds();
    if (!b || (ym >= b[0] && ym <= b[1])) { ui.calMonth = ym; renderDrawer(); }
    return;
  }
  if (t.closest('[data-caltoday]')) { ui.calMonth = TODAY().slice(0, 7); renderDrawer(); return; }
  if (t.closest('[data-evtasks]')) {
    ui.evTasks = !ui.evTasks;
    try { localStorage.setItem('evTasks', ui.evTasks ? '1' : '0'); } catch (e2) { /* 覚えられなくても動く */ }
    renderDrawer(); return;
  }
  if ((el = t.closest('[data-day]'))) {
    if (ui.page === 'tasks') ui.taskDay = ui.taskDay === el.dataset.day ? null : el.dataset.day;
    else { ui.selDay = el.dataset.day; ui.calMonth = el.dataset.day.slice(0, 7); }
    ui.cal = false; render(); return;
  }
  if ((el = t.closest('[data-daynav]'))) { ui.selDay = addDays(ui.selDay, +el.dataset.daynav); ui.calMonth = ui.selDay.slice(0, 7); render(); return; }
  if (t.closest('[data-daytoday]')) { ui.selDay = TODAY(); ui.calMonth = ui.selDay.slice(0, 7); render(); return; }
  if (t.closest('[data-dayclear]')) { ui.taskDay = null; render(); return; }
});
$('pick').addEventListener('change', async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) await loadFile(f); });
/* 左端から右へのスワイプでカレンダーを開き、引き出しの上で左へのスワイプで閉じる（補助。ボタンが本筋） */
let sw0 = null;
document.addEventListener('touchstart', e => { const p = e.touches[0]; sw0 = { x: p.clientX, y: p.clientY }; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!sw0 || !S) return; const p = e.changedTouches[0], dx = p.clientX - sw0.x, dy = p.clientY - sw0.y, x0 = sw0.x; sw0 = null;
  if (Math.abs(dy) > 50 || Math.abs(dx) < 60) return;
  if (!ui.cal && x0 < 28 && dx > 0 && calPage()) { ui.cal = true; if (!ui.calMonth) ui.calMonth = TODAY().slice(0, 7); renderDrawer(); }
  else if (ui.cal && dx < 0) { ui.cal = false; renderDrawer(); }
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (S) render(); autoUpdate(); } });   // 日付が変わっていても、端末の時計で作り直す

/* 画面のコードの更新確認。通信するのは sw.js だけ（約1.5KB）。自動は1日1回まで。新しい版があれば、全ファイルを取り直して保存する。
   反映は、アプリを閉じて開き直したとき。Wi-Fiかどうかは、iPhoneのSafariでは調べられないので、回数を減らして通信量を抑える。 */
const swOk = () => 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost');
async function checkUpdate(manual) {
  if (!swOk()) { if (manual) toast('この環境では更新を確認できません'); return; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { if (manual) toast('まだ端末に保存されていません'); return; }
  try { await reg.update(); } catch (e) { if (manual) toast('確認できませんでした（圏外です）'); return; }
  try { localStorage.setItem('lastUpd', String(Date.now())); } catch (e) { /* 覚えられなくても動く */ }
  if (manual) toast('確認しました。新しい版があれば、保存します');
}
function autoUpdate() {
  let last = 0; try { last = +localStorage.getItem('lastUpd') || 0; } catch (e) { /* 次へ */ }
  if (Date.now() - last > 24 * 3600 * 1000) checkUpdate(false);
}

(async () => {
  S = await loadSnap();
  if (S && validate(S)) S = null;   // 壊れた保存データは使わない
  await loadOut();
  ui.calMonth = TODAY().slice(0, 7); ui.selDay = TODAY();
  render();
  if (swOk()) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('新しい版を保存しました。アプリを閉じて開き直すと反映されます'); });
      });
      autoUpdate();
    }).catch(() => { /* 登録できなくても、画面は動く */ });
  }
})();
