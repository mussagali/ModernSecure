"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText = "Сохраняем…" }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? pendingText : children}</button>;
}
