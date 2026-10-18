"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "../../../lib/supabase/server";

function value(formData: FormData, name: string) {
  const item = formData.get(name);
  return typeof item === "string" ? item.normalize("NFC").trim() : "";
}

export async function saveOwnProfile(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const displayName = value(formData, "displayName");
  const phone = value(formData, "phone");
  const city = value(formData, "city");
  if (displayName.length > 160 || city.length > 100 || phone.length > 30
    || /[\u0000-\u001f\u007f]/u.test(`${displayName}${city}`)
    || (phone && !/^\+?[0-9 ()-]{7,30}$/.test(phone))) {
    redirect("/account/profile?error=invalid");
  }
  const { error } = await supabase.rpc("save_own_profile", {
    p_expected_updated_at: value(formData, "expectedUpdatedAt"),
    p_display_name: displayName || null,
    p_phone: phone || null,
    p_city: city || null,
  });
  if (error?.message === "Profile changed") redirect("/account/profile?error=conflict");
  if (error) redirect("/account/profile?error=save");
  revalidatePath("/staff/clients");
  revalidatePath("/account/profile");
  redirect("/account/profile?saved=1");
}

export async function completeOwnIdentity(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const fullName = value(formData, "fullName");
  const iin = value(formData, "iin");
  if (!fullName || fullName.length > 160 || /[\u0000-\u001f\u007f]/u.test(fullName)
    || (iin && !/^[0-9]{12}$/.test(iin))) redirect("/account/profile?error=identity-invalid");
  const { error } = await supabase.rpc("complete_own_client_identity", {
    p_full_name: fullName, p_iin: iin || null,
  });
  if (error?.message === "Identity is already completed") redirect("/account/profile?error=identity-locked");
  if (error) redirect("/account/profile?error=save");
  revalidatePath("/account", "layout");
  revalidatePath("/staff/clients");
  redirect("/account/profile?saved=1");
}
