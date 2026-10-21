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
