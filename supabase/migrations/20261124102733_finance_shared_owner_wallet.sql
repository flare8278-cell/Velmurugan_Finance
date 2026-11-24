-- Keep a single encryption key envelope for all verified administrators.
create unique index finance_one_wallet on public.finance_vault_metadata ((true));
alter policy vault_meta_read on public.finance_vault_metadata using (finance_private.is_owner());

create or replace function finance_private.finance_save_vault_metadata(p_envelope jsonb,p_expected_updated_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.finance_vault_metadata;
begin
 perform finance_private.assert_owner();
 if p_envelope->>'v' is distinct from '1' or p_envelope->>'kdf' is distinct from 'PBKDF2-SHA256' or coalesce((p_envelope->>'iterations')::int,0)<600000 or length(p_envelope::text)>10000 then raise exception 'Invalid encrypted wallet metadata'; end if;
 perform pg_advisory_xact_lock(hashtextextended('finance-shared-wallet',1));
 if exists(select 1 from public.finance_vault_metadata  ) then
  update public.finance_vault_metadata set envelope=p_envelope,updated_at=clock_timestamp() where owner_id=auth.uid() and updated_at=p_expected_updated_at returning * into result;
  if not found then raise exception 'Only the wallet creator can recover it. If you are the creator, refresh and retry.'; end if;
 else
  insert into public.finance_vault_metadata(owner_id,envelope) values(auth.uid(),p_envelope) returning * into result;
 end if;
 insert into public.finance_audit_events(actor,action,entity_id) values(auth.uid(),'vault.metadata_saved',auth.uid()); return to_jsonb(result);
end $$;

create or replace function finance_private.finance_service_link_client(p_owner uuid,p_session uuid,p_client uuid,p_user uuid,p_envelope jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not finance_private.verified_owner(p_owner,p_session) then raise exception 'Verified owner required' using errcode='42501'; end if;
 if p_envelope->>'v' is distinct from '1' or coalesce(length(p_envelope->>'ciphertext'),0) not between 20 and 150000 or coalesce(length(p_envelope->>'iv'),0)<>16 then raise exception 'Encrypted wallet record required'; end if;
 perform 1 from public.finance_clients where id=p_client and auth_user_id is null for update;
 if not found then raise exception 'Client already linked or missing'; end if;
 if not exists(select 1 from public.finance_vault_metadata) then raise exception 'Set up secret wallet first'; end if;
 insert into public.finance_profiles(user_id,role) values(p_user,'client');
 update public.finance_clients set auth_user_id=p_user where id=p_client;
 insert into public.finance_vault_items(client_id,envelope) values(p_client,p_envelope);
 insert into public.finance_audit_events(actor,action,entity_id) values(p_owner,'client.access_created',p_client);
end $$;
