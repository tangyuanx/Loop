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
- 设置中的“数据”可导出 `.loopbackup` 工作区备份，支持密码加密，并显示绑定笔记和资源的覆盖数量。
- 已有工作区缺失、损坏或超出当前版本支持范围时进入只读保护，并保留原始文件与恢复入口。
- 任务和节点的变更保存在处理历史中，结论与记录可以查看前后版本并恢复。最近删除保留任务、节点与笔记的恢复材料。
- 首次启动不预置任务数据，从空列表开始记录。
- 设置中的“帮助与反馈 → 反馈问题”可以将用户主动填写的问题提交到独立服务，并自动创建 GitHub Issue。

## 下载和安装

正式可下载版本通过 GitHub Releases 分发。进入仓库的 Releases 页面，下载对应系统的安装包：

- macOS: 下载 `.dmg` 或 `.zip`。
- Windows: 下载 `.exe` 安装包。

安装版可在「设置 → 软件更新」自动或手动检查新版本，并查看跨版本更新说明。

- macOS 点击「下载并更新」后，Loop 会校验 DMG、保存并备份工作区，退出后打开安装包。把 Loop 拖进「应用程序」并确认替换。替换完成后会尝试打开新版并执行升级自检。首次打开未公证的下载版本时，可能需要按 macOS 提示在「系统设置 → 隐私与安全性」确认「仍要打开」。Loop 收到新版窗口的启动确认后才清理本次下载。
- Windows 下载后可继续使用，由你点击「安装并重启」才保存并进入安装。

Loop 通过 GitHub Releases 分发。任务数据仍只保存在本机；仅当用户主动确认并提交 Bug 反馈时，应用才会把反馈表单和可选的基础环境信息发送到独立反馈服务。

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

版本发布统一遵循 [`RELEASE.md`](RELEASE.md)：本地针对性测试与真实应用验收，更新版本并推送 main 和 `v*` 标签，再由云端完成完整检查、双平台打包、实际包测试和发布文件校验。常规发布不重复本地双平台打包。

`main`、PR 和手动触发的 `Check Desktop Apps` 负责应用检查；纯 Markdown / `docs/` 提交自动跳过。标签触发的 `Release Desktop Apps` 在所有门禁通过后公开 GitHub Release。Windows 安装包允许选择安装目录；为保持旧版原位升级兼容，内部安装目录继续使用 `Personal Task Track`，可见的软件名、快捷方式、程序文件和图标均为 Loop。

## 数据说明

桌面应用通过 Electron 主进程读写本机 JSON 文件。典型路径如下：

- macOS: `~/Library/Application Support/Personal Task Track/task-data.json`
- Windows: `%APPDATA%/Personal Task Track/task-data.json`

为保证旧版本升级后仍能直接读取既有任务，Loop 继续沿用原来的 `Personal Task Track` 数据目录；这只影响本机存储路径，应用界面和安装包名称均为 Loop。

Windows 应用内升级会在卸载旧程序前备份所有应用管理的数据，校验失败时停止安装。安全副本保留在 `%APPDATA%/Personal Task Track Upgrade Backups`，并复制到当前安装目录的 `Loop Data Backups` 文件夹。首次启动只在当前路径没有已初始化的工作区时检查历史数据目录，已有任务文件和工作区标记均会阻止自动替换。多个历史目录需要用户选择。

日常修改先写入同目录的独占临时文件，确认文件写入后再替换任务库。图片按内容摘要保存在 `image-assets/`，任务、恢复草稿与历史中的图片使用引用。已有内嵌图片在保存时迁移并保持可读。正式 Markdown 的自包含附件仍保存在笔记目录。历史和最近删除增加的空间随记录增长，应用保留这些内容直到用户明确处理。

应用每天生成一个本机恢复点，位于工作区的 `workspace-snapshots/`。新备份校验成功后，按最多三份、约 512 MiB 轮转；超过预算时仍保留最近有效的一份。自动恢复点保存应用管理的内容及外部文件绑定。设置可查看用量和最近可用时间，并恢复最近一次本机备份。同设备的副本用于本机故障恢复，设备损坏时需使用保存到独立位置的备份。

迁移设备时，在设置 → 数据中选择“导出备份”。新版备份流式压缩任务、历史、恢复草稿、托管资源和绑定 Markdown 的可移植相对附件。导出前会说明将复制的文件范围，完成后列出缺失或不可迁移内容的数量。恢复会在工作区内的 `workspace-notes/` 重建所包含的笔记及其资源，保留缓存正文和原有冲突依据，并重新关联路径。密码留空生成普通备份；填写密码生成 AES-256-GCM 加密备份，恢复时需填写原密码，应用不保存密码。

仍可恢复旧版 `.loopbackup` 文件和备份目录。带清单的目录按原清单校验；没有清单的旧目录会标记来源，包含多个备份时需要选择具体目录。恢复前先保留当前数据，校验整个候选后才切换，进程中断后根据持久化恢复记录继续或回退。只读保护入口可在当前工作区无法保存时直接选择恢复材料。

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
