"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Bridge = { postMessage: (message: string) => void; onmessage?: (event: { data: string }) => void };
type NativeWindow = Window & { ModernSecureNative?: Bridge };

export function MobilePush() {
  const pathname = usePathname();
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const bridge = (window as NativeWindow).ModernSecureNative;
    if (!bridge) return;
    let disposed = false;
    bridge.onmessage = async event => {
      try {
        const data = JSON.parse(event.data);
        if (disposed) return;
        if (typeof data.configured === "boolean") setAvailable(data.configured);
        if (data.error) throw new Error("native");
        setDenied(data.denied === true);
        if (data.enabled && data.token) {
          const response = await fetch("/api/push-devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
          if (!response.ok) throw new Error("registration");
        }
        if (!disposed) { setEnabled(data.enabled === true); setError(""); }
      } catch { if (!disposed) { setEnabled(false); setError("Не удалось включить уведомления. Повторите попытку позже."); } }
      finally { if (!disposed) setWorking(false); }
    };
    const refresh = () => { if (document.visibilityState === "visible") bridge.postMessage("status"); };
    bridge.postMessage("status");
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; bridge.onmessage = undefined; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [pathname]);
  if (!available || enabled) return null;
  return <aside className="mobile-push-prompt" aria-label="Уведомления на телефоне">
    <p>Узнавайте о сообщениях и изменениях в кабинете, когда приложение закрыто.</p>
    {error && <p role="alert">{error}</p>}
    {denied && <p role="status">Уведомления запрещены в настройках телефона. Разрешите их для этого приложения, затем вернитесь в кабинет.</p>}
    <button type="button" disabled={working} onClick={() => { if (!denied) setWorking(true); (window as NativeWindow).ModernSecureNative?.postMessage(denied ? "settings" : "enable"); }}>{working ? "Подключаем…" : denied ? "Открыть настройки уведомлений" : "Включить push-уведомления"}</button>
  </aside>;
}
