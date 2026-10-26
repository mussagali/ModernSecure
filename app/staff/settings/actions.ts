"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "../../../lib/staff";
import { uuidPattern } from "../../../lib/client-case";

function field(formData: FormData, name: string) {
  const item = formData.get(name);
  return typeof item === "string" ? item.normalize("NFC").trim() : "";
}

export async function saveContactSettings(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const paymentDetails = field(formData, "paymentDetails");
  const expectedUpdatedAt = field(formData, "expectedUpdatedAt");
  const phone = field(formData, "phone");
  const email = field(formData, "email").toLowerCase();
  const whatsapp = field(formData, "whatsapp");
  const businessHours = field(formData, "businessHours");
  const responseExpectation = field(formData, "responseExpectation");
  if (paymentDetails.length > 4000 || phone.length > 40 || email.length > 254 || whatsapp.length > 300
    || businessHours.length > 300 || responseExpectation.length > 500
    || (phone && !/^\+?[0-9 ()-]{6,40}$/.test(phone))
    || (email && !/^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(email))) {
    redirect("/staff/settings?error=invalid");
  }
  const { error } = await supabase.rpc("admin_save_contact_settings", {
    p_phone: phone || null, p_email: email || null, p_whatsapp_url: whatsapp || null,
    p_expected_updated_at: expectedUpdatedAt || null, p_payment_details: paymentDetails || null,
    p_business_hours: businessHours || null, p_response_expectation: responseExpectation || null,
  });
  if (error?.message === "Settings changed") redirect("/staff/settings?error=conflict");
  if (error) redirect("/staff/settings?error=contact");
  redirect("/staff/settings?contactSaved=1");
}

export async function saveFaqEntry(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const id = field(formData, "id");
  const question = field(formData, "question");
  const answer = field(formData, "answer");
  const position = field(formData, "position");
  const published = formData.get("published") === "on";
  if ((id && !uuidPattern.test(id)) || !question || question.length > 180
    || !answer || answer.length > 4000 || !/^[1-9]\d{0,2}$|^1000$/.test(position)) {
    redirect("/staff/settings?error=invalid");
  }
  const { error } = await supabase.rpc("admin_upsert_faq", {
    p_id: id || null, p_question: question, p_answer: answer,
    p_position: Number(position), p_published: published, p_expected_updated_at: field(formData, "expectedUpdatedAt") || null,
  });
  if (error?.message === "Settings changed") redirect("/staff/settings?error=conflict");
  if (error) redirect("/staff/settings?error=faq");
  redirect("/staff/settings?faqSaved=1");
}

export async function saveStaleCaseDays(formData: FormData) {
  const { supabase } = await requireStaff(["admin"]);
  const days = field(formData, "days");
  if (!/^[1-9]\d{0,2}$/.test(days) || Number(days) > 365) {
    redirect("/staff/settings?error=invalid");
  }
  const { error } = await supabase.rpc("admin_set_stale_case_days", { p_days: Number(days) });
  if (error) redirect("/staff/settings?error=stale");
  redirect("/staff/settings?staleSaved=1");
}
