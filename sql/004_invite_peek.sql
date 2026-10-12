-- Run once in the Supabase SQL editor (after 003_invitations.sql).
-- Lets the invitation page show who invited you and pre-fill your email BEFORE
-- you have an account. It only works for someone holding the secret link.

create or replace function peek_invitation(_token text)
returns table (org_name text, email text, role org_role, status text)
language plpgsql security definer set search_path = public as $$
declare inv invitations;
begin
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

revoke all on function peek_invitation(text) from public;
grant execute on function peek_invitation(text) to anon, authenticated;
