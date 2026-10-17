import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "../../../components/SubmitButton";
import { requireStaff } from "../../../lib/staff";
import { addStaffMember, cancelStaffInvitation, changeStaffAccess, setPaymentPermission } from "../actions";

export const metadata: Metadata = { title: "Команда — Современная защита" };

const roleNames: Record<string, string> = { admin: "Администратор", manager: "Менеджер", lawyer: "Юрист" };
const roleCards = [
  { title: "Главный администратор", detail: "Полный доступ. Назначает администраторов и управляет их правами." },
  { title: "Администратор", detail: "Все дела, назначения, шаблоны и журнал. Управляет юристами и менеджерами." },
  { title: "Менеджер", detail: "Клиенты и открытие дел. Работа только по назначенным делам; юридические решения недоступны." },
  { title: "Юрист", detail: "Только назначенные дела: этапы, задачи, запросы документов и диалог с клиентом." },
  { title: "Клиент", detail: "Только собственные дела, ответы на задачи и сообщения по ним." },
];

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ invited?: string; cancelled?: string; changed?: string; unchanged?: string; financeChanged?: string; error?: string; page?: string; invitePage?: string | string[] }> }) {
  const { supabase, staff, userId } = await requireStaff(["admin"]);
  const query = await searchParams;
  const page = Math.max(1, Math.min(200, Number.parseInt(query.page ?? "1", 10) || 1));
  const pageSize = 25;
  const requestedInvitePage = typeof query.invitePage === "string" && /^\d+$/.test(query.invitePage)
    ? Number(query.invitePage) : 1;
  const { data: members, count, error } = await supabase.from("staff_members")
    .select("user_id, display_name, role, active, is_primary_admin, can_confirm_payments, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
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
    `/staff/team?${new URLSearchParams({ page: String(staffPage), invitePage: String(pendingPage) })}`;
  const links = await Promise.all((members ?? []).map(async (member) => {
    const result = await supabase.from("case_assignments")
      .select("case_id, cases(case_number, title)", { count: "exact" })
      .eq("staff_user_id", member.user_id).is("revoked_at", null)
      .order("assigned_at", { ascending: false }).limit(5);
    return { userId: member.user_id, ...result };
  }));
  const assignments = new Map(links.map((entry) => [entry.userId, entry]));
  const failed = Boolean(error || profilesError || (members ?? []).some((member) => !emailsByUserId.get(member.user_id)) || links.some((entry) => entry.error));
  const pages = Math.ceil((count ?? 0) / pageSize);
  return <><div className="staff-page-heading"><div><h1>Команда</h1><p>Администратор видит роли и назначенные дела. Юрист получает доступ только после назначения на конкретное дело.</p></div><span className="staff-role-pill">{count ?? 0} сотрудников</span></div>
    {query.invited === "granted" && <div className="staff-alert is-success">Роль выдана: аккаунт уже был подтверждён. Сотрудник появится в списке ниже.</div>}{query.invited === "pending" && <div className="staff-alert is-success">Приглашение сохранено. Передайте сотруднику ссылку на регистрацию; после подтверждения email роль активируется при входе.</div>}{query.cancelled && <div className="staff-alert is-success">Приглашение отменено.</div>}{query.changed && <div className="staff-alert is-success">Права сотрудника обновлены и записаны в журнал.</div>}{query.unchanged && <div className="staff-alert" role="status">Роль и доступ уже установлены так, как указано в форме. Изменений не было.</div>}{query.financeChanged && <div className="staff-alert is-success">Финансовое право изменено и записано в журнал.</div>}{query.error === "assigned" && <div className="staff-alert is-error">У этого аккаунта уже есть роль клиента или сотрудника. Права существующего сотрудника изменяются в списке ниже; клиентский аккаунт нельзя автоматически превратить в сотрудника.</div>}{query.error && query.error !== "assigned" && <div className="staff-alert is-error">Не удалось сохранить изменение. Проверьте адрес, роль и статус аккаунта; если ошибка повторится, обратитесь к администратору БД.</div>}
    <section className="staff-role-matrix" aria-label="Роли и доступ">{roleCards.map((role) => <article key={role.title}><h2>{role.title}</h2><p>{role.detail}</p></article>)}</section>
    <details className="form-disclosure"><summary>Пригласить сотрудника</summary><div className="staff-form-panel"><div><p>Можно указать адрес до регистрации. Приглашение действует 14 дней; сотрудник регистрируется по <Link href="/register">этой ссылке</Link> и подтверждает почту. Если аккаунт уже подтверждён, роль выдаётся сразу.</p></div><form action={addStaffMember} className="staff-form"><label>Email сотрудника<input name="email" type="email" required maxLength={254} autoComplete="off" /></label><label>Имя для команды<input name="displayName" required maxLength={160} /></label><label>Роль<select name="role" defaultValue="lawyer"><option value="lawyer">Юрист</option><option value="manager">Менеджер</option>{staff.is_primary_admin && <option value="admin">Администратор</option>}</select></label><SubmitButton>Сохранить приглашение</SubmitButton></form></div></details>
    {/* eslint-disable-next-line react-hooks/purity -- Expiry labels are calculated only in this per-request Server Component. */}
    <section className="staff-list-section"><div className="staff-section-heading"><h2>Ожидают регистрации или подтверждения</h2><span>{inviteError ? "—" : `${inviteCount ?? 0} всего`}</span></div>{inviteError ? <div className="staff-alert is-error">Не удалось загрузить приглашения.</div> : pendingInvites?.length ? <div className="staff-work-list">{pendingInvites.map((invite) => { const expired = new Date(invite.expires_at).getTime() <= Date.now(); return <article className="staff-work-card" key={invite.id}><div className="staff-work-head"><h3>{invite.display_name}</h3><span className="staff-tag">{expired ? "Срок истёк" : "Ожидает"}</span></div><p>{invite.email} · {roleNames[invite.role] ?? invite.role}</p><small>{expired ? "Повторите приглашение через форму выше" : `Действует до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Almaty" }).format(new Date(invite.expires_at))}`}</small>{(invite.role !== "admin" || staff.is_primary_admin) && <form action={cancelStaffInvitation} className="case-quiet-form"><input type="hidden" name="inviteId" value={invite.id} /><button type="submit">Отменить приглашение</button></form>}</article>; })}</div> : <div className="staff-empty-box"><h3>{inviteCount ? "На этой странице нет ожидающих приглашений" : "Ожидающих приглашений нет"}</h3></div>}
      {!inviteError && invitePages > 1 && <nav className="staff-pagination" aria-label="Страницы приглашений">{invitePage > 1 && <Link href={teamHref(page, invitePage - 1)}>Назад</Link>}<span>Страница {invitePage} из {invitePages}</span>{invitePage < invitePages && <Link href={teamHref(page, invitePage + 1)}>Далее</Link>}</nav>}
    </section>
    <section className="staff-list-section">
      <div className="staff-section-heading"><h2>Сотрудники и дела</h2><span>{count ?? 0} всего</span></div>
      {failed ? <div className="staff-alert is-error">Не удалось загрузить команду, email или назначения.</div>
        : members?.length ? <div className="staff-work-list">{members.map((member) => {
          const related = assignments.get(member.user_id);
          return <article className="staff-work-card" key={member.user_id}>
            <div className="staff-work-head"><div><h3>{member.display_name}</h3><small style={{ overflowWrap: "anywhere" }}>{emailsByUserId.get(member.user_id)}</small></div><span className={member.active ? "staff-tag is-linked" : "staff-tag"}>{member.active ? (member.is_primary_admin ? "Главный администратор" : roleNames[member.role]) : "Доступ отключён"}</span></div>
            <p>Активных назначений: {related?.count ?? 0}</p>
            {related?.data?.length ? <ul className="staff-team-cases">{related.data.map((assignment) => {
              const caseRecord = Array.isArray(assignment.cases) ? assignment.cases[0] : assignment.cases;
              return <li key={assignment.case_id}><Link href={`/staff/cases/${assignment.case_id}`}>№ {caseRecord?.case_number ?? "Дело"} · {caseRecord?.title ?? "Открыть"}</Link></li>;
            })}</ul> : <small>Назначенных дел нет.</small>}
            <Link className="staff-text-link" href={`/staff/audit?actor=${member.user_id}`}>Действия в журнале</Link>
            {!member.is_primary_admin && member.user_id !== userId && (member.role !== "admin" || staff.is_primary_admin) && <form action={changeStaffAccess} className="staff-form staff-access-form">
              <input type="hidden" name="staffUserId" value={member.user_id} />
              <div className="staff-form-grid"><label>Роль<select name="role" defaultValue={member.role}><option value="lawyer">Юрист</option><option value="manager">Менеджер</option>{staff.is_primary_admin && <option value="admin">Администратор</option>}</select></label><label>Доступ<select name="active" defaultValue={String(member.active)}><option value="true">Активен</option><option value="false">Отключён</option></select></label></div>
              <label>Причина изменения<input name="reason" required maxLength={500} placeholder="Обязательно для аудита" /></label>
              <SubmitButton>Сохранить права</SubmitButton><small>При изменении роли или отключении доступа все действующие назначения на дела отзываются. Для продолжения работы потребуется назначить сотрудника на дела заново.</small>
            </form>}
            {member.active && (member.role !== "admin" || staff.is_primary_admin) && <form action={setPaymentPermission} className="staff-form staff-access-form">
              <input type="hidden" name="staffUserId" value={member.user_id} />
              <input type="hidden" name="allowed" value={String(!member.can_confirm_payments)} />
              <p>Управление оплатами и графиком: {member.can_confirm_payments ? "разрешено" : "не разрешено"}</p>
              <label>Причина изменения<input name="reason" required maxLength={500} placeholder="Обязательно для аудита" /></label>
              <SubmitButton>{member.can_confirm_payments ? "Отозвать финансовое право →" : "Разрешить управление оплатами →"}</SubmitButton>
              <small>Право не следует из роли автоматически. Для менеджера или юриста оно действует только по назначенным делам.</small>
            </form>}
          </article>;
        })}</div> : <div className="staff-empty-box"><h3>Сотрудников нет</h3></div>}
      {pages > 1 && <nav className="staff-pagination" aria-label="Страницы сотрудников">{page > 1 && <Link href={teamHref(page - 1, invitePage)}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={teamHref(page + 1, invitePage)}>Далее</Link>}</nav>}
    </section>
  </>;
}
