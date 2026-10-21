# EduPilot AI 实施计划

> 阶段 0 产出。只描述现状和建议，尚未创建应用代码。  
> 检查时间：2026-10-21。等待确认后再进入阶段 1。

## 1. 已阅读的产品范围

已完整读取根目录 `PRODUCT_SPEC.md`（约 902 行，第 1–19 节），不是只看到文件名。

MVP 闭环：负责人排课 → 教师记录课堂 → AI 起草报告 → 教师确认并发布 → 家长查看已绑定孩子的已发布报告。

第一版角色：机构负责人（OWNER）、教师（TEACHER）、家长（PARENT）。数据按机构隔离；家长还要校验与学生的绑定关系。AI 只生成草稿，不能自动改排课、考勤或档案，也不能把未发布内容给家长。

暂不实现：多校区、复杂财务、支付、CRM、向量库、多智能体、原生 App、短信推送。

## 2. 当前项目状态

目录：`C:\Users\86150\OneDrive\Desktop\EduPilotAI`

| 检查项 | 结果 |
| --- | --- |
| 应用代码 | 无。没有 `src`、`app`、页面或 API |
| 依赖与锁文件 | 无 `package.json`、`package-lock.json`、`node_modules` |
| 运行脚本 | 无 |
| 认证 | 无 |
| 数据库客户端 / 迁移 | 无 |
| 环境变量 | 无 `.env`、`.env.local`、`.env.example`（本文件创建前） |
| Git | 不是 Git 仓库 |
| 可复用代码 | 仅 `PRODUCT_SPEC.md`，已保留 |

本机工具（本次实际执行）：

- Windows，PowerShell
- Node.js v24.14.0
- npm 11.9.0（有一条 `devdir` 未知配置警告，不影响当前检查）
- Git 2.53.0.windows.2

数据库：按你的说明，计划使用 Sealos Cloud PostgreSQL。本次没有探测数据库是否已创建，也没有尝试连接。连接是否成功仍未知。

未删除任何文件，未执行迁移或清库。

## 3. 建议的最小技术栈

阶段 1 确认后再初始化，本阶段不安装依赖。

| 选择 | 用途 | 原因 |
| --- | --- | --- |
| Next.js（App Router）+ TypeScript | 单体 Web 应用 | 页面和服务端逻辑在同一项目，适合 MVP，不拆微服务 |
| React | 界面 | 随 Next.js 使用 |
| PostgreSQL | 业务数据 | 与 Sealos 计划一致，适合机构、课次、报告这类关系数据 |
| Prisma | 模型与迁移 | 迁移文件可纳入版本控制，重复执行时不会靠“删库重建” |
| 服务端会话 + 密码哈希 | 登录 | 密码不明文保存；会话在服务端校验。具体库在阶段 1 选定成熟方案（优先 Auth.js Credentials 或等价方案） |
| 单一 OpenAI 兼容 Chat API | AI 报告 | 只在服务端调用，密钥放环境变量 |

不引入：独立后端、Redis、向量数据库、消息队列、支付 SDK、邮件服务。

主要影响：阶段 1 会在此目录新增 `package.json`、应用源码、Prisma schema 和迁移。现有 `PRODUCT_SPEC.md` 保持不动。

## 4. 计划中的主要文件

阶段 1 才会创建，此处只作路线图。

```text
app/                      页面与服务端入口
  login/                  统一登录
  owner/ teacher/ parent/ 三个工作空间外壳
lib/auth.ts               会话与角色
lib/tenant.ts             机构隔离查询约束
prisma/schema.prisma      数据模型
prisma/migrations/        版本化迁移
prisma/seed.ts            仅开发环境的虚构种子数据
.env.example              变量名与说明（本阶段已创建）
.gitignore                排除 .env、.env.local、node_modules
```

后续阶段按 `PRODUCT_SPEC.md` 第 15 节推进，一次只做一个阶段：

1. 身份、机构、角色、租户隔离
2. 学生、教师、课程、班级、家长绑定
3. 课次、名单、考勤、时间冲突警告
4. 教学记录与 AI 报告
5. 家长工作空间
6. 工作台统计、机构设置、轻量操作日志
7. 端到端验证与部署说明

## 5. 环境变量

见根目录 `.env.example`。真实值放在本地 `.env`（不提交）。不要把数据库密码或 API Key 发到聊天里。

Sealos PostgreSQL 需要的是一条连接串，而不是把密码写进源码：

`postgresql://用户名:密码@主机:端口/数据库名`

是否启用 SSL 以 Sealos 控制台给出的连接说明为准，常见写法会在连接串末尾带 `sslmode=require`。主机、端口、库名、用户名都从 Sealos 数据库详情页复制到本地 `.env` 的 `DATABASE_URL`。

## 6. 风险

1. **数据库未验证。** 不知道实例是否已创建、白名单是否放行本机、SSL 参数是否正确。阶段 1 在你本地写好 `.env` 之后，只用“能否连接并执行迁移”来验证，不在聊天中交换密码。
2. **项目在 OneDrive 目录。** `node_modules` 同步可能变慢或锁文件。若安装或启动异常，再考虑把项目移出 OneDrive。本阶段不移动目录。
3. **还不是 Git 仓库。** 阶段 1 骨架稳定后应初始化仓库，并忽略 `.env`。本阶段不执行 `git init`。
4. **Node.js 24 较新。** 选定 Next.js / Prisma 版本时要核对对 Node 24 的支持，避免装一个不兼容的旧主版本。
5. **AI 供应商未选定。** 计划用 OpenAI 兼容接口，模型名和地址用环境变量。没有 Key 时，教学记录仍应可保存，报告生成返回可重试错误。

## 7. 阶段 0 验收

- 能说明现状：只有产品文档，没有可启动的应用。
- 没有开发服务器可启动，因为没有 `package.json` 和启动脚本。这不是启动失败，而是项目尚未创建。
- 没有删除原有文件。`PRODUCT_SPEC.md` 仍在。

## 8. 现在如何验证

当前不能 `npm run dev`。可做的检查：

1. 确认根目录有 `PRODUCT_SPEC.md`、`IMPLEMENTATION_PLAN.md`、`.env.example`。
2. 打开 `.env.example`，确认里面没有真实密码或 Key。
3. 在 Sealos 控制台自行确认 PostgreSQL 是否已创建。创建后把连接信息写入本地 `.env`，不要粘贴到聊天。
4. 确认本计划中的技术栈后，再开始阶段 1。

阶段 1 完成并安装依赖后，预期启动方式是在项目根目录执行 `npm install`，配置 `.env`，执行数据库迁移，然后 `npm run dev`。具体命令以阶段 1 实际写入的 `package.json` 为准。在那之前，这些命令会失败，属预期情况。
