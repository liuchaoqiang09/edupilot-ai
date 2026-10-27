import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { formatCourseUsage } from "@/lib/billing-list";
import { calendarDateKey, periodValidity } from "@/lib/course-hours";
import { shanghaiDateKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { studentFacts, studyBadge } from "@/lib/student-profile";

type StudentCard = {
  id: string;
  name: string;
  studentNo: string | null;
  grade: string | null;
  age: number | null;
  status: "ACTIVE" | "INACTIVE";
  archiveReason: string | null;
  enrolled: boolean;
  enrolledInClass: boolean;
  usageText: string;
};

type ClassSection = {
  id: string;
  courseName: string;
  courseId: string;
  billingType: "PER_LESSON" | "PER_PERIOD";
  className: string;
  archived: boolean;
  mine: boolean;
  official: StudentCard[];
  temporary: StudentCard[];
  substitute: StudentCard[];
};

function studentCard(student: {
  id: string;
  name: string;
  studentNo: string | null;
  grade: string | null;
  age: number | null;
  status: "ACTIVE" | "INACTIVE";
  archiveReason: string | null;
  _count: { enrollments: number };
}): StudentCard {
  return {
    id: student.id,
    name: student.name,
    studentNo: student.studentNo,
    grade: student.grade,
    age: student.age,
    status: student.status,
    archiveReason: student.archiveReason,
    enrolled: student._count.enrollments > 0,
    enrolledInClass: false,
    usageText: "未报名",
  };
}

export default async function TeacherStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireRole("TEACHER", "teacher");
  const params = await searchParams;
  const showInactive = params.status === "含已停用";
  const teacher = await prisma.teacher.findFirst({
    where: { userId: user.id, organizationId: user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });

  const [enrollments, lessonRows] = teacher
    ? await Promise.all([
        prisma.enrollment.findMany({
          where: { organizationId: user.organizationId, classGroup: { teacherId: teacher.id } },
          select: {
            classGroupId: true,
            classGroup: { select: { id: true, name: true, status: true, teacherId: true, course: { select: { id: true, name: true, billingType: true } } } },
            student: { select: { id: true, name: true, studentNo: true, grade: true, age: true, status: true, archiveReason: true, _count: { select: { enrollments: true } } } },
          },
        }),
        prisma.lessonStudent.findMany({
          where: {
            organizationId: user.organizationId,
            lessonSession: {
              status: { not: "CANCELLED" },
              OR: [
                { teacherId: teacher.id },
                { classGroup: { teacherId: teacher.id } },
              ],
            },
          },
          select: {
            student: { select: { id: true, name: true, studentNo: true, grade: true, age: true, status: true, archiveReason: true, _count: { select: { enrollments: true } } } },
            lessonSession: {
              select: {
                teacherId: true,
                classGroup: { select: { id: true, name: true, status: true, teacherId: true, course: { select: { id: true, name: true, billingType: true } } } },
              },
            },
          },
        }),
      ])
    : [[], []];

  const sections = new Map<string, ClassSection & { officialIds: Set<string> }>();
  function sectionFor(classGroup: { id: string; name: string; status: "ACTIVE" | "ARCHIVED"; teacherId: string; course: { id: string; name: string; billingType: "PER_LESSON" | "PER_PERIOD" } }) {
    const current = sections.get(classGroup.id);
    if (current) return current;
    const created = {
      id: classGroup.id,
      courseName: classGroup.course.name,
      courseId: classGroup.course.id,
      billingType: classGroup.course.billingType,
      className: classGroup.name,
      archived: classGroup.status === "ARCHIVED",
      mine: classGroup.teacherId === teacher?.id,
      official: [] as StudentCard[],
      temporary: [] as StudentCard[],
      substitute: [] as StudentCard[],
      officialIds: new Set<string>(),
    };
    sections.set(classGroup.id, created);
    return created;
  }

  for (const enrollment of enrollments) {
    if (!enrollment.classGroup || !enrollment.classGroupId) continue;
    const group = sectionFor(enrollment.classGroup);
    if (group.officialIds.has(enrollment.student.id)) continue;
    group.officialIds.add(enrollment.student.id);
    group.official.push({ ...studentCard(enrollment.student), enrolledInClass: true });
  }

  const substituteClassIds = [...new Set(lessonRows.flatMap((row) => row.lessonSession.classGroup.teacherId === teacher?.id ? [] : [row.lessonSession.classGroup.id]))];
  const substituteEnrollments = teacher && substituteClassIds.length
    ? await prisma.enrollment.findMany({
        where: { organizationId: user.organizationId, classGroupId: { in: substituteClassIds } },
        select: { classGroupId: true, studentId: true },
      })
    : [];
  const enrolledInSubstituteClass = new Set(substituteEnrollments.flatMap((enrollment) => enrollment.classGroupId ? [`${enrollment.classGroupId}:${enrollment.studentId}`] : []));

  const temporaryIds = new Map<string, Set<string>>();
  const substituteIds = new Map<string, Set<string>>();
  for (const row of lessonRows) {
    const classGroup = row.lessonSession.classGroup;
    const group = sectionFor(classGroup);
    const card = studentCard(row.student);
    if (group.mine) {
      if (group.officialIds.has(card.id)) continue;
      const seen = temporaryIds.get(classGroup.id) ?? new Set<string>();
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      temporaryIds.set(classGroup.id, seen);
      group.temporary.push(card);
      continue;
    }
    if (row.lessonSession.teacherId !== teacher?.id) continue;
    const seen = substituteIds.get(classGroup.id) ?? new Set<string>();
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    substituteIds.set(classGroup.id, seen);
    group.substitute.push({ ...card, enrolledInClass: enrolledInSubstituteClass.has(`${classGroup.id}:${card.id}`) });
  }

  const courseIds = [...new Set([...sections.values()].map((group) => group.courseId))];
  const studentIds = [...new Set([...sections.values()].flatMap((group) => [...group.official, ...group.temporary, ...group.substitute].map((student) => student.id)))];
  const today = shanghaiDateKey();
  const [balances, courseEnrollments] = teacher && studentIds.length > 0
    ? await Promise.all([
        prisma.courseHourBalance.findMany({
          where: { organizationId: user.organizationId, studentId: { in: studentIds }, courseId: { in: courseIds } },
          select: { studentId: true, courseId: true, remainingHours: true },
        }),
        prisma.enrollment.findMany({
          where: { organizationId: user.organizationId, studentId: { in: studentIds }, courseId: { in: courseIds } },
          select: { studentId: true, courseId: true, startDate: true, endDate: true },
        }),
      ])
    : [[], []];
  const hoursLeft = new Map(balances.map((row) => [`${row.studentId}:${row.courseId}`, row.remainingHours]));
  const enrolledKeys = new Set(courseEnrollments.map((row) => `${row.studentId}:${row.courseId}`));
  const windows = new Map<string, { start: string; end: string }[]>();
  for (const row of courseEnrollments) {
    if (!row.startDate || !row.endDate) continue;
    const key = `${row.studentId}:${row.courseId}`;
    windows.set(key, [...(windows.get(key) ?? []), { start: calendarDateKey(row.startDate), end: calendarDateKey(row.endDate) }]);
  }
  function usageText(studentId: string, courseId: string, billingType: "PER_LESSON" | "PER_PERIOD") {
    const key = `${studentId}:${courseId}`;
    const enrolled = enrolledKeys.has(key);
    if (billingType === "PER_PERIOD") {
      const period = periodValidity(windows.get(key) ?? [], today);
      return formatCourseUsage({
        enrolled,
        billingType,
        periodStatus: enrolled ? period.status : null,
        remainingHours: null,
        validUntil: period.end === "—" ? null : period.end,
      }, today);
    }
    return formatCourseUsage({
      enrolled,
      billingType,
      periodStatus: null,
      remainingHours: enrolled ? hoursLeft.get(key) ?? 0 : null,
      validUntil: null,
    }, today);
  }

  const visible = [...sections.values()]
    .map((group) => ({
      ...group,
      official: group.official.filter((student) => showInactive || student.status === "ACTIVE").map((student) => ({ ...student, usageText: usageText(student.id, group.courseId, group.billingType) })).sort(byName),
      temporary: group.temporary.filter((student) => showInactive || student.status === "ACTIVE").map((student) => ({ ...student, usageText: usageText(student.id, group.courseId, group.billingType) })).sort(byName),
      substitute: group.substitute.filter((student) => showInactive || student.status === "ACTIVE").map((student) => ({ ...student, usageText: usageText(student.id, group.courseId, group.billingType) })).sort(byName),
    }))
    .filter((group) => group.official.length + group.temporary.length + group.substitute.length > 0)
    .sort((left, right) => left.courseName.localeCompare(right.courseName, "zh-CN") || left.className.localeCompare(right.className, "zh-CN"));

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">我的学生</h1>
          <p className="mt-2 max-w-2xl leading-7 text-[var(--muted)]">按课程和班级分开。本班学生是现在报名在这个班、并且你是这个班默认教师的人。临时上课是上过这个班的课、但现在没有报名在这个班的人。代课只列出你代过的那几节课里的学生。</p>
        </div>
        <Link href={showInactive ? "/teacher/students" : "/teacher/students?status=含已停用"} className="rounded-[10px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385058]">
          {showInactive ? "隐藏已停用" : "显示已停用"}
        </Link>
      </div>
      {showInactive ? <p className="mt-4 text-xs font-bold text-[#74838b]">当前正在筛选：包含已停用学生</p> : null}
      {!teacher ? (
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">当前账号还没有关联在职教师档案。</div>
      ) : visible.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-12 text-center text-sm leading-7 text-[var(--muted)]">{showInactive ? "还没有你负责或代过课的学生。" : "目前没有在读学生。可以打开「显示已停用」查看已经停用的学生。"}</div>
      ) : (
        <div className="mt-4 grid gap-4">
          {visible.map((group) => (
            <section key={group.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-[#eef1ee] px-5 py-4">
                <h2 className="text-sm font-semibold">{group.courseName} · {group.className}</h2>
                {group.archived ? <span className="rounded-full bg-[#eef1ee] px-2 py-1 text-[10px] font-bold text-[#74838b]">已归档</span> : null}
                {group.mine ? null : <span className="rounded-full bg-[#f3e9fb] px-2 py-1 text-[10px] font-bold text-[#6b3a86]">代课</span>}
              </div>
              {group.mine ? <StudentGroup title="本班学生" students={group.official} empty="这个班还没有报名学生。" /> : null}
              {group.mine && group.temporary.length > 0 ? <StudentGroup title="临时上课" students={group.temporary} tag="临时上课" /> : null}
              {!group.mine && group.substitute.length > 0 ? <StudentGroup title="代课学生" students={group.substitute} tag="代课" guestTag /> : null}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function byName(left: StudentCard, right: StudentCard) {
  return left.name.localeCompare(right.name, "zh-CN");
}

function StudentGroup({
  title,
  students,
  empty,
  tag,
  guestTag = false,
}: {
  title: string;
  students: StudentCard[];
  empty?: string;
  tag?: string;
  guestTag?: boolean;
}) {
  return (
    <div className="border-b border-[#eef1ee] last:border-b-0">
      <h3 className="px-5 pt-4 text-xs font-bold text-[#51656a]">{title}</h3>
      {students.length === 0 && empty ? <p className="px-5 py-4 text-sm text-[var(--muted)]">{empty}</p> : null}
      <ul>
        {students.map((student) => (
          <li id={`student-${student.id}`} key={student.id} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{student.name}</span>
                {tag ? <span className="rounded-full bg-[#e7eefb] px-2 py-1 text-[10px] font-bold text-[#24548f]">{tag}</span> : null}
                {guestTag && !student.enrolledInClass ? <span className="rounded-full bg-[#fff2df] px-2 py-1 text-[10px] font-bold text-[#9a6729]">非本班报名</span> : null}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">{studentFacts(student.grade, student.age)} · {student.studentNo ?? "无编号"} · {student.usageText}</div>
            </div>
            {student.status === "INACTIVE" ? (
              <div className="text-right">
                <span className="rounded-full bg-[#eef1ee] px-2 py-1 text-[10px] font-bold text-[#74838b]">已停用</span>
                <div className="mt-1 text-xs text-[#74838b]">停用原因：{student.archiveReason?.trim() || "未填写"}</div>
              </div>
            ) : (
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${studyBadge(student.status, student.enrolled).className}`}>
                {studyBadge(student.status, student.enrolled).label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
