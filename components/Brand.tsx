import Link from "next/link";

export function Brand({ href = "/account" }: { href?: string }) {
  return <Link href={href} className="brand" aria-label="Современная защита | главная">
    <span className="brand-mark" aria-hidden="true"><svg width="24" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 6v8c0 6 9 11 9 11s9-5 9-11V6L12 2Z"/><path d="m8 13 3 3 5-6"/></svg></span>
    <span className="brand-name">Современная<strong>защита</strong></span>
  </Link>;
}
