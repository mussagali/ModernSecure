export type ClientAccountLookup = {
  email: string;
  user_id: string | null;
  display_name: string | null;
  email_verified: boolean;
  status: "staff" | "linked" | "pending" | "missing";
  client_id: string | null;
  invited_role: "admin" | "lawyer" | "manager" | null;
  cards: Array<{ id: string; full_name: string; available: boolean }>;
};
