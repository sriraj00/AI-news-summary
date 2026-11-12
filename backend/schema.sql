-- Run this in the Supabase SQL editor. Keep service-role credentials on the server only.
create extension if not exists pgcrypto;

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  summary text not null default '',
  article_summaries jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  common_information jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  claims jsonb not null default '[]'::jsonb,
  source_articles jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analyses_created_at_idx on public.analyses (created_at desc);
alter table public.analyses enable row level security;
-- The API uses the service role key from the backend. Never expose it to the browser.
