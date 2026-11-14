import { createElement } from "react";
import icons from "./reference-icons.json";

export type ReferenceIconName = keyof typeof icons;
export function ReferenceIcon({ name, size = 20 }: { name: ReferenceIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name].map(([tag, attrs], index) => createElement(tag as string, { ...(attrs as object), key: index }))}</svg>;
}
