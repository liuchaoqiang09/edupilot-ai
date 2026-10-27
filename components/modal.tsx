"use client";

import { useLayoutEffect, useRef } from "react";

const confirmMessage = "当前有未保存的内容，确定要退出吗？";

function fieldValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    return field.checked ? "1" : "0";
  }
  return field.value;
}

function readFields(root: HTMLElement) {
  return [...root.querySelectorAll("input, textarea, select")].flatMap((node) => {
    const field = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (field.disabled || (field instanceof HTMLInputElement && field.type === "hidden")) return [];
    return [fieldValue(field)];
  });
}

function isDirty(root: HTMLElement, initial: string[]) {
  const current = readFields(root);
  const length = Math.max(current.length, initial.length);
  for (let index = 0; index < length; index += 1) {
    if ((current[index] ?? "") !== (initial[index] ?? "")) return true;
  }
  return false;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<string[] | null>(null);

  useLayoutEffect(() => {
    if (panelRef.current) initialRef.current = readFields(panelRef.current);
  }, []);

  function dirty() {
    return Boolean(panelRef.current && initialRef.current && isDirty(panelRef.current, initialRef.current));
  }

  function requestClose() {
    if (dirty() && !window.confirm(confirmMessage)) return;
    onClose();
  }

  function guardDismiss(event: React.MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!button || button.dataset.modalDismiss === "x") return;
    const label = (button.textContent ?? "").replace(/\s/g, "");
    if (label !== "取消" && label !== "关闭") return;
    if (dirty() && !window.confirm(confirmMessage)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-[#0f2022]/45 p-5">
      <div
        ref={panelRef}
        className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[18px] bg-white shadow-[0_28px_80px_#142b2b35]"
        onClickCapture={guardDismiss}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          <button type="button" data-modal-dismiss="x" onClick={requestClose} className="grid h-9 w-9 place-items-center rounded-[11px] border border-[var(--line)] bg-white text-[#51656a]" aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
