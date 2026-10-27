import OpenAI from "openai";

const fields = ["summary", "strengths", "issues", "nextSteps", "homeworkSummary"] as const;

export type GeneratedReport = Record<(typeof fields)[number], string> & {
  aiModel: string;
  promptVersion: string;
};

export class AiReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiReportError";
  }
}

const promptVersion = "deepseek-json-2";

export type ReportLanguage = "zh-CN" | "en";

export type HistorySummary = {
  label: string;
  summary: string;
};

export function normalizeReportLanguage(value: string | null | undefined): ReportLanguage {
  return value === "en" ? "en" : "zh-CN";
}

const copy = {
  "zh-CN": {
    student: "该同学",
    missing: "本次记录未提供相关信息。",
    system: [
      "你是培训机构的教学记录整理助手。",
      "只根据用户给出的材料整理一份学生报告，并且只返回一个 JSON 对象。",
      "不要使用 Markdown，不要加解释，不要输出 JSON 以外的文字。",
      "JSON 必须包含这五个字符串字段：summary、strengths、issues、nextSteps、homeworkSummary。",
      "使用清楚、具体、适合家长阅读的简体中文。",
      "不得编造分数、出勤、家庭情况、历史进步或记录里没有的事实。",
      "不得做医疗、心理或能力诊断，不得给学生贴羞辱性标签。",
      "文中不要出现学生真实姓名，统一用“该同学”。不要写其他学生的表现。",
      "某个字段没有依据时，该字段只写“本次记录未提供相关信息。”",
      "历史摘要只作为背景。不要把历史课次写成这节课新发生的事。",
    ].join(""),
    lead: "请只根据下面的材料，为“该同学”整理报告。",
    fields: ["本节课内容", "该同学的表现", "遇到的问题", "作业"],
    history: "同一学员最近相关课程的已确认内容（只能作背景，不能写成这节课新发生的事实）：",
  },
  en: {
    student: "the student",
    missing: "This record does not include that information.",
    system: [
      "You organize lesson notes for a tutoring center.",
      "Use only the material provided, and return one JSON object.",
      "Do not use Markdown, explanations, or any text outside the JSON.",
      "The JSON must contain these five string fields: summary, strengths, issues, nextSteps, homeworkSummary.",
      "Write clear, specific English that a parent can read.",
      "Do not invent scores, attendance, family circumstances, progress, or facts that are not in the material.",
      "Do not make medical, psychological, or ability diagnoses, and do not apply humiliating labels.",
      "Do not use the student's real name. Use “the student”. Do not describe other students.",
      "If a field has no evidence, write only “This record does not include that information.”",
      "Earlier summaries are background only. Do not present them as events from this lesson.",
    ].join(""),
    lead: "Prepare the report for “the student” using only the material below.",
    fields: ["Lesson content", "This student's performance", "Difficulties", "Homework"],
    history: "Confirmed notes from this student's recent related lessons (background only, not new events in this lesson):",
  },
} as const;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new AiReportError("AI 尚未配置完成，教学记录已保留。请稍后重试。");
  return value;
}

function baseUrl() {
  const value = requiredEnv("AI_BASE_URL").replace(/\/+$/, "");
  return value.endsWith("/v1") ? value : `${value}/v1`;
}

function timeoutMs() {
  const value = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 ? value : 30000;
}

export function redactStudentNames(text: string, names: string[], replacement = "该同学") {
  const unique = [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2))].sort(
    (left, right) => right.length - left.length,
  );
  return unique.reduce((result, name) => result.split(name).join(replacement), text);
}

/** Strip markup before any model call so injected tags cannot shape the prompt. */
export function stripPromptMarkup(text: string) {
  return text
    .replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, " ")
    .replace(/<\s*style[\s\S]*?>[\s\S]*?<\s*\/\s*style\s*>/gi, " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, placeholder: string, max = 2000) {
  const text = stripPromptMarkup(value).trim();
  return text ? text.slice(0, max) : placeholder;
}

function parseReport(content: string, model: string): GeneratedReport {
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiReportError("模型返回的内容无法读取，教学记录已保留。请重试。");

  let value: unknown;
  try {
    value = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AiReportError("模型返回的内容无法读取，教学记录已保留。请重试。");
  }
  if (!value || typeof value !== "object") throw new AiReportError("模型返回的内容无法读取，教学记录已保留。请重试。");

  const source = value as Record<string, unknown>;
  const report = {
    summary: "",
    strengths: "",
    issues: "",
    nextSteps: "",
    homeworkSummary: "",
    aiModel: model,
    promptVersion,
  };
  for (const field of fields) {
    const item = source[field];
    if (typeof item !== "string" || !item.trim()) {
      throw new AiReportError("模型返回的内容不完整，教学记录已保留。请重试。");
    }
    report[field] = clip(item, copy["zh-CN"].missing);
  }
  return report;
}

export function buildLessonAnalysisPrompt(input: {
  language: ReportLanguage;
  useRecentSummaries: boolean;
  history: HistorySummary[];
  lessonContent: string;
  studentPerformance: string;
  difficulties: string;
  homework: string;
  studentNames: string[];
}) {
  const text = copy[input.language];
  const redact = (value: string, max = 2000) =>
    clip(redactStudentNames(stripPromptMarkup(value), input.studentNames, text.student), text.missing, max);
  const lines = [
    text.lead,
    `${text.fields[0]}：${redact(input.lessonContent)}`,
    `${text.fields[1]}：${redact(input.studentPerformance)}`,
    `${text.fields[2]}：${redact(input.difficulties)}`,
    `${text.fields[3]}：${redact(input.homework)}`,
  ];
  const history = input.useRecentSummaries
    ? input.history.filter((item) => item.summary.trim()).slice(0, 3)
    : [];
  if (history.length > 0) {
    lines.push(text.history);
    history.forEach((item, index) => {
      lines.push(`${index + 1}. ${redact(item.label, 80)}：${redact(item.summary, 500)}`);
    });
  }
  return { system: text.system, user: lines.join("\n") };
}

export async function generateLessonAnalysis(input: {
  language: ReportLanguage;
  useRecentSummaries: boolean;
  history: HistorySummary[];
  lessonContent: string;
  studentPerformance: string;
  difficulties: string;
  homework: string;
  studentNames: string[];
}): Promise<GeneratedReport> {
  const model = requiredEnv("AI_MODEL");
  const client = new OpenAI({
    apiKey: requiredEnv("AI_API_KEY"),
    baseURL: baseUrl(),
    timeout: timeoutMs(),
    maxRetries: 0,
  });
  const prompt = buildLessonAnalysisPrompt(input);

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    return parseReport(content, model);
  } catch (error) {
    if (error instanceof AiReportError) throw error;
    if (error instanceof OpenAI.APIConnectionTimeoutError || (error instanceof Error && error.name === "TimeoutError")) {
      throw new AiReportError("生成超时，教学记录已保留。请稍后重试。");
    }
    throw new AiReportError("生成失败，教学记录已保留。请稍后重试。");
  }
}
