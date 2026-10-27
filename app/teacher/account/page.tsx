import { AccountSecurity } from "@/components/account-security";
import { requireRole } from "@/lib/auth";
import { pick } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function TeacherAccountPage() {
  const user = await requireRole("TEACHER", "teacher");
  return (
    <AccountSecurity
      email={user.email}
      phone={user.phone}
      note={pick(user.locale, "这个账号只能查看自己的课表、考勤和教学记录。负责人可以收回登录权限，但不能修改你的密码。", "This account shows your own schedule, attendance, and lesson notes. The owner can remove the login, but cannot change your password.")}
    />
  );
}
