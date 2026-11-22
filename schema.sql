-- Supabase Schema for Khabari Elite

-- Enable pgvector extension
create extension if not exists vector;

-- News Cache Table
create table public.news_cache (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    description text,
    content text,
    url text unique not null,
    image_url text,
    published_at timestamp with time zone,
    source_name text,
    created_at timestamp with time zone default now()
);

-- News Embeddings Table for Semantic Search
create table public.news_embeddings (
    id uuid default gen_random_uuid() primary key,
    article_id uuid references public.news_cache(id) on delete cascade,
    embedding vector(1536), -- Assuming 1536 dimensions for embeddings
    created_at timestamp with time zone default now()
);

-- User Likes for Personalization
create table public.user_likes (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade,
    article_id uuid references public.news_cache(id) on delete cascade,
    created_at timestamp with time zone default now(),
    unique(user_id, article_id)
);

-- Functions for Semantic RAG
create or replace function match_articles (
  query_embedding vector(1536),
  match_count int default 3
) returns table (
  id uuid,
  title text,
  description text,
  url text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    nc.id,
    nc.title,
    nc.description,
    nc.url,
    1 - (ne.embedding <=> query_embedding) as similarity
  from news_embeddings ne
  join news_cache nc on ne.article_id = nc.id
  order by ne.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Server code uses the service-role key (bypasses RLS). With RLS on and no
-- anon policies, a leaked anon key cannot read or write these tables.
-- ---------------------------------------------------------------------------
alter table public.news_cache enable row level security;
alter table public.news_embeddings enable row level security;
alter table public.user_likes enable row level security;

-- Public, read-only access to cached headlines (safe: it's public news).
create policy "news_cache is publicly readable"
  on public.news_cache for select
  using (true);

-- Signed-in users manage only their own likes.
create policy "users read own likes"
  on public.user_likes for select
  using (auth.uid() = user_id);
create policy "users insert own likes"
  on public.user_likes for insert
  with check (auth.uid() = user_id);
create policy "users delete own likes"
  on public.user_likes for delete
  using (auth.uid() = user_id);

-- Analytics tables (user_analytics, article_analytics, ai_features_usage,
-- daily_visits, location_analytics), if you created them, should also have
-- RLS enabled with NO anon policies:
--   alter table public.<table> enable row level security;

-- ---------------------------------------------------------------------------
-- News ingest (scheduled job -> /api/ingest). Safe to run on an existing DB.
-- ---------------------------------------------------------------------------
alter table public.news_cache add column if not exists summary text;
alter table public.news_cache add column if not exists summarized_at timestamp with time zone;

-- Which stories appear in which feed. feed = 'lang|region|topic', e.g.
-- 'en|in|sports', 'en|world|general', 'hi|in|general'. A story can be in many.
create table if not exists public.feed_items (
    feed text not null,
    url text not null references public.news_cache(url) on delete cascade,
    published_at timestamp with time zone,
    seen_at timestamp with time zone not null default now(),
    primary key (feed, url)
);
create index if not exists feed_items_feed_idx on public.feed_items (feed, published_at desc);
alter table public.feed_items enable row level security;
drop policy if exists "feed_items is publicly readable" on public.feed_items;
create policy "feed_items is publicly readable" on public.feed_items for select using (true);

-- Newest stories in a feed, with their AI summaries (one round trip).
create or replace function public.get_feed(p_feed text, p_limit int default 60)
returns table (
    title text, description text, url text, image_url text,
    published_at timestamp with time zone, source_name text, summary text,
    seen_at timestamp with time zone
)
language sql stable
as $$
    select nc.title, nc.description, nc.url, nc.image_url,
           coalesce(fi.published_at, nc.published_at), nc.source_name, nc.summary, fi.seen_at
    from public.feed_items fi
    join public.news_cache nc on nc.url = fi.url
    where fi.feed = p_feed and fi.seen_at > now() - interval '7 days'
    order by coalesce(fi.published_at, nc.published_at) desc nulls last
    limit least(greatest(p_limit, 1), 200);
$$;

-- Keep the free-tier database small: drop stories not seen for p_days.
create or replace function public.prune_news(p_days int default 7)
returns void
language sql
as $$
    delete from public.feed_items where seen_at < now() - make_interval(days => p_days);
    delete from public.news_cache nc
    where nc.created_at < now() - make_interval(days => p_days)
      and not exists (select 1 from public.feed_items fi where fi.url = nc.url)
      and not exists (select 1 from public.user_likes ul where ul.article_id = nc.id);
$$;
-- Functions are executable by everyone by default; only the server may prune.
revoke execute on function public.prune_news(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contact form messages (written by /api/contact with the service key).
-- RLS on with no policies: not readable or writable with the public key.
-- ---------------------------------------------------------------------------
create table if not exists public.contact_messages (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone not null default now(),
    name text,
    email text not null,
    topic text not null default 'other',
    message text not null,
    page text,
    attribution jsonb,
    ip_hash text,
    user_agent text,
    handled boolean not null default false
);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
alter table public.contact_messages enable row level security;
