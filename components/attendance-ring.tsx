const tones = {
  PRESENT: "font-bold text-[#34725d]",
  LEAVE: "font-bold text-[#c27b35]",
  ABSENT: "font-bold text-[#b94d4d]",
  LATE: "font-bold text-[#9a6729]",
} as const;

const fields = [
  { status: "PRESENT", label: "出勤" },
  { status: "LEAVE", label: "请假" },
  { status: "ABSENT", label: "缺勤" },
  { status: "LATE", label: "迟到" },
] as const;

type AttendanceStudent = { attendanceStatus: keyof typeof tones | "NOT_MARKED" };

export function attendanceRate(students: AttendanceStudent[], started = true) {
  const total = students.length;
  const unmarked = total === 0 || students.every((student) => student.attendanceStatus === "NOT_MARKED");
  if (!started || unmarked) return null;
  const attended = students.filter((student) => student.attendanceStatus === "PRESENT" || student.attendanceStatus === "LATE").length;
  return Math.round((attended / total) * 100);
}

export function AttendanceBreakdown({ students }: { students: AttendanceStudent[] }) {
  const visible = fields.flatMap((field) => {
    const count = students.filter((student) => student.attendanceStatus === field.status).length;
    return count > 0 ? [{ ...field, count }] : [];
  });
  if (visible.length === 0) return null;
  return (
    <span>
      {visible.map((field, index) => (
        <span key={field.status}>
          {index > 0 ? <span className="text-[var(--muted)]"> | </span> : null}
          <span className={tones[field.status]}>{field.label} {field.count} 人</span>
        </span>
      ))}
    </span>
  );
}

export function AttendanceRing({ rate }: { rate: number | null }) {
  const color = rate === null ? "#c5d0cc" : rate >= 90 ? "#34725d" : rate >= 70 ? "#c27b35" : "#b94d4d";
  const degrees = rate === null ? 0 : rate * 3.6;
  return (
    <span
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(${color} ${degrees}deg, #e4ebe8 0deg)` }}
      title={rate === null ? "未考勤" : `出勤率 ${rate}%`}
    >
      <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white text-[9px] font-extrabold leading-none" style={{ color: rate === null ? "#8a9894" : color }}>
        {rate === null ? "未考勤" : `${rate}%`}
      </span>
    </span>
  );
}
