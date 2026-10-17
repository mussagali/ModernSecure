"use client";

import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type Factor = { id: string; friendly_name?: string | null; status?: string };
type PendingFactor = { id: string; qr: string; secret: string };

export function StaffMfaPanel({ required, passed }: { required: boolean; passed: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  ), []);
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [pending, setPending] = useState<PendingFactor | null>(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadFactors() {
      const { data, error: loadError } = await supabase.auth.mfa.listFactors();
      if (!mounted) return;
      if (loadError) { setError("Не удалось проверить приложение-аутентификатор. Обновите страницу."); return; }
      const verified = (data?.totp ?? []).filter((factor) => factor.status === "verified");
      setFactors(verified);
      setSelectedId(verified[0]?.id ?? "");
    }
    void loadFactors();
    return () => { mounted = false; };
  }, [supabase]);

  async function startEnrollment() {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp", friendlyName: factors?.length ? "Резервное устройство" : "Современная защита",
      });
      if (enrollError || !data?.totp?.qr_code || !data.totp.secret) throw new Error("enroll");
      const qr = data.totp.qr_code.startsWith("<svg")
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.totp.qr_code)}` : data.totp.qr_code;
      setPending({ id: data.id, qr, secret: data.totp.secret });
      setCode("");
    } catch {
      setError("Не удалось начать настройку. Проверьте соединение и повторите попытку.");
    } finally { setWorking(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !/^\d{6}$/.test(code)) return;
    const factorId = pending?.id ?? selectedId;
    if (!factorId) return;
    setWorking(true);
    setError("");
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (verifyError) {
      setError("Код не подошёл или истёк. Проверьте время на устройстве и введите новый код.");
      setCode("");
      setWorking(false);
      return;
    }
    setPending(null);
    setCode("");
    router.replace("/staff");
    router.refresh();
  }

  async function removeBackup(factorId: string) {
    if (working || !passed || !factors || factors.length < 2) return;
    setWorking(true);
    setError("");
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
    if (removeError) setError("Не удалось удалить резервное устройство. Повторите попытку.");
    else {
      const remaining = factors.filter((factor) => factor.id !== factorId);
      setFactors(remaining);
      setSelectedId(remaining[0]?.id ?? "");
    }
    setWorking(false);
  }

  if (!factors) return <div className="staff-security-card" role="status">Проверяем способы подтверждения входа…</div>;

  return <div className="staff-security-card">
    {error && <p className="staff-security-error" role="alert">{error}</p>}
    {pending ? <>
      <h2>Подключите приложение</h2>
      <p>Откройте приложение-аутентификатор на телефоне и отсканируйте QR-код. Если камера недоступна, введите ключ вручную.</p>
      {/* QR is produced by Supabase Auth and kept only in this browser state. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="staff-security-qr" src={pending.qr} alt="QR-код для настройки приложения-аутентификатора" referrerPolicy="no-referrer" />
      <div className="staff-security-secret"><span>Ключ для ручного ввода</span><code>{pending.secret}</code></div>
      <form onSubmit={verify} className="staff-security-form"><label htmlFor="mfa-code">Код из приложения</label><input id="mfa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /><button type="submit" disabled={working || code.length !== 6}>{working ? "Проверяем…" : "Подключить и войти"}</button></form>
      <p className="staff-security-hint">После подтверждения остальные сеансы этого аккаунта завершатся. Не отправляйте ключ и QR-код коллегам.</p>
    </> : factors.length === 0 ? <>
      <h2>Подключите второй фактор</h2><p>{required ? "Для доступа к панели сотрудника сначала подключите приложение-аутентификатор." : "Настройте дополнительную защиту. После подключения коды потребуются при каждом новом входе."}</p>
      <button className="staff-security-primary" type="button" onClick={startEnrollment} disabled={working}>{working ? "Подготавливаем…" : "Подключить приложение"}</button>
    </> : !passed ? <>
      <h2>Введите код подтверждения</h2><p>Ваша учётная запись уже защищена. Возьмите шестизначный код из подключённого приложения.</p>
      <form onSubmit={verify} className="staff-security-form">
        {factors.length > 1 && <><label htmlFor="mfa-factor">Устройство</label><select id="mfa-factor" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{factors.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendly_name || `Устройство ${index + 1}`}</option>)}</select></>}
        <label htmlFor="mfa-code">Код из приложения</label><input id="mfa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /><button type="submit" disabled={working || code.length !== 6}>{working ? "Проверяем…" : "Подтвердить вход"}</button>
      </form>
    </> : <>
      <h2>Вход защищён</h2><p>Этот сеанс подтверждён кодом из приложения. Для восстановления доступа подключите резервное устройство, которое хранится отдельно от основного.</p>
      <ul className="staff-security-factors">{factors.map((factor, index) => <li key={factor.id}><span>{factor.friendly_name || `Устройство ${index + 1}`}</span>{factors.length > 1 && <button type="button" onClick={() => void removeBackup(factor.id)} disabled={working}>Удалить</button>}</li>)}</ul>
      {factors.length < 2 && <button className="staff-security-secondary" type="button" onClick={startEnrollment} disabled={working}>{working ? "Подготавливаем…" : "Добавить резервное устройство"}</button>}
      <Link className="staff-security-return" href="/staff">Вернуться в рабочую панель</Link>
    </>}
  </div>;
}
