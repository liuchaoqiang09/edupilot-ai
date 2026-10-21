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

const promptVersion = "deepseek-json-1";
const missing = "本次记录未提供相关信息。";

const systemPrompt = [
  "你是培训机构的教学记录整理助手。",
  "只根据用户给出的本节课文字整理一份学生报告，并且只返回一个 JSON 对象。",
  "不要使用 Markdown，不要加解释，不要输出 JSON 以外的文字。",
  "JSON 必须包含这五个字符串字段：summary、strengths、issues、nextSteps、homeworkSummary。",
  "使用清楚、具体、适合家长阅读的简体中文。",
  "不得编造分数、出勤、家庭情况、历史进步或记录里没有的事实。",
  "不得做医疗、心理或能力诊断，不得给学生贴羞辱性标签。",
  "文中不要出现学生真实姓名，统一用“该同学”。不要写其他学生的表现。",
  "某个字段没有依据时，该字段只写“本次记录未提供相关信息。”",
].join("");

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

export function redactStudentNames(text: string, names: string[]) {
  const unique = [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2))].sort(
    (left, right) => right.length - left.length,
  );
  return unique.reduce((result, name) => result.split(name).join("该同学"), text);
}

function clip(value: string) {
  const text = value.trim();
  return text ? text.slice(0, 2000) : missing;
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
    report[field] = clip(item);
  }
  return report;
}

export async function generateLessonAnalysis(input: {
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
  const record = [
    `本节课内容：${clip(redactStudentNames(input.lessonContent, input.studentNames))}`,
    `该同学的表现：${clip(redactStudentNames(input.studentPerformance, input.studentNames))}`,
    `遇到的问题：${clip(redactStudentNames(input.difficulties, input.studentNames))}`,
    `作业：${clip(redactStudentNames(input.homework, input.studentNames))}`,
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `请只根据下面的本节课文字，为“该同学”整理报告。\n${record}` },
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
