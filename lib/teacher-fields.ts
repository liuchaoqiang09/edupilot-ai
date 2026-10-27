export type TeacherFieldErrors = Partial<Record<"name" | "teacherNo" | "phone" | "wechat" | "courses" | "link", string>>;

const realName = /^[\u4e00-\u9fa5·]{2,20}$/;
const teacherNoPattern = /^[A-Za-z0-9-]{1,32}$/;
const phoneDigits = /^\d{11}$/;
const wechatId = /^[A-Za-z0-9_]{1,20}$/;

export function validateTeacherFields(input: { name: string; teacherNo?: string; phone: string; wechat: string }) {
  const fieldErrors: TeacherFieldErrors = {};
  const name = input.name.trim();
  const teacherNo = (input.teacherNo ?? "").trim();
  const phone = input.phone.trim();
  const wechat = input.wechat.trim();

  if (!name) fieldErrors.name = "请填写教师姓名。";
  else if (!realName.test(name)) fieldErrors.name = "请填写真实姓名，例如“王强”。";

  if (teacherNo && !teacherNoPattern.test(teacherNo)) fieldErrors.teacherNo = "编号只能包含字母、数字和短横线，最多 32 位。";
  if (phone && !phoneDigits.test(phone)) fieldErrors.phone = "手机号必须是 11 位数字。";
  if (wechat && !wechatId.test(wechat)) fieldErrors.wechat = "微信号只能包含字母、数字和下划线。";

  return {
    fieldErrors,
    data: { name, teacherNo: teacherNo || null, phone: phone || null, wechat: wechat || null },
  };
}
