/** 教师/家长工作台个人偏好（本机 localStorage） */

export type XiaoxingModePref = "ask" | "agent";

export type TeacherWorkspacePrefs = {
  scheduleView: "day" | "week";
  preferAttendanceDesk: boolean;
  recordsPendingFirst: boolean;
  reportsDraftFirst: boolean;
  xiaoxingMode: XiaoxingModePref;
};

export type ParentWorkspacePrefs = {
  rememberChild: boolean;
  scheduleNewestFirst: boolean;
  noticesUnreadFirst: boolean;
  xiaoxingMode: XiaoxingModePref;
};

const TEACHER_KEY = "edupilot-teacher-workspace-prefs";
const PARENT_KEY = "edupilot-parent-workspace-prefs";

export const defaultTeacherPrefs = (): TeacherWorkspacePrefs => ({
  scheduleView: "day",
  preferAttendanceDesk: false,
  recordsPendingFirst: true,
  reportsDraftFirst: true,
  xiaoxingMode: "agent",
});

export const defaultParentPrefs = (): ParentWorkspacePrefs => ({
  rememberChild: true,
  scheduleNewestFirst: false,
  noticesUnreadFirst: true,
  xiaoxingMode: "ask",
});

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadTeacherPrefs() {
  const prefs = readJson(TEACHER_KEY, defaultTeacherPrefs());
  try {
    const mode = window.localStorage.getItem("edupilot-xiaoxing-mode-teacher");
    if (mode === "ask" || mode === "agent") prefs.xiaoxingMode = mode;
  } catch {
    /* ignore */
  }
  return prefs;
}

export function saveTeacherPrefs(prefs: TeacherWorkspacePrefs) {
  writeJson(TEACHER_KEY, prefs);
  try {
    window.localStorage.setItem("edupilot-xiaoxing-mode-teacher", prefs.xiaoxingMode);
  } catch {
    /* ignore */
  }
}

export function loadParentPrefs() {
  const prefs = readJson(PARENT_KEY, defaultParentPrefs());
  try {
    const mode = window.localStorage.getItem("edupilot-xiaoxing-mode-parent");
    if (mode === "ask" || mode === "agent") prefs.xiaoxingMode = mode;
  } catch {
    /* ignore */
  }
  return prefs;
}

export function saveParentPrefs(prefs: ParentWorkspacePrefs) {
  writeJson(PARENT_KEY, prefs);
  try {
    window.localStorage.setItem("edupilot-xiaoxing-mode-parent", prefs.xiaoxingMode);
  } catch {
    /* ignore */
  }
}
