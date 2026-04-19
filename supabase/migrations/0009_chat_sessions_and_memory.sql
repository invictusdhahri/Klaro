-- =============================================================================
-- 0009 — Chat sessions & long-term memory
-- =============================================================================

-- ---------- chat_sessions ----------------------------------------------------
create table public.chat_sessions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  title           text        not null default 'New chat',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz,
  message_count   int         not null default 0,
  is_summarized   boolean     not null default false,
  archived_at     timestamptz
);

create index chat_sessions_user_updated_idx
  on public.chat_sessions(user_id, updated_at desc)
  where archived_at is null;

-- ---------- session_id on chat_messages --------------------------------------
alter table public.chat_messages
  add column session_id uuid references public.chat_sessions(id) on delete cascade;

create index chat_messages_session_created_idx
  on public.chat_messages(session_id, created_at);

-- ---------- backfill ---------------------------------------------------------
-- One "Legacy chat" session per user that already has chat messages.
insert into public.chat_sessions (user_id, title, last_message_at, message_count, is_summarized)
select
  user_id,
  'Legacy chat',
  max(created_at),
  count(*)::int,
  false
from public.chat_messages
where session_id is null
group by user_id;

-- Point every orphan message at its user's legacy session.
update public.chat_messages m
set session_id = s.id
from public.chat_sessions s
where m.session_id is null
  and s.user_id   = m.user_id
  and s.title     = 'Legacy chat';

-- ---------- user_memories ----------------------------------------------------
create table public.user_memories (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.profiles(id) on delete cascade,
  source_session_id uuid        references public.chat_sessions(id) on delete set null,
  fact              text        not null,
  category          text        check (category in ('goal','preference','situation','concern','fact')),
  importance        int         not null default 3 check (importance between 1 and 5),
  created_at        timestamptz not null default now()
);

create index user_memories_user_idx
  on public.user_memories(user_id, importance desc, created_at desc);

-- ---------- RLS --------------------------------------------------------------
alter table public.chat_sessions enable row level security;
alter table public.user_memories  enable row level security;

create policy "Users see own chat sessions"
  on public.chat_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users see own memories"
  on public.user_memories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
