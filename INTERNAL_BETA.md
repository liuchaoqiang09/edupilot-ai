# EduPilot AI 封闭内测手册

本手册保证**不改登录界面**的前提下，把环境、数据、探活和备份做到可对外给熟人试用。短信邀请、自助注册不在本轮范围。

## 内测账号（三端同密）

| 邮箱 | 角色 |
| --- | --- |
| `demo_owner@edupilot.test` | 负责人 |
| `demo_teacher@edupilot.test` | 教师 |
| `demo_parent@edupilot.test` | 家长 |

密码与本地 seed 相同：`edupilot2026`。

约定：链接只发给内测名单；只用虚构学生数据；不要公开搜索引擎收录。

## 上线前检查清单

按顺序执行（Windows PowerShell 可用 `npm.cmd`）：

1. 复制 `.env.example` → `.env`，填写：
   - `NODE_ENV=production`（正式内测进程）
   - 强随机 `AUTH_SECRET`（≥16 字符）
   - 真实 `DATABASE_URL`
   - `APP_URL=https://你的内测域名`
   - `SEED_ENABLED=false`
   - 若要测报告 / 小星：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`
2. 安装依赖：`npm.cmd install`
3. 迁移：`npx prisma migrate deploy`
4. 预检：`npm.cmd run beta:preflight`（必须退出码 0）
5. 写入演示机构（仅当库中还没有三账号）：

```powershell
$env:ALLOW_BETA_DEMO='yes'; npm.cmd run beta:ensure-demo
```

   已有三账号只需重置密码时：

```powershell
$env:ALLOW_BETA_DEMO='yes'; npm.cmd run beta:ensure-demo -- --reset-passwords
```

6. 构建并启动：`npm.cmd run build` → `npm.cmd start`
7. 探活：浏览器或 curl 打开 `GET /api/health`，期望 `database`/`uploads`/`authSecret` 均为可用；`aiConfigured` 为 true 才能测 AI。
8. 自己先跑主路径：负责人排课 → 教师点名/签到 → 教学记录 → 生成并发布报告 → 家长查看。

## 必须持久化的目录

相对应用工作目录挂载卷（容器重建也不丢）：

- `uploads/homework-assets/`
- `uploads/report-photos/`
- `backups/`

应用启动时会尝试自动创建这些目录；不可写时 `/api/health` 会返回 503。

## 备份与回滚

- **数据库**：在 Sealos / 托管控制台开启自动备份；出事前至少确认能看到最近一份备份。恢复按厂商文档操作，恢复后重新 `migrate deploy`（若版本有差）。
- **上传文件**：与数据库备份同频率拷贝上述 `uploads/`（否则报告照片、作业附件会对不上）。
- **演示数据重来**：不要在生产跑 `db:seed`（会拒绝或清空逻辑不安全）。用 `beta:ensure-demo`；若演示机构已脏且需整机构重灌，优先从库备份回滚，或在**空库**上重新 `beta:ensure-demo`。

## 明确不做（本轮）

- 不改登录页文案 / 一键入口逻辑
- 不接真实短信；不用手机验证码登录 / 邀请兑码做内测开户
- 不做微信推送、线上支付、多机构自助开通

## 给测试员的一句话

用上面三个邮箱和统一密码分别进负责人、教师、家长；站内消息即可，没有短信提醒；发现问题记「谁、哪一页、点了什么、期望/实际」。

## 相关命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run beta:preflight` | 上线前预检 |
| `ALLOW_BETA_DEMO=yes npm run beta:ensure-demo` | 写入或确认演示三账号 |
| `npx prisma migrate deploy` | 应用迁移 |
| `GET /api/health` | 运行中探活 |
| `npm run test:core` | 核心自动化回归 |
