-- 경북 자원 지도: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 [Run] 을 누르세요.
-- 여러 번 실행해도 괜찮습니다(이미 있으면 건너뜁니다).
-- 기존 앱의 entries 표와는 따로인 gb_ 표만 만듭니다. 다른 앱 기록에는 손대지 않습니다.
-- 로그인 없이 링크만으로 쓰는 수업용 앱이라, 링크를 아는 사람은 읽고 쓸 수 있는 모델입니다.

-- 1) 기록 표 -------------------------------------------------------------
create table if not exists public.gb_entries (
  kind       text not null,          -- cfg(선생님 설정) res(자원 카드) arrow(화살표) tag chat gen
  key        text not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (kind, key)
);

-- 고칠 때마다 서버 시각으로 updated_at 을 새로 적습니다(다른 기기가 바뀐 줄만 읽어 가는 데 씀).
create or replace function public.gb_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists gb_entries_touch on public.gb_entries;
create trigger gb_entries_touch before insert or update on public.gb_entries
  for each row execute function public.gb_touch();

create index if not exists gb_entries_updated on public.gb_entries (updated_at);

alter table public.gb_entries enable row level security;

drop policy if exists "gb read"   on public.gb_entries;
drop policy if exists "gb insert" on public.gb_entries;
drop policy if exists "gb update" on public.gb_entries;
drop policy if exists "gb delete" on public.gb_entries;
create policy "gb read"   on public.gb_entries for select using (true);
create policy "gb insert" on public.gb_entries for insert with check (true);
create policy "gb update" on public.gb_entries for update using (true) with check (true);
create policy "gb delete" on public.gb_entries for delete using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.gb_entries to anon, authenticated;

-- 앱이 새 표를 바로 알아보게 합니다.
notify pgrst, 'reload schema';

-- 2) 사진 저장 공간(공개 읽기, 한 장 2MB 까지, jpg/png/webp 만) ---------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gb-photos', 'gb-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "gb photos read"   on storage.objects;
drop policy if exists "gb photos insert" on storage.objects;
drop policy if exists "gb photos update" on storage.objects;
drop policy if exists "gb photos delete" on storage.objects;
create policy "gb photos read"   on storage.objects for select to anon, authenticated using (bucket_id = 'gb-photos');
create policy "gb photos insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'gb-photos');
create policy "gb photos update" on storage.objects for update to anon, authenticated using (bucket_id = 'gb-photos') with check (bucket_id = 'gb-photos');
create policy "gb photos delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'gb-photos');

-- 끝. 아래 줄이 결과에 보이면 성공입니다.
select 'gb_entries 표와 gb-photos 사진 공간이 준비되었습니다' as 결과;
