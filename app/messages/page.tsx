import { redirect } from "next/navigation";

export default function MessagesPage() {
  redirect("/account/select-case?section=messages");
}
