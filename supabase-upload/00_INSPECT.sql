-- Только чтение. Можно выполнить в другом проекте до установки.
select current_database() as database_name, current_user as database_role;
select schemaname, tablename, rowsecurity from pg_tables
where schemaname in ('public','private') order by schemaname,tablename;
select n.nspname as schema_name,p.proname as function_name
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private')
and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
order by 1,2;
select id,name,public,file_size_limit from storage.buckets order by id;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') order by 1,2,3;
select count(*) as existing_auth_users from auth.users;
select rolname,rolconfig from pg_roles where rolname='authenticator';
