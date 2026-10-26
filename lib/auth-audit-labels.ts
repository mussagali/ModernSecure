const actions: Record<string, string> = {
  login: "Вход в аккаунт",
  logout: "Выход из аккаунта",
  signup: "Регистрация аккаунта",
  user_signedup: "Регистрация аккаунта",
  user_recovery_requested: "Запрос восстановления доступа",
  user_recovery: "Восстановление доступа",
  challenge_created: "Запрошен код MFA",
  verification_attempted: "Попытка подтверждения MFA",
  factor_in_progress: "Подключение MFA начато",
  factor_deleted: "Фактор MFA удалён",
  token_revoked: "Токен отозван",
};

export function authAuditActionLabel(action: string | null) {
  if (!action) return "Событие авторизации";
  return actions[action] ?? `Событие авторизации: ${action}`;
}
