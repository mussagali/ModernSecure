"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NavIcon } from "./NavIcon";

export function WorkspaceSearch({ client = false }: { client?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const destination = client ? "/account/select-case" : "/staff/search";
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (input.current?.getClientRects().length) input.current.focus();
        else router.push(destination);
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [router, destination]);
  return <><Link className="workspace-search-mobile" href={destination} aria-label={client ? "Найти своё дело" : "Поиск в рабочем пространстве"}><NavIcon name="search" size={22} /></Link><form action={destination} className="workspace-search" role="search">
    <NavIcon name="search" size={19} />
    <input ref={input} name="q" type="search" aria-label={client ? "Поиск ваших дел" : "Поиск в рабочем пространстве"} placeholder={client ? "Найти своё дело" : "Поиск дел, клиентов и разделов"} maxLength={120} />
    <kbd aria-hidden="true">⌘ K</kbd><button type="submit" aria-label="Искать"><NavIcon name="arrow" size={18} /></button>
  </form></>;
}
