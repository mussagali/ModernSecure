import { notFound } from "next/navigation";
import { uuidPattern } from "./client-case";
import { requireStaff } from "./staff";

export async function requireStaffCase(id: string) {
  if (!uuidPattern.test(id)) notFound();
  const { supabase, userId, staff } = await requireStaff();
  const { data: item, error } = await supabase.from("cases")
    .select("id, case_number, title, client_id, status, is_suspended")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Не удалось загрузить дело");
  if (!item) notFound();
  return { supabase, userId, staff, item };
}
