"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { removeHomeworkAsset, submitHomework } from "@/app/parent/homework/actions";
import {
  HOMEWORK_BODY_LIMIT,
  HOMEWORK_MAX_FILES,
  HOMEWORK_MAX_IMAGES,
  canParentEditSubmission,
  homeworkOverdue,
  homeworkStatusLabel,
  homeworkStatusTone,
  listHomeworkStatus,
  type HomeworkStatusValue,
} from "@/lib/homework";

type Asset = { id: string; kind: "IMAGE" | "FILE"; fileName: string };

type Props = {
  lessonStudentId: string;
  studentName: string;
  courseName: string;
  lessonTitle: string;
  when: string;
  teacherName: string;
  assignment: string;
  dueLabel: string | null;
  dueAtIso: string | null;
  status: HomeworkStatusValue | null;
  body: string;
  feedback: string | null;
  score: string | null;
  submittedLabel: string | null;
  gradedLabel: string | null;
  assets: Asset[];
};

export function ParentHomeworkDetail(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [assets, setAssets] = useState(props.assets);
  const status = listHomeworkStatus(props.status);
  const overdue = homeworkOverdue(props.dueAtIso ? new Date(props.dueAtIso) : null, status);
  const editable = canParentEditSubmission(props.status);
  const images = assets.filter((asset) => asset.kind === "IMAGE");
  const files = assets.filter((asset) => asset.kind === "FILE");

  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    setMessage("");
    setFailed(false);
    startTransition(async () => {
      const result = await task();
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    run(() => submitHomework(props.lessonStudentId, new FormData(form)));
  }

  function dropAsset(assetId: string) {
    run(async () => {
      const result = await removeHomeworkAsset(props.lessonStudentId, assetId);
      if (result.ok) setAssets((current) => current.filter((asset) => asset.id !== assetId));
      return result;
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/parent/homework" className="text-xs font-bold text-[var(--teal)]">← 返回作业列表</Link>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${homeworkStatusTone[status]}`}>{homeworkStatusLabel[status]}</span>
        {overdue ? <span className="rounded-full bg-[#fdecec] px-2.5 py-1 text-[11px] font-bold text-[#9a3434]">已逾期</span> : null}
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h1 className="text-[22px] font-semibold tracking-tight">{props.courseName} · {props.lessonTitle}</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">{props.studentName} · {props.teacherName} · {props.when}</p>
        {props.dueLabel ? <p className="mt-2 text-xs font-bold text-[#9a6729]">截止：{props.dueLabel}</p> : null}
        <h2 className="mt-4 text-sm font-semibold">作业要求</h2>
        <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7 text-[#42565a]">{props.assignment}</p>
      </div>

      {(props.feedback || props.score || props.gradedLabel) && (status === "GRADED" || status === "COMPLETED" || status === "RETURNED") ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-sm font-semibold">教师反馈</h2>
          {props.score ? <p className="mt-2 text-sm font-bold text-[#34725d]">评分：{props.score}</p> : null}
          {props.feedback ? <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#42565a]">{props.feedback}</p> : null}
          {props.gradedLabel ? <p className="mt-2 text-xs text-[var(--muted)]">{props.gradedLabel}</p> : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-sm font-semibold">{editable ? "提交作业" : "我的提交"}</h2>
        {props.submittedLabel ? <p className="mt-1 text-xs text-[var(--muted)]">上次提交：{props.submittedLabel}</p> : null}

        {!editable ? (
          <div className="mt-3 space-y-3">
            {props.body ? <p className="whitespace-pre-wrap break-words rounded-xl bg-[#f7f9f6] px-3 py-3 text-sm leading-7">{props.body}</p> : <p className="text-sm text-[var(--muted)]">没有文字说明。</p>}
            <AssetGallery assets={assets} />
            <p className="text-xs text-[var(--muted)]">教师已批改或标记完成。如需修改，请等教师退回后再交。</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-3 grid gap-3">
            <label className="grid gap-1.5 text-xs font-bold">
              文字说明
              <textarea name="body" rows={4} maxLength={HOMEWORK_BODY_LIMIT} defaultValue={props.body} placeholder="可写完成情况、遇到的问题，或配合照片说明。" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm font-medium outline-none focus:border-[var(--teal)]" />
            </label>

            {assets.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-xs font-bold">已上传（可勾选删除）</p>
                <div className="flex flex-wrap gap-3">
                  {assets.map((asset) => (
                    <label key={asset.id} className="w-28 text-[11px]">
                      {asset.kind === "IMAGE" ? (
                        <img src={`/api/homework-assets/${asset.id}`} alt={asset.fileName} className="h-20 w-28 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-20 w-28 items-center justify-center rounded-lg border border-[var(--line)] bg-[#f7f9f6] px-2 text-center">{asset.fileName}</span>
                      )}
                      <span className="mt-1 flex items-center gap-1">
                        <input type="checkbox" name="removeAsset" value={asset.id} />
                        删除
                      </span>
                      <button type="button" disabled={pending} onClick={() => dropAsset(asset.id)} className="mt-1 font-bold text-[#9a3434]">立刻去掉</button>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-2 rounded-xl bg-[#f7f9f6] px-3 py-3">
              <p className="text-xs font-bold">添加材料</p>
              <p className="text-[11px] leading-5 text-[var(--muted)]">照片最多 {HOMEWORK_MAX_IMAGES} 张（可拍照或从相册选），附件最多 {HOMEWORK_MAX_FILES} 个（PDF / TXT / DOC / DOCX）。至少交文字、照片或附件其中一项。</p>
              <label className="grid gap-1 text-xs font-bold">
                拍照
                <input name="camera" type="file" accept="image/*" capture="environment" className="text-xs" />
              </label>
              <label className="grid gap-1 text-xs font-bold">
                从相册选择（可多选）
                <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="text-xs" />
              </label>
              <label className="grid gap-1 text-xs font-bold">
                上传附件（可多选）
                <input name="files" type="file" accept=".pdf,.txt,.doc,.docx,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple className="text-xs" />
              </label>
              <p className="text-[11px] text-[var(--muted)]">当前已有照片 {images.length} / {HOMEWORK_MAX_IMAGES}，附件 {files.length} / {HOMEWORK_MAX_FILES}。</p>
            </div>

            {message ? <p className={`text-sm ${failed ? "text-[#9a3434]" : "text-[#34725d]"}`}>{message}</p> : null}
            <button disabled={pending} className="w-fit rounded-[10px] bg-[var(--teal)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              {pending ? "正在提交…" : status === "RETURNED" ? "重新提交" : status === "SUBMITTED" ? "更新提交" : "提交作业"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function AssetGallery({ assets }: { assets: Asset[] }) {
  if (assets.length === 0) return <p className="text-sm text-[var(--muted)]">没有照片或附件。</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {assets.map((asset) =>
        asset.kind === "IMAGE" ? (
          <a key={asset.id} href={`/api/homework-assets/${asset.id}`} target="_blank" rel="noreferrer" className="block">
            <img src={`/api/homework-assets/${asset.id}`} alt={asset.fileName} className="h-28 w-40 rounded-lg object-cover" />
          </a>
        ) : (
          <a key={asset.id} href={`/api/homework-assets/${asset.id}`} target="_blank" rel="noreferrer" className="flex h-28 w-40 items-center justify-center rounded-lg border border-[var(--line)] bg-[#f7f9f6] px-2 text-center text-xs font-bold text-[var(--teal)]">
            {asset.fileName}
          </a>
        ),
      )}
    </div>
  );
}
