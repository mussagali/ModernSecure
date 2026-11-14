"use client";

import { useEffect, useRef, useState } from "react";

/** Keep the mobile navigation keyboard focus inside its visible controls. */
export function useNavigationDrawer() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const mobile = window.matchMedia("(max-width: 700px)");
    if (!mobile.matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => [toggleRef.current, ...Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), summary, input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? [])].filter((element): element is HTMLElement => Boolean(element?.getClientRects().length));
    controls()[1]?.focus();
    function close() {
      setMenuOpen(false);
      toggleRef.current?.focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        const targets = controls();
        const index = targets.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === targets.length - 1)) {
          event.preventDefault();
          targets[event.shiftKey ? targets.length - 1 : 0]?.focus();
        }
      }
    }
    function onResize(event: MediaQueryListEvent) {
      if (!event.matches) setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    mobile.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      mobile.removeEventListener("change", onResize);
    };
  }, [menuOpen]);

  return { menuOpen, setMenuOpen, toggleRef, sidebarRef };
}
