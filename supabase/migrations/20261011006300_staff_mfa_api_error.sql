-- PostgREST requires both status and headers in a PGRST exception detail.
-- Normalize the path because hosted API deployments can include a leading /.
create or replace function public.enforce_staff_mfa_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare request_path text := trim(both '/' from coalesce(current_setting('request.path', true), ''));
begin
  if auth.jwt()->>'role' = 'service_role'
    or private.staff_mfa_passed()
    or request_path in ('rpc/staff_mfa_status', 'rpc/claim_staff_invite') then
    return;
  end if;
  raise sqlstate 'PGRST' using
    message = '{"code":"MFA_REQUIRED","message":"Complete staff two-factor authentication"}',
    detail = '{"status":403,"headers":{}}';
end;
$$;
