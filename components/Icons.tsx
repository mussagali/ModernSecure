type IconProps = { name: "home" | "case" | "file" | "chat" | "more" | "bell" | "chevron" | "upload" | "clock" | "check" | "close" | "calendar" | "arrow"; size?: number };

const paths = {
  home: <><path d="M3 10.8 12 3l9 7.8" /><path d="M5.5 9.7V21h13V9.7" /><path d="M9 21v-6h6v6" /></>,
  case: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 5V3h8v2M8 11h8M8 15h5" /></>,
  file: <><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M8 13h8M8 17h6" /></>,
  chat: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3.7-.9L4 19l1-3.2A7.1 7.1 0 0 1 4 12a7.5 7.5 0 0 1 8-7.5 7.5 7.5 0 0 1 8 7Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
  more: <><circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 22h4" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  upload: <><path d="M12 16V4M8 8l4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
};

export function Icon({ name, size = 20 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
