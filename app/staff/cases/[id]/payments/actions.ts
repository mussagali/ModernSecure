"use server";

import { redirect } from "next/navigation";
import { uuidPattern } from "../../../../../lib/client-case";
import { requireStaffCase } from "../../../../../lib/staff-case";

function field(formData: FormData, name: string) {
  const item = formData.get(name);
  return typeof item === "string" ? item.trim() : "";
}

const moneyPattern = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function addInstallment(formData: FormData) {
  const caseId = field(formData, "caseId");
  if (!uuidPattern.test(caseId)) redirect("/staff/cases");
  const { supabase } = await requireStaffCase(caseId);
  const dueOn = field(formData, "dueOn");
  const amount = field(formData, "amount");
  const description = field(formData, "description");
  if (!datePattern.test(dueOn) || !moneyPattern.test(amount) || Number(amount) <= 0 || description.length > 500) {
    redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  }
  const { error } = await supabase.rpc("staff_add_payment_installment", {
    p_case_id: caseId, p_due_on: dueOn, p_amount_kzt: amount, p_description: description || null,
  });
  if (error) redirect(`/staff/cases/${caseId}/payments?error=schedule`);
  redirect(`/staff/cases/${caseId}/payments?created=1`);
}

export async function enableOwnPaymentPermission(formData: FormData) {
  const caseId = field(formData, "caseId");
  if (!uuidPattern.test(caseId)) redirect("/staff/cases");
  const { supabase, userId, staff } = await requireStaffCase(caseId);
  if (staff.role !== "admin") redirect(`/staff/cases/${caseId}/payments?error=finance`);
  const reason = field(formData, "reason");
  if (!reason || reason.length > 500) redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  const { data: member, error: lookupError } = await supabase.from("staff_members")
    .select("can_confirm_payments").eq("user_id", userId).maybeSingle();
  if (lookupError || !member) redirect(`/staff/cases/${caseId}/payments?error=finance`);
  if (!member.can_confirm_payments) {
    const { error } = await supabase.rpc("admin_set_payment_permission", {
      p_staff_user_id: userId, p_allowed: true, p_reason: reason,
    });
    if (error) redirect(`/staff/cases/${caseId}/payments?error=finance`);
  }
  redirect(`/staff/cases/${caseId}/payments?financeEnabled=1`);
}

export async function updateInstallment(formData: FormData) {
  const caseId = field(formData, "caseId");
  const scheduleId = field(formData, "scheduleId");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(scheduleId)) redirect("/staff/cases");
  const { supabase } = await requireStaffCase(caseId);
  const expected = field(formData, "expectedUpdatedAt");
  const dueOn = field(formData, "dueOn");
  const amount = field(formData, "amount");
  const description = field(formData, "description");
  const reason = field(formData, "reason");
  if (Number.isNaN(Date.parse(expected)) || !datePattern.test(dueOn)
    || !moneyPattern.test(amount) || Number(amount) <= 0 || description.length > 500
    || !reason || reason.length > 500) redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  const { data: schedule } = await supabase.from("payment_schedule").select("case_id").eq("id", scheduleId).maybeSingle();
  if (schedule?.case_id !== caseId) redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  const { error } = await supabase.rpc("staff_update_payment_installment", {
    p_schedule_id: scheduleId, p_expected_updated_at: expected, p_due_on: dueOn,
    p_amount_kzt: amount, p_description: description || null, p_reason: reason,
  });
  if (error?.message === "Installment changed by another user") redirect(`/staff/cases/${caseId}/payments?error=conflict`);
  if (error) redirect(`/staff/cases/${caseId}/payments?error=schedule`);
  redirect(`/staff/cases/${caseId}/payments?updated=1`);
}

export async function confirmPayment(formData: FormData) {
  const caseId = field(formData, "caseId");
  const scheduleId = field(formData, "scheduleId");
  const key = field(formData, "key");
  if (!uuidPattern.test(caseId) || (scheduleId && !uuidPattern.test(scheduleId)) || !uuidPattern.test(key)) redirect("/staff/cases");
  const { supabase } = await requireStaffCase(caseId);
  const amount = field(formData, "amount");
  const paidOn = field(formData, "paidOn");
  const reference = field(formData, "reference");
  const clientNote = field(formData, "clientNote");
  const receiptId = field(formData, "receiptId");
  if (!moneyPattern.test(amount) || Number(amount) <= 0 || !datePattern.test(paidOn)
    || reference.length < 4 || reference.length > 120 || clientNote.length > 500
    || (receiptId && !uuidPattern.test(receiptId))) {
    redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  }
  if (scheduleId) {
    const { data: schedule } = await supabase.from("payment_schedule").select("case_id, cancelled_at").eq("id", scheduleId).maybeSingle();
    if (schedule?.case_id !== caseId || schedule.cancelled_at) redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  }
  const { error } = await supabase.rpc("staff_record_payment", {
    p_case_id: caseId, p_schedule_id: scheduleId || null, p_amount_kzt: amount, p_paid_on: paidOn,
    p_reference: reference, p_client_note: clientNote || null, p_idempotency_key: key,
    p_receipt_id: receiptId || null,
  });
  if (error?.message === "Payment exceeds active schedule") redirect(`/staff/cases/${caseId}/payments?error=exceeds`);
  if (error?.code === "23505") redirect(`/staff/cases/${caseId}/payments?error=duplicate`);
  if (error) redirect(`/staff/cases/${caseId}/payments?error=payment`);
  redirect(`/staff/cases/${caseId}/payments?confirmed=1`);
}

export async function cancelInstallment(formData: FormData) {
  const caseId = field(formData, "caseId");
  const scheduleId = field(formData, "scheduleId");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(scheduleId)) redirect("/staff/cases");
  const { supabase } = await requireStaffCase(caseId);
  const expected = field(formData, "expectedUpdatedAt");
  const reason = field(formData, "reason");
  if (Number.isNaN(Date.parse(expected)) || !reason || reason.length > 500) {
    redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  }
  const { data: schedule } = await supabase.from("payment_schedule").select("case_id").eq("id", scheduleId).maybeSingle();
  if (schedule?.case_id !== caseId) redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  const { error } = await supabase.rpc("staff_cancel_payment_installment", {
    p_schedule_id: scheduleId, p_expected_updated_at: expected, p_reason: reason,
  });
  if (error?.message === "Installment changed by another user") redirect(`/staff/cases/${caseId}/payments?error=conflict`);
  if (error) redirect(`/staff/cases/${caseId}/payments?error=cancel`);
  redirect(`/staff/cases/${caseId}/payments?cancelled=1`);
}

export async function voidPayment(formData: FormData) {
  const caseId = field(formData, "caseId");
  const paymentId = field(formData, "paymentId");
  const reason = field(formData, "reason");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(paymentId) || !reason || reason.length > 500) {
    redirect("/staff/cases");
  }
  const { supabase } = await requireStaffCase(caseId);
  const { data: payment } = await supabase.from("payments").select("case_id").eq("id", paymentId).maybeSingle();
  if (payment?.case_id !== caseId) redirect(`/staff/cases/${caseId}/payments?error=invalid`);
  const { error } = await supabase.rpc("staff_void_payment", { p_payment_id: paymentId, p_reason: reason });
  if (error) redirect(`/staff/cases/${caseId}/payments?error=void`);
  redirect(`/staff/cases/${caseId}/payments?voided=1`);
}

export async function reviewReceipt(formData: FormData) {
  const caseId = field(formData, "caseId");
  const receiptId = field(formData, "receiptId");
  const decision = field(formData, "decision");
  const note = field(formData, "note");
  if (!uuidPattern.test(caseId) || !uuidPattern.test(receiptId)) redirect("/staff/cases");
  if (!["accept", "reject"].includes(decision) || !note || note.length > 1000) {
    redirect(`/staff/cases/${caseId}/payments?receiptError=invalid`);
  }
  const { supabase } = await requireStaffCase(caseId);
  const { data: receipt, error: lookupError } = await supabase.from("payment_receipts")
    .select("case_id").eq("id", receiptId).maybeSingle();
  if (lookupError || receipt?.case_id !== caseId) redirect(`/staff/cases/${caseId}/payments?receiptError=invalid`);
  const { error } = await supabase.rpc("staff_review_payment_receipt", {
    p_receipt_id: receiptId, p_accept: decision === "accept", p_note: note,
  });
  if (error) redirect(`/staff/cases/${caseId}/payments?receiptError=review`);
  redirect(`/staff/cases/${caseId}/payments?receiptReviewed=1`);
}
