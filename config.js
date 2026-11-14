// ตั้งค่าเว็บเช็คชื่อ Claude future food
// วางลิงก์ Web app ของ Google Apps Script ที่ได้จากขั้นตอน Deploy (ลงท้ายด้วย /exec)
// ถ้าเว้นว่างไว้ เว็บจะทำงานแบบ "เครื่องเดียว" เก็บข้อมูลในเบราว์เซอร์
window.CHECKIN_CONFIG = {
  SHEETS_API_URL: "https://script.google.com/macros/s/AKfycbyEM-i7vK7lWk_VEsosV2n0ds4s0duGsW0VVX9l3nchBuJRqbLHHf2rgCbTDp89aW8OHA/exec",

  // ต้องตรงกับ TOKEN ใน apps-script/Code.gs (เว้นว่างได้ทั้งสองฝั่ง)
  // หมายเหตุ: ไฟล์นี้เปิดดูได้สาธารณะบน GitHub Pages จึงใช้กันคนสุ่มยิงได้ระดับหนึ่งเท่านั้น
  TOKEN: "",

  // PIN ผู้สอนเริ่มต้น (ตัวเลข 4–8 หลัก) ใช้ปลดล็อกโหมดผู้สอนครั้งแรก
  // หลังเข้าโหมดผู้สอนแล้วกด "เปลี่ยน PIN" ได้ PIN ใหม่จะบันทึกใน Google Sheet และใช้แทนค่านี้
  // ถ้าเว้นว่าง คนแรกที่กดปุ่ม 🔐 ผู้สอน จะเป็นคนตั้ง PIN จึงควรใส่ไว้ก่อนแชร์ลิงก์
  TEACHER_PIN: "",

  // ดึงข้อมูลล่าสุดจาก Google Sheet ทุกกี่วินาที (ขั้นต่ำ 4)
  POLL_SECONDS: 8
};
