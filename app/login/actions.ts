"use server";

import { workspaceDestination } from "../../lib/workspace-destination";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { getStaffStatus } from "../../lib/staff";

export type AuthState = { status: "idle" | "error" | "success"; message: string };

function emailFrom(formData: FormData) {
  const value = formData.get("email");
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function passwordFrom(formData: FormData) {
  const value = formData.get("password");
  return typeof value === "string" ? value : "";
}

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const existingAccountMessage = "Письмо подтверждения не отправлено. Возможно, аккаунт с этой почтой уже существует. Войдите или восстановите пароль.";

function emailErrorMessage(code?: string) {
  if (code === "over_email_send_rate_limit") return "Сервис временно достиг лимита отправки писем. Попробуйте позже; если письмо не приходит, обратитесь в поддержку.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit_per_user") return "Слишком много запросов. Подождите минуту перед повторной отправкой.";
  if (code === "email_address_not_authorized" || code === "unexpected_failure") return "Не удалось отправить письмо. Попробуйте позже или обратитесь в поддержку.";
  return "Не удалось выполнить запрос. Попробуйте позже.";
}

export async function loginAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailFrom(formData);
  const password = passwordFrom(formData);
  if (!validEmail(email) || !password) {
    return { status: "error", message: "Введите корректный email и пароль." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      status: "error",
      message: error.code === "email_not_confirmed"
        ? "Подтвердите email по ссылке из письма, затем повторите вход."
        : error.code === "over_request_rate_limit"
          ? "Слишком много попыток входа. Подождите несколько минут и попробуйте снова."
          : error.code === "invalid_credentials"
            ? "Email или пароль не распознаны. Проверьте данные или восстановите пароль."
            : "Сервис входа сейчас недоступен. Попробуйте позже; если проблема повторится, сообщите администратору.",
    };
  }
  if (formData.get("next") === "/delete-account") redirect("/delete-account");
  const { error: inviteError } = await supabase.rpc("claim_staff_invite");
  const { staff, error: staffError } = await getStaffStatus(supabase);
  if (inviteError || staffError) {
    await supabase.auth.signOut();
    return { status: "error", message: "Не удалось проверить доступ. Попробуйте позже." };
  }
  redirect(workspaceDestination(staff, formData.get("next")));
}

export async function registerAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailFrom(formData);
  const password = passwordFrom(formData);
  const repeat = formData.get("passwordRepeat");
  if (!validEmail(email)) return { status: "error", message: "Введите корректный email." };
  if (password.length < 8 || password.length > 72) {
    return { status: "error", message: "Пароль должен содержать от 8 до 72 символов." };
  }
  if (password !== repeat) return { status: "error", message: "Пароли не совпадают." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${process.env.APP_ORIGIN}/auth/callback` },
  });
  if (error) return { status: "error", message: ["user_already_exists", "email_exists"].includes(error.code ?? "") ? existingAccountMessage : emailErrorMessage(error.code) };
  if (data.session) redirect("/account");
  // GoTrue can return an obfuscated user (no identities) for a confirmed
  // address. No confirmation email is sent in that case.
  if (data.user?.identities?.length === 0) return { status: "error", message: existingAccountMessage };
  if (!data.user) return { status: "error", message: "Не удалось создать аккаунт. Попробуйте позже." };
  return { status: "success", message: "Проверьте почту и папку «Спам»: для завершения регистрации откройте ссылку подтверждения. Если вы уже регистрировались, войдите или восстановите пароль." };
}

export async function forgotPasswordAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailFrom(formData);
  if (!validEmail(email)) return { status: "error", message: "Введите корректный email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.APP_ORIGIN}/auth/recovery`,
  });
  if (error) return { status: "error", message: emailErrorMessage(error.code) };
  return { status: "success", message: "Если аккаунт существует, письмо для восстановления отправлено." };
}

export async function updatePasswordAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const password = passwordFrom(formData);
  const repeat = formData.get("passwordRepeat");
  if (password.length < 8 || password.length > 72) {
    return { status: "error", message: "Пароль должен содержать от 8 до 72 символов." };
  }
  if (password !== repeat) return { status: "error", message: "Пароли не совпадают." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { status: "error", message: "Ссылка недействительна или срок её действия истёк." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { status: "error", message: "Не удалось обновить пароль. Попробуйте ещё раз." };
  redirect("/account");
}
