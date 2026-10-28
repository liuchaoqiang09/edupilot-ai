# EduPilot AI

小型培训机构的教学记录与报告工作台。本地开发使用 Next.js、Prisma 和 PostgreSQL。

## 启动本地开发

1. 安装 Node.js 20 或更新版本。
2. 在项目根目录安装依赖。Windows PowerShell 如果拦截 `npm.ps1`，改用 `npm.cmd`。

```bash
npm install
```

3. 复制环境变量模板，并在本机填写，不要把 `.env` 提交到仓库：

```bash
copy .env.example .env
```

4. 执行已有迁移。这条命令只补齐未应用的迁移，不会清空数据。不要运行 `prisma migrate reset`。

```bash
npx prisma migrate deploy
```

5. 启动开发服务器，然后打开 http://localhost:3000 。

```bash
npm run dev
```

可选：只在开发环境、并且 `.env` 里 `SEED_ENABLED=true` 时，运行 `npm run db:seed` 创建演示机构。生产环境保持 `SEED_ENABLED=false`。

运行自动化测试（核心套件更快）：

```bash
npm.cmd run test:core
```

全量测试：`npm.cmd run test`。小星助教可主动办理教务与教学，但不能主动删除、收款/退费/调课时，或改账号邀请与绑定；详见 `PRODUCT_SPEC.md` 第 1.5 节。

## 环境变量

变量说明以 `.env.example` 为准。需要填写的是：

| 变量 | 用途 |
| --- | --- |
| `APP_URL` | 本机地址，默认 `http://localhost:3000` |
| `AUTH_SECRET` | 登录会话签名。用一串本地随机字符，不要用公开示例 |
| `DATABASE_URL` | PostgreSQL 连接串，例如 Sealos 外网地址。库名写在路径里 |
| `AI_API_KEY` | 服务端调用模型的密钥，只放在 `.env` |
| `AI_BASE_URL` | OpenAI 兼容地址。DeepSeek 可填 `https://api.deepseek.com` |
| `AI_MODEL` | 模型名，例如 `deepseek-chat` |
| `AI_TIMEOUT_MS` | 单次生成超时，默认 30000 |
| `SEED_ENABLED` | 是否允许运行演示种子。生产必须为 `false` |

没有 `AI_API_KEY` 时，教学记录仍可保存；点击生成报告会失败，并可以重试。

## 数据库

业务表在 PostgreSQL schema `edupilot` 中。迁移文件位于 `prisma/migrations`。部署或换一台机器时，配置好 `DATABASE_URL` 后再执行 `npx prisma migrate deploy`。

## 课次保留一年

页面上的课表和「查看历史课表」只查询最近一年的 `LessonSession`。这样控制数据库容量，一年内的课次和考勤可以随时按日期、教师、班级查看。

超过一年的课次不会在页面上删除。清理只发生在归档脚本里：先把课次、考勤、课堂记录和教学报告导出到本地 `backups/`（JSONL 与 CSV），读回并核对条数，确认文件可读之后，才从数据库删掉这批已经导出的旧课次。导出失败或条数不一致时不会删除。`backups/` 不提交到仓库，以后可以改成上传到对象存储。

页面和接口都不提供这条清理操作。脚本按系统时间处理全部机构的超期课次，不接受外部传入的机构编号。

先看会清理多少条、但不写文件、也不删除：

```bash
npm run lessons:archive -- --dry-run
```

确认后再执行。生产环境同样必须带上这个确认变量：

```powershell
$env:ARCHIVE_CONFIRM='yes'; npm.cmd run lessons:archive
```

可以用系统计划任务或 cron 定期运行上面的确认命令。目前排课使用「设定规则自动生成」。以后如果要做 Excel 导入，流程是：下载 Excel 模板、填写周期规则、上传后批量识别。

## 周视图范围

「排课 / 课表」的周视图默认是本周，每次只向数据库查询这一周。往前最多两周；更早的课次用「查看历史课表」。往后翻周不限，用来看已经排好的学期。
