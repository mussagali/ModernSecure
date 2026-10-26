import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function createClient({ allowStaffSession = true } = {}) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot write cookies. The proxy refreshes sessions.
          }
        },
      },
    },
  );
  // Optional client-only callers can still reject staff sessions explicitly.
  // Role-specific web access is enforced by requireStaff, account layout and RLS.
  if (!allowStaffSession) {
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      const { data: staff, error } = await supabase.rpc("staff_mfa_status");
      if (error) throw new Error("Не удалось проверить доступ к личному кабинету");
      if (staff?.active) redirect("/client-only");
    }
  }
  return supabase;
}
