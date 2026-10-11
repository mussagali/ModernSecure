const labels: Record<string, string> = {
  created: "Задача создана",
  acknowledged: "Ознакомление подтверждено",
  completed: "Выполнено",
  returned: "Возвращено на доработку",
  cancelled: "Задача отменена",
};

export function taskEventLabel(action: string, viewer: "client" | "staff") {
  if (action === "responded") return viewer === "client" ? "Ваш ответ" : "Ответ клиента";
  return labels[action] ?? "Обновление задачи";
}
