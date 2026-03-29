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
