-- The owner requested password-only access. MFA remains available by opt-in.
-- Keep enrolled factors and the existing role/RLS checks intact.
alter table public.staff_members alter column mfa_required set default false;

with changed as (
  update public.staff_members set mfa_required = false where mfa_required returning user_id
)
insert into public.audit_events(entity_type, entity_id, action, after_data)
select 'staff_member', user_id, 'mfa_required_disabled',
  jsonb_build_object('mfa_required', false, 'reason', 'Owner requested optional MFA')
from changed;
