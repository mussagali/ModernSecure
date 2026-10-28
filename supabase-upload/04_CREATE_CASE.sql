-- Необязательный шаг: создать ПЕРВОЕ реальное дело и стартовый шаблон услуги.
-- Замените параметры. Этапы ниже взяты из ТЗ как пример; утвердите их до запуска.
-- Для повторного использования укажите selected_service_id; иначе будет новая услуга.
begin;
do $setup$
declare
  operator_id uuid := 'REPLACE_OPERATOR_UUID'::uuid;
  client_card_id uuid := 'REPLACE_CLIENT_CARD_UUID'::uuid;
  case_title text := 'REPLACE_CASE_TITLE';
  selected_service_id uuid := null; -- UUID существующей услуги или null для новой
  service_name text := 'REPLACE_SERVICE_NAME';
  stages text[] := array['Дело открыто','Сбор документов','Проверка документов',
    'Подготовка заявления','Заявление подано','Рассмотрение','Дело завершено'];
  version_id uuid;
  new_case_id uuid;
begin
  if case_title like 'REPLACE_%' or (selected_service_id is null and service_name like 'REPLACE_%') then
    raise exception 'Replace case title and service name';
  end if;
  if not exists(select 1 from public.staff_members where user_id=operator_id and is_primary_admin and active) then
    raise exception 'Unknown operator';
  end if;
  if not exists(select 1 from public.clients where id=client_card_id and user_id is not null) then
    raise exception 'Link the client card first';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(client_card_id::text || case_title,0));
  if exists(select 1 from public.cases where client_id=client_card_id and title=case_title) then
    raise exception 'A case with this client and title already exists; inspect before creating another';
  end if;
  perform set_config('request.jwt.claim.sub',operator_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_id,'role','authenticated','aal','aal1')::text,true);
  if selected_service_id is null then selected_service_id := public.admin_create_service(service_name,stages); end if;
  select id into version_id from public.service_template_versions v
  where v.service_id=selected_service_id and published_at is not null order by version_no desc limit 1;
  if version_id is null then raise exception 'No published service version'; end if;
  new_case_id := public.staff_create_case(client_card_id,version_id,case_title);
  raise notice 'Case created: %',new_case_id;
end;
$setup$;
commit;
select id,case_number,title,client_id from public.cases order by created_at desc;
