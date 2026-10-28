import assert from "node:assert/strict";
import test from "node:test";
import {
  inferOccurredAtFromBody,
  legacyNoticeParams,
  noticeListHref,
  noticeOrderBy,
  noticeWhere,
  parseNoticeKind,
  parseNoticeOrder,
  parseNoticeStatus,
} from "../lib/parent-notices-ui.ts";

test("消息状态/类型解析与旧 tab 兼容", () => {
  assert.equal(parseNoticeStatus(undefined), "all");
  assert.equal(parseNoticeStatus("unread"), "unread");
  assert.equal(parseNoticeStatus("read"), "read");
  assert.equal(parseNoticeStatus("nope"), "all");
  assert.equal(parseNoticeKind("EXAM"), "EXAM");
  assert.equal(parseNoticeKind("nope"), "all");
  assert.equal(parseNoticeOrder("asc"), "asc");
  assert.equal(parseNoticeOrder(undefined), "desc");
  assert.deepEqual(legacyNoticeParams("unread"), { status: "unread" });
  assert.deepEqual(legacyNoticeParams("HOMEWORK"), { kind: "HOMEWORK" });
});

test("消息筛选与排序：已读可叠加类型，按 occurredAt 排序", () => {
  assert.deepEqual(
    noticeWhere({ organizationId: "o1", parentUserId: "p1", status: "read", kind: "EXAM" }),
    {
      organizationId: "o1",
      parentUserId: "p1",
      readAt: { not: null },
      kind: "EXAM",
    },
  );
  assert.deepEqual(
    noticeWhere({ organizationId: "o1", parentUserId: "p1", status: "unread", kind: "all" }),
    {
      organizationId: "o1",
      parentUserId: "p1",
      readAt: null,
    },
  );
  assert.deepEqual(noticeOrderBy("desc"), [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(noticeOrderBy("asc"), [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }]);
});

test("消息链接保留状态、类型与时间排序", () => {
  assert.equal(noticeListHref({}), "/parent/notices");
  assert.equal(noticeListHref({ status: "unread" }), "/parent/notices?status=unread");
  assert.equal(noticeListHref({ status: "read", kind: "EXAM", order: "asc", page: 2 }), "/parent/notices?status=read&kind=EXAM&order=asc&page=2");
  assert.equal(noticeListHref({ kind: "REPORT" }), "/parent/notices?kind=REPORT");
});

test("从正文推断业务时间用于历史回填与可见排序", () => {
  const fallback = new Date("2026-01-01T00:00:00+08:00");
  const exam = inferOccurredAtFromBody("林子涵：2026年10月24日周六「期中」的成绩可以查看", fallback);
  assert.equal(exam.toISOString(), new Date("2026-10-24T12:00:00+08:00").toISOString());
  const bareMonth = inferOccurredAtFromBody("10月20日 15:30的课次有变动", fallback);
  assert.equal(bareMonth.toISOString(), fallback.toISOString());
  const lesson = inferOccurredAtFromBody("林子涵：2026年10月20日 15:30的「口语」布置了作业", fallback);
  assert.equal(lesson.toISOString(), new Date("2026-10-20T15:30:00+08:00").toISOString());
  const short = inferOccurredAtFromBody("林子涵：10/16 16:00「一次函数图像」的作业已完成", fallback);
  assert.equal(short.toISOString(), new Date("2026-10-16T16:00:00+08:00").toISOString());
});
