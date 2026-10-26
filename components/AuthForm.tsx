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
  login: "Войти",
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

function PasswordVisibility({ visible, onToggle, field }: { visible: boolean; onToggle: () => void; field: string }) {
  return <button type="button" onClick={onToggle} aria-label={visible ? "Скрыть пароль" : "Показать пароль"} aria-pressed={visible} aria-controls={field}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12C4.4 7.8 7.7 5.7 12 5.7S19.6 7.8 22 12C19.6 16.2 16.3 18.3 12 18.3S4.4 16.2 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {visible && <path d="M4 3.5 20 20.5" />}
    </svg>
  </button>;
}

export function AuthForm({ mode, next = "/account" }: { mode: Mode; next?: string }) {
  const [state, action] = useActionState(actions[mode], initialAuthState);
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const hasPassword = mode !== "forgot";
  const hasEmail = mode !== "reset";

  return (
    <>
      <form className={`auth-form auth-form-${mode}`} action={action}>
        <input type="hidden" name="next" value={next} />
        {hasEmail && <div className="auth-field">
          <label htmlFor="email">Электронная почта</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="Электронная почта" required maxLength={254} />
        </div>}
        {hasPassword && <div className="auth-field">
          <div className="auth-label-row"><label htmlFor="password">{mode === "reset" ? "Новый пароль" : "Пароль"}</label>{mode === "login" && <Link href="/forgot-password">Забыли пароль?</Link>}</div>
          <div className="auth-password-field">
            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Пароль" : "Не менее 8 символов"} required minLength={mode === "login" ? undefined : 8} maxLength={72} />
            <PasswordVisibility visible={showPassword} onToggle={() => setShowPassword(!showPassword)} field="password" />
          </div>
        </div>}
        {(mode === "register" || mode === "reset") && <div className="auth-field">
          <label htmlFor="passwordRepeat">Повторите пароль</label>
          <div className="auth-password-field">
            <input id="passwordRepeat" name="passwordRepeat" type={showRepeat ? "text" : "password"} autoComplete="new-password" placeholder="Повторите пароль" required minLength={8} maxLength={72} />
            <PasswordVisibility visible={showRepeat} onToggle={() => setShowRepeat(!showRepeat)} field="passwordRepeat" />
          </div>
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
