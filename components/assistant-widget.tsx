"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Area = "owner" | "teacher";

type Confirmation = { token: string; summary: string; detail: string; href?: string; fields?: { label: string; value: string }[] };

type ChatItem = {
  role: "user" | "assistant";
  content: string;
  confirmation?: Confirmation;
  confirmState?: "pending" | "done" | "cancelled";
  navigation?: { href: string; label: string };
};

type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function useDraggable<T extends HTMLElement>() {
  const [point, setPoint] = useState<Point | null>(null);
  const ref = useRef<T | null>(null);
  const moved = useRef(false);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const node = ref.current ?? event.currentTarget;
    const rect = node.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const originX = event.clientX;
    const originY = event.clientY;
    moved.current = false;
    const place = (clientX: number, clientY: number) => {
      setPoint({
        x: clamp(clientX - offsetX, 8, window.innerWidth - rect.width - 8),
        y: clamp(clientY - offsetY, 8, window.innerHeight - rect.height - 8),
      });
    };
    place(event.clientX, event.clientY);
    const onMove = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientX - originX) + Math.abs(moveEvent.clientY - originY) > 5) moved.current = true;
      place(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { point, moved, ref, onPointerDown };
}

export function AssistantWidget({ area }: { area: Area }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const panel = useDraggable<HTMLElement>();
  const launcher = useDraggable<HTMLButtonElement>();

  const waitingConfirm = items.some((item) => item.confirmState === "pending");

  async function ask(nextItems: ChatItem[]) {
    setPending(true);
    try {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          area,
          messages: nextItems.map((item) => ({ role: item.role, content: item.content })),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        type?: string;
        content?: string;
        confirmation?: Confirmation;
        navigation?: { href: string };
      } | null;
      if (!data?.ok || data.type === "confirm" && !data.confirmation) {
        setItems((current) => [...current, { role: "assistant", content: data?.message || "小星助教思考超时，请稍后再试" }]);
        return;
      }
      if (data.type === "navigate" && data.navigation?.href) {
        router.push(data.navigation.href);
        setItems((current) => [...current, { role: "assistant", content: data.content || "已打开。" }]);
        return;
      }
      if (data.type === "confirm" && data.confirmation) {
        if (data.confirmation.href) router.push(data.confirmation.href);
        setItems((current) => [...current, {
          role: "assistant",
          content: data.content || "请先确认，我才会写入。",
          confirmation: data.confirmation,
          confirmState: "pending",
        }]);
        return;
      }
      setItems((current) => [...current, { role: "assistant", content: data.content || data.message || "我没有查到可以回答的内容。" }]);
    } catch {
      setItems((current) => [...current, { role: "assistant", content: "小星助教思考超时，请稍后再试" }]);
    } finally {
      setPending(false);
    }
  }

  function send() {
    const content = draft.trim();
    if (!content || pending || waitingConfirm) return;
    const next = [...items, { role: "user" as const, content }];
    setItems(next);
    setDraft("");
    void ask(next);
  }

  async function confirm(token: string, href?: string) {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/ai/agent/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ area, token }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      const message = data?.message || (data?.ok ? "已执行。" : "没有写入成功，请稍后再试。");
      if (!data?.ok) {
        setItems((current) => [
          ...current.map((item) => item.confirmState === "pending" ? { ...item, confirmState: "cancelled" as const } : item),
          { role: "assistant", content: message },
        ]);
        return;
      }
      const next = [
        ...itemsRef.current.map((item) => item.confirmState === "pending" ? { ...item, confirmState: "done" as const } : item),
        { role: "user" as const, content: `系统已执行。结果：${message}` },
      ];
      setItems(next);
      if (href) router.push(href);
      await ask(next);
    } catch {
      setItems((current) => [
        ...current.map((item) => item.confirmState === "pending" ? { ...item, confirmState: "cancelled" as const } : item),
        { role: "assistant", content: "没有写入成功，请稍后再试。" },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {open ? (
        <section
          ref={panel.ref}
          className="fixed z-[71] flex h-[min(560px,72vh)] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[22px] border border-[var(--line)] bg-white shadow-[0_22px_60px_rgba(23,52,58,.22)] print:hidden"
          style={panel.point ? { left: panel.point.x, top: panel.point.y } : { right: 20, bottom: 96 }}
        >
          <header
            onPointerDown={panel.onPointerDown}
            className="flex cursor-grab touch-none items-center gap-3 bg-[var(--navy)] px-3.5 py-3 text-white active:cursor-grabbing"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--lime)] text-[var(--navy)]">
              <StarMark />
            </span>
            <span className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold leading-none">小星助教</h2>
              <p className="mt-1 text-[10px] text-[#b7d4c8]">按住标题可拖动窗口</p>
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-xs font-bold text-[#d4e1dc]"
            >
              关闭
            </button>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {items.length === 0 ? <p className="text-xs leading-6 text-[var(--muted)]">直接说要办的事。说报名、排课或看报告，我会打开对应的表单。</p> : null}
            {items.map((item, index) => (
              <div key={`${item.role}-${index}`} className={item.role === "user" ? "ml-8 rounded-2xl bg-[#e7f3ee] px-3 py-2 text-sm leading-6" : "mr-6 text-sm leading-6"}>
                {item.role === "assistant" && index === items.length - 1 ? <Typewriter text={item.content} /> : item.content}
                {item.confirmation && item.confirmState === "pending" ? (
                  <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--line)] bg-white text-[var(--ink)]">
                    <p className="bg-[var(--navy)] px-3 py-2 text-xs font-extrabold text-white">请核对后执行</p>
                    <dl>
                      {(item.confirmation.fields?.length ? item.confirmation.fields : [{ label: "操作", value: item.confirmation.summary }]).map((field) => (
                        <div key={`${field.label}-${field.value}`} className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-3 py-2">
                          <dt className="shrink-0 text-xs text-[var(--muted)]">{field.label}</dt>
                          <dd className="text-right text-sm font-bold">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="flex gap-2 px-3 py-3">
                      <button type="button" disabled={pending} onClick={() => void confirm(item.confirmation!.token, item.confirmation!.href)} className="rounded-[10px] bg-[var(--teal)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">✅ 确认执行</button>
                      <button type="button" disabled={pending} onClick={() => setItems((current) => [...current.map((row) => row.confirmState === "pending" ? { ...row, confirmState: "cancelled" as const } : row), { role: "assistant", content: "已取消，没有写入。" }])} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs font-bold">取消</button>
                    </div>
                  </div>
                ) : null}
                {item.confirmState === "done" ? <p className="mt-1 text-[11px] font-bold text-[#34725d]">已确认执行</p> : null}
                {item.confirmState === "cancelled" ? <p className="mt-1 text-[11px] font-bold text-[#74838b]">未执行</p> : null}
              </div>
            ))}
            {pending ? <p className="text-xs text-[var(--muted)]">小星助教正在想…</p> : null}
          </div>
          <form
            className="flex gap-2 border-t border-[var(--line)] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={waitingConfirm ? "请先确认或取消上面的操作" : "问小星助教"}
              disabled={pending || waitingConfirm}
              className="min-w-0 flex-1 rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)] disabled:bg-[#f4f6f5]"
            />
            <button disabled={pending || waitingConfirm || !draft.trim()} className="rounded-[10px] bg-[var(--teal)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">发送</button>
          </form>
        </section>
      ) : null}
      <button
        ref={launcher.ref}
        type="button"
        aria-label="AI小星"
        onPointerDown={launcher.onPointerDown}
        onClick={() => {
          if (launcher.moved.current) {
            launcher.moved.current = false;
            return;
          }
          setOpen((value) => !value);
        }}
        className="fixed z-[70] flex h-10 cursor-grab touch-none items-center gap-1.5 overflow-hidden rounded-full bg-[var(--navy)] py-1 pl-1 pr-3 text-white shadow-[0_10px_24px_rgba(23,52,58,.22)] print:hidden active:cursor-grabbing"
        style={launcher.point ? { left: launcher.point.x, top: launcher.point.y } : { right: 20, bottom: 20 }}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--lime)] text-[var(--navy)]">
          <StarMark />
        </span>
        <span className="text-[13px] font-extrabold leading-none">AI小星</span>
      </button>
    </>
  );
}

function StarMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path fill="currentColor" d="M12 1.6 14.7 8.8 22.2 12 14.7 15.2 12 22.4 9.3 15.2 1.8 12 9.3 8.8Z" />
    </svg>
  );
}

function Typewriter({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!text) return;
    const timer = window.setInterval(() => {
      setCount((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 16);
    return () => window.clearInterval(timer);
  }, [text]);
  return text.slice(0, count);
}
