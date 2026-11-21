-- Claude Future Food Check-in · Supabase schema (v2.0.0)
-- ตั้งไว้แล้วในโปรเจกต์ classcheckin (rxppmmhqewuiwqiokpes) — ไฟล์นี้เก็บไว้อ้างอิง/สร้างใหม่
-- ห้ามรันซ้ำบนโปรเจกต์เดิม

create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- แอดมิน (ตามอีเมล Google)
create table private.admins (email text primary key);
insert into private.admins(email) values ('indyjanezz@gmail.com');

-- ลิงก์ Apps Script ที่รับสำเนาการเช็คชื่อ (ชีต "เช็คอิน")
create table private.sync_config (id int primary key default 1 check (id = 1), url text not null);
-- insert into private.sync_config(id, url) values (1, 'https://script.google.com/macros/s/.../exec');

create table public.students (
  id text primary key default ('w' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  name text not null check (length(trim(name)) between 2 and 120),
  company text not null default '',
  walkin boolean not null default false,
  sort int not null default 0,
  user_id uuid unique references auth.users(id) on delete set null,   -- Gmail ที่ผูกกับชื่อนี้
  email text,
  created_at timestamptz not null default now()
);
create unique index students_name_key on public.students (lower(regexp_replace(name, '\s+', '', 'g')));

create table public.checks (
  day date not null,
  student_id text not null references public.students(id) on delete cascade,
  in_at timestamptz,
  out_at timestamptz,
  late_min int,                         -- นาทีหลังเวลาเริ่มเรียน
  sig text check (sig is null or length(sig) < 200000),
  checked_by uuid default auth.uid(),
  primary key (day, student_id)
);
create index checks_student_idx on public.checks(student_id);

create table public.settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
insert into public.settings(key, value) values ('start', '"09:00"'), ('grace', '15'), ('cert_pct', '80'), ('course_days', '[]');

create table public.draws (day date primary key, winners text[] not null default '{}');

alter table public.students enable row level security;
alter table public.checks   enable row level security;
alter table public.settings enable row level security;
alter table public.draws    enable row level security;

create policy "signed in can read students" on public.students for select to authenticated using (true);
create policy "signed in can read checks"   on public.checks   for select to authenticated using (true);
create policy "signed in can read settings" on public.settings for select to authenticated using (true);
create policy "signed in can read draws"    on public.draws    for select to authenticated using (true);
create policy "admin writes students" on public.students for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin writes checks"   on public.checks   for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin writes settings" on public.settings for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin writes draws"    on public.draws    for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- functions ----------
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.class_day() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

-- นักเรียนผูก Gmail กับชื่อตัวเอง (ครั้งเดียว)
create or replace function public.claim_student(p_student text) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); taken uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.students where user_id = uid) then raise exception 'already_linked'; end if;
  select user_id into taken from public.students where id = p_student for update;
  if not found then raise exception 'no_such_student'; end if;
  if taken is not null then raise exception 'name_taken'; end if;
  update public.students set user_id = uid, email = auth.jwt() ->> 'email' where id = p_student;
end $$;

create or replace function public.register_walkin(p_name text, p_company text) returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); nid text; nsort int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not public.is_admin() and exists (select 1 from public.students where user_id = uid) then raise exception 'already_linked'; end if;
  if exists (select 1 from public.students where lower(regexp_replace(name, '\s+', '', 'g')) = lower(regexp_replace(p_name, '\s+', '', 'g'))) then raise exception 'name_exists'; end if;
  select coalesce(max(sort), 0) + 1 into nsort from public.students;
  insert into public.students(name, company, walkin, sort, user_id, email)
  values (trim(regexp_replace(p_name, '\s+', ' ', 'g')), trim(coalesce(p_company, '')), true, nsort,
          case when public.is_admin() then null else uid end,
          case when public.is_admin() then null else auth.jwt() ->> 'email' end)
  returning id into nid;
  return nid;
end $$;

-- เช็คอิน: เวลาจากเซิร์ฟเวอร์ เช็คได้เฉพาะชื่อตัวเอง (แอดมินเช็คแทนได้)
create or replace function public.check_in(p_student text, p_sig text) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); d date := public.class_day(); st text; late int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not public.is_admin() and not exists (select 1 from public.students where id = p_student and user_id = uid) then raise exception 'not_your_name'; end if;
  if p_sig is null or p_sig not like 'data:image/png;base64,%' then raise exception 'signature_required'; end if;
  select value #>> '{}' into st from public.settings where key = 'start';
  late := greatest(0, floor(extract(epoch from ((now() at time zone 'Asia/Bangkok') - (d + coalesce(st, '09:00')::time))) / 60))::int;
  insert into public.checks(day, student_id, in_at, late_min, sig, checked_by)
  values (d, p_student, now(), late, p_sig, uid)
  on conflict (day, student_id) do nothing;
  if not found then raise exception 'already_checked_in'; end if;
end $$;

create or replace function public.check_out(p_student text) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not public.is_admin() and not exists (select 1 from public.students where id = p_student and user_id = uid) then raise exception 'not_your_name'; end if;
  update public.checks set out_at = now() where day = public.class_day() and student_id = p_student and in_at is not null and out_at is null;
  if not found then raise exception 'not_checked_in'; end if;
end $$;

revoke execute on function public.claim_student(text), public.register_walkin(text, text), public.check_in(text, text), public.check_out(text), public.is_admin(), public.class_day() from public, anon;
grant execute on function public.claim_student(text), public.register_walkin(text, text), public.check_in(text, text), public.check_out(text), public.is_admin(), public.class_day() to authenticated;

-- ---------- สำเนาลง Google Sheet ----------
create or replace function private.push_to_sheet(body jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare u text;
begin
  select url into u from private.sync_config where id = 1;
  if u is null or u = '' then return; end if;
  begin
    perform net.http_post(url := u, body := body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 15000);
  exception when others then
    raise warning 'sheet copy skipped: %', sqlerrm;  -- ชีตมีปัญหาไม่ทำให้เช็คชื่อพัง
  end;
end $$;

create or replace function private.ms(t timestamptz) returns bigint language sql immutable set search_path = '' as $$ select coalesce((extract(epoch from t) * 1000)::bigint, 0) $$;

create or replace function private.sync_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if tg_op = 'DELETE' then
    perform private.push_to_sheet(jsonb_build_object('op', 'delete', 'path', 'days/' || old.day || '/checks/' || old.student_id));
    return null;
  end if;
  select name, company into s from public.students where id = new.student_id;
  if tg_op = 'INSERT' or new.sig is distinct from old.sig then
    perform private.push_to_sheet(jsonb_build_object('op', 'set', 'path', 'days/' || new.day || '/checks/' || new.student_id,
      'data', jsonb_build_object('name', s.name, 'inAt', private.ms(new.in_at), 'outAt', private.ms(new.out_at), 'sig', coalesce(new.sig, ''))));
  else
    perform private.push_to_sheet(jsonb_build_object('op', 'update', 'path', 'days/' || new.day || '/checks/' || new.student_id,
      'data', jsonb_build_object('name', s.name, 'inAt', private.ms(new.in_at), 'outAt', private.ms(new.out_at))));
  end if;
  return null;
end $$;

create or replace function private.sync_student() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.push_to_sheet(jsonb_build_object('op', 'delete', 'path', 'students/' || old.id));
  elsif tg_op = 'INSERT' or (new.name, new.company, new.walkin) is distinct from (old.name, old.company, old.walkin) then
    perform private.push_to_sheet(jsonb_build_object('op', 'set', 'path', 'students/' || new.id,
      'data', jsonb_build_object('name', new.name, 'company', new.company, 'walkin', new.walkin)));
  end if;
  return null;
end $$;

create trigger checks_to_sheet after insert or update or delete on public.checks for each row execute function private.sync_check();
create trigger students_to_sheet after insert or update or delete on public.students for each row execute function private.sync_student();

alter publication supabase_realtime add table public.students, public.checks, public.settings, public.draws;
