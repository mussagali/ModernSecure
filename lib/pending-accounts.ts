export type PendingAccount = {
  user_id: string;
  email: string;
  display_name: string | null;
  email_verified: boolean;
  suggested_role: "client" | "lawyer" | "manager" | "admin" | null;
  invited_name: string | null;
  can_approve: boolean;
};

export type PendingAccountPage = {
  items: PendingAccount[];
  total_count: number;
  ready_count: number;
  page: number;
};
