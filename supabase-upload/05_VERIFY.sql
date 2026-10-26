-- Только чтение и проверки. Выполните после установки и создания клиента.
do $verify$
declare item text;
begin
  foreach item in array array['profiles','clients','cases','staff_members','case_assignments',
    'service_templates','service_template_versions','stage_templates','document_requests',
    'document_files','tasks','messages','notifications','contracts','payment_schedule',
    'payments','consent_records','audit_events'] loop
    if to_regclass('public.'||item) is null then raise exception 'Missing table: %',item; end if;
  end loop;
  if exists(select 1 from pg_tables where schemaname='public' and not rowsecurity) then
    raise exception 'Public table without RLS found';
  end if;
  if (select count(*) from storage.buckets where id in ('modernsecure-files','modernsecure-previews')
    and not public and file_size_limit=20971520) <> 2 then
    raise exception 'Private Storage buckets are missing or misconfigured';
  end if;
  foreach item in array array['staff_mfa_status','client_consent_status','accept_client_consents',
    'client_respond_task','client_acknowledge_task','resume_or_begin_document_upload',
    'complete_document_upload','retract_document_file','open_own_notification',
    'staff_create_client','link_client_account','staff_create_case'] loop
    if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=item) then
      raise exception 'Missing RPC: %',item;
    end if;
  end loop;
end;
$verify$;
select 'OK: tables, RLS, RPC and private buckets' as result;
select count(*) as rls_tables from pg_tables where schemaname='public' and rowsecurity;
select count(*) as policies from pg_policies where schemaname='public';
select id,public,file_size_limit from storage.buckets where id in ('modernsecure-files','modernsecure-previews');
select count(*) as primary_operators from public.staff_members where is_primary_admin and active;
select count(*) as linked_clients from public.clients where user_id is not null;
select count(*) as cases from public.cases;
select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime';
select extname from pg_extension where extname in ('pgcrypto','pg_cron');
-- Если pg_cron установлен, отдельно проверьте задания:
-- select jobname,schedule,active from cron.job where jobname like 'modernsecure-%';
-- Должны существовать modernsecure-task-deadlines и modernsecure-payment-deadlines.
