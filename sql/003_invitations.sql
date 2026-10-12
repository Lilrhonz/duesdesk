-- Run once in the Supabase SQL editor (after schema.sql and 002_fees.sql).

-- ---------- Invitations ----------
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  email        text not null,
  role         org_role not null default 'treasurer',
  token        text not null unique
               default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz
);

-- One open invitation per email per organization
create unique index invitations_open_unique
  on invitations (org_id, lower(email)) where accepted_at is null;
create index invitations_org_idx on invitations (org_id);

alter table invitations enable row level security;

create policy inv_select on invitations for select
  using (has_org_role(org_id, array['admin']::org_role[]));
create policy inv_insert on invitations for insert
  with check (has_org_role(org_id, array['admin']::org_role[]));
create policy inv_delete on invitations for delete
  using (has_org_role(org_id, array['admin']::org_role[]));

-- ---------- Team list (includes emails, which only admins may see) ----------
create or replace function list_team(_org uuid)
returns table (user_id uuid, full_name text, email text, role org_role, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_org_member(_org) then
    raise exception 'Not allowed.';
  end if;
  return query
    select ou.user_id,
           p.full_name,
           case when has_org_role(_org, array['admin']::org_role[]) then u.email::text else null end,
           ou.role,
           ou.created_at
    from org_users ou
    join auth.users u on u.id = ou.user_id
    left join profiles p on p.id = ou.user_id
    where ou.org_id = _org
    order by ou.created_at;
end $$;

-- ---------- Look up an invitation by its secret token ----------
create or replace function get_invitation(_token text)
returns table (org_name text, email text, role org_role, status text)
language plpgsql security definer set search_path = public as $$
declare inv invitations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;
  select * into inv from invitations where invitations.token = _token;
  if not found then
    return;
  end if;
  return query
    select o.name, inv.email, inv.role,
           case when inv.accepted_at is not null then 'accepted'
                when inv.expires_at < now()      then 'expired'
                else 'valid' end
    from organizations o
    where o.id = inv.org_id;
end $$;

-- ---------- Accept an invitation (only by the invited email address) ----------
create or replace function accept_invitation(_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv invitations;
  me_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select * into inv from invitations where invitations.token = _token for update;
  if not found then
    raise exception 'This invitation link is not valid.';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invitation has already been used.';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask your admin for a new one.';
  end if;

  me_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if me_email <> lower(inv.email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  insert into org_users (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do nothing;

  update invitations set accepted_at = now() where id = inv.id;
  return inv.org_id;
end $$;

revoke all on function list_team(uuid)        from public;
revoke all on function get_invitation(text)   from public;
revoke all on function accept_invitation(text) from public;
grant execute on function list_team(uuid)        to authenticated;
grant execute on function get_invitation(text)   to authenticated;
grant execute on function accept_invitation(text) to authenticated;

-- ---------- Never leave an organization without an admin ----------
create or replace function keep_one_admin() returns trigger
language plpgsql as $$
declare demoting boolean;
begin
  if tg_op = 'DELETE' then
    demoting := true;
  else
    demoting := (new.role <> 'admin');
  end if;

  if old.role = 'admin'
     and demoting
     and exists (select 1 from organizations where id = old.org_id)
     and not exists (select 1 from org_users
                     where org_id = old.org_id and role = 'admin' and user_id <> old.user_id)
  then
    raise exception 'An organization must keep at least one admin.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger org_users_keep_admin
  before update or delete on org_users
  for each row execute function keep_one_admin();
