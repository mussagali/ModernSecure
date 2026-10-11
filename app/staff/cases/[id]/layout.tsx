import { CaseTabs } from "../../../../components/CaseTabs";
import { requireStaffCase } from "../../../../lib/staff-case";

export default async function StaffCaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { item } = await requireStaffCase(id);
  const root = `/staff/cases/${id}`;
  return <><CaseTabs root={root} staff caseNumber={item.case_number} />{children}</>;
}
