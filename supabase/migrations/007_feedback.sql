-- User-submitted feedback from the in-app rating prompt's thumbs-down path.
-- Inserts allowed for any client; reads are admin-only via Supabase dashboard.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  message text not null,
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_user_id_idx on feedback (user_id);
create index if not exists feedback_created_at_idx on feedback (created_at desc);

alter table feedback enable row level security;

drop policy if exists "feedback_insert_anon" on feedback;
create policy "feedback_insert_anon" on feedback
  for insert
  with check (true);
