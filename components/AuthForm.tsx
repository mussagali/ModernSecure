"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  forgotPasswordAction,
  loginAction,
  registerAction,
  updatePasswordAction,
} from "../app/login/actions";

type Mode = "login" | "register" | "forgot" | "reset";
const initialAuthState = { status: "idle" as const, message: "" };

const actions = {
  login: loginAction,
  register: registerAction,
  forgot: forgotPasswordAction,
  reset: updatePasswordAction,
};

const buttonLabels = {
  login: "Войти в кабинет",
  register: "Создать аккаунт",
  forgot: "Отправить ссылку",
  reset: "Сохранить новый пароль",
};

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      {pending ? "Подождите…" : buttonLabels[mode]}
    </button>
  );
}

export function AuthForm({ mode, next = "/account" }: { mode: Mode; next?: string }) {
  const [state, action] = useActionState(actions[mode], initialAuthState);
  const [showPassword, setShowPassword] = useState(false);
  const hasPassword = mode !== "forgot";
  const hasEmail = mode !== "reset";

  return (
    <>
      <form className="auth-form" action={action}>
        <input type="hidden" name="next" value={next} />
        {hasEmail && <div className="auth-field">
          <label htmlFor="email">Электронная почта</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="name@example.com" required maxLength={254} />
        </div>}
        {hasPassword && <div className="auth-field">
          <div className="auth-label-row"><label htmlFor="password">{mode === "reset" ? "Новый пароль" : "Пароль"}</label>{mode === "login" && <Link href="/forgot-password">Забыли пароль?</Link>}</div>
          <div className="auth-password-field">
            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Введите пароль" : "Не менее 8 символов"} required minLength={mode === "login" ? undefined : 8} maxLength={72} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? "Скрыть" : "Показать"}</button>
          </div>
        </div>}
        {(mode === "register" || mode === "reset") && <div className="auth-field">
          <label htmlFor="passwordRepeat">Повторите пароль</label>
          <input id="passwordRepeat" name="passwordRepeat" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Повторите пароль" required minLength={8} maxLength={72} />
        </div>}
        {state.message && <div className={state.status === "success" ? "auth-feedback is-success" : "auth-feedback is-error"} role={state.status === "error" ? "alert" : "status"}>{state.message}</div>}
        <SubmitButton mode={mode} />
      </form>
      <div className="auth-switch">
        {mode === "login" && <>Нет аккаунта? <Link href="/register">Зарегистрироваться</Link></>}
        {mode !== "login" && <>Уже есть аккаунт? <Link href="/login">Войти</Link></>}
      </div>
    </>
  );
}
