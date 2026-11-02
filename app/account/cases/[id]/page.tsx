import type { Metadata } from "next";
import ClientCaseOverview from "./CaseOverview";

export const metadata: Metadata = { title: "Дело | Современная защита" };

export default async function ClientCasePage({ params }: { params: Promise<{ id: string }> }) {
  return <ClientCaseOverview params={params} />;
}
