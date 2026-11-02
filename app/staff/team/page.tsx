import { loadListPage } from "../../../lib/list-page";
import { ListSearch, ListPagination } from "../../../components/ListControls";
import { NavIcon } from "../../../components/NavIcon";
import { queryPage, queryText, searchPattern, listHref, type ListParams } from "../../../lib/list-query";
import type { Metadata } from "next";
import Link from "next/link";
import { PendingAccounts } from "../../../components/PendingAccounts";
import { AccountAccessRefresh } from "../../../components/AccountAccessRefresh";
import { SubmitButton } from "../../../components/SubmitButton";
import { requireStaff } from "../../../lib/staff";
import { addStaffMember, cancelStaffInvitation, changeStaffAccess, setPaymentPermission } from "../actions";

export const metadata: Metadata = { title: "Команда | Современная защита" };

const approvalErrors: Record<string, string> = {
  "approval-invalid": "Проверьте имя пользователя и выбранную роль, затем повторите активацию.",
  "approval-assigned": "Аккаунт уже активирован другим администратором. Обновите заявки; права сотрудника можно проверить в списке команды.",
  "approval-unverified": "Почта пользователя ещё не подтверждена либо аккаунт больше недоступен. Обновите заявки после подтверждения email.",
  "approval-forbidden": "У вас нет права назначить эту роль. Приглашение администратора обрабатывает главный администратор.",
};

const roleNames: Record<string, string> = { admin: "Администратор", manager: "Менеджер", lawyer: "Юрист" };
const roleCards = [
  { title: "Главный администратор", detail: "Полный доступ. Активирует аккаунты и назначает все роли." },
  { title: "Администратор", detail: "Все дела, назначения, шаблоны и журнал. Активирует клиентов, юристов и менеджеров и управляет их доступом. Администраторов назначает и изменяет только главный администратор." },
  { title: "Менеджер", detail: "Клиенты и открытие дел. Работа только по назначенным делам; юридические решения недоступны." },
  { title: "Юрист", detail: "Только назначенные дела: этапы, задачи, запросы документов и диалог с клиентом." },
  { title: "Клиент", detail: "Только собственные дела, ответы на задачи и сообщения по ним." },
];

export default async function TeamPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { supabase, staff, userId } = await requireStaff(["admin"]);
  const query = await searchParams;
  let page = queryPage(query.page);
  const q = queryText(query.q);
  const role = ["admin", "lawyer", "manager"].includes(queryText(query.role)) ? queryText(query.role) : "all";
  const state = ["active", "disabled"].includes(queryText(query.state)) ? queryText(query.state) : "all";
  const tab = query.tab === "invites" || query.new || query.invited || query.cancelled ? "invites" : query.tab === "pending" || query.accountPage || query.approved ? "pending" : "members";
  const { data: summary, error: summaryError } = await supabase.rpc("admin_pending_account_summary");
  const pendingCount = Number(summary?.total_count ?? 0);
  const pageSize = 25;
  const requestedInvitePage = typeof query.invitePage === "string" && /^\d+$/.test(query.invitePage)
    ? Number(query.invitePage) : 1;
  let request = supabase.from("staff_members").select("user_id, display_name, role, active, is_primary_admin, can_confirm_payments, created_at", { count: "exact" });
  if (q) request = request.ilike("display_name", searchPattern(q));
  if (role !== "all") request = request.eq("role", role);
  if (state !== "all") request = request.eq("active", state === "active");
  request = request.order("display_name").order("user_id");
  const memberResult = tab === "members" ? await loadListPage(target => request.range((target - 1) * pageSize, target * pageSize - 1), page) : { data: [], count: 0, error: null, page: 1 };
  const { data: members, count, error } = memberResult;
  page = memberResult.page;
  const { data: profiles, error: profilesError } = members?.length
    ? await supabase.rpc("admin_staff_emails", { p_user_ids: members.map((member) => member.user_id) })
    : { data: [], error: null };
  const emailsByUserId = new Map<string, string>(((profiles ?? []) as Array<{ user_id: string; email: string }>)
    .map((profile) => [profile.user_id, profile.email]));
  const { count: inviteCount, error: inviteCountError } = await supabase.from("staff_invites")
    .select("id", { count: "exact", head: true }).eq("status", "pending");
  const invitePages = Math.ceil((inviteCount ?? 0) / pageSize);
  const invitePage = Number.isSafeInteger(requestedInvitePage) && requestedInvitePage > 0
    ? Math.min(requestedInvitePage, Math.max(invitePages, 1)) : 1;
  const { data: pendingInvites, error: inviteListError } = await supabase.from("staff_invites")
    .select("id, email, display_name, role, expires_at, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((invitePage - 1) * pageSize, invitePage * pageSize - 1);
  const inviteError = inviteCountError || inviteListError;
  const teamHref = (staffPage: number, pendingPage: number) =>
    `/staff/team?${new URLSearchParams({ page: String(staffPage), tab: "invites", invitePage: String(pendingPage) })}`;
  const failed = Boolean(error || profilesError);

  return <><div className="staff-page-heading"><div><h1>Команда и доступ</h1><p>Сотрудники, приглашения и активация новых аккаунтов.</p></div><Link className="primary-action compact-action" href="/staff/team?tab=invites&new=1" aria-label="Пригласить сотрудника"><NavIcon name="plus" size={18} /><span>Пригласить</span></Link></div>
    {query.invited === "granted" && <div className="staff-alert is-success">Роль выдана: аккаунт уже был подтверждён. Сотрудник появится в списке ниже.</div>}{query.invited === "pending" && <div className="staff-alert is-success">Приглашение сохранено. Передайте сотруднику ссылку на регистрацию; после подтверждения email активируйте аккаунт в разделе «Заявки на доступ».</div>}{query.cancelled && <div className="staff-alert is-success">Приглашение отменено.</div>}{query.changed && <div className="staff-alert is-success">Права сотрудника обновлены и записаны в журнал.</div>}{query.unchanged && <div className="staff-alert" role="status">Роль и доступ уже установлены так, как указано в форме. Изменений не было.</div>}{query.financeChanged && <div className="staff-alert is-success">Финансовое право изменено и записано в журнал.</div>}{query.error === "assigned" && <div className="staff-alert is-error">У этого аккаунта уже есть роль клиента или сотрудника. Права существующего сотрудника изменяются в списке ниже; клиентский аккаунт нельзя автоматически превратить в сотрудника.</div>}{query.error && query.error !== "assigned" && <div className="staff-alert is-error">{approvalErrors[queryText(query.error)] ?? "Не удалось сохранить изменение. Проверьте адрес, роль и статус аккаунта; если ошибка повторится, обратитесь к администратору БД."}</div>}
    {query.approved && <p className="staff-alert is-success" role="status">Аккаунт активирован. Пользователь может войти в свой кабинет.</p>}
    <nav className="workspace-tabs" aria-label="Управление командой">{[["members", "Сотрудники"], ["pending", `Заявки на доступ${!summaryError ? ` (${pendingCount})` : ""}`], ["invites", "Приглашения"]].map(([value, label]) => <Link key={value} href={listHref("/staff/team", { tab: value })} aria-current={tab === value ? "page" : undefined}>{label}</Link>)}</nav>
    {tab !== "pending" && <><AccountAccessRefresh protectForms /><p className="staff-alert" role="status">{summaryError ? "Не удалось проверить новые регистрации. " : pendingCount ? `Заявок на доступ: ${pendingCount}. ` : "Новые регистрации появятся в заявках на доступ. "}<Link href="/staff/team?tab=pending">Открыть заявки</Link>. {staff.is_primary_admin ? "Вы можете назначать все роли." : "Вы активируете клиентов, юристов и менеджеров. Администраторов назначает главный администратор."}</p></>}
    {tab === "pending" && <PendingAccounts supabase={supabase} page={queryPage(query.accountPage)} isPrimaryAdmin={staff.is_primary_admin} />}

    {tab === "invites" && <>
    <details className="form-disclosure" open={Boolean(query.new)}><summary>Пригласить сотрудника</summary><div className="staff-form-panel"><div><p>Можно указать адрес до регистрации. Приглашение действует 14 дней; сотрудник регистрируется по <Link href="/register">этой ссылке</Link> и подтверждает почту. Для выдачи роли активируйте аккаунт в разделе «Заявки на доступ».</p></div><form action={addStaffMember} className="staff-form"><label>Email сотрудника<input name="email" type="email" required maxLength={254} autoComplete="off" /></label><label>Имя для команды<input name="displayName" required maxLength={160} /></label><label>Роль<select name="role" defaultValue="lawyer"><option value="lawyer">Юрист</option><option value="manager">Менеджер</option>{staff.is_primary_admin && <option value="admin">Администратор</option>}</select></label><SubmitButton>Сохранить приглашение</SubmitButton></form></div></details>
    {/* eslint-disable-next-line react-hooks/purity -- Expiry labels are calculated only in this per-request Server Component. */}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Ожидают регистрации или подтверждения</h2><span>{inviteError ? "|" : `${inviteCount ?? 0} всего`}</span></div>{inviteError ? <div className="staff-alert is-error">Не удалось загрузить приглашения.</div> : pendingInvites?.length ? <div className="staff-work-list">{pendingInvites.map((invite) => { const expired = new Date(invite.expires_at).getTime() <= Date.now(); return <article className="staff-work-card" key={invite.id}><div className="staff-work-head"><h3>{invite.display_name}</h3><span className="staff-tag">{expired ? "Срок истёк" : "Ожидает"}</span></div><p>{invite.email} · {roleNames[invite.role] ?? invite.role}</p><small>{expired ? "Повторите приглашение через форму выше" : `Действует до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Almaty" }).format(new Date(invite.expires_at))}`}</small>{(invite.role !== "admin" || staff.is_primary_admin) && <form action={cancelStaffInvitation} className="case-quiet-form"><input type="hidden" name="inviteId" value={invite.id} /><button type="submit">Отменить приглашение</button></form>}</article>; })}</div> : <div className="staff-empty-box"><h3>{inviteCount ? "На этой странице нет ожидающих приглашений" : "Ожидающих приглашений нет"}</h3></div>}
      {!inviteError && invitePages > 1 && <nav className="staff-pagination" aria-label="Страницы приглашений">{invitePage > 1 && <Link href={teamHref(page, invitePage - 1)}>Назад</Link>}<span>Страница {invitePage} из {invitePages}</span>{invitePage < invitePages && <Link href={teamHref(page, invitePage + 1)}>Далее</Link>}</nav>}
    </section>
    </>}
    {tab === "members" && <>
    <ListSearch action="/staff/team" query={q} label="Поиск сотрудников" placeholder="Найти сотрудника по имени" resetHref={q || role !== "all" || state !== "all" ? "/staff/team" : undefined}>
      <label className="list-select"><span className="sr-only">Роль сотрудника</span><select name="role" defaultValue={role}><option value="all">Все роли</option><option value="admin">Администраторы</option><option value="lawyer">Юристы</option><option value="manager">Менеджеры</option></select></label>
      <label className="list-select"><span className="sr-only">Доступ сотрудника</span><select name="state" defaultValue={state}><option value="all">Любой доступ</option><option value="active">Активные</option><option value="disabled">Отключённые</option></select></label>
    </ListSearch>
    <section className="staff-list-section">
      <div className="staff-section-heading"><h2>Сотрудники</h2><span>{count ?? 0} всего</span></div>
      {failed ? <div className="staff-alert is-error">Не удалось загрузить команду, email или назначения.</div>
        : members?.length ? <div className="team-directory"><div className="team-directory-head" aria-hidden="true"><span>Сотрудник</span><span>Роль</span><span>Доступ</span><span /></div>{members.map((member) => {
          const canChangeAccess = !member.is_primary_admin && member.user_id !== userId && (staff.is_primary_admin || member.role !== "admin");
          const canChangePayments = member.active && (member.role !== "admin" || staff.is_primary_admin);
          return <details className="team-directory-item" key={member.user_id}>
            <summary><span className="directory-person"><span className="directory-avatar" aria-hidden="true">{member.display_name.trim().slice(0, 1)}</span><span><strong>{member.display_name}</strong><small>{emailsByUserId.get(member.user_id)}</small></span></span><span className="directory-role">{member.is_primary_admin ? "Главный администратор" : roleNames[member.role]}</span><span className="directory-status" data-active={member.active}>{member.active ? "Активен" : "Отключён"}</span><NavIcon name="chevron" size={18} /></summary>
            <div className="team-directory-detail"><div className="directory-actions"><Link href={`/staff/cases?staff=${member.user_id}`}>Назначенные дела</Link><Link href={`/staff/audit?actor=${member.user_id}`}>История действий</Link></div>
            {(canChangeAccess || canChangePayments) && <details className="staff-member-controls"><summary>Управление доступом и оплатами</summary>
            {canChangeAccess && <form action={changeStaffAccess} className="staff-form staff-access-form">
              <input type="hidden" name="staffUserId" value={member.user_id} />
              <div className="staff-form-grid"><label>Роль<select name="role" defaultValue={member.role}><option value="lawyer">Юрист</option><option value="manager">Менеджер</option>{staff.is_primary_admin && <option value="admin">Администратор</option>}</select></label><label>Доступ<select name="active" defaultValue={String(member.active)}><option value="true">Активен</option><option value="false">Отключён</option></select></label></div>
              <label>Причина изменения<input name="reason" required maxLength={500} placeholder="Обязательно для аудита" /></label>
              <SubmitButton>Сохранить права</SubmitButton><small>При изменении роли или отключении доступа все действующие назначения на дела отзываются. Для продолжения работы потребуется назначить сотрудника на дела заново.</small>
            </form>}
            {canChangePayments && <form action={setPaymentPermission} className="staff-form staff-access-form">
              <input type="hidden" name="staffUserId" value={member.user_id} />
              <input type="hidden" name="allowed" value={String(!member.can_confirm_payments)} />
              <p>Управление оплатами и графиком: {member.can_confirm_payments ? "разрешено" : "не разрешено"}</p>
              <label>Причина изменения<input name="reason" required maxLength={500} placeholder="Обязательно для аудита" /></label>
              <SubmitButton>{member.can_confirm_payments ? "Отозвать финансовое право" : "Разрешить управление оплатами"}</SubmitButton>
              <small>Право не следует из роли автоматически. Для менеджера или юриста оно действует только по назначенным делам.</small>
            </form>}
            </details>}
          </div></details>;
        })}</div> : <div className="staff-empty-box"><h3>Сотрудники не найдены</h3><p>Измените имя или фильтры.</p><Link href="/staff/team">Показать всех сотрудников</Link></div>}
      {!failed && <ListPagination path="/staff/team" page={page} count={count ?? 0} params={{ q, role, state }} />}
    </section>
    </>}
    <details className="form-disclosure staff-role-guide"><summary>Что доступно каждой роли</summary><section className="staff-role-matrix" aria-label="Роли и доступ">{roleCards.map((role) => <article key={role.title}><h2>{role.title}</h2><p>{role.detail}</p></article>)}</section></details>
  </>;
}
