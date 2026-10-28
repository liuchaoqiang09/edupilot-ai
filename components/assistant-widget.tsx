"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { XiaoxingMark } from "@/components/xiaoxing-mark";
import { useXiaoxingSpeech } from "@/components/xiaoxing-speech";

type Area = "owner" | "teacher" | "parent";
type AssistantMode = "ask" | "agent";

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

function useDraggable<T extends HTMLElement>(opts?: { untilMove?: boolean }) {
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
    // 默认 right/bottom 定位时，按下不立刻改成 left/top，避免漂移；拖动超过阈值再跟手
    if (!opts?.untilMove) place(event.clientX, event.clientY);
    const onMove = (moveEvent: PointerEvent) => {
      const dragged = Math.abs(moveEvent.clientX - originX) + Math.abs(moveEvent.clientY - originY) > 5;
      if (dragged) moved.current = true;
      if (!opts?.untilMove || dragged) place(moveEvent.clientX, moveEvent.clientY);
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
  const [mode, setMode] = useState<AssistantMode>("agent");
  const [keyboardInset, setKeyboardInset] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const draftCommittedRef = useRef("");
  const panel = useDraggable<HTMLElement>();
  const launcher = useDraggable<HTMLButtonElement>({ untilMove: true });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`edupilot-xiaoxing-mode-${area}`);
      if (saved === "ask" || saved === "agent") setMode(saved);
    } catch {
      /* ignore */
    }
  }, [area]);

  // 手机软键盘顶起可视区时，把未拖动的面板抬高，避免挡住输入与麦克风。
  useEffect(() => {
    if (!open || panel.point) {
      setKeyboardInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setKeyboardInset(inset);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [open, panel.point]);

  function switchMode(next: AssistantMode) {
    setMode(next);
    try {
      window.localStorage.setItem(`edupilot-xiaoxing-mode-${area}`, next);
    } catch {
      /* ignore */
    }
  }

  const waitingConfirm = items.some((item) => item.confirmState === "pending");
  const speechEnabled = open && !pending && !waitingConfirm;
  const speech = useXiaoxingSpeech({
    enabled: speechEnabled,
    onTranscript: (text, isFinal) => {
      if (isFinal) {
        const prefix = draftCommittedRef.current.trimEnd();
        const next = prefix ? `${prefix} ${text}` : text;
        draftCommittedRef.current = next;
        setDraft(next);
        return;
      }
      const prefix = draftCommittedRef.current.trimEnd();
      setDraft(prefix ? `${prefix} ${text}` : text);
    },
  });

  function toggleMic() {
    // 停止时把当前框内文字（含 interim）落定为已提交，避免下次 interim 回滚。
    draftCommittedRef.current = draft;
    if (speech.listening) {
      speech.stop();
      return;
    }
    speech.toggle();
  }

  async function ask(nextItems: ChatItem[]) {
    setPending(true);
    try {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          area,
          mode: modeRef.current,
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
        // 问答模式也允许打开核对页；工作模式办理后同样跳转。
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
    speech.stop();
    const next = [...items, { role: "user" as const, content }];
    setItems(next);
    setDraft("");
    draftCommittedRef.current = "";
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
          className="xx-panel fixed z-[71] flex h-[min(560px,72vh)] max-[900px]:h-[min(620px,78dvh)] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[22px] border border-[var(--line)] bg-white shadow-[0_22px_60px_rgba(23,52,58,.22)] print:hidden"
          style={
            panel.point
              ? { left: panel.point.x, top: panel.point.y }
              : { right: 16, bottom: 96 + keyboardInset }
          }
        >
          <header
            onPointerDown={panel.onPointerDown}
            className="flex cursor-grab touch-none items-center gap-3 bg-[linear-gradient(120deg,#123338_0%,#1a454c_55%,#0f7a6c_160%)] px-3.5 py-3 text-white active:cursor-grabbing"
          >
            <span className="xx-panel-avatar shrink-0">
              <XiaoxingMark size={40} busy={pending} />
            </span>
            <span className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold leading-none">
                小星助教
                <span className="rounded-full bg-[var(--lime)]/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-[var(--lime)]">LIVE</span>
              </h2>
              <p className="mt-1 text-[10px] text-[#b7d4c8]">
                {pending ? "正在思考…" : `按住标题可拖动 · ${mode === "agent" ? "工作模式可办理" : "问答：查询与用法解答"}`}
              </p>
            </span>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                speech.stop();
                setOpen(false);
              }}
              className="min-h-9 min-w-9 touch-manipulation rounded-lg px-2 py-1 text-xs font-bold text-[#d4e1dc]"
            >
              关闭
            </button>
          </header>
          <div
            className="flex items-center gap-1 border-b border-[var(--line)] bg-[#f7faf8] px-3 py-2"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span className="mr-1 text-[10px] font-bold text-[var(--muted)]">模式</span>
            <button
              type="button"
              disabled={pending || waitingConfirm}
              onClick={() => switchMode("ask")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${mode === "ask" ? "bg-[var(--teal)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
            >
              问答
            </button>
            <button
              type="button"
              disabled={pending || waitingConfirm}
              onClick={() => switchMode("agent")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${mode === "agent" ? "bg-[var(--navy)] text-white" : "border border-[var(--line)] bg-white text-[#385058]"}`}
            >
              工作
            </button>
            <span className="ml-auto text-[10px] text-[var(--muted)]">{mode === "ask" ? "查询·用法·不写入" : "查完可确认执行"}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {items.length === 0 ? (
              <p className="text-xs leading-6 text-[var(--muted)]">
                {area === "parent"
                  ? mode === "ask"
                    ? "问答模式：可查已绑定孩子的课表、出勤、报告、作业与通知；也可问怎么请假、为什么看不到报告等用法问题。不会写入。要请假或回报告请切到「工作」。"
                    : "工作模式：可请假、取消请假、回复报告、标消息已读。我会查齐信息并弹出确认卡，你点确认后才写入。不能办教务或交费。"
                  : mode === "ask"
                    ? "问答模式：可查名单、课表、报告并打开核对页；也可当用法助手，问怎么报名、报告何时对家长可见、问答与工作模式区别等。不会写入。要报名、排课、点名请切到「工作」。"
                    : "工作模式：直接说要办的事。我会查齐信息并弹出确认卡，你点确认后才写入。财务收款与邀请码仍须在页面操作。"}
              </p>
            ) : null}
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
            {pending ? (
              <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <XiaoxingMark size={18} busy />
                小星助教正在想…
              </p>
            ) : null}
          </div>
          <form
            className="border-t border-[var(--line)] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            {speech.error ? (
              <p className="mb-2 text-[11px] leading-5 text-[#a34b3b]" role="status">
                {speech.error}
              </p>
            ) : null}
            {speech.listening ? (
              <p className="mb-2 text-[11px] font-bold leading-5 text-[var(--teal)]" role="status">
                正在听…再说完可点麦克风停止，核对后点发送
              </p>
            ) : null}
            <div className="flex items-stretch gap-2">
              <input
                value={draft}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value);
                  draftCommittedRef.current = value;
                  if (speech.error) speech.setError("");
                }}
                placeholder={
                  waitingConfirm
                    ? "请先确认或取消上面的操作"
                    : speech.listening
                      ? "说出你的问题或要办的事…"
                      : area === "parent"
                        ? mode === "ask"
                          ? "问答：查课表，或问怎么请假、为何看不到报告…"
                          : "工作：帮林子涵请假、回复报告…"
                        : mode === "ask"
                          ? "问答：查谁欠费，或问怎么报名、报告何时可见…"
                          : "工作：给林子涵排课、点名…"
                }
                disabled={pending || waitingConfirm}
                className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)] disabled:bg-[#f4f6f5]"
              />
              {speech.supported ? (
                <button
                  type="button"
                  aria-label={speech.listening ? "停止语音输入" : "语音输入"}
                  aria-pressed={speech.listening}
                  title={speech.listening ? "停止语音输入" : "语音输入（手机/平板/电脑）"}
                  disabled={pending || waitingConfirm}
                  onClick={toggleMic}
                  className={`grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-[10px] border text-[var(--ink)] disabled:opacity-60 ${
                    speech.listening
                      ? "border-[var(--teal)] bg-[#e7f3ee] text-[var(--teal)]"
                      : "border-[var(--line)] bg-white"
                  }`}
                >
                  <MicIcon listening={speech.listening} />
                </button>
              ) : null}
              <button
                type="submit"
                disabled={pending || waitingConfirm || !draft.trim()}
                className="h-11 shrink-0 touch-manipulation rounded-[10px] bg-[var(--teal)] px-3.5 text-xs font-bold text-white disabled:opacity-60"
              >
                发送
              </button>
            </div>
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
        className={`xx-launcher fixed z-[70] flex h-10 cursor-grab touch-none items-center gap-1.5 overflow-hidden rounded-full bg-[var(--navy)] py-1 pl-1 pr-3 text-white print:hidden active:cursor-grabbing ${open ? "xx-launcher--open" : ""}`}
        style={
          launcher.point
            ? { left: launcher.point.x, top: launcher.point.y, right: "auto", bottom: "auto" }
            : { right: 20, bottom: 20, left: "auto", top: "auto" }
        }
      >
        <XiaoxingMark size={32} busy={pending && open} />
        <span className="xx-launcher__label text-[13px] font-extrabold leading-none">AI小星</span>
      </button>
    </>
  );
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={listening ? "animate-pulse" : undefined}>
      <path
        d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
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
