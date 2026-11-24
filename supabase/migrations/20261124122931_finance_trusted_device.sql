-- Extend only the exact authenticated session that just passed a valid OTP.
create function finance_private.verify_trusted_code(
  p_user uuid, p_session uuid, p_id uuid, p_hash text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if public.finance_service_verify_code(p_user,p_session,p_id,p_hash) is not true then
    return false;
  end if;
  update finance_private.owner_verifications
    set expires_at=now()+interval '30 days'
    where user_id=p_user and session_id=p_session;
  return true;
end;
$$;
revoke all on function finance_private.verify_trusted_code(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function finance_private.verify_trusted_code(uuid,uuid,uuid,text) to service_role;
create function public.finance_service_verify_trusted_code(p_user uuid,p_session uuid,p_id uuid,p_hash text)
returns boolean language sql security invoker set search_path='' as $$
  select finance_private.verify_trusted_code(p_user,p_session,p_id,p_hash);
$$;
revoke all on function public.finance_service_verify_trusted_code(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finance_service_verify_trusted_code(uuid,uuid,uuid,text) to service_role;
