"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";
import { FieldError, TextField } from "@/components/form-fields";
import { InstantSearch } from "@/components/instant-search";
import { ParentInviteButton } from "@/components/invite-button";
import { Modal } from "@/components/modal";
import { SortHeader } from "@/components/sort-header";
import type { SortOrder } from "@/lib/table-sort";
import { createStudent, importStudents, setStudentStatus, updateStudent, type FieldErrors, type ImportFailure } from "@/app/owner/students/actions";
import { linkParent, unlinkParent } from "@/app/owner/students/links";
import { ParentCombobox } from "@/components/parent-combobox";
import { usePick, usePublicLabel } from "@/components/locale-provider";

export type StudentRow = {
  id: string;
  name: string;
  studentNo: string | null;
  grade: string | null;
  age: number | null;
  guardianName: string | null;
  guardianPhone: string | null;
  contactNote: string | null;
  status: "ACTIVE" | "INACTIVE";
  archiveReason: string | null;
  courses: string[];
  studyLabel: string;
  studyClassName: string;
  hourAdjustments: { id: string; courseName: string; deltaHours: number; reason: string; actorName: string; at: string }[];
};

export type ParentAccount = { id: string; name: string; email: string; phone: string | null };
export type GuardianLink = { id: string; studentId: string; parentUserId: string; parentName: string; parentEmail: string };

function studentListHref({
  q,
  status,
  sortBy,
  order,
}: {
  q?: string;
  status?: string | null;
  sortBy: "name" | "studentNo" | "status" | null;
  order: SortOrder | null;
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (sortBy && order) {
    params.set("sortBy", sortBy);
    params.set("order", order);
  }
  const text = params.toString();
  return text ? `/owner/students?${text}` : "/owner/students";
}

function FilterNotice({ label, href }: { label: string; href: string }) {
  const t = usePick();
  const show = usePublicLabel();
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-[var(--teal-2)] px-2.5 py-1 font-bold text-[var(--teal)]">{t("当前正在筛选", "Filter")}: {show(label)}</span>
      <Link href={href} className="font-bold text-[var(--teal)]">{t("重置", "Reset")}</Link>
    </p>
  );
}

export function StudentDirectory({
  students,
  query,
  focusId = null,
  openCreate = false,
  launchKey = "",
  importKey = "",
  statusFilter = null,
  sortBy,
  order,
  parents,
  links,
}: {
  students: StudentRow[];
  query: string;
  focusId?: string | null;
  openCreate?: boolean;
  launchKey?: string;
  importKey?: string;
  statusFilter?: "在读" | "已停用" | null;
  sortBy: "name" | "studentNo" | "status" | null;
  order: SortOrder | null;
  parents: ParentAccount[];
  links: GuardianLink[];
}) {
  const router = useRouter();
  const t = usePick();
  const show = usePublicLabel();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<StudentRow | null | "new">(openCreate ? "new" : null);
  const [viewing, setViewing] = useState<StudentRow | null>(null);
  useEffect(() => {
    if (!focusId) return;
    const student = students.find((item) => item.id === focusId);
    if (student) setViewing(student);
  }, [focusId, students]);
  useEffect(() => {
    if (launchKey) setEditing("new");
  }, [launchKey]);
  const [confirming, setConfirming] = useState<StudentRow | null>(null);
  const [message, setMessage] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [parentId, setParentId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (importKey) setImporting(true);
  }, [importKey]);
  const [importMessage, setImportMessage] = useState("");
  const [importFailures, setImportFailures] = useState<ImportFailure[]>([]);

  function downloadTemplate() {
    const csv = "\uFEFF姓名*,年级,年龄,家长手机号,备注\r\n张三,初二,13,13800000000,请删除本行\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "学生导入模板.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function uploadStudents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setImportMessage("");
    setImportFailures([]);
    startTransition(async () => {
      const result = await importStudents(formData);
      if (!result.ok) {
        setImportMessage(result.message ?? "导入失败。");
        return;
      }
      const skipped = result.failed.length;
      setImportFailures(result.failed);
      setImportMessage(result.created === 0 && skipped === 0 ? "没有可导入的学生。" : `成功导入 ${result.created} 名学生，失败 ${skipped} 名。`);
      form.reset();
      router.refresh();
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setMessage("");
    setFieldErrors({});
    startTransition(async () => {
      const result = editing === "new" ? await createStudent(formData) : editing ? await updateStudent(editing.id, formData) : { ok: false };
      if (!result.ok) {
        setMessage(result.message ?? "");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function changeStatus(student: StudentRow, status: "ACTIVE" | "INACTIVE") {
    setMessage("");
    startTransition(async () => {
      const result = await setStudentStatus(student.id, status);
      if (!result.ok) {
        setMessage(result.message ?? "操作失败。");
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  }

  function bindGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viewing || !parentId) {
      setLinkMessage("请选择家长账号。");
      return;
    }
    setLinkMessage("");
    startTransition(async () => {
      const result = await linkParent(viewing.id, parentId);
      if (!result.ok) {
        setLinkMessage(result.message ?? "绑定失败。");
        return;
      }
      setParentId("");
      router.refresh();
    });
  }

  function removeGuardian(linkId: string) {
    setLinkMessage("");
    startTransition(async () => {
      const result = await unlinkParent(linkId);
      if (!result.ok) {
        setLinkMessage(result.message ?? "解除失败。");
        return;
      }
      router.refresh();
    });
  }

  const guardians = viewing ? links.filter((link) => link.studentId === viewing.id) : [];
  const childCounts = new Map<string, number>();
  for (const link of links) childCounts.set(link.parentUserId, (childCounts.get(link.parentUserId) ?? 0) + 1);
  const availableParents = parents
    .filter((parent) => !guardians.some((link) => link.parentUserId === parent.id))
    .map((parent) => ({ ...parent, childCount: childCounts.get(parent.id) ?? 0 }));

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{t("学生管理", "Students")}</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">{t("学生档案按当前机构保存。停用后仍可查询，不会删除历史记录。", "Student records stay in this organization. Inactive students can still be found, and history is kept.")}</p>
          {statusFilter ? <FilterNotice label={statusFilter} href={studentListHref({ sortBy, order })} /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/owner/students/export?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(statusFilter ? { status: statusFilter } : {}), ...(sortBy && order ? { sortBy, order } : {}) })}`} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">{t("导出当前结果", "Export current results")}</a>
          <button type="button" onClick={() => { setImporting(true); setImportMessage(""); setImportFailures([]); }} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">
            {t("批量导入", "Import")}
          </button>
          <button type="button" onClick={() => { setEditing("new"); setFieldErrors({}); setMessage(""); }} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white">
            {t("＋ 新增学生", "+ Add student")}
          </button>
        </div>
      </div>

      <InstantSearch
        action="/owner/students"
        query={query}
        placeholder={t("搜索姓名或编号", "Search name or number")}
        params={{ status: statusFilter, sortBy, order }}
        className="mt-6 flex flex-wrap gap-2"
        inputClassName="w-full rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--teal)] sm:w-auto sm:min-w-[220px] sm:flex-1"
      />
      {message ? <p className="mt-3 text-sm text-[#b94d4d]">{message}</p> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[20%]" />
              <col className="w-[9%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead className="bg-[#fafbf9] text-[10px] tracking-wide text-[#84918e]">
              <tr>
                <SortHeader label={t("学生", "Student")} field="name" sortBy={sortBy} order={order} pathname="/owner/students" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                <th className="px-4 py-3 font-extrabold">{t("家长姓名", "Guardian")}</th>
                <SortHeader label={t("编号", "Number")} field="studentNo" sortBy={sortBy} order={order} pathname="/owner/students" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                <th className="px-4 py-3 font-extrabold">{t("年级", "Grade")}</th>
                <th className="px-4 py-3 font-extrabold">{t("年龄", "Age")}</th>
                <th className="px-4 py-3 font-extrabold">{t("报名课程", "Courses")}</th>
                <SortHeader label={t("状态", "Status")} field="status" sortBy={sortBy} order={order} pathname="/owner/students" query={query} extra={statusFilter ? { status: statusFilter } : undefined} />
                <th className="px-4 py-3 font-extrabold">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center leading-7 text-[var(--muted)]">
                    {query || statusFilter ? t("没有找到符合条件的学生。", "No matching students.") : t("还没有学生。可以先新增一名学生。", "No students yet.")}
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="border-t border-[#eef1ee]">
                    <td className="px-4 py-4 font-bold">{student.name}</td>
                    <td className="px-4 py-4">{student.guardianName ?? "—"}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{student.studentNo ?? "—"}</td>
                    <td className="px-4 py-4">{student.grade ?? "—"}</td>
                    <td className="px-4 py-4">{student.age ? t(`${student.age}岁`, String(student.age)) : "—"}</td>
                    <td className="px-4 py-4">
                      {student.courses.length === 0 ? <span className="text-[var(--muted)]">—</span> : (
                        <div className="flex flex-wrap gap-1">
                          {student.courses.map((course) => (
                            <span key={course} className="rounded-full bg-[#e4f2ee] px-2 py-1 text-[10px] font-bold text-[#146b62]">{course}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${student.studyClassName}`}>
                        {show(student.studyLabel)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => { setViewing(student); setLinkMessage(""); setParentId(""); }}>{t("查看", "View")}</button>
                      <button type="button" className="mr-3 font-bold text-[var(--teal)]" onClick={() => { setEditing(student); setFieldErrors({}); setMessage(""); }}>{t("编辑", "Edit")}</button>
                      {student.status === "ACTIVE" ? (
                        <button type="button" className="font-bold text-[#9a6729]" onClick={() => setConfirming(student)}>{t("停用", "Deactivate")}</button>
                      ) : (
                        <button type="button" className="font-bold text-[var(--teal)]" disabled={pending} onClick={() => changeStatus(student, "ACTIVE")}>{t("恢复在读", "Restore")}</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[#eef1ee] px-4 py-3 text-[11px] text-[var(--muted)]">共 {students.length} 名学生 · 数据来自当前机构</div>
      </div>

      {importing ? (
        <Modal title="批量导入学生" onClose={() => setImporting(false)}>
          <form onSubmit={uploadStudents} className="grid gap-3 px-5 py-5 text-sm">
            <button type="button" onClick={downloadTemplate} className="w-fit font-bold text-[var(--teal)]">下载导入模板（CSV格式）</button>
            <p className="leading-6 text-[var(--muted)]">用 Excel 打开模板，从第三行开始填写。姓名必填。年级、年龄、家长手机号和备注可以留空。年龄只能填数字。手机号只保存下来，供以后绑定家长，这次不会创建家长账号。编号不用填，系统会自动生成；如果自行增加「编号」列，则只能使用字母、数字和短横线。请另存为 CSV 再上传。</p>
            <label className="grid gap-1.5 text-xs font-bold">
              选择文件
              <input name="file" type="file" accept=".csv,text/csv" required className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium" />
            </label>
            {importMessage ? <p className="text-sm font-semibold">{importMessage}</p> : null}
            {importFailures.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto rounded-xl bg-[#fff6f4] px-3 py-2 text-xs leading-6 text-[#9a4d4d]">
                {importFailures.slice(0, 12).map((failure) => (
                  <li key={`${failure.row}-${failure.reason}`}>第 {failure.row} 行：{failure.reason}</li>
                ))}
                {importFailures.length > 12 ? <li>还有 {importFailures.length - 12} 行未列出。</li> : null}
              </ul>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setImporting(false)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">关闭</button>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在导入…" : "开始导入"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={editing === "new" ? "新增学生" : "编辑学生"} onClose={() => setEditing(null)}>
          <form key={editing === "new" ? "new" : editing.id} onSubmit={save} className="px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="学生姓名" name="name" required defaultValue={editing === "new" ? "" : editing.name} placeholder="请输入姓名" error={fieldErrors.name} />
              <TextField label="学生编号" name="studentNo" defaultValue={editing === "new" ? "" : editing.studentNo} placeholder="留空则自动生成" error={fieldErrors.studentNo} />
              <TextField label="家长姓名" name="guardianName" defaultValue={editing === "new" ? "" : editing.guardianName} placeholder="例如：林子涵家长" error={fieldErrors.guardianName} />
              <TextField label="联系人电话" name="guardianPhone" defaultValue={editing === "new" ? "" : editing.guardianPhone} placeholder="选填，11 位手机号" error={fieldErrors.guardianPhone} />
              <TextField label="年级" name="grade" defaultValue={editing === "new" ? "" : editing.grade} placeholder="例如：初二" error={fieldErrors.grade} />
              <label className="grid gap-1.5 text-xs font-bold">
                <span>年龄</span>
                <input name="age" inputMode="numeric" defaultValue={editing === "new" || editing.age == null ? "" : String(editing.age)} placeholder="例如：12" className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[var(--teal)]" />
                <FieldError message={fieldErrors.age} />
              </label>
              <TextField label="联系备注" name="contactNote" defaultValue={editing === "new" ? "" : editing.contactNote} placeholder="选填，仅机构内部可见" error={fieldErrors.contactNote} />
            </div>
            {editing !== "new" ? (
              <div className="mt-4 grid gap-1.5">
                <span className="text-xs font-bold">家长邀请码</span>
                <ParentInviteButton studentId={editing.id} />
              </div>
            ) : null}
            {message ? <p className="mt-3 text-xs text-[#b94d4d]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button disabled={pending} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "正在保存…" : "保存"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {viewing ? (
        <Modal title="学生档案" onClose={() => setViewing(null)}>
          <div className="space-y-4 px-5 py-5 text-sm">
            <div><div className="text-xs font-bold">姓名</div><p className="mt-1">{viewing.name}</p></div>
            <div><div className="text-xs font-bold">家长姓名</div><p className="mt-1 text-[var(--muted)]">{viewing.guardianName ?? "未填写"}</p></div>
            <div><div className="text-xs font-bold">家长联系方式</div><p className="mt-1 text-[var(--muted)]">{viewing.guardianPhone ?? "未填写"}</p></div>
            <div><div className="text-xs font-bold">编号</div><p className="mt-1 text-[var(--muted)]">{viewing.studentNo ?? "—"}</p></div>
            <div><div className="text-xs font-bold">年级</div><p className="mt-1 text-[var(--muted)]">{viewing.grade ?? "未填写"}</p></div>
            <div><div className="text-xs font-bold">年龄</div><p className="mt-1 text-[var(--muted)]">{viewing.age ? `${viewing.age}岁` : "未填写"}</p></div>
            <div><div className="text-xs font-bold">联系备注</div><p className="mt-1 leading-6 text-[var(--muted)]">{viewing.contactNote ?? "未填写"}</p></div>
            {viewing.status === "INACTIVE" ? <div><div className="text-xs font-bold">停用原因</div><p className="mt-1 leading-6 text-[var(--muted)]">{viewing.archiveReason?.trim() || "未填写"}</p></div> : null}
            <div>
              <div className="text-xs font-bold">{t("课时调整", "Hour changes")}</div>
              {viewing.hourAdjustments.length === 0 ? (
                <p className="mt-2 text-[var(--muted)]">{t("还没有课时调整。", "No hour changes yet.")}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {viewing.hourAdjustments.map((item) => (
                    <li key={item.id} className="rounded-xl bg-[#f7faf8] px-3 py-2 text-xs leading-5">
                      <span className="font-bold">{item.courseName} {item.deltaHours > 0 ? `+${item.deltaHours}` : item.deltaHours} 节</span>
                      <span className="ml-2 text-[var(--muted)]">{item.at} · {item.actorName}</span>
                      <p className="text-[var(--muted)]">{item.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-xs font-bold">已绑定家长</div>
              {guardians.length === 0 ? (
                <p className="mt-2 text-[var(--muted)]">还没有绑定家长。绑定后，该家长登录只能看到这名学生。</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {guardians.map((guardian) => (
                    <li key={guardian.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f7faf8] px-3 py-2">
                      <span>
                        <span className="font-bold">{guardian.parentName}</span>
                        <span className="ml-2 text-[var(--muted)]">{guardian.parentEmail}</span>
                      </span>
                      <button type="button" disabled={pending} onClick={() => removeGuardian(guardian.id)} className="font-bold text-[#9a6729]">收回账号</button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs leading-5 text-[var(--muted)]">收回后，这位家长不能再查看这名学生。密码不会改变，之后可以重新绑定。</p>
              <form onSubmit={bindGuardian} className="mt-3 grid gap-2">
                <div className="grid gap-1.5 text-xs font-bold">
                  绑定家长账号
                  <ParentCombobox key={viewing.id} parents={availableParents} value={parentId} onChange={setParentId} />
                </div>
                {linkMessage ? <p className="text-xs text-[#b94d4d]">{linkMessage}</p> : null}
                <div className="flex flex-wrap items-start gap-2">
                  <button disabled={pending || availableParents.length === 0} className="rounded-[10px] bg-[var(--teal)] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                    {pending ? "正在绑定…" : "绑定已有家长"}
                  </button>
                  <ParentInviteButton studentId={viewing.id} />
                </div>
              </form>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setViewing(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirming ? (
        <Modal title="停用学生" onClose={() => setConfirming(null)}>
          <div className="px-5 py-5 text-sm leading-7 text-[var(--muted)]">
            停用后不会删除「{confirming.name}」的档案。以后产生的课次和报告也会保留。
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="rounded-[10px] border border-[var(--line)] px-3.5 py-2.5 text-xs font-bold">取消</button>
              <button type="button" disabled={pending} onClick={() => changeStatus(confirming, "INACTIVE")} className="rounded-[10px] bg-[#c27b35] px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {pending ? "正在停用…" : "确认停用"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
