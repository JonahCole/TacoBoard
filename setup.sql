-- TacoBoard 2.0 — Supabase setup
-- Run this entire file once in Supabase > SQL Editor.
-- The browser gets NO direct table access. It can only call the SECURITY DEFINER functions below.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tacoboards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (char_length(title) between 1 and 90),
  subtitle text not null default '' check (char_length(subtitle) <= 140),
  theme text not null default 'fiesta' check (theme in ('fiesta','verde','night','sunset','paper','corporate')),
  status text not null default 'open' check (status in ('open','served')),
  contributor_token text not null,
  admin_token_hash bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tacoboard_posts (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.tacoboards(id) on delete cascade,
  author text not null check (char_length(author) between 1 and 60),
  message text not null check (char_length(message) between 1 and 700),
  media text not null default '' check (char_length(media) <= 2000000),
  color text not null default '#fff4b8' check (char_length(color) <= 24),
  x double precision not null default 5,
  y double precision not null default 25,
  rotation double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tacoboard_stickers (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.tacoboards(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 24),
  x double precision not null default 70,
  y double precision not null default 60,
  rotation double precision not null default 0,
  size double precision not null default 1,
  created_at timestamptz not null default now()
);

alter table public.tacoboards enable row level security;
alter table public.tacoboard_posts enable row level security;
alter table public.tacoboard_stickers enable row level security;

-- No direct Data API access. Functions below are the entire public surface.
revoke all on table public.tacoboards from anon, authenticated;
revoke all on table public.tacoboard_posts from anon, authenticated;
revoke all on table public.tacoboard_stickers from anon, authenticated;

create or replace function public.create_tacoboard(
  p_title text,
  p_subtitle text default '',
  p_theme text default 'fiesta'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_slug text;
  v_contributor text;
  v_admin text;
  v_board_id uuid;
begin
  if char_length(trim(coalesce(p_title,''))) not between 1 and 90 then
    raise exception 'Board title must be 1-90 characters';
  end if;
  if char_length(coalesce(p_subtitle,'')) > 140 then
    raise exception 'Board subtitle is too long';
  end if;
  if p_theme not in ('fiesta','verde','night','sunset','paper','corporate') then
    p_theme := 'fiesta';
  end if;

  loop
    v_slug := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
    exit when not exists (select 1 from public.tacoboards where slug = v_slug);
  end loop;

  v_contributor := encode(extensions.gen_random_bytes(18), 'hex');
  v_admin := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.tacoboards (slug, title, subtitle, theme, contributor_token, admin_token_hash)
  values (v_slug, trim(p_title), coalesce(p_subtitle,''), p_theme, v_contributor, extensions.digest(v_admin, 'sha256'))
  returning id into v_board_id;

  insert into public.tacoboard_stickers (board_id, emoji, x, y, rotation, size)
  values
    (v_board_id, '🌮', 72, 70, -10, 1.18),
    (v_board_id, '✨', 83, 76, 9, .82);

  return jsonb_build_object(
    'slug', v_slug,
    'contributor_token', v_contributor,
    'admin_token', v_admin
  );
end;
$$;

create or replace function public.get_tacoboard(
  p_slug text,
  p_token text
) returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions, pg_temp
as $$
declare
  b public.tacoboards%rowtype;
  v_admin boolean;
  v_contributor boolean;
begin
  select * into b from public.tacoboards where slug = p_slug;
  if not found then raise exception 'invalid taco key'; end if;

  v_admin := b.admin_token_hash = extensions.digest(coalesce(p_token,''), 'sha256');
  v_contributor := b.contributor_token = coalesce(p_token,'');
  if not (v_admin or v_contributor) then raise exception 'invalid taco key'; end if;

  return jsonb_build_object(
    'board', jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'title', b.title, 'subtitle', b.subtitle,
      'theme', b.theme, 'status', b.status, 'created_at', b.created_at, 'updated_at', b.updated_at
    ),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'author', p.author, 'message', p.message, 'media', p.media,
        'color', p.color, 'x', p.x, 'y', p.y, 'rotation', p.rotation, 'created_at', p.created_at
      ) order by p.created_at)
      from public.tacoboard_posts p where p.board_id = b.id
    ), '[]'::jsonb),
    'stickers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'emoji', s.emoji, 'x', s.x, 'y', s.y, 'rotation', s.rotation, 'size', s.size
      ) order by s.created_at)
      from public.tacoboard_stickers s where s.board_id = b.id
    ), '[]'::jsonb),
    'is_admin', v_admin,
    'contributor_token', case when v_admin then b.contributor_token else null end
  );
end;
$$;

create or replace function public.add_tacoboard_post(
  p_slug text, p_token text, p_author text, p_message text,
  p_media text default '', p_color text default '#fff4b8',
  p_x double precision default 5, p_y double precision default 25, p_rotation double precision default 0
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype; v_id uuid; v_allowed boolean;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found then raise exception 'invalid taco key'; end if;
  v_allowed := b.contributor_token=coalesce(p_token,'') or b.admin_token_hash=extensions.digest(coalesce(p_token,''),'sha256');
  if not v_allowed then raise exception 'invalid taco key'; end if;
  if b.status <> 'open' then raise exception 'This TacoBoard has already been served'; end if;
  if char_length(trim(coalesce(p_author,''))) not between 1 and 60 then raise exception 'Author is required'; end if;
  if char_length(trim(coalesce(p_message,''))) not between 1 and 700 then raise exception 'Message must be 1-700 characters'; end if;
  if char_length(coalesce(p_media,'')) > 2000000 then raise exception 'Media is too large'; end if;
  insert into public.tacoboard_posts(board_id,author,message,media,color,x,y,rotation)
  values(b.id,trim(p_author),trim(p_message),coalesce(p_media,''),left(coalesce(p_color,'#fff4b8'),24),greatest(0,least(98,p_x)),greatest(0,p_y),greatest(-20,least(20,p_rotation)))
  returning id into v_id;
  update public.tacoboards set updated_at=now() where id=b.id;
  return v_id;
end;
$$;

create or replace function public.add_tacoboard_sticker(
  p_slug text, p_token text, p_emoji text,
  p_x double precision default 70, p_y double precision default 60,
  p_rotation double precision default 0, p_size double precision default 1
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype; v_id uuid; v_allowed boolean;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found then raise exception 'invalid taco key'; end if;
  v_allowed := b.contributor_token=coalesce(p_token,'') or b.admin_token_hash=extensions.digest(coalesce(p_token,''),'sha256');
  if not v_allowed then raise exception 'invalid taco key'; end if;
  if b.status <> 'open' then raise exception 'This TacoBoard has already been served'; end if;
  insert into public.tacoboard_stickers(board_id,emoji,x,y,rotation,size)
  values(b.id,left(coalesce(nullif(p_emoji,''),'🌮'),24),greatest(0,least(96,p_x)),greatest(0,p_y),greatest(-45,least(45,p_rotation)),greatest(.4,least(2.2,p_size)))
  returning id into v_id;
  update public.tacoboards set updated_at=now() where id=b.id;
  return v_id;
end;
$$;

create or replace function public.update_tacoboard(
  p_slug text, p_admin_token text, p_title text, p_subtitle text, p_theme text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found or b.admin_token_hash<>extensions.digest(coalesce(p_admin_token,''),'sha256') then raise exception 'invalid taco admin key'; end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 90 then raise exception 'Board title must be 1-90 characters'; end if;
  if char_length(coalesce(p_subtitle,''))>140 then raise exception 'Board subtitle is too long'; end if;
  if p_theme not in ('fiesta','verde','night','sunset','paper','corporate') then raise exception 'Unknown board theme'; end if;
  update public.tacoboards set title=trim(p_title),subtitle=coalesce(p_subtitle,''),theme=p_theme,updated_at=now() where id=b.id;
  return true;
end;
$$;

create or replace function public.set_tacoboard_status(
  p_slug text, p_admin_token text, p_status text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found or b.admin_token_hash<>extensions.digest(coalesce(p_admin_token,''),'sha256') then raise exception 'invalid taco admin key'; end if;
  if p_status not in ('open','served') then raise exception 'Invalid board status'; end if;
  update public.tacoboards set status=p_status,updated_at=now() where id=b.id;
  return true;
end;
$$;

create or replace function public.update_tacoboard_post(
  p_slug text, p_admin_token text, p_post_id uuid,
  p_author text, p_message text, p_media text default '', p_color text default '#fff4b8'
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found or b.admin_token_hash<>extensions.digest(coalesce(p_admin_token,''),'sha256') then raise exception 'invalid taco admin key'; end if;
  if char_length(trim(coalesce(p_author,''))) not between 1 and 60 then raise exception 'Author is required'; end if;
  if char_length(trim(coalesce(p_message,''))) not between 1 and 700 then raise exception 'Message must be 1-700 characters'; end if;
  if char_length(coalesce(p_media,''))>2000000 then raise exception 'Media is too large'; end if;
  update public.tacoboard_posts set author=trim(p_author),message=trim(p_message),media=coalesce(p_media,''),color=left(coalesce(p_color,'#fff4b8'),24),updated_at=now()
  where id=p_post_id and board_id=b.id;
  if not found then raise exception 'Taco note not found'; end if;
  update public.tacoboards set updated_at=now() where id=b.id;
  return true;
end;
$$;

create or replace function public.delete_tacoboard_post(
  p_slug text, p_admin_token text, p_post_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found or b.admin_token_hash<>extensions.digest(coalesce(p_admin_token,''),'sha256') then raise exception 'invalid taco admin key'; end if;
  delete from public.tacoboard_posts where id=p_post_id and board_id=b.id;
  if not found then raise exception 'Taco note not found'; end if;
  update public.tacoboards set updated_at=now() where id=b.id;
  return true;
end;
$$;

create or replace function public.move_tacoboard_post(
  p_slug text, p_admin_token text, p_post_id uuid, p_x double precision, p_y double precision
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found or b.admin_token_hash<>extensions.digest(coalesce(p_admin_token,''),'sha256') then raise exception 'invalid taco admin key'; end if;
  update public.tacoboard_posts set x=greatest(0,least(98,p_x)),y=greatest(0,p_y),updated_at=now() where id=p_post_id and board_id=b.id;
  if not found then raise exception 'Taco note not found'; end if;
  return true;
end;
$$;

create or replace function public.delete_tacoboard_sticker(
  p_slug text, p_admin_token text, p_sticker_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found or b.admin_token_hash<>extensions.digest(coalesce(p_admin_token,''),'sha256') then raise exception 'invalid taco admin key'; end if;
  delete from public.tacoboard_stickers where id=p_sticker_id and board_id=b.id;
  if not found then raise exception 'Sticker not found'; end if;
  return true;
end;
$$;

create or replace function public.move_tacoboard_sticker(
  p_slug text, p_admin_token text, p_sticker_id uuid, p_x double precision, p_y double precision
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare b public.tacoboards%rowtype;
begin
  select * into b from public.tacoboards where slug=p_slug;
  if not found or b.admin_token_hash<>extensions.digest(coalesce(p_admin_token,''),'sha256') then raise exception 'invalid taco admin key'; end if;
  update public.tacoboard_stickers set x=greatest(0,least(96,p_x)),y=greatest(0,p_y) where id=p_sticker_id and board_id=b.id;
  if not found then raise exception 'Sticker not found'; end if;
  return true;
end;
$$;

-- Remove the default PUBLIC execute permission and grant only the browser roles.
revoke all on function public.create_tacoboard(text,text,text) from public;
revoke all on function public.get_tacoboard(text,text) from public;
revoke all on function public.add_tacoboard_post(text,text,text,text,text,text,double precision,double precision,double precision) from public;
revoke all on function public.add_tacoboard_sticker(text,text,text,double precision,double precision,double precision,double precision) from public;
revoke all on function public.update_tacoboard(text,text,text,text,text) from public;
revoke all on function public.set_tacoboard_status(text,text,text) from public;
revoke all on function public.update_tacoboard_post(text,text,uuid,text,text,text,text) from public;
revoke all on function public.delete_tacoboard_post(text,text,uuid) from public;
revoke all on function public.move_tacoboard_post(text,text,uuid,double precision,double precision) from public;
revoke all on function public.delete_tacoboard_sticker(text,text,uuid) from public;
revoke all on function public.move_tacoboard_sticker(text,text,uuid,double precision,double precision) from public;

grant execute on function public.create_tacoboard(text,text,text) to anon, authenticated;
grant execute on function public.get_tacoboard(text,text) to anon, authenticated;
grant execute on function public.add_tacoboard_post(text,text,text,text,text,text,double precision,double precision,double precision) to anon, authenticated;
grant execute on function public.add_tacoboard_sticker(text,text,text,double precision,double precision,double precision,double precision) to anon, authenticated;
grant execute on function public.update_tacoboard(text,text,text,text,text) to anon, authenticated;
grant execute on function public.set_tacoboard_status(text,text,text) to anon, authenticated;
grant execute on function public.update_tacoboard_post(text,text,uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.delete_tacoboard_post(text,text,uuid) to anon, authenticated;
grant execute on function public.move_tacoboard_post(text,text,uuid,double precision,double precision) to anon, authenticated;
grant execute on function public.delete_tacoboard_sticker(text,text,uuid) to anon, authenticated;
grant execute on function public.move_tacoboard_sticker(text,text,uuid,double precision,double precision) to anon, authenticated;
