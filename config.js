// ตั้งค่าเว็บเช็คชื่อ Claude future food
// วางลิงก์ Web app ของ Google Apps Script ที่ได้จากขั้นตอน Deploy (ลงท้ายด้วย /exec)
// ถ้าเว้นว่างไว้ เว็บจะทำงานแบบ "เครื่องเดียว" เก็บข้อมูลในเบราว์เซอร์
window.CHECKIN_CONFIG = {
  SHEETS_API_URL: "",

  // ต้องตรงกับ TOKEN ใน apps-script/Code.gs (เว้นว่างได้ทั้งสองฝั่ง)
  // หมายเหตุ: ไฟล์นี้เปิดดูได้สาธารณะบน GitHub Pages จึงใช้กันคนสุ่มยิงได้ระดับหนึ่งเท่านั้น
  TOKEN: "",

  // ดึงข้อมูลล่าสุดจาก Google Sheet ทุกกี่วินาที (ขั้นต่ำ 4)
  POLL_SECONDS: 8
};
