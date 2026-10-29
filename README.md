# Loop

- 项目仓库：https://github.com/tangyuanx/Loop
- 下载更新：https://github.com/tangyuanx/Loop/releases/latest

Loop 是一个本地优先的个人任务闭环工具，让任务从创建、处理到完成形成清晰循环，面向程序员日常处理问题、拆解子任务、聚焦主线任务、跟踪处理过程、记录判断和沉淀结论的场景。

## 功能

- 左侧任务列表，支持按状态和优先级筛选。
- 右侧处理流，支持无限层级节点。
- 节点支持右键新增下级、同级、标记状态和删除。
- 任务包含背景、当前判断、结论。
- 节点详情支持 Markdown 注释，可记录图片、链接、代码块、表格等内容。
- 支持浅色和深色主题，默认浅色。
- 数据保存在本机应用数据目录中的 `task-data.json`，不依赖云端服务。
- 设置中的“数据迁移与恢复”可导出完整 `.loopbackup` 文件，并可从该文件或升级备份目录恢复全部工作数据。
- 会自动修复可恢复的旧版/异常字段；JSON 损坏时先生成带时间戳的备份，再以空数据安全启动。
- 首次启动不预置任务数据，从空列表开始记录。
- 设置中的“帮助与反馈 → 反馈问题”可以将用户主动填写的问题提交到独立服务，并自动创建 GitHub Issue。

## 下载和安装

正式可下载版本通过 GitHub Releases 分发。进入仓库的 Releases 页面，下载对应系统的安装包：

- macOS: 下载 `.dmg` 或 `.zip`。
- Windows: 下载 `.exe` 安装包。

支持应用内更新的安装版可自动或手动检查新版本。检测到更新后，先点击“下载更新”；下载完成后继续使用应用，由用户点击“安装并重启”才保存数据并进入安装，退出应用也不会自动安装。更新入口与“设置 → 软件更新”会展示当前版本到目标版本之间的更新说明，最新版默认展开，较早版本按版本折叠；说明获取不全时会提示并提供完整发布记录入口。

当前没有做应用商店分发。任务数据仍只保存在本机；仅当用户主动确认并提交 Bug 反馈时，应用才会把反馈表单和可选的基础环境信息发送到独立反馈服务。macOS 未签名版本首次打开时可能会出现系统安全提示，可在 Finder 中右键应用并选择打开。若后续需要双击无提示打开，需要配置 Apple Developer ID 签名和 notarization，但不需要上架 App Store。

## 开发

```bash
npm install
npm run dev
```

Bug 反馈联调需要另开一个终端启动后端：

```bash
cd services/bug-report
npm install
cp .env.example .env.local
# 在 .env.local 中设置服务端 GITHUB_TOKEN
set -a && . ./.env.local && set +a
npm run dev
```

桌面开发环境默认连接 `http://127.0.0.1:3000`。连接已部署服务时：

```bash
BUG_REPORT_API_URL=https://feedback.example.com npm run dev
```

## 检查

```bash
npm run check
```

该命令会重建 Milkdown 资源、检查关键脚本语法，并运行数据持久化、导出、排序和 Markdown 安全回归测试。也可以单独运行：

```bash
npm test
```

## 项目结构

```text
app/            桌面应用本体：Electron 主进程、渲染器和应用资源
services/       可独立部署的配套服务，目前包含 Bug 反馈服务
tests/          桌面应用回归测试
tools/          构建、打包、图标和发布校验工具
docs/           正式架构、交接、需求来源和历史记录文档
prototypes/     不参与生产打包的 Demo、设计系统、截图和 QA 报告
.agents/        项目专用的 Codex/代理技能配置
.github/        持续集成和 GitHub Release 工作流
```

生产应用只从 `app/` 打包；`prototypes/` 中的 HTML 和设计文件仅用于方案回看，不会进入安装包。文档索引见 [`docs/README.md`](docs/README.md)，原型说明见 [`prototypes/README.md`](prototypes/README.md)。

## 构建

macOS:

```bash
npm run dist:mac
```

Windows:

```bash
npm run dist:win
```

仓库内置 GitHub Actions。推送到 `main`、创建 `v*` 标签，或手动触发 workflow 后，会分别在 macOS 和 Windows runner 上构建桌面安装包，并上传为 workflow artifacts。

创建正式下载版本：

```bash
git tag v0.1.0
git push origin v0.1.0
```

标签推送后，`Release Desktop Apps` workflow 会自动构建 macOS 和 Windows 安装包，并上传到 GitHub Release。Windows 安装包允许选择安装目录；为保持旧版原位升级兼容，内部安装目录继续使用 `Personal Task Track`，可见的软件名、快捷方式、程序文件和图标均为 Loop。

## 数据说明

桌面应用通过 Electron 主进程读写本机 JSON 文件。典型路径如下：

- macOS: `~/Library/Application Support/Personal Task Track/task-data.json`
- Windows: `%APPDATA%/Personal Task Track/task-data.json`

为保证旧版本升级后仍能直接读取既有任务，Loop 继续沿用原来的 `Personal Task Track` 数据目录；这只影响本机存储路径，应用界面和安装包名称均为 Loop。

Windows 应用内升级会在卸载旧程序前备份所有应用管理的数据，校验失败时停止安装。安全副本保留在 `%APPDATA%/Personal Task Track Upgrade Backups`，并复制到当前安装目录的 `Loop Data Backups` 文件夹。首次升级后的启动还会检查历史数据目录，只在当前数据库为空或升级后发现历史数据库更完整时执行复制恢复；源数据不会被删除。

手动迁移时，在设置 → 数据迁移与恢复中选择“导出完整备份”。新安装的 Loop 可选择“导入备份文件”，或直接选择 `Loop Data Backups`、`Personal Task Track Upgrade Backups` 等备份目录。导入前会再次备份当前数据，文件内容和 SHA-256 校验通过后才恢复；失败时自动回滚。

任务数据只保存在本机，不会上传到远程服务。浏览器预览模式下会回退使用 `localStorage`，仅用于开发预览。

## Bug 反馈架构

```text
渲染器表单
→ Electron 预加载白名单桥
→ Electron 主进程 POST /api/bug-reports（10 秒超时）
→ 独立 TypeScript/Fastify 服务
→ GitHub REST API
→ tangyuanx/Loop Issue
```

客户端不包含 GitHub Token，不直接调用 GitHub API，也不会将任务数据库、任务标题/内容、笔记、本地文件、Cookie、密码、Token、完整用户目录、日志或附件自动上传。用户允许时只附带软件版本、操作系统、架构、当前模块、提交时间和首次运行生成的随机 UUID 安装标识。

后端位于 `services/bug-report/`，包含本地启动、环境变量、Fine-grained Token 最小权限和 Node/Docker 部署说明。创建 Issue 所需的最小权限是只针对 `Loop` 仓库的 `Issues: Read and write`；详情以 [GitHub Create an issue 文档](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#create-an-issue) 和 [Fine-grained Token 管理文档](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) 为准。

服务端安全边界包括 100KB 请求体、字段长度校验、单 IP 每小时 5 次、CORS 白名单、安全响应头、GitHub 超时/错误转换和统一 JSON 错误；日志不输出 Token、Authorization 请求头或完整联系方式。`.env` 与 `.env.*` 已加入 `.gitignore`，`.env.example` 不含真实凭据。
