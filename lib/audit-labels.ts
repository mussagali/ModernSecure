const actions: Record<string, string> = {
  accepted: "Принято",
  approved: "Аккаунт активирован",
  registration_approved: "Регистрация одобрена",
  installment_cancelled: "Платёж графика отменён",
  installment_updated: "Платёж графика изменён",
  voided: "Оплата аннулирована",
  account_linked: "Аккаунт привязан",
  acknowledged: "Ознакомление подтверждено",
  cancelled: "Отменено",
  cancelled_on_case_cancel: "Отменено при отмене дела",
  reopened: "Запрос восстановлен",
  closed: "Дело завершено",
  completed: "Завершено",
  confirmed: "Подтверждено",
  created: "Создано",
  created_from_template: "Создано по шаблону",
  document_checklist_published: "Список документов опубликован",
  documents_submitted: "Документы отправлены",
  download_issued: "Скачивание файла выдано",
  installment_created: "Платёж графика добавлен",
  invited: "Приглашение отправлено",
  identity_completed: "Данные клиента заполнены",
  payment_permission_changed: "Право на оплаты изменено",
  preview_issued: "Предпросмотр файла выдан",
  profile_updated: "Профиль обновлён",
  published: "Опубликовано",
  receipt_linked: "Чек привязан к оплате",
  responded: "Ответ отправлен",
  returned: "Возвращено на исправление",
  role_granted: "Роль выдана",
  sent: "Сообщение отправлено",
  stage_changed: "Этап изменён",
  staff_mfa_verified: "MFA-сессия подтверждена",
  stale_threshold_changed: "Порог дел без обновлений изменён",
  submitted: "Отправлено на проверку",
  test_accounts_provisioned: "Созданы тестовые аккаунты",
  uploaded: "Файл загружен",
};

const entities: Record<string, string> = {
  account: "Аккаунт",
  case: "Дело",
  case_assignment: "Назначение на дело",
  case_internal_note: "Внутренняя заметка",
  client: "Карточка клиента",
  contract: "Договор",
  document_file: "Документ по делу",
  document_request: "Запрос документов",
  message: "Сообщение по делу",
  message_attachment: "Вложение переписки по делу",
  payment: "Платёж",
  payment_receipt: "Квитанция об оплате",
  payment_schedule: "График платежей",
  profile: "Профиль",
  qa_setup: "Настройка тестовых аккаунтов",
  service_template: "Шаблон услуги",
  service_template_version: "Версия услуги",
  staff_invite: "Приглашение сотрудника",
  staff_member: "Сотрудник",
  staff_session: "Сессия сотрудника",
  staff_work_settings: "Настройки контроля дел",
  staff_thread: "Диалог команды",
  staff_message: "Внутреннее сообщение",
  staff_message_attachment: "Вложение переписки команды",
  task: "Задача",
  upload_session: "Отправка документов",
};

export function auditActionLabel(action: string, entityType: string) {
  if (action === "completed" && entityType === "task") return "Задача завершена";
  if (action === "confirmed" && entityType === "payment") return "Оплата подтверждена";
  return actions[action] ?? action;
}

export function auditEntityLabel(entityType: string) {
  return entities[entityType] ?? entityType;
}
