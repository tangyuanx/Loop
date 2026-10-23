# Bug Report Server

Loop 的独立 Bug 反馈服务。客户端只向本服务提交白名单字段；本服务持有 GitHub 凭据并调用 GitHub REST API 创建 Issue。

项目仓库为 `tangyuanx/Loop`。部署配置使用 `GITHUB_REPO=Loop`；旧配置中的 `tangyuanx/personal-task-track` 会自动映射到新仓库，其他仓库配置保持原样。

## 本地开发

```bash
cp .env.example .env.local
set -a
. ./.env.local
set +a
npm install
npm run dev
```

服务提供：

- `GET /health`
- `POST /api/bug-reports`

桌面客户端开发环境默认连接 `http://127.0.0.1:3000`。连接其他服务时，在启动桌面应用前设置 `BUG_REPORT_API_URL`；非本机地址必须使用 HTTPS。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 是 | 仅保存于服务端的 Fine-grained Token |
| `GITHUB_OWNER` | 是 | 默认 `tangyuanx` |
| `GITHUB_REPO` | 是 | 默认 `Loop` |
| `PORT` | 否 | 默认 `3000` |
| `ALLOWED_ORIGINS` | 否 | 逗号分隔的浏览器 Origin 白名单；桌面主进程请求不带 Origin，可留空 |
| `GITHUB_TIMEOUT_MS` | 否 | GitHub 请求超时，默认 10000ms，范围 100～30000ms |

不要创建或提交含真实 Token 的 `.env`。仓库已忽略 `.env`、`.env.*`、日志和依赖目录。

## Fine-grained Token

1. 打开 GitHub `Settings → Developer settings → Personal access tokens → Fine-grained tokens`，创建新 Token。
2. Resource owner 选择 `tangyuanx`，Repository access 选择 `Only select repositories`，只勾选 `Loop`。
3. Repository permissions 只将 `Issues` 设置为 `Read and write`，其余权限保持 `No access`。
4. 设置尽可能短的有效期，生成后立即存入部署平台的加密 Secret `GITHUB_TOKEN`。

GitHub 官方文档确认创建 Issue 的最小仓库权限为 `Issues: write`：

- https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#create-an-issue
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

## 测试与构建

```bash
npm run check
```

测试使用 mock GitHub API，不会创建真实 Issue。

## 部署

Node.js 20+：

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

Docker：

```bash
docker build -t loop-bug-report-server .
docker run --rm -p 3000:3000 \
  -e GITHUB_TOKEN \
  -e GITHUB_OWNER=tangyuanx \
  -e GITHUB_REPO=Loop \
  loop-bug-report-server
```

生产部署必须放在 HTTPS 入口之后，并在平台 Secret 中配置 `GITHUB_TOKEN`。部署完成后先检查 `/health`，再将桌面端运行环境的 `BUG_REPORT_API_URL` 指向该 HTTPS 域名。服务本身不记录联系方式、Authorization 请求头或 GitHub Token。
