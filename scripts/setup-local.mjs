import { chmodSync, constants, copyFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["app.env", ".env.local"],
  ["database.env", ".env.db.local"],
  ["accounts.json", ".workspace-accounts.local.json"],
];

for (const [source, target] of files) {
  const destination = path.join(root, target);
  try {
    copyFileSync(path.join(root, "handoff", source), destination, constants.COPYFILE_EXCL);
    if (process.platform !== "win32") chmodSync(destination, 0o600);
    console.log(`Создан ${target}`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!lstatSync(destination).isFile()) throw new Error(`${target} должен быть обычным файлом`);
    if (process.platform !== "win32") chmodSync(destination, 0o600);
    console.log(`Сохранён существующий ${target}; содержимое не перезаписано`);
  }
}

console.log("Настройки готовы. Запуск: npm run dev. Адрес: http://localhost:3000");
