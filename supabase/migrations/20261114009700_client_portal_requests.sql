-- Cabinet forms: own submissions, administrator inbox, and a private BKI upload request.
create table public.portal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('director','partner_signup','recommendation','partner_chat','payment_invoice')),
  subject text not null check (length(subject) between 1 and 180),
  body text not null check (length(body) between 1 and 5000),
  contact_name text check (length(contact_name) <= 160),
  contact_phone text check (length(contact_phone) <= 40),
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create index portal_requests_user_created on public.portal_requests(user_id, created_at desc);
alter table public.portal_requests enable row level security;
grant select on public.portal_requests to authenticated;
create policy portal_requests_read on public.portal_requests for select to authenticated using (
  user_id = auth.uid() or private.staff_role_for_current_user() = 'admin'
  or (kind <> 'director' and private.staff_role_for_current_user() = 'manager')
);
create policy staff_mfa_guard on public.portal_requests as restrictive for all to authenticated
  using ((select private.staff_mfa_passed())) with check ((select private.staff_mfa_passed()));

create function public.submit_portal_request(p_kind text, p_subject text, p_body text, p_contact_name text default null, p_contact_phone text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if auth.uid() is null or public.account_access_status() <> 'approved' or not public.client_consent_status() or not private.staff_mfa_passed() then raise exception 'Not authorized'; end if;
  if p_kind is null or p_kind not in ('director','partner_signup','recommendation','partner_chat','payment_invoice')
    or nullif(trim(p_subject),'') is null or length(p_subject) > 180
    or nullif(trim(p_body),'') is null or length(p_body) > 5000
    or length(p_contact_name) > 160 or length(p_contact_phone) > 40
    or (p_kind = 'recommendation' and (nullif(trim(p_contact_name),'') is null or p_contact_phone is null or p_contact_phone !~ '^\+?[0-9 ()-]{7,40}$')) then raise exception 'Invalid request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 791602));
  if (select count(*) from public.portal_requests where user_id=auth.uid() and created_at > now()-interval '1 minute') >= 5 then raise exception 'Too many requests'; end if;
  if p_kind = 'partner_signup' then
    select id into request_id from public.portal_requests where user_id=auth.uid() and kind=p_kind and status <> 'closed' order by created_at desc limit 1;
    if request_id is not null then return request_id; end if;
  end if;
  insert into public.portal_requests(user_id,kind,subject,body,contact_name,contact_phone)
    values(auth.uid(),p_kind,trim(p_subject),trim(p_body),nullif(trim(p_contact_name),''),nullif(trim(p_contact_phone),'')) returning id into request_id;
  insert into public.audit_events(actor_user_id,entity_type,entity_id,action) values(auth.uid(),'portal_request',request_id,'submitted');
  return request_id;
end; $$;
revoke all on function public.submit_portal_request(text,text,text,text,text) from public, anon;
grant execute on function public.submit_portal_request(text,text,text,text,text) to authenticated;

create function public.client_prepare_bki_upload(p_case_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if auth.uid() is null or public.account_access_status() <> 'approved' or not public.client_consent_status() or not private.staff_mfa_passed() then raise exception 'Not authorized'; end if;
  perform 1 from public.cases c join public.clients cl on cl.id=c.client_id where c.id=p_case_id and cl.user_id=auth.uid() and c.status='open' and not c.is_suspended for update of c;
  if not found then raise exception 'No active client case'; end if;
  select id into request_id from public.document_requests where case_id=p_case_id and title='Выписка БКИ' and status='active' order by created_at desc limit 1;
  if request_id is not null then return request_id; end if;
  insert into public.document_requests(case_id,title,instructions,required)
    values(p_case_id,'Выписка БКИ','Выписка из бюро кредитных историй для анализа юристом.',false) returning id into request_id;
  insert into public.audit_events(actor_user_id,case_id,entity_type,entity_id,action) values(auth.uid(),p_case_id,'document_request',request_id,'client_requested');
  return request_id;
end; $$;
revoke all on function public.client_prepare_bki_upload(uuid) from public, anon;
grant execute on function public.client_prepare_bki_upload(uuid) to authenticated;
