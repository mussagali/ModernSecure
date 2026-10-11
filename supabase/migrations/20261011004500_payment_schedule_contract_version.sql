-- A legacy installment without any registered contract is an invalid financial
-- chain. Abort the migration so these rows can be reviewed before deployment.
do $$
begin
  if exists (
    select 1 from public.payment_schedule ps
    where not exists (select 1 from public.contracts c where c.case_id = ps.case_id)
  ) then
    raise exception 'Legacy payment schedule contains a case without a contract';
  end if;
end;
$$;

-- Keep the remaining historical schedules unassigned: their original contract
-- version cannot be inferred safely, even when a case has only one today.
alter table public.payment_schedule add column contract_id uuid;

-- The pair makes it impossible to attach an installment to another case's
-- contract, while nullable legacy rows continue to be editable.
alter table public.contracts add constraint contracts_id_case_id_key unique (id, case_id);
alter table public.payment_schedule add constraint payment_schedule_contract_case_fk
  foreign key (contract_id, case_id) references public.contracts (id, case_id)
  on update restrict on delete restrict;

create function private.require_installment_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contract_id is null then
    raise exception 'Contract version is required for a new installment';
  end if;
  return new;
end;
$$;
revoke all on function private.require_installment_contract() from public, anon, authenticated;
create trigger modernsecure_installment_contract_required
  before insert on public.payment_schedule
  for each row execute function private.require_installment_contract();

create function private.keep_installment_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contract_id is distinct from old.contract_id or new.case_id is distinct from old.case_id then
    raise exception 'Installment contract version and case are immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.keep_installment_contract() from public, anon, authenticated;
create trigger modernsecure_installment_contract_immutable
  before update of contract_id, case_id on public.payment_schedule
  for each row execute function private.keep_installment_contract();

-- Preserve the RPC signature used by the existing server action.
create or replace function public.staff_add_payment_installment(p_case_id uuid, p_due_on date,
  p_amount_kzt numeric, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.cases%rowtype;
  contract_version public.contracts%rowtype;
  installment_id uuid;
begin
  if actor_id is null or not private.can_manage_payments(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case is not active'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 then raise exception 'Invalid installment'; end if;

  select * into contract_version from public.contracts
    where case_id = p_case_id order by version_no desc limit 1;
  if not found then raise exception 'Contract version is required for a new installment'; end if;

  insert into public.payment_schedule (case_id, contract_id, due_on, amount_kzt, description)
  values (p_case_id, contract_version.id, p_due_on, p_amount_kzt, nullif(trim(p_description), ''))
  returning id into installment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_schedule', installment_id, 'installment_created',
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt,
      'contract_id', contract_version.id, 'contract_version_no', contract_version.version_no));
  return installment_id;
end;
$$;
