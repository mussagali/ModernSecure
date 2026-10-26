import { AuthFrame } from "../../components/AuthFrame";
import { signOutAction } from "../account/actions";

export default function AccessDeniedPage() {
  return <AuthFrame title="Доступ приостановлен" description="Обратитесь к администратору компании, чтобы уточнить статус вашего аккаунта.">
    <form action={signOutAction}><button type="submit">Выйти из аккаунта</button></form>
  </AuthFrame>;
}
