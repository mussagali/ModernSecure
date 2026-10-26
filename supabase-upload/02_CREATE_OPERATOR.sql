-- Сначала создайте отдельного пользователя управления в Authentication > Users.
-- Укажите ЕГО UUID вместо REPLACE_OPERATOR_UUID. Не используйте UUID клиента.
-- Пароль здесь не нужен. В клиентское приложение этот аккаунт не допускается.
-- Запуск: только доверенный владелец проекта через SQL Editor (postgres).
begin;
do $setup$
declare
  operator_id uuid := 'REPLACE_OPERATOR_UUID'::uuid;
  operator_name text := 'Администратор компании';
begin
  if not exists (select 1 from auth.users where id=operator_id and email_confirmed_at is not null) then
    raise exception 'Create and verify the operator Auth user first';
  end if;
  if exists (select 1 from public.clients where user_id=operator_id) then
    raise exception 'The operator cannot be a client';
  end if;
  if exists (select 1 from public.staff_members where is_primary_admin and user_id<>operator_id) then
    raise exception 'Another primary operator already exists';
  end if;
  if exists (select 1 from public.staff_members where user_id=operator_id) then
    if exists (select 1 from public.staff_members where user_id=operator_id and is_primary_admin and active) then
      raise notice 'Operator already provisioned';
      return;
    end if;
    raise exception 'User already has a staff role; inspect it instead of overwriting';
  end if;
  insert into public.staff_members(user_id,display_name,role,active,is_primary_admin)
  values(operator_id,operator_name,'admin',true,true);
  insert into public.audit_events(actor_user_id,entity_type,entity_id,action,after_data)
  values(operator_id,'staff_member',operator_id,'primary_operator_bootstrap',jsonb_build_object('source','sql_editor'));
end;
$setup$;
commit;
select user_id,display_name,role,is_primary_admin from public.staff_members where is_primary_admin;
