const missing = "本次记录未提供相关信息。";

export function mockStudentReport(
  studentName: string,
  record: {
    lessonContent: string;
    studentPerformance: string;
    difficulties: string;
    homework: string | null;
  },
) {
  const content = record.lessonContent.trim();
  const performance = record.studentPerformance.trim();
  const difficulties = record.difficulties.trim();
  const homework = record.homework?.trim() ?? "";

  return {
    summary: content
      ? `本节课学习内容：${content}。本报告只针对${studentName}，内容来自本次教学记录，未调用大模型，也没有写入其他学生的信息。`
      : `本次记录未提供教学内容。本报告只针对${studentName}。`,
    strengths: performance ? `${studentName}在本次记录中的表现：${performance}` : missing,
    issues: difficulties || missing,
    nextSteps: difficulties
      ? "下一步只针对本次记录里写到的问题安排一次短练习，并在下一节课复核，不据此作能力判断。"
      : "本次记录没有写出需要改进的问题，建议下一节课补充具体观察后再安排练习。",
    homeworkSummary: homework || "本次记录未提供作业信息。",
    aiModel: "mock",
    promptVersion: "mock-1",
  };
}
