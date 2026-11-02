import { toKztCents } from "./money";

type Payment = { id: string; status: string };
type Allocation = { payment_id: string; schedule_id: string; amount_kzt: string | number };

// A bank transaction can cover several installments; voided payments retain
// their historical allocations but must not contribute to current balances.
export function installmentPaidAmounts(payments: Payment[], allocations: Allocation[]) {
  const confirmed = new Set(payments.filter((payment) => payment.status === "confirmed").map((payment) => payment.id));
  const totals = new Map<string, bigint>();
  for (const allocation of allocations) {
    if (!confirmed.has(allocation.payment_id)) continue;
    totals.set(allocation.schedule_id, (totals.get(allocation.schedule_id) ?? BigInt(0)) + toKztCents(allocation.amount_kzt));
  }
  return totals;
}
