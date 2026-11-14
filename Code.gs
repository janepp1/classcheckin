/**
 * Claude future food — เว็บเช็คชื่อ (Google Apps Script backend)
 * วางไฟล์นี้ใน Extensions > Apps Script ของ Google Sheet ที่จะใช้เก็บข้อมูล
 * แล้วรันฟังก์ชัน setup() หนึ่งครั้ง จากนั้น Deploy เป็น Web app (ดู README.md)
 */

const CONFIG = {
  TOKEN: '',                      // ต้องตรงกับ TOKEN ใน config.js (เว้นว่างได้)
  TZ: 'Asia/Bangkok',
  SAVE_SIGNATURE_IMAGES: true,    // บันทึกรูปลายเซ็นเป็นไฟล์ PNG ใน Google Drive ด้วย
  SIGNATURE_FOLDER: 'Claude Future Food - ลายเซ็น'
};

const SHEETS = {
  students: { name: 'Students', head: ['ID', 'ลำดับ', 'ชื่อ-นามสกุล', 'บริษัท', 'Walk-in', 'เพิ่มเมื่อ'] },
  att: { name: 'Attendance', head: ['วันที่', 'Student ID', 'ชื่อ-นามสกุล', 'บริษัท', 'เวลาเข้า', 'เวลาออก', 'ลายเซ็น (ไฟล์)', 'inAt', 'outAt', 'signatureData'] },
  meta: { name: 'Meta', head: ['Path', 'JSON', 'อัปเดตเมื่อ'] }
};

// รายชื่อเริ่มต้น (ใช้ตอนรัน setup() ครั้งแรก ถ้าชีต Students ยังว่าง)
const DEFAULT_ROSTER = [
  ['ภณธกร วงศ์เจริญ', ''], ['วิภาดา พลาธนพร', ''], ['วราภรณ์ หวานล้ำ', ''], ['นรพนธ์ จิรัฐิติกาลพงศ์', ''],
  ['จิดาภา ทองเกิด', ''], ['ธนวรรณ ตั้งตรงพานิช', ''], ['คณาธิป จำนงค์', ''], ['รัตติยากร ฉายหิรัญ', ''],
  ['วิชยุตม์ กีรติธนาภรณ์', ''], ['จิตรา คำแหง', ''],
  ['สิริวรรณ รอดศิริ', 'Foodle NoodleCo., Ltd'], ['วิศรุต สุดสัตย์', 'Foodle NoodleCo., Ltd'], ['กิตติธัช ธูปถมพงศ์', 'Foodle NoodleCo., Ltd'],
  ['นางสาวณัฏชา แสวงหอม', 'บริษัท โอชาฟูดแพ็ค จำกัด'], ['คงติภูมิ มณีโชค', 'บริษัท ซีเอ็ม พรีเมี่ยม ไรซ์ จำกัด'],
  ['สุชาดา เอี่ยมสำอางค์', 'เทพผดุงพรมะพร้าว จำกัด'], ['พิชญา พิสุทธิ์พิเชฎฐ์', 'เทพผดุงพรมะพร้าว จำกัด'], ['วันทนา จุตาลานนท์', 'เทพผดุงพรมะพร้าว จำกัด'],
  ['ระวีวรรณ การภักดี', 'บริษัท โอชาฟูดแพ็ค จำกัด'], ['พรพิมล ผลเพิ่ม', 'บริษัท ลาโต้ ฟู้ดแอนด์ดริ้งส์ จำกัด'],
  ['อรณิชา ครองศักดิ์ศิริ', 'บริษัท โอชาฟูดแพ็ค จำกัด'], ['นัทธมน พุทธพรม', 'บริษัท โอชาฟูดแพ็ค จำกัด']
];

/* ---------- setup ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (k) {
    const def = SHEETS[k];
    let sh = ss.getSheetByName(def.name);
    if (!sh) sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight('bold').setBackground('#FFDCE8');
    sh.setFrozenRows(1);
  });
  const att = ss.getSheetByName(SHEETS.att.name);
  att.getRange('H:I').setNumberFormat('0');
  att.hideColumns(8, 3); // inAt, outAt, signatureData ใช้ภายในระบบ
  att.setColumnWidth(3, 200); att.setColumnWidth(4, 220);
  const st = ss.getSheetByName(SHEETS.students.name);
  st.setColumnWidth(3, 200); st.setColumnWidth(4, 240);
  if (st.getLastRow() < 2) {
    const now = fmtDateTime_(Date.now());
    const rows = DEFAULT_ROSTER.map(function (r, i) { return ['s' + (i + 1), i + 1, r[0], r[1], '', now]; });
    st.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  if (CONFIG.SAVE_SIGNATURE_IMAGES) signatureFolder_(); // ขอสิทธิ์ Google Drive ตั้งแต่ตอนนี้
  const sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 3) ss.deleteSheet(sheet1);
  SpreadsheetApp.flush();
  Logger.log('ตั้งค่าเสร็จแล้ว ต่อไปให้ Deploy > New deployment > Web app');
}

/* ---------- web app ---------- */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    checkToken_(p.token);
    if (p.action === 'snapshot') return json_(snapshot_(p.date || ''));
    return json_({ ok: true, app: 'Claude future food check-in', time: fmtDateTime_(Date.now()) });
  } catch (err) {
    return json_({ ok: false, code: err.code || 'error', error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkToken_(body.token);
    if (['set', 'update', 'delete'].indexOf(body.op) < 0 || typeof body.path !== 'string') throw codeErr_('bad_request', 'คำขอไม่ถูกต้อง');
    lock.waitLock(20000);
    route_(body.op, body.path, body.data || {});
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, code: err.code || 'error', error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------- read ---------- */
function snapshot_(date) {
  const students = {};
  rows_(SHEETS.students).forEach(function (r) {
    if (!r[0] || !r[2]) return;
    const d = { name: String(r[2]), order: Number(r[1]) || 0 };
    if (r[3]) d.company = String(r[3]);
    if (r[4]) d.walkin = true;
    students[String(r[0])] = d;
  });
  const checks = rows_(SHEETS.att).filter(function (r) { return r[0] && r[1]; }).map(function (r) {
    const c = { date: dateKey_(r[0]), id: String(r[1]), name: String(r[2]) };
    if (r[7]) c.inAt = Number(r[7]);
    if (r[8]) c.outAt = Number(r[8]);
    if (c.date === date && r[9]) c.sig = String(r[9]); // ส่งรูปลายเซ็นเฉพาะวันที่กำลังดู
    return c;
  });
  const meta = {};
  rows_(SHEETS.meta).forEach(function (r) {
    if (!r[0]) return;
    try { meta[String(r[0])] = JSON.parse(r[1]); } catch (x) {}
  });
  return { ok: true, students: students, checks: checks, meta: meta };
}

/* ---------- write ---------- */
function route_(op, path, data) {
  const parts = path.split('/');
  if (parts.length === 2 && parts[0] === 'students') return writeStudent_(op, parts[1], data);
  if (parts.length === 4 && parts[0] === 'days' && parts[2] === 'checks') return writeCheck_(op, parts[1], parts[3], data);
  return writeMeta_(op, path, data);
}

function writeStudent_(op, id, data) {
  const sh = sheet_(SHEETS.students);
  const row = findRow_(sh, function (r) { return String(r[0]) === id; });
  if (op === 'delete') { if (row) sh.deleteRow(row.index); return; }
  let cur = {};
  if (row) cur = { order: row.values[1], name: row.values[2], company: row.values[3], walkin: !!row.values[4] };
  else if (op === 'update') throw codeErr_('invalid_argument', 'ไม่พบรายชื่อนี้');
  const d = op === 'set' ? data : Object.assign(cur, data);
  const vals = [id, Number(d.order) || 0, clean_(d.name), clean_(d.company), d.walkin ? 'ใช่' : '',
    row ? row.values[5] : fmtDateTime_(d.createdAt || Date.now())];
  if (!vals[2]) throw codeErr_('invalid_argument', 'ต้องมีชื่อ');
  if (row) sh.getRange(row.index, 1, 1, vals.length).setValues([vals]);
  else sh.appendRow(vals);
}

function writeCheck_(op, date, id, data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw codeErr_('invalid_argument', 'วันที่ไม่ถูกต้อง');
  const sh = sheet_(SHEETS.att);
  const row = findRow_(sh, function (r) { return dateKey_(r[0]) === date && String(r[1]) === id; });
  if (op === 'delete') { if (row) sh.deleteRow(row.index); return; }
  let cur = {};
  if (row) cur = { name: row.values[2], inAt: Number(row.values[7]) || null, outAt: Number(row.values[8]) || null, sig: row.values[9] || '', sigLink: row.values[6] || '' };
  else if (op === 'update') throw codeErr_('invalid_argument', 'ยังไม่ได้ Clock in');
  const d = op === 'set' ? Object.assign({}, data) : Object.assign(cur, data);
  const student = findRow_(sheet_(SHEETS.students), function (r) { return String(r[0]) === id; });
  const name = clean_(d.name) || (student ? student.values[2] : '');
  const company = student ? student.values[3] : '';

  let sig = typeof d.sig === 'string' && d.sig.indexOf('data:image/') === 0 ? d.sig : '';
  let sigLink = op === 'set' ? '' : (cur.sigLink || '');
  if (sig && data.sig && CONFIG.SAVE_SIGNATURE_IMAGES) sigLink = saveSignature_(sig, date, name);
  if (sig.length > 49000) sig = ''; // เกินขนาดเซลล์ของ Google Sheets — ยังมีไฟล์ใน Drive

  const vals = ["'" + date, id, name, company,
    d.inAt ? fmtTime_(d.inAt) : '', d.outAt ? fmtTime_(d.outAt) : '', sigLink,
    d.inAt || '', d.outAt || '', sig];
  if (row) sh.getRange(row.index, 1, 1, vals.length).setValues([vals]);
  else sh.appendRow(vals);
}

function writeMeta_(op, path, data) {
  if (!/^[A-Za-z0-9_\-.~:@+]+(\/[A-Za-z0-9_\-.~:@+]+)+$/.test(path)) throw codeErr_('invalid_argument', 'path ไม่ถูกต้อง');
  const sh = sheet_(SHEETS.meta);
  const row = findRow_(sh, function (r) { return String(r[0]) === path; });
  if (op === 'delete') { if (row) sh.deleteRow(row.index); return; }
  let cur = {};
  if (row) { try { cur = JSON.parse(row.values[1]); } catch (x) {} }
  else if (op === 'update') throw codeErr_('invalid_argument', 'ไม่พบข้อมูล');
  const d = op === 'set' ? data : Object.assign(cur, data);
  const vals = [path, JSON.stringify(d), fmtDateTime_(Date.now())];
  if (row) sh.getRange(row.index, 1, 1, 3).setValues([vals]);
  else sh.appendRow(vals);
}

/* ---------- helpers ---------- */
function sheet_(def) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(def.name);
  if (!sh) { sh = ss.insertSheet(def.name); sh.getRange(1, 1, 1, def.head.length).setValues([def.head]); sh.setFrozenRows(1); }
  return sh;
}
function rows_(def) {
  const sh = sheet_(def);
  const n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, def.head.length).getValues();
}
function findRow_(sh, match) {
  const n = sh.getLastRow();
  if (n < 2) return null;
  const vals = sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < vals.length; i++) if (match(vals[i])) return { index: i + 2, values: vals[i] };
  return null;
}
function dateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd');
  return String(v).replace(/^'/, '').trim();
}
function fmtTime_(ms) { return Utilities.formatDate(new Date(Number(ms)), CONFIG.TZ, 'HH:mm:ss'); }
function fmtDateTime_(ms) { return Utilities.formatDate(new Date(Number(ms)), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function clean_(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
function checkToken_(t) { if (CONFIG.TOKEN && t !== CONFIG.TOKEN) throw codeErr_('permission_denied', 'TOKEN ไม่ถูกต้อง'); }
function codeErr_(code, msg) { const e = new Error(msg); e.code = code; return e; }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function signatureFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.SIGNATURE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.SIGNATURE_FOLDER);
}
function saveSignature_(dataUrl, date, name) {
  try {
    const b64 = dataUrl.split(',')[1];
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', date + '_' + (name || 'signature') + '.png');
    return signatureFolder_().createFile(blob).getUrl();
  } catch (err) {
    return '';
  }
}
