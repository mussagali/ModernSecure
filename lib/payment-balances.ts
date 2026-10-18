import { toKztCents } from "./money.ts";

type AllocatedPayment = {
  status?: string;
  payment_allocations: Array<{ schedule_id: string; amount_kzt: string | number }>;
};

export function installmentPaid(payments: readonly AllocatedPayment[], scheduleId: string): bigint {
  return payments.filter((payment) => !payment.status || payment.status === "confirmed")
    .flatMap((payment) => payment.payment_allocations)
    .filter((allocation) => allocation.schedule_id === scheduleId)
    .reduce((sum, allocation) => sum + toKztCents(allocation.amount_kzt), BigInt(0));
}
