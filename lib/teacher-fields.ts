export type TeacherFieldErrors = Partial<Record<"name" | "phone" | "wechat" | "courses" | "link", string>>;

const realName = /^[\u4e00-\u9fa5·]{2,20}$/;
const phoneDigits = /^\d{11}$/;
const wechatId = /^[A-Za-z0-9_]{1,20}$/;

export function validateTeacherFields(input: { name: string; phone: string; wechat: string }) {
  const fieldErrors: TeacherFieldErrors = {};
  const name = input.name.trim();
  const phone = input.phone.trim();
  const wechat = input.wechat.trim();

  if (!name) fieldErrors.name = "请填写教师姓名。";
  else if (!realName.test(name)) fieldErrors.name = "请填写真实姓名，例如“王强”。";

  if (phone && !phoneDigits.test(phone)) fieldErrors.phone = "手机号必须是 11 位数字。";
  if (wechat && !wechatId.test(wechat)) fieldErrors.wechat = "微信号只能包含字母、数字和下划线。";

  return {
    fieldErrors,
    data: { name, phone: phone || null, wechat: wechat || null },
  };
}
