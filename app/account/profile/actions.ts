"use server";

import { redirect } from "next/navigation";
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
  const { error } = await supabase.rpc("update_own_profile", {
    p_display_name: displayName || null,
    p_phone: phone || null,
    p_city: city || null,
  });
  if (error) redirect("/account/profile?error=save");
  redirect("/account/profile?saved=1");
}
