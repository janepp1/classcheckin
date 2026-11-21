// ตั้งค่าเว็บเช็คชื่อ Claude future food

window.CHECKIN_CONFIG = {
  // ---------- ล็อกอินด้วย Gmail + ฐานข้อมูล Supabase (v2) ----------
  // เปลี่ยนเป็น true หลังตั้งค่า Google ใน Supabase เสร็จ (ดู README หัวข้อ "เปิดล็อกอินด้วย Gmail")
  // ตอนเป็น false เว็บจะใช้โหมด Google Sheet ด้านล่างเหมือนเดิม
  ENABLE_LOGIN: false,
  SUPABASE_URL: "https://rxppmmhqewuiwqiokpes.supabase.co",
  // publishable key ใช้ในหน้าเว็บได้ตามปกติ ข้อมูลถูกป้องกันด้วยสิทธิ์ (RLS) ในฐานข้อมูล
  SUPABASE_KEY: "sb_publishable_DdtlIpOsECP-KSX6oVofHg_mI38241U",

  // ---------- โหมด Google Sheet (ใช้เมื่อ ENABLE_LOGIN เป็น false) ----------
  // เมื่อเปิดล็อกอินแล้ว Supabase จะส่งสำเนาการเช็คชื่อไปที่ลิงก์นี้ให้เอง
  SHEETS_API_URL: "https://script.google.com/macros/s/AKfycbzOGdidnj1GnLehuo0-XszcQUDDAQsazNBgPU0DI8dNENCjlg_8EApWUJML6tjfoX3SSg/exec",
  TOKEN: "",
  TEACHER_PIN: "",
  POLL_SECONDS: 8
};
