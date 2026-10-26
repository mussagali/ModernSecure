-- Создайте клиента через Authentication > Users или регистрацию приложения.
-- Email должен быть подтверждён. Этот файл НЕ создаёт пароль и НЕ выдаёт роль сотрудника.
-- Замените UUID оператора, email и ФИО. Повторный запуск не создаёт вторую карточку.
begin;
do $setup$
declare
  operator_id uuid := 'REPLACE_OPERATOR_UUID'::uuid;
  client_email text := 'REPLACE_CLIENT_EMAIL';
  client_name text := 'REPLACE_CLIENT_FULL_NAME';
  client_phone text := null;
  client_city text := null;
  client_user_id uuid;
  card_id uuid;
begin
  if client_email like 'REPLACE_%' or client_name like 'REPLACE_%' then
    raise exception 'Replace client email and full name';
  end if;
  if not exists(select 1 from public.staff_members where user_id=operator_id and is_primary_admin and active) then
    raise exception 'Provision the operator using 02_CREATE_OPERATOR.sql';
  end if;
  select id into strict client_user_id from auth.users
  where lower(email)=lower(trim(client_email)) and email_confirmed_at is not null;
  if exists(select 1 from public.staff_members where user_id=client_user_id) then
    raise exception 'A staff user cannot be linked as a client';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(client_user_id::text,0));
  select id into card_id from public.clients where user_id=client_user_id;
  if card_id is not null then
    raise notice 'Client already linked: %',card_id;
    return;
  end if;
  if exists(select 1 from public.clients where lower(email)=lower(trim(client_email))) then
    raise exception 'An unlinked card with this email already exists; review and link its ID explicitly';
  end if;
  -- Transaction-local actor, only for audited RPC calls made by SQL Editor.
  perform set_config('request.jwt.claim.sub',operator_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_id,'role','authenticated','aal','aal1')::text,true);
  card_id := public.staff_create_client(client_name,client_email,client_phone,client_city);
  perform public.link_client_account(card_id,client_email);
  raise notice 'Client card created and linked: %',card_id;
end;
$setup$;
commit;
select id,full_name,user_id from public.clients order by created_at desc;
