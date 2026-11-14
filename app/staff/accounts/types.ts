export type ManagedAccount = {
  user_id: string;
  email: string | null;
  display_name: string;
  role: string;
  active: boolean;
  is_primary_admin: boolean;
  email_verified: boolean;
  active_case_count: number;
  client_case_count: number;
};

export const accountRoleNames: Record<string, string> = {
  admin: "Администратор", lawyer: "Юрист", manager: "Менеджер", client: "Клиент", pending: "Ожидает активации",
};
