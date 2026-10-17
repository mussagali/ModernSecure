import Link from "next/link";
import { CaseTabs } from "../../../../components/CaseTabs";
import { requireStaffCase } from "../../../../lib/staff-case";

export default async function StaffCaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { item } = await requireStaffCase(id);
  const root = `/staff/cases/${id}`;
  return <>
    <div className="staff-case-heading"><Link href="/staff/cases" className="staff-back">Все дела</Link><div className="staff-page-heading"><div><h1>{item.title}</h1><p>Дело № {item.case_number}</p></div><span className="staff-role-pill">{item.is_suspended ? "Приостановлено" : item.status === "open" ? "В работе" : item.status === "closed" ? "Завершено" : "Отменено"}</span></div></div>
    <CaseTabs root={root} staff caseNumber={item.case_number} />{children}
  </>;
}
