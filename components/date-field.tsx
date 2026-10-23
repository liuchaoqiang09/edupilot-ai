"use client";

import { useState } from "react";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isCalendarDate(value: string) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isDateTimeValue(value: string) {
  if (!dateTimePattern.test(value)) return false;
  const [date, time] = value.split("T");
  if (!isCalendarDate(date)) return false;
  const [hour, minute] = time.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function sanitizeDate(raw: string) {
  return raw.replace(/\//g, "-").replace(/[^\d-]/g, "").slice(0, 10);
}

function sanitizeDateTime(raw: string) {
  return raw.replace(/\//g, "-").replace("T", " ").replace(/[^\d\- :]/g, "").slice(0, 16);
}

function toDateTimeValue(text: string) {
  const iso = text.trim().replace(" ", "T");
  return isDateTimeValue(iso) ? iso : "";
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5 2v2.5M11 2v2.5" />
    </svg>
  );
}

export function DateField({
  name,
  value,
  defaultValue = "",
  onChange,
  required,
  className = "",
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const text = controlled ? value : inner;

  function commit(next: string) {
    const cleaned = sanitizeDate(next);
    if (!controlled) setInner(cleaned);
    onChange?.(cleaned);
  }

  return (
    <div className="relative">
      <input
        name={name}
        value={text}
        required={required}
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY-MM-DD"
        pattern="\d{4}-\d{2}-\d{2}"
        title="请输入 YYYY-MM-DD，或点右侧日历选择"
        onChange={(event) => commit(event.target.value)}
        className={className}
        style={{ paddingRight: 40 }}
      />
      <span className="pointer-events-none absolute top-1/2 right-1.5 grid h-7 w-7 -translate-y-1/2 place-items-center text-[#51656a]">
        <CalendarIcon />
      </span>
      <input
        type="date"
        tabIndex={-1}
        aria-label="打开日历"
        value={isCalendarDate(text) ? text : ""}
        onChange={(event) => commit(event.target.value)}
        className="absolute top-1/2 right-1.5 z-10 h-7 w-7 -translate-y-1/2 cursor-pointer opacity-0"
      />
    </div>
  );
}

export function DateTimeField({
  name,
  defaultValue = "",
  onChange,
  required,
  className = "",
}: {
  name: string;
  defaultValue?: string;
  onChange?: () => void;
  required?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(defaultValue.replace("T", " "));
  const stored = toDateTimeValue(text);

  function commit(next: string) {
    setText(sanitizeDateTime(next));
    onChange?.();
  }

  return (
    <div className="relative">
      <input
        value={text}
        required={required}
        autoComplete="off"
        placeholder="YYYY-MM-DD HH:mm"
        pattern="\d{4}-\d{2}-\d{2} \d{2}:\d{2}"
        title="请输入 YYYY-MM-DD HH:mm，或点右侧日历选择"
        onChange={(event) => commit(event.target.value)}
        className={className}
        style={{ paddingRight: 40 }}
      />
      <input type="hidden" name={name} value={stored} />
      <span className="pointer-events-none absolute top-1/2 right-1.5 grid h-7 w-7 -translate-y-1/2 place-items-center text-[#51656a]">
        <CalendarIcon />
      </span>
      <input
        type="datetime-local"
        tabIndex={-1}
        aria-label="打开日历"
        value={stored}
        onChange={(event) => commit(event.target.value)}
        className="absolute top-1/2 right-1.5 z-10 h-7 w-7 -translate-y-1/2 cursor-pointer opacity-0"
      />
    </div>
  );
}
