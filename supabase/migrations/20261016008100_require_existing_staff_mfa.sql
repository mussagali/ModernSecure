-- Existing staff use the same enrollment gate as newly invited employees.
-- The /staff-security route and Supabase Auth enrollment remain available at AAL1.
with changed as (
  update public.staff_members set mfa_required = true where not mfa_required returning user_id
)
insert into public.audit_events(entity_type, entity_id, action, after_data)
select 'staff_member', user_id, 'mfa_required_enabled', jsonb_build_object('mfa_required', true) from changed;
