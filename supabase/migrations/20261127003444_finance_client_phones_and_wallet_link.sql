create or replace function finance_private.finance_service_link_client(p_owner uuid,p_session uuid,p_client uuid,p_user uuid,p_envelope jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not finance_private.verified_owner(p_owner,p_session) then raise exception 'Verified owner required' using errcode='42501'; end if;
 if p_envelope->>'v' is distinct from '1' or coalesce(length(p_envelope->>'ciphertext'),0) not between 20 and 150000 or coalesce(length(p_envelope->>'iv'),0)<>16 then raise exception 'Encrypted wallet record required'; end if;
 perform 1 from public.finance_clients where id=p_client and active and auth_user_id is null for update;
 if not found then raise exception 'Client already linked or missing'; end if;
 if not exists(select 1 from public.finance_vault_metadata) then raise exception 'Set up secret wallet first'; end if;
 insert into public.finance_profiles(user_id,role) values(p_user,'client');
 update public.finance_clients set auth_user_id=p_user where id=p_client;
 insert into public.finance_vault_items(client_id,envelope) values(p_client,p_envelope)
 on conflict(client_id) do update
 set envelope=excluded.envelope,updated_at=clock_timestamp();
 insert into public.finance_audit_events(actor,action,entity_id) values(p_owner,'client.access_created',p_client);
end $$;

alter table public.finance_clients
  add column alternate_phone text not null default '';

create function finance_private.update_own_phones(p_phone text,p_alternate_phone text)
returns void language plpgsql security definer set search_path='' as $$
declare
  caller uuid := auth.uid();
  session_id uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  primary_phone text := regexp_replace(coalesce(p_phone,''),'[[:space:]()-]','','g');
  alternate text := regexp_replace(coalesce(p_alternate_phone,''),'[[:space:]()-]','','g');
begin
  if not finance_private.live_session(caller,session_id)
     or not exists(select 1 from public.finance_profiles where user_id=caller and role='client' and active) then
    raise exception 'Active client session required' using errcode='42501';
  end if;
  if primary_phone !~ '^[+]?[0-9]{7,15}$'
     or (alternate <> '' and (alternate !~ '^[+]?[0-9]{7,15}$' or alternate=primary_phone)) then
    raise exception 'Enter a valid phone number and a different alternate number.';
  end if;
  update public.finance_clients set phone=primary_phone,alternate_phone=alternate
    where auth_user_id=caller and active;
  if not found then raise exception 'Active client account required' using errcode='42501'; end if;
end;
$$;
revoke all on function finance_private.update_own_phones(text,text) from public,anon;
grant execute on function finance_private.update_own_phones(text,text) to authenticated;

create function public.finance_update_own_phones(p_phone text,p_alternate_phone text default '')
returns void language sql security invoker set search_path='' as $$
  select finance_private.update_own_phones(p_phone,p_alternate_phone);
$$;
revoke all on function public.finance_update_own_phones(text,text) from public,anon;
grant execute on function public.finance_update_own_phones(text,text) to authenticated;
