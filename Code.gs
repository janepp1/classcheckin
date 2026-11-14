/**
 * Claude Future Food Check-in — Google Sheet backend (Google Apps Script)
 * ใช้คู่กับหน้าเว็บเช็คชื่อ (index.html) ในโหมด Google Sheet
 *
 * ใช้แท็บที่มีอยู่แล้วในชีต "เช็คอิน":
 *   Roster      ← รายชื่อ (id | ชื่อ-นามสกุล | หน่วยงาน | ชื่อภาษาอังกฤษ) — หน้าเว็บอ่าน/เพิ่ม/ลบจากแท็บนี้
 *   Attendance  ← ทุกการเช็คอิน: วันที่, ชื่อ, หน่วยงาน, เวลา, สถานะ (ตรงเวลา/สาย), สายกี่นาที, ลายเซ็น
 *                 (สคริปต์เพิ่มคอลัมน์ K–L สำหรับเวลาเช็คเอาต์ให้เอง)
 *   Data        ← log อ่านง่าย: timestamp | name | note (มา / สาย / ออก)
 *   Settings    ← start = เวลาเริ่มเรียน, grace = นาทีที่ยังไม่นับว่าสาย
 *   _meta       ← (ซ่อน) PIN ผู้สอน / วันเรียน / ผลสุ่มรางวัล — สร้างให้เองตอนใช้งานครั้งแรก
 */

const TOKEN = '';              // ถ้าตั้ง ต้องใส่ค่าเดียวกันใน TOKEN ของ config ในหน้าเว็บ (เว้นว่าง = ไม่ใช้)
const TZ = 'Asia/Bangkok';
const SIG_FOLDER = 'ลายเซ็นเช็คอิน';
const MAX_CELL = 49000;        // Google Sheet เก็บได้ไม่เกิน 50,000 ตัวอักษรต่อช่อง

const ROSTER = 'Roster', ATT = 'Attendance', LOG = 'Data', SETTINGS = 'Settings', META = '_meta';
const ROSTER_HEAD = ['id', 'ชื่อ-นามสกุล', 'หน่วยงาน', 'ชื่อภาษาอังกฤษ', 'ประเภท'];
const ATT_HEAD = ['วันที่', 'id', 'ชื่อ-นามสกุล', 'หน่วยงาน', 'เวลาเช็คอิน', 'สถานะ', 'สาย (นาที)',
  'บันทึกเมื่อ (ISO)', 'ลิงก์ลายเซ็น', 'ลายเซ็น (ข้อมูลภาพ)', 'เวลาเช็คเอาต์', 'เช็คเอาต์เมื่อ (ISO)'];
// คอลัมน์ใน Attendance (เริ่มที่ 0)
const A = { date: 0, id: 1, name: 2, unit: 3, time: 4, status: 5, late: 6, iso: 7, link: 8, sig: 9, outTime: 10, outIso: 11 };

// ---------- entry points ----------
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (TOKEN && p.token !== TOKEN) return out_({ ok: false, error: 'bad token', code: 'permission_denied' });
  if (p.action === 'snapshot') return out_(snapshot_(p.date || ''));
  return out_({ ok: true, hello: 'check-in backend is running' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json', code: 'invalid_argument' }); }
  if (TOKEN && body.token !== TOKEN) return out_({ ok: false, error: 'bad token', code: 'permission_denied' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return out_({ ok: false, error: 'busy', code: 'unavailable' });
  try {
    write_(String(body.op || ''), String(body.path || ''), body.data || null);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err), code: 'invalid_argument' });
  } finally {
    lock.releaseLock();
  }
}

// ---------- read ----------
function snapshot_(date) {
  const students = {};
  rows_(ROSTER).forEach((r, i) => {
    const id = String(r[0] || '').trim(), name = String(r[1] || '').trim();
    if (!id || !name) return;
    const d = { name: name, order: i + 1 };
    if (r[2]) d.company = String(r[2]);
    if (String(r[4] || '') === 'walk-in') d.walkin = true;
    students[id] = d;
  });

  const checks = [];
  rows_(ATT).forEach(r => {
    if (!r[A.date] || !r[A.id]) return;
    const c = { date: day_(r[A.date]), id: String(r[A.id]), name: String(r[A.name] || '') };
    const inAt = ms_(r[A.iso]) || clockMs_(c.date, r[A.time]);
    const outAt = ms_(r[A.outIso]);
    if (inAt) c.inAt = inAt;
    if (outAt) c.outAt = outAt;
    if (r[A.sig] && c.date === date) c.sig = String(r[A.sig]);   // ส่งลายเซ็นเฉพาะวันที่เปิดดู ให้โหลดเร็ว
    checks.push(c);
  });

  const meta = {};
  rows_(META).forEach(r => { if (r[0]) meta[r[0]] = parse_(r[1]); });

  return { ok: true, students: students, checks: checks, meta: meta };
}

// ---------- write ----------
function write_(op, path, data) {
  if (['set', 'update', 'delete'].indexOf(op) < 0) throw new Error('unknown op');
  const seg = path.split('/');
  if (seg[0] === 'students' && seg.length === 2) return student_(seg[1], op, data);
  if (seg[0] === 'days' && seg[2] === 'checks' && seg.length === 4) return check_(seg[1], seg[3], op, data);
  return meta_(path, op, data);
}

function student_(id, op, data) {
  const sh = sheet_(ROSTER, ROSTER_HEAD);
  const row = findRow_(sh, [id]);
  if (op === 'delete') { if (row) sh.deleteRow(row); return; }
  if (op === 'update' && !row) throw new Error('missing');
  const cur = row ? sh.getRange(row, 1, 1, 5).getValues()[0] : [id, '', '', '', ''];
  const d = data || {};
  if ('name' in d) cur[1] = d.name;
  if ('company' in d) cur[2] = d.company || '';
  if (d.walkin) cur[4] = 'walk-in';
  if (row) sh.getRange(row, 1, 1, 5).setValues([cur]);
  else sh.appendRow(cur);
}

function check_(date, id, op, data) {
  const sh = sheet_(ATT, ATT_HEAD);
  ensureHead_(sh, ATT_HEAD);
  const row = findRow_(sh, [date, id]);
  const prev = row ? sh.getRange(row, 1, 1, ATT_HEAD.length).getValues()[0] : null;
  const prevIn = prev ? (ms_(prev[A.iso]) || clockMs_(date, prev[A.time])) : 0;
  const prevOut = prev ? ms_(prev[A.outIso]) : 0;
  const d = data || {};
  const name = d.name || (prev && prev[A.name]) || nameOf_(id);

  if (op === 'delete') {
    if (row) sh.deleteRow(row);
    if (prev) log_(Date.now(), name, 'ยกเลิกการเช็คชื่อ (' + date + ')');
    return;
  }
  if (op === 'update' && !prev) throw new Error('missing');

  const r = prev ? prev.slice() : new Array(ATT_HEAD.length).fill('');
  while (r.length < ATT_HEAD.length) r.push('');
  r[A.date] = "'" + date; r[A.id] = id; r[A.name] = name;
  r[A.unit] = unitOf_(id) || r[A.unit] || '';

  const inAt = 'inAt' in d ? Number(d.inAt) || 0 : (op === 'set' ? 0 : prevIn);
  const outAt = 'outAt' in d ? Number(d.outAt) || 0 : (op === 'set' ? 0 : prevOut);

  if (inAt) {
    const late = lateMinutes_(inAt, date);
    r[A.time] = "'" + fmt_(inAt, 'HH:mm:ss');
    r[A.late] = late;
    r[A.status] = late > grace_() ? 'สาย' : 'ตรงเวลา';
    r[A.iso] = new Date(inAt).toISOString();
  } else {
    r[A.time] = r[A.status] = r[A.late] = r[A.iso] = '';
  }
  r[A.outTime] = outAt ? "'" + fmt_(outAt, 'HH:mm:ss') : '';
  r[A.outIso] = outAt ? new Date(outAt).toISOString() : '';

  if ('sig' in d) {
    const sig = d.sig ? String(d.sig) : '';
    r[A.sig] = sig.length <= MAX_CELL ? sig : '';
    r[A.link] = sig ? saveSig_(sig, date, name) : '';
  }

  if (row) sh.getRange(row, 1, 1, ATT_HEAD.length).setValues([r]);
  else sh.appendRow(r);

  // log อ่านง่ายในแท็บ Data
  if (inAt && inAt !== prevIn) log_(inAt, name, r[A.status] === 'สาย' ? 'สาย' : 'มา');
  if (outAt && outAt !== prevOut) log_(outAt, name, 'ออก');
  if (!inAt && prevIn) log_(Date.now(), name, 'ยกเลิกเช็คอิน');
  if (!outAt && prevOut) log_(Date.now(), name, 'ยกเลิกเช็คเอาต์');
}

function meta_(key, op, data) {
  const sh = sheet_(META, ['key', 'json']);
  const row = findRow_(sh, [key]);
  if (op === 'delete') { if (row) sh.deleteRow(row); return; }
  let next = data || {};
  if (op === 'update') {
    if (!row) throw new Error('missing');
    next = Object.assign(parse_(sh.getRange(row, 2).getValue()), data || {});
  }
  if (row) sh.getRange(row, 1, 1, 2).setValues([[key, JSON.stringify(next)]]);
  else sh.appendRow([key, JSON.stringify(next)]);
}

function log_(ms, name, note) {
  sheet_(LOG, ['timestamp', 'name', 'note']).appendRow([fmt_(ms, 'dd/MM/yyyy HH:mm'), name || '', note]);
}

// ---------- settings: เวลาเริ่ม / ผ่อนผัน ----------
function setting_(key) {
  const r = rows_(SETTINGS).find(x => String(x[0]).trim() === key);
  return r ? r[1] : '';
}
function grace_() { return Number(setting_('grace')) || 0; }
function lateMinutes_(inAt, date) {
  let start = setting_('start') || '09:00';
  if (start instanceof Date) start = Utilities.formatDate(start, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'HH:mm');
  const startMs = clockMs_(date, start);
  return startMs ? Math.max(0, Math.floor((inAt - startMs) / 60000)) : 0;
}

// ---------- signatures → Google Drive ----------
function saveSig_(dataUrl, date, name) {
  try {
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
    if (!m) return '';
    const it = DriveApp.getFoldersByName(SIG_FOLDER);
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder(SIG_FOLDER);
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], date + '_' + name + '.png');
    return folder.createFile(blob).getUrl();
  } catch (err) {
    return '';
  }
}

// ---------- helpers ----------
function nameOf_(id) { const r = rosterRow_(id); return r ? String(r[1] || '') : ''; }
function unitOf_(id) { const r = rosterRow_(id); return r ? String(r[2] || '') : ''; }
function rosterRow_(id) { return rows_(ROSTER).find(r => String(r[0]).trim() === id) || null; }

function sheet_(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.setFrozenRows(1);
    if (name.charAt(0) === '_') sh.hideSheet();
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(head);
  }
  return sh;
}

function ensureHead_(sh, head) {
  const cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
  let changed = false;
  head.forEach((h, i) => { if (!cur[i]) { cur[i] = h; changed = true; } });
  if (changed) sh.getRange(1, 1, 1, head.length).setValues([cur]);
}

function rows_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 2)).getValues();
}

function findRow_(sh, keys) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const vals = sh.getRange(2, 1, n, keys.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    let hit = true;
    for (let k = 0; k < keys.length; k++) {
      const v = k === 0 && keys.length > 1 ? day_(vals[i][k]) : String(vals[i][k]).trim();
      if (v !== String(keys[k])) { hit = false; break; }
    }
    if (hit) return i + 2;
  }
  return 0;
}

function day_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).trim(); }
function ms_(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v));
  return isNaN(t) ? 0 : t;
}
function clockMs_(date, hhmm) {   // "2026-11-14" + "09:00" (เวลาไทย) → ms
  if (!date || !hhmm) return 0;
  if (hhmm instanceof Date) hhmm = Utilities.formatDate(hhmm, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'HH:mm:ss');
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(hhmm).trim());
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || !dm) return 0;
  return Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +m[1] - 7, +m[2], +(m[3] || 0));
}
function parse_(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
function fmt_(ms, pattern) { return Utilities.formatDate(new Date(Number(ms)), TZ, pattern); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** กด Run ฟังก์ชันนี้ 1 ครั้งใน Apps Script เพื่อให้สิทธิ์ (ชีต + Drive) และเตรียมหัวคอลัมน์ */
function setup() {
  sheet_(LOG, ['timestamp', 'name', 'note']);
  ensureHead_(sheet_(ATT, ATT_HEAD), ATT_HEAD);
  sheet_(ROSTER, ROSTER_HEAD);
  sheet_(META, ['key', 'json']);
  DriveApp.getRootFolder();   // ขอสิทธิ์ Drive สำหรับเก็บลายเซ็น
}
