# Loop 项目持续交接说明

> 文档性质：**生产项目的持续交接入口（Living Handoff）**
> 当前生产版本：**v0.1.200**
> 当前生产提交：**见标签 `v0.1.200`**
> 最近核对日期：**2026-10-01（Asia/Shanghai）**
> 远程仓库：`git@github.com:tangyuanx/Loop.git`
> 当前生产形态：**Electron 桌面应用 + Vanilla JavaScript + 本地 Milkdown/Crepe**
> 生产数据持久化：Electron `userData/task-data.json`；浏览器预览使用 `localStorage` 降级

---

# 0. 新会话先读这里（当前生产状态，优先级最高）

本节是新会话接手项目时的第一入口。后文第 1～27 节保留了 `prototypes/demos/task-track.html` v1.3.1 原型的完整设计、交互和后端化设想，但它们属于**历史设计基线**，不能覆盖本节描述的当前生产事实。

发生冲突时按以下优先级判断：

1. 用户在当前会话中的最新明确要求；
2. 本节“当前生产状态”；
3. 仓库当前源码、测试和 Git 状态；
4. `docs/history/task_plan.md`、`docs/history/findings.md`、`docs/history/progress.md`；
5. `docs/architecture/FEATURE_MAP.md`（函数地图有用，但行号可能随版本漂移）；
6. 后文 v1.3.1 单文件原型说明和 `prototypes/demos/task-track.html`。

## 0.1 五分钟接手流程

新会话不要从记忆或旧版本号开始工作。依次执行：

```bash
cd /Volumes/T7/work/personal-task-track
git status --short --branch
git fetch origin main --tags
git log --oneline --decorate -n 5
```

然后完整或按需阅读：

```text
docs/handoff/Task_Track_前端项目交接说明.md
                                   当前生产交接入口 + 历史设计基线
docs/history/task_plan.md                    阶段、决策和未完成项
docs/history/progress.md                     最近会话实施与验证记录
docs/history/findings.md                     已确认事实、视觉结论和踩坑记录
docs/architecture/FEATURE_MAP.md                  功能到文件/函数的地图（行号仅供参考）
package.json                    当前版本、依赖、构建和打包配置
```

接手时必须确认：

- 本地 `main` 是否和 `origin/main` 一致；
- 是否有用户未提交文件，绝不能擅自覆盖或删除；
- 最新远程 `v*` 标签和 `package.json` 版本是否一致；
- 当前任务是只读分析、代码实现、设计验证，还是完整发布；
- 本文“当前任务状态”是否仍然有效。

## 0.2 当前任务状态

> 2026-10-10：v0.1.226 新增处理流“隐藏已完成 / 显示已完成”。入口为 `workspace.js` 的处理流工具栏，由 `actions.js` 分发；本机显示偏好保存在 `loop-flow-hide-completed`，默认关闭。已完成父节点仅隐藏行，保留未完成子节点的真实缩进，不改层级或折叠值；定位器遵循筛选，详情记录在自动隐藏前保存。`tests/flow-completed-filter.ui.cjs` 覆盖混合层级、重启、记录、统计和最小桌面窗口。

截至 2026-07-18：

> 2026-08-16 补充：生产代码现统一位于 `app/`，反馈服务位于 `services/bug-report/`，测试和构建工具分别位于 `tests/`、`tools/`；正式文档与非生产原型分别归档到 `docs/`、`prototypes/`。后面的版本列表保留为历史发布记录。

- v0.1.159 已实现任务级截至提醒时间：支持不提醒、截至时、提前 5/15/30 分钟、1/2 小时、1/2 天和 1 周，默认提前 1 小时；设置入口位于现有截至日期面板。
- v0.1.159 将提醒去重状态升级为 v2 并兼容旧阶段记录；提醒只面向未完成且截至时间有效的任务，应用重启后可补发，点击通知仍可定位任务或日历。
- v0.1.159 增加提醒交互 demo、存储/调度/迁移/渲染回归，并通过 `main` 与 `v0.1.159` 标签触发正式跨平台构建和发布流程。

- v0.1.74 已发布到远程 `main`，标签 `v0.1.74` 已推送；
- macOS ARM64 DMG/ZIP 和 Windows x64 NSIS 安装包已成功构建；
- `npm run check`、8 项 Node 回归测试、`git diff --check`、依赖安全审计和设计 QA 已通过；
- v0.1.47 已完成知识笔记页签缓存、处理流状态视觉和右键状态菜单修复，但其空分组布局覆盖错误地取消了任务区弹性高度，导致任务分组与底栏上移；
- v0.1.48 已撤销该错误覆盖，恢复任务区占用侧栏剩余空间、任务分组与底栏稳定贴底；macOS ARM64 与 Windows x64 安装包均已构建；
- v0.1.49 已完成：空分组底部分组区改为贴底扁平导航，隐藏冗余横向滚动条但保留滚动/箭头导航；今日任务数量说明改为单行“n 项待推进”；macOS ARM64 与 Windows x64 安装包均已成功构建；
- v0.1.50 已发布：窄窗口侧栏明确使用 `100svh` 高度，任务仓库继续作为弹性区，空分组和有任务分组的分组/设置区都以窗口底部为锚点；macOS ARM64 与 Windows x64 安装包均已成功构建；
- v0.1.51 已发布：筛选无结果时移除 `TRACK` 标记，仅在工作区顶部保留“没有符合筛选的任务”；设置按钮右侧新增月亮/太阳主题快捷切换，复用既有 Electron 与 localStorage 持久化；补齐最终版侧栏、工作区、任务行、搜索、输入控件、按钮、边框、Milkdown、弹窗、滚动条和 SVG 的深色主题覆盖；
- v0.1.73 已完成 Taste Skill 接入和任务工作台视觉细化，并作为本次发布链的前序标签补推；
- v0.1.74 完成全量功能与数据完整性审计：修复任务导出调用不存在函数的问题，导出前刷新最新 Milkdown 草稿；对任务、节点、分组、状态、优先级、时间戳、附件和旧字体设置做双端严格规范化；修复删除父节点后子节点详情残留；增加全局 `Esc` 关闭、今日任务/回顾项键盘操作和表单辅助名称；
- v0.1.74 新增 `tests/desktop.test.cjs`，覆盖数据规范化、原子读写、损坏备份、旧设置迁移、任务导出、过滤排序、节点完整性和 Markdown URL 安全；`npm run check` 会自动执行这些测试；
- 依赖更新到 Electron 42.7.0 和 Milkdown/Crepe 7.21.3，完整 npm 审计与生产依赖审计均为 0 个已知漏洞；
- 发布包启用 ASAR；Milkdown 只作为构建期依赖，运行时使用已生成的 `app/renderer/src/vendor` 资源，避免把整套编辑器依赖重复打入安装包；
- 外置卷直接生成 ASAR 会触发 electron-builder 头读取错误，`tools/build.cjs` 会在 `/Volumes` 工作区自动改用本机临时目录构建，再只复制最终产物回 `release` 并清理 AppleDouble；
- `docs/architecture/FEATURE_MAP.md` 已改为按函数名定位，移除会随源码变化而失效的固定行号；
- 本文档从本次提交开始纳入 Git，并作为后续会话的持续交接入口；
- `prototypes/demos/task-track.html` 是用户提供的视觉/交互基线文件，目前仍是本地参考文件，不等于生产入口；
- `prototypes/design-qa/` 是本地截图和比较证据目录，不属于生产运行依赖。

如果后续工作已经发生，必须在结束前更新这一小节，不能让“当前任务状态”长期停留在旧版本。

## 0.3 当前产品形态

Loop 是一个本地优先的个人任务处理流桌面工具。当前生产界面以 `prototypes/demos/task-track.html` 的信息架构和视觉语言为主，同时保留了此前 Electron 版本已有的持久化、回顾、导出、主题、字体、拖拽排序等能力。

当前核心区域：

```text
左侧：品牌 / 搜索 / 今日聚焦 / 任务仓库 / 横向任务分组 / 设置 / 主题切换 / 回顾
右侧：任务标题与元信息 / 背景·进展·结论 / 处理流·知识笔记·历史处理
```

必须保持的最新内容边界：

- `task.notes`：任务级长期知识笔记，由“知识笔记”页中的 Milkdown 编辑器维护；
- `node.note`：节点级简短处理记录，点击处理流摘要后在 HTML 风格浮窗中编辑；
- 处理流中只展示节点记录摘要，不直接完全展开长内容；
- 节点记录浮窗支持保存、取消、遮罩关闭、`Esc` 关闭以及 `Ctrl/Command + Enter` 保存；
- 桌面端记录浮窗居中，窄屏下变为底部抽屉；
- 任务 Markdown/PDF 导出包含任务知识笔记和节点记录。

## 0.4 不可轻易改变的产品原则

以下是当前仍然有效的硬约束：

1. “今日任务”是唯一强视觉焦点，其他区域保持低饱和和工具感；
2. 任务分组筛选只影响任务仓库，不应改变今日聚焦集合；
3. 主流程顺序与父子层级使用两套清晰视觉通道；
4. 节点状态优先使用删除线、粗细、虚线、空心等形态差异，而非大面积高饱和底色；
5. 页面保持紧凑，任务列表和处理流优先于装饰性内容；
6. 任务分组保持横向展示和滚动；
7. 新建节点后只聚焦标题，不自动打开记录浮窗；只有点击记录摘要才打开浮窗；
8. 知识笔记与节点记录不能再次合并成同一个编辑器或同一个字段；
9. 已存在的数据字段和桌面存储必须向后兼容，新增持久化字段时同时更新浏览器端规范化和 `app/main/storage.cjs`；
10. 不要为了迁移框架顺便重做 UI；先保持现有行为和视觉契约。

## 0.5 当前仓库结构与职责

```text
app/renderer/index.html                         生产渲染入口
app/renderer/src/app.js                         状态、渲染、事件、CRUD、导出与编辑器编排
app/renderer/src/styles.css                     全局视觉、响应式与主题样式
app/renderer/src/milkdown-editor.entry.js       Milkdown/Crepe 封装入口
app/renderer/src/vendor/milkdown-editor.js      esbuild 生成的浏览器 bundle
app/renderer/src/vendor/milkdown-editor.css     Milkdown 生成/依赖样式
app/main/main.cjs                  BrowserWindow、IPC、剪贴板、Markdown/PDF 导出
app/main/preload.cjs               安全 contextBridge
app/main/storage.cjs               JSON 读取、规范化、损坏备份、原子写入
tools/build-milkdown.cjs         Milkdown bundle 构建
tools/build.cjs                  electron-builder 打包入口
app/resources/                             应用图标等打包资源
.github/workflows/                 CI 构建和标签发布工作流
docs/architecture/FEATURE_MAP.md                     功能地图；定位前先用 rg 确认实际行号
docs/history/task_plan.md / docs/history/findings.md / docs/history/progress.md
                                   跨会话工作记忆
prototypes/demos/task-track.html                    v1.3.1 设计原型，本地视觉参考
```

生产前端仍是无框架的单页渲染模式：

```text
用户操作
→ action(data) / edit(data, value)
→ 修改 state
→ render() 重建 DOM
→ bind() 重新绑定事件
→ requestAnimationFrame()
→ mountMilkdownEditors()
→ save()
```

不要保存已经被 `render()` 替换的 DOM 引用。Milkdown 是异步挂载的，编辑器实例必须按现有生命周期销毁和重建。

## 0.6 当前技术栈和命令

当前 `package.json`：

```text
应用版本             0.1.74
Electron             ^42.7.0
electron-builder     ^26.15.3
esbuild              ^0.28.1
@milkdown/crepe      ^7.21.3
```

常用命令：

```bash
npm install             # 仅依赖缺失或 lockfile 变化时
npm run dev             # 启动 Electron
npm run build:milkdown  # 重建 Milkdown vendor bundle
npm test                # 运行 Node 回归测试
npm run check           # Milkdown 构建 + JS 语法检查 + 回归测试
npm run dist:mac        # macOS ARM64 DMG + ZIP
npm run dist:win        # Windows x64 NSIS
```

`npm run check` 会先运行 `build:milkdown`，所以即使只改 `app/renderer/src/milkdown-editor.entry.js`，最终检查也会同步生成 bundle。

本仓库位于外置卷时，`npm run dist:mac` / `npm run dist:win` 会自动把 electron-builder 输出放到系统临时目录，完成后复制 `.dmg`、`.zip`、`.exe`、`.blockmap` 和 `.yml` 到仓库 `release/`。不要绕过 `tools/build.cjs` 直接在外置卷生成 ASAR。

## 0.7 当前持久化和数据兼容

### Electron 生产环境

渲染进程通过 `window.personalTaskTrack.storage` 调用 IPC：

```text
app/renderer/src/app.js
→ app/main/preload.cjs
→ app/main/main.cjs
→ app/main/storage.cjs
→ app.getPath("userData")/task-data.json
```

写入流程为：先写 `.tmp`，再 `rename` 原子替换。JSON 损坏时会备份为带时间戳的 `task-data.corrupt-*.json`。

当前数据版本：

```js
const DATA_VERSION = 1;
```

桌面与浏览器规范化目前共同覆盖：

- 过滤空值、修复重复/缺失 ID，并重建任务/节点父子关系；
- 任务与节点的字符串字段、顺序、状态、优先级和时间戳；
- 旧数组任务标签到 `{ today, later, blocked }` 的迁移；
- 递归节点树、节点 `collapsed`、`taskGroups` 和 `activeGroupId`；
- 处理流列宽、侧栏宽度、详情高度和图片附件 data URL；
- 主题、中英文字体和旧 `font` 设置迁移；
- 任务筛选、优先级筛选和新任务优先级。

### 浏览器预览环境

若不存在 Electron bridge，`app/renderer/src/app.js` 会使用多个 localStorage 键作为降级持久化。它主要用于开发预览，不是生产桌面数据文件。

### 当前核心数据轮廓

```ts
interface Task {
  id: string;
  title: string;
  description: string;
  hypothesis: string;
  hypothesisUpdatedAt: string;
  conclusion: string;
  notes: string; // 任务级 Milkdown 知识笔记
  priority: "high" | "medium" | "low";
  status: "active" | "done";
  tags: { today: boolean; later: boolean; blocked: boolean };
  groupId: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  nodes: TaskNode[];
}

interface TaskNode {
  id: string;
  taskId: string;
  parentId: string | null;
  order: number;
  type: "step" | "subtask";
  title: string;
  status: "todo" | "done" | "blocked" | "later";
  note: string; // 节点级简短记录
  hypothesis: string;
  conclusion: string;
  createdAt: string;
  updatedAt: string;
  collapsed: boolean;
  children: TaskNode[];
}

interface TaskGroup {
  id: string;
  title: string;
  order: number;
}
```

以源码规范化函数为最终依据。修改数据字段时至少检查：

```text
app/renderer/src/app.js: normalizeTasks / normalizeNodes / save / loadAppData
app/main/storage.cjs: normalizeTaskData / normalizeTaskNodes
导出序列化：taskMarkdown / PDF payload
```

## 0.8 v0.1.45 已完成能力

- 370px 起的宽左栏、深绿色今日聚焦、低饱和任务工作区；
- 任务仓库、搜索、优先级过滤、Today/Later/Blocked 标记；
- 任务和分组拖拽排序；
- 横向任务分组导航、双击重命名和右键操作；
- 任务背景、当前判断、结果/总结；
- 处理流主节点顺序、递归父子节点、状态、折叠/展开全部；
- 处理流、知识笔记、历史处理三个任务页签；
- 节点简短记录浮窗和摘要展示；
- 任务级 Milkdown 知识笔记，支持自动保存、表格、代码块和图片；
- 自定义日期范围的任务回顾；
- 亮/暗主题和中英文字体偏好；
- 任务 Markdown/PDF 导出、节点 PDF 相关底层能力；
- Electron 本地原子存储及浏览器 localStorage 降级；
- macOS ARM64 和 Windows x64 安装包构建；
- 标签推送触发 GitHub Release 工作流。

## 0.9 已知限制和技术债

当前没有远程业务后端、账号或多端数据同步；GitHub 仅保存源码与发布产物。

继续开发前应注意：

- `app/renderer/src/app.js` 和 `app/renderer/src/styles.css` 仍然较大，功能地图中的行号会漂移；
- `render()` 会重建主要 DOM，新增组件时要遵守现有绑定和编辑器生命周期；
- `today` 仍是任务标签，不是真实的日期聚焦记录；
- 历史处理是派生展示，不是完整审计事件系统；
- 浏览器预览数据与 Electron `task-data.json` 是两个独立数据源；
- 打包配置当前 `asar: false`，构建会出现 electron-builder 的安全建议提示；
- macOS 当前明确不签名，Windows 构建使用现有签名工具流程；
- `docs/architecture/FEATURE_MAP.md` 的功能说明有参考价值，但 v0.1.45 后部分行号和“节点 Milkdown”描述需要逐步更新；
- 旧原型包含双语业务字段设计，当前生产数据是单语言字符串；不要未经迁移直接替换为 `{zh,en}`。

## 0.10 验证和发布纪律

任何修改提交前至少运行：

```bash
npm run check
git diff --check
```

涉及脚本时增加对应 `node --check`。涉及 UI 时按风险验证桌面和 390px 移动布局；不能仅凭源码推断视觉结果。

发布用户可见版本时：

1. `git fetch origin main --tags`；
2. 从最新远程 `v*` 标签递增补丁版本；
3. 同步更新 `package.json` 和 `package-lock.json`；
4. 运行检查；
5. `rm -rf release`；
6. `npm run dist:mac`；
7. `npm run dist:win`；
8. `find release -type f -name '._*' -print`，必须无输出；
9. 只暂存相关文件；
10. 提交、创建匹配标签、推送 `main`、推送标签；
11. 再次确认本地 `main` 和 `origin/main` 一致。

文档-only 更新不需要强行增加应用版本或创建应用发布标签，但仍需检查差异并提交到远程。

外置磁盘可能生成 `._*` AppleDouble 文件，尤其不能让它们进入 `.git/objects/pack` 或发布包。不要用破坏性 Git 命令处理用户改动。

## 0.11 本文档的持续维护规则

本文不是一次性交接报告，而是每次工作都要逐步完善的生产资产。

### 必须更新本文的情况

当发生以下任一变化时，在同一次提交或紧随其后的文档提交中更新本文：

- 应用版本、发布标签或生产提交变化；
- 当前任务完成、阻塞或换方向；
- 架构、入口文件、依赖、构建命令或发布流程变化；
- 数据字段、存储路径、schema version 或迁移策略变化；
- 关键交互契约或视觉原则变化；
- 新增重要功能、删除能力或发现重大限制；
- 验证方式、平台支持或已知构建问题变化；
- 新会话接手时实际踩到了本文未说明的坑。

### 每次工作结束前的交接检查

```text
[ ] 更新文档顶部版本、提交和核对日期
[ ] 更新“当前任务状态”与下一步
[ ] 更新产品/数据/架构变化
[ ] 记录验证结果和未验证项
[ ] 记录已知问题、失败尝试和解决办法
[ ] 删除已经失效的“当前”描述，或明确标成历史资料
[ ] 确认文档已被 Git 跟踪并推送远程
```

### 写法要求

- 优先写“现在是什么、接下来做什么、不能破坏什么”；
- 使用绝对路径、文件名、函数名、命令和提交号，避免只写模糊结论；
- 不把临时浏览器测试数据误写成生产用户数据；
- 不保存密码、令牌、签名凭据或私人数据；
- 已失效内容不要静默保留为“当前状态”，应移动到历史附录或明确标注；
- 新会话应能只依靠仓库内本文和源码继续工作，不依赖上一段聊天记录。

## 0.12 最近生产变更记录

### v0.1.50 — 2026-07-13 — `bf6d3e0`

- 根因是窄窗口断点继承了 `min-height: auto`，空分组内容不足时侧栏会按内容收缩；
- `max-width: 870px` 下侧栏现在明确使用 `height/min-height/max-height: 100vh/100svh`，任务仓库继续通过 `flex: 1 1 auto` 占据剩余空间；
- `npm run check` 与 `git diff --check` 已通过；
- macOS ARM64 DMG/ZIP 与 Windows x64 NSIS 安装包已成功构建，且无 AppleDouble `._*` 文件；
- Product Design 本地预览被浏览器安全策略拒绝，未绕过限制，因此本次不声称视觉回归已通过；
- 修复提交 `bf6d3e0` 与 `v0.1.50` 标签已推送至远程。

### v0.1.49 — 2026-07-12 — `a14bf4d`

- 空分组状态下的任务分组区去除卡片边框、圆角和填充背景，改为与侧栏一体化的贴底导航；
- 隐藏分组标签的可见横向滚动条，保留滚轮、左右箭头、拖拽与新增分组能力；
- 今日任务数量说明从容易折行的“n 项重点任务需要推进”精简为单行“n 项待推进”；
- Product Design 同状态浏览器核对通过：空分组任务区、分组区和底栏边界稳定，控制台无警告或错误。
- `npm run check`、`git diff --check` 与双平台打包均通过，发布目录不存在 `._*` 污染文件。
- `main` 与 `v0.1.49` 已推送到远程。

### v0.1.48 — 2026-07-12 — `ed6bcaa`

- 撤销 v0.1.47 添加的 `.rail.sidebar .task-list` 非弹性高度覆盖；
- 任务列表重新占用侧栏剩余空间，任务分组与设置/回顾底栏恢复贴底；
- 空分组仍保留稳定的任务仓库区域，不会把分组控件顶到侧栏中上部。
- `npm run check`、`git diff --check` 与双平台打包均已通过，发布目录不存在 `._*` 污染文件。
- `main` 与 `v0.1.48` 已推送到远程。

### v0.1.47 — 2026-07-12 — `2f7d272`

- 处理流与知识笔记切换时缓存并复用当前任务的 Milkdown 编辑器 DOM/实例，避免往返页签时重新初始化编辑器；
- 状态、更新时间继续作为处理流最后两列，状态视觉改成绿色文本和细轨道，不再显示突兀的胶囊形标签；
- 右键菜单只给出与当前状态不同的可选状态；已完成节点不再重复显示“标记为未完成”；
- 曾尝试让空分组任务列表按内容收缩，但该覆盖造成任务分组与底栏上移；已在 v0.1.48 撤销；
- `npm run check` 与 `git diff --check` 已通过；macOS ARM64 DMG/ZIP、Windows x64 NSIS 安装包均已构建，发布目录不存在 `._*` 污染文件；`main` 与 `v0.1.47` 已推送到远程。

### v0.1.46 — 2026-07-12 — `3f8599f`

- 保持使用官方 `@milkdown/crepe`，收紧知识笔记有序/无序列表缩进与行距；
- Milkdown ImageBlock 上传改用持久 data URL，真实 PNG 粘贴后可显示并跨刷新保存；
- CSP 补充 Crepe 图片预览所需的 `blob:`；
- 收起节点后主流程轴结束在最后可见根节点，不再延伸到空白区域；
- 处理流底部提示恢复为 `prototypes/demos/task-track.html` 的原文和居中虚线样式；
- 删除左侧大型新建任务卡，改为双击空白、右键菜单和紧凑提示；
- 桌面与 390×844 浏览器设计 QA 已通过；macOS ARM64 DMG/ZIP 与 Windows x64 NSIS 安装包构建成功，且发布目录不存在 `._*` 污染文件；`main` 与 `v0.1.46` 已推送到远程。

### v0.1.45 — 2026-07-12 — `2aa78f4`

- 生产界面按 `prototypes/demos/task-track.html` 重塑为宽左栏、今日聚焦和三页签任务工作区；
- 处理流增强主顺序和父子层级表达，并支持节点折叠；
- 节点记录改为简短 HTML 风格浮窗，处理流只显示摘要；
- Milkdown 移到任务级“知识笔记”，内容写入 `task.notes`；
- Electron 规范化补齐任务知识笔记；
- 任务导出包含知识笔记；
- 桌面和 390px 移动布局、保存/取消快捷键、Milkdown 持久化均完成浏览器验证；
- macOS ARM64 与 Windows x64 发布包构建成功；
- `main` 和 `v0.1.45` 已推送到远程。

---

# 历史附录：prototypes/demos/task-track.html v1.3.1 单文件原型说明

> 以下第 1～27 节是用户提供的单文件原型说明，保留其产品原则、交互细节和后端化设想。
> 其中“当前文件”“当前版本”“当前数据模型”“当前限制”等表述描述的是 **v1.3.1 原型当时状态**，不是 Electron v0.1.45 的生产事实。
> 需要实现视觉/交互时以它作为设计参考；需要修改生产代码、数据和发布流程时以第 0 节及仓库源码为准。

---

## 1. 项目定位

Task Track 是一个以“**今日任务**”为核心视觉焦点的个人任务工作台。它不是传统的看板或普通待办列表，而是把每个任务拆成以下几个层次：

1. 今日需要重点推进的任务；
2. 完整任务仓库；
3. 任务分组；
4. 单个任务的背景、进展、结果；
5. 任务内部的有序处理流；
6. 处理流节点的父子关系、状态、记录和历史。

产品的核心目标是：

- 用户进入页面后，视线首先落在“今日任务”；
- 其他模块负责支撑今日任务，而不是与其争夺注意力；
- 处理流既要表达主节点之间的执行顺序，也要表达父子节点的层级关系；
- 页面应保持紧凑、克制、低饱和，不使用大量卡片、大色块或高饱和状态色；
- 常用编辑操作尽量通过点击、双击、右键完成，避免在页面上堆积按钮。

---

## 2. 必须保留的产品设计原则

后续无论由另一个对话、Codex、前端工程师还是全栈工程师继续开发，都应保留以下原则。

### 2.1 今日任务是唯一强视觉焦点

- 左侧“今日任务”使用深绿色渐变、白色文字和相对明显的阴影。
- 任务仓库、任务分组、右侧内容、状态标签、按钮、浮窗均采用近白、灰色、灰绿色等低饱和颜色。
- 不应重新给不同节点状态增加大面积彩色背景，否则会削弱今日任务的焦点。

### 2.2 今日任务与分组筛选逻辑相互独立

这是已经明确修复过的核心业务逻辑：

- 选择“工作”“学习”“个人”等分组，只能筛选“任务仓库”；
- “今日任务”不能因分组选择而变化；
- 当前实现中，搜索关键字仍会同时过滤今日任务和任务仓库，这是有意保留的行为。

对应现有逻辑：

```js
const today = data.tasks.filter(
  task => task.today && taskMatchesSearch(task)
);

const repository = data.tasks.filter(taskMatchesRepository);
```

其中 `taskMatchesRepository()` 才会检查 `selectedGroupId`。

### 2.3 处理流的两种关系必须分别清晰

处理流同时存在两种关系：

- **主节点顺序**：通过左侧连续竖轴、节点序号 `01 / 02 / 03...` 和短横线表达；
- **父子层级**：通过右侧缩进和树形连接线表达。

不要把主流程序号、父子关系、状态图标全部堆在同一个视觉通道中。

### 2.4 状态使用“形态差异”，而不是大面积颜色

当前版本对四种节点状态的表现如下：

| 状态 | 视觉形态 |
|---|---|
| 已完成 `done` | 标题和记录摘要带删除线；标题、关系、记录和时间整体降低透明度；状态线较短；状态选择文字带删除线 |
| 进行中 `doing` | 标题加粗；状态线加宽、加长；状态选择左侧有实线强调 |
| 等待中 `waiting` | 标题斜体；状态线为断续虚线；状态选择边框为虚线并使用斜体 |
| 待办 `todo` | 标题字重稍轻；状态线为空心线框；整体保持中性 |

这样既能区分状态，又不会让处理流比今日任务更抢眼。

### 2.5 页面保持紧凑

- 任务列表项之间间距为紧凑型；
- 处理流默认行高约 `58px`；
- 紧凑模式下处理流行高约 `48px`；
- 不应随意增大节点间距、卡片内边距或模块间距。

### 2.6 任务分组横向展示

- 分组位于左侧底部，采用横向排列；
- 支持横向滚动条；
- 鼠标滚轮纵向滚动会转化为横向滚动；
- 不应恢复成上下纵向列表。

---

## 3. 当前文件和运行方式

当前项目仅有一个核心文件：

```text
prototypes/demos/task-track.html
```

运行方式：

1. 直接双击 HTML 文件在浏览器打开；
2. 或使用任意静态服务器：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080/task-track.html
```

当前无以下内容：

- npm；
- package.json；
- React/Vue/Svelte；
- TypeScript；
- CSS 框架；
- 图标库；
- 后端 API；
- 数据库；
- 登录和权限系统。

所有图标均为内联 SVG 或字符，例如导出按钮使用内联 SVG，设置按钮使用 `⚙`。

---

## 4. 当前版本和存储键

界面显示版本：

```text
v1.3.1
```

版本号在 HTML 中出现两次：

1. 左上角版本标签；
2. 设置浮窗右上角。

当前没有统一的 JavaScript 版本常量，后续修改版本时需要同步修改两处。建议工程化时增加：

```js
export const APP_VERSION = "1.3.1";
```

localStorage 键：

```js
const DATA_KEY = "task-track-data-v3";
const SETTINGS_KEY = "task-track-settings-v3";
```

其中：

- `task-track-data-v3` 保存分组、任务、节点和历史；
- `task-track-settings-v3` 保存语言、紧凑模式、更新时间显示、删除确认和列宽比例。

---

## 5. 页面整体结构

### 5.1 桌面端布局

根容器：

```css
.app {
  display: grid;
  grid-template-columns:
    clamp(370px, 25vw, 410px)
    minmax(0, 1fr);
}
```

左侧宽度：

- 最小 `370px`；
- 理想值为视口宽度的 `25vw`；
- 最大 `410px`。

右侧使用剩余宽度。

### 5.2 左侧区域顺序

```text
品牌和版本
搜索框
今日任务
任务仓库
任务分组
底部设置 / 自动保存提示 / 恢复示例
```

### 5.3 右侧区域顺序

```text
顶部面包屑 / 导出图标 / 中英文切换
任务标题和元信息
背景 / 当前进展 / 结果
标签页：处理流 / 知识笔记 / 历史处理
```

### 5.4 响应式断点

#### `max-width: 1180px`

- 左侧固定约 `350px`；
- 处理流隐藏“更新时间”列；
- 更新时间列的分隔拖动柄隐藏。

#### `max-width: 870px`

- 左右布局改为上下布局；
- 左侧不再占满固定视口高度；
- 上下文三个输入区改为单列；
- 处理流表头隐藏；
- 每个节点行改为单列排列；
- 节点记录、状态和时间缩进到标题下方；
- 记录浮窗接近底部抽屉式展示；
- 设置浮窗宽度自适应页面。

---

## 6. 视觉设计系统

### 6.1 颜色策略

CSS 变量集中在 `:root`。

基础中性色：

```css
--page: #f3f4f2;
--sidebar: #eef0ee;
--surface: #fcfdfc;
--ink: #26312b;
--muted: #747c77;
--soft: #9aa09c;
--line: #e1e5e2;
--line-strong: #d2d8d4;
--line-soft: #edf0ee;
```

今日任务专用焦点色：

```css
--focus-950: #17392d;
--focus-900: #214a3a;
--focus-800: #2e5d49;
--focus-700: #3d6d57;
```

状态色仅用于细线和文字，不用于大面积背景：

```css
--done: #66776c;
--doing: #806f4b;
--waiting: #6a7981;
--todo: #8b928e;
```

### 6.2 字体

使用系统字体栈：

```css
-apple-system,
BlinkMacSystemFont,
"Segoe UI",
"PingFang SC",
"Microsoft YaHei",
sans-serif
```

时间、版本号、主流程序号使用等宽字体：

```css
ui-monospace,
SFMono-Regular,
Menlo,
monospace
```

### 6.3 卡片策略

- 今日任务允许使用明显卡片和阴影；
- 其他区域仅使用轻边框、近白背景和小圆角；
- 处理流节点不是独立大卡片，而是表格式行；
- 主节点只使用极浅背景；
- 子节点保持透明或近透明。

---

## 7. 左侧功能详细说明

## 7.1 品牌区

显示：

```text
Task Track
个人任务工作台 / PERSONAL TASK WORKSPACE
v1.3.1
```

左上角不再有加号。版本号替代了原加号位置。

## 7.2 搜索

输入框 ID：

```text
#searchInput
```

当前搜索范围：

- 任务标题；
- 分组名称；
- 任务优先级文本；
- `nextNode()` 返回的下一个未完成节点标题。

当前搜索**不会**完整检索：

- 背景；
- 当前进展；
- 结果；
- 知识笔记；
- 所有节点标题；
- 所有节点记录。

因此后端融合时不要误认为当前已实现全文搜索。

## 7.3 今日任务

今日任务判断字段：

```js
task.today === true
```

当前 `today` 只是布尔值，并不和真实日期绑定。也就是说，任务一旦设为今日任务，第二天仍然会显示，直到用户手动取消。

今日任务列表项展示：

- 任务标题；
- 下一个未完成节点标题；
- 优先级；
- 当前选中状态。

点击任务会切换右侧详情。

右键任务菜单包含：

- 新建任务；
- 重命名任务；
- 切换今日任务状态；
- 移动到指定分组；
- 删除任务。

双击任务：重命名。

## 7.4 任务仓库

任务仓库受以下条件影响：

1. 当前选择的分组；
2. 搜索关键字。

点击、双击、右键行为与今日任务相同。

双击任务仓库空白区域：新建任务。

右键任务仓库空白区域：出现“新建任务”。

新任务默认：

```js
priority: "normal"
status: "todo"
today: false
```

如果当前选中了具体分组，新任务进入该分组；如果当前是“全部任务”，新任务进入 `ungrouped`。

## 7.5 任务分组

“全部任务”是 UI 中的伪分组：

```js
selectedGroupId === "all"
```

它不在 `data.groups` 数组中。

真实分组结构包括：

- 工作；
- 学习；
- 个人；
- 健康；
- 未分组。

“未分组”字段：

```js
{
  id: "ungrouped",
  system: true
}
```

系统分组不能重命名或删除。

分组交互：

- 单击：筛选任务仓库；
- 双击普通分组：重命名；
- 双击空白处：新建分组；
- 右键普通分组：新建、重命名、删除；
- 右键“全部任务”：只能新建分组；
- 鼠标滚轮：横向滚动分组列表。

删除普通分组时，该组任务自动移动到 `ungrouped`。

---

## 8. 右侧任务详情

## 8.1 顶部工具区

左侧：面包屑。

格式：

```text
工作台 / 当前任务标题
```

右侧：

1. 导出数据图标；
2. 中文 / EN 切换。

导出图标使用“向下箭头进入托盘”的 SVG，只导出任务数据，不导出设置。

下载文件名：

```text
task-track-data.json
```

## 8.2 任务标题和元信息

显示：

- 任务标题；
- 优先级；
- 任务状态；
- 节点数量；
- 所属分组。

注意：当前页面没有直接修改任务级优先级和任务级状态的 UI。它们只在示例数据和新任务默认值中存在。

节点状态变化也不会自动汇总并修改任务级状态。

## 8.3 背景、进展、结果

三个文本区字段：

```js
background
progress
result
```

当前使用 `input` 事件，每输入一个字符就同步写入 localStorage。

没有防抖，没有保存中状态，也没有失败处理。

## 8.4 标签页

三个标签页：

```text
处理流
知识笔记
历史处理
```

切换函数：

```js
switchTab(name)
```

当前选中的标签页没有持久化，刷新后回到处理流。

---

## 9. 处理流详细说明

## 9.1 基本概念

任务的 `nodes` 数组中的一级节点即主流程节点。

主节点顺序由数组顺序决定：

```js
task.nodes[0]
task.nodes[1]
task.nodes[2]
```

主节点序号由渲染时自动生成：

```js
String(index + 1).padStart(2, "0")
```

节点内部 `children` 数组表示子节点。子节点可以继续包含子节点，因此数据结构是递归树。

## 9.2 主节点顺序表现

主要元素：

```text
.flow-sequence
.flow-stage
.main-sequence-rail
.sequence-index
```

- `.flow-sequence::before` 绘制连续竖轴；
- `.sequence-index` 显示 `01 / 02 / 03...`；
- `.main-sequence-rail::after` 绘制横向短连接线；
- 主轴颜色保持中性，不跟随状态大幅变色。

## 9.3 父子关系表现

每级缩进：

```css
--indent: calc(var(--level, 0) * 28px);
```

子节点通过 `.flow-node-cell::before` 和 `::after` 绘制竖线和横线。

每行会显示一段关系说明：

主节点：

```text
主流程第 N 步 · relation
```

子节点：

```text
属于 父节点标题 · relation
```

## 9.4 处理流列

当前列名：

```text
处理
记录
状态
更新时间
```

默认比例：

```js
[42, 32, 12, 14]
```

对应 CSS 变量：

```css
--flow-col-process
--flow-col-record
--flow-col-status
--flow-col-time
```

表头分隔线支持：

- 鼠标拖动调整相邻两列宽度；
- 双击恢复默认列宽；
- 键盘左右方向键微调；
- `Shift + 左右方向键` 加快调整；
- 调整结果保存到 settings。

最小像素宽度约束：

```js
[220, 140, 78, 92]
```

列宽调整在 `max-width: 870px` 下禁用。

## 9.5 节点标题

节点标题是行内 `<input>`。

修改触发：

```text
change
```

通常在输入框失焦或按 Enter 后保存，而不是每输入一个字符就保存。

## 9.6 节点记录

“记录”列只显示单行摘要。

点击摘要后打开居中浮窗：

- 显示节点名称；
- 显示状态和关系；
- 支持长文本编辑；
- 点击保存写入数据；
- `Ctrl + Enter` 或 `Command + Enter` 快速保存；
- `Esc` 关闭；
- 点击遮罩关闭；
- 点击取消关闭。

当前关闭浮窗不会提示未保存内容，未保存修改会丢失。

切换语言时，如果记录浮窗打开，也会直接关闭。

## 9.7 节点状态

状态枚举：

```js
"todo"
"doing"
"waiting"
"done"
```

中英文文本：

| 值 | 中文 | 英文 |
|---|---|---|
| `todo` | 待办 | To Do |
| `doing` | 进行中 | In Progress |
| `waiting` | 等待中 | Waiting |
| `done` | 已完成 | Completed |

状态修改使用 `<select>`，触发 `change` 后更新数据、更新时间和历史记录。

## 9.8 节点折叠

有子节点的节点显示 `+ / −`。

字段：

```js
collapsed: boolean
```

支持：

- 单个节点展开 / 折叠；
- “展开全部 / 收起全部”。

当前 `allExpanded` 是页面运行状态，不持久化；但每个节点的 `collapsed` 会随完整数据保存到 localStorage。

## 9.9 节点增删

节点行右键菜单：

- 添加同级节点；
- 添加子节点；
- 删除当前节点。

处理流空白区域：

- 双击：添加顶层节点；
- 右键：添加顶层节点。

删除节点会级联删除该节点的全部子节点，因为整个子树直接从数组中移除。

当前没有拖拽排序，也没有“上移 / 下移”。

---

## 10. 知识笔记与历史

## 10.1 知识笔记

字段：

```js
notes
```

当前是普通 `<textarea>`，虽然示例内容包含 Markdown，但页面不渲染 Markdown。

使用 `input` 事件实时保存。

## 10.2 历史处理

历史结构：

```js
{
  time: "07/11 16:10",
  text: {
    zh: "...",
    en: "..."
  }
}
```

历史倒序展示：最新记录在最上方。

当前会自动生成历史的操作主要有：

- 修改节点标题；
- 修改节点状态；
- 保存节点记录。

当前不会完整记录：

- 修改任务背景；
- 修改当前进展；
- 修改结果；
- 修改知识笔记；
- 新建 / 删除任务；
- 移动任务分组；
- 切换今日状态；
- 新建 / 删除分组；
- 新建 / 删除节点。

后端融合时建议把历史改为真正的审计事件模型。

---

## 11. 中英文机制

UI 文本位于：

```js
const UI = {
  zh: { ... },
  en: { ... }
};
```

状态和优先级单独定义：

```js
const STATUS = { ... };
const PRIORITY = { ... };
```

业务数据的双语结构：

```js
{
  zh: "中文内容",
  en: "English content"
}
```

读取函数：

```js
loc(value)
```

写入函数：

```js
setLoc(current, value)
```

重要行为：

- 在中文模式编辑，只修改 `zh`；
- 在英文模式编辑，只修改 `en`；
- 新建任务、分组或节点时，会先把用户输入同时写入 `zh` 和 `en`；
- 后续切换语言后可以分别修改两个语言版本；
- 系统不会自动翻译用户内容。

---

## 12. 当前数据模型

## 12.1 顶层结构

```ts
interface AppData {
  groups: Group[];
  tasks: Task[];
}
```

## 12.2 双语文本

```ts
interface LocalizedText {
  zh: string;
  en: string;
}
```

## 12.3 分组

```ts
interface Group {
  id: string;
  name: LocalizedText;
  system: boolean;
}
```

说明：

- `id` 为字符串；
- 用户分组通常为 `group-${createId()}`；
- `ungrouped` 是系统分组；
- 当前没有显式排序字段，数组顺序即显示顺序。

## 12.4 任务

```ts
interface Task {
  id: number;
  title: LocalizedText;
  priority: "high" | "normal" | "low";
  status: "todo" | "doing" | "waiting" | "done";
  groupId: string;
  today: boolean;

  background: LocalizedText;
  progress: LocalizedText;
  result: LocalizedText;
  notes: LocalizedText;

  history: HistoryItem[];
  nodes: TaskNode[];
}
```

说明：

- `id` 由时间戳加随机数生成；
- 当前没有 `createdAt`、`updatedAt`；
- 当前没有明确的任务排序字段；
- 当前没有截止日期、提醒时间、负责人、标签等字段；
- `today` 不是日期字段。

## 12.5 处理节点

```ts
interface TaskNode {
  id: number;
  title: LocalizedText;
  record: LocalizedText;
  relation: LocalizedText;
  status: "todo" | "doing" | "waiting" | "done";
  updated: string;
  collapsed: boolean;
  children: TaskNode[];
}
```

说明：

- 树关系通过嵌套 `children` 保存；
- 主节点就是 `task.nodes` 的直接元素；
- 同级顺序由数组顺序决定；
- `updated` 可能是 `MM/DD HH:mm`，也可能是中文“未开始”，不是标准日期；
- `collapsed` 实际上偏向 UI 状态，但当前混在业务数据中。

## 12.6 历史

```ts
interface HistoryItem {
  time: string;
  text: LocalizedText;
}
```

---

## 13. 当前设置模型

```ts
interface Settings {
  language: "zh" | "en";
  compactMode: boolean;
  showUpdatedTime: boolean;
  confirmDelete: boolean;
  flowColumnRatios: [number, number, number, number];
}
```

默认值：

```js
{
  language: "zh",
  compactMode: false,
  showUpdatedTime: true,
  confirmDelete: true,
  flowColumnRatios: [42, 32, 12, 14]
}
```

设置浮窗当前包含：

- 紧凑模式；
- 显示更新时间；
- 删除前确认。

“设置”按钮已经预留为后续配置入口，呈浮窗形式，不应改成独立大页面，除非产品需求明确变化。

---

## 14. 重要 JavaScript 函数地图

### 14.1 基础工具

| 函数 | 作用 |
|---|---|
| `t(key, vars)` | 获取当前语言的 UI 文本并替换变量 |
| `loc(value)` | 获取双语字段的当前语言值 |
| `setLoc(current, value)` | 更新双语字段的当前语言值 |
| `escapeHtml(value)` | 转义动态 HTML，避免直接注入 |
| `createId()` | 生成时间戳加随机数 ID |
| `nowText()` | 生成 `MM/DD HH:mm` 时间字符串 |
| `saveData()` | 保存整个 data 到 localStorage |
| `saveSettings()` | 保存整个 settings 到 localStorage |

### 14.2 渲染入口

```js
renderAll()
```

执行顺序：

```js
renderStaticText();
applySettings();
renderGroups();
renderSidebarTasks();
renderCurrentTask();
```

`renderCurrentTask()` 内部继续调用：

```js
renderFlow();
renderHistory();
```

### 14.3 任务相关

| 函数 | 作用 |
|---|---|
| `currentTask()` | 获取当前任务 |
| `taskMatchesSearch()` | 搜索判断 |
| `taskMatchesRepository()` | 分组和搜索联合判断 |
| `taskCard()` | 生成任务列表项 HTML |
| `renderSidebarTasks()` | 渲染今日任务和任务仓库 |
| `createTask()` | 新建任务 |
| `renameTask()` | 重命名任务 |
| `toggleToday()` | 切换今日状态 |
| `moveTaskToGroup()` | 移动分组 |
| `deleteTask()` | 删除任务 |

### 14.4 分组相关

| 函数 | 作用 |
|---|---|
| `findGroup()` | 查找分组 |
| `renderGroups()` | 渲染横向分组 |
| `createGroup()` | 新建分组 |
| `renameGroup()` | 重命名分组 |
| `deleteGroup()` | 删除分组并迁移任务到未分组 |
| `enableGroupWheelScroll()` | 把鼠标滚轮转为横向滚动 |

### 14.5 节点相关

| 函数 | 作用 |
|---|---|
| `findNodeInfo()` | 递归查找节点、父节点、所在数组和下标 |
| `renderNodeRow()` | 渲染单个节点行 |
| `renderChildRows()` | 递归渲染子节点 |
| `renderMainStages()` | 渲染主流程阶段和序号 |
| `renderFlow()` | 渲染完整处理流 |
| `updateNodeField()` | 修改标题或状态 |
| `toggleNode()` | 展开 / 折叠 |
| `makeNode()` | 创建默认节点对象 |
| `addRootNode()` | 添加主节点 |
| `addSiblingNode()` | 添加同级节点 |
| `addChildNode()` | 添加子节点 |
| `deleteNode()` | 删除节点及子树 |
| `toggleAllNodes()` | 展开 / 收起全部 |

### 14.6 记录浮窗

| 函数 | 作用 |
|---|---|
| `openRecordModal()` | 打开节点记录浮窗 |
| `closeRecordModal()` | 关闭浮窗 |
| `saveRecordModal()` | 保存记录、更新时间和历史 |

### 14.7 列宽

| 函数 | 作用 |
|---|---|
| `getFlowColumnRatios()` | 校验并归一化列宽比例 |
| `applyFlowColumnWidths()` | 写入 CSS 变量 |
| `resetFlowColumnWidths()` | 恢复默认比例 |
| `enableFlowColumnResize()` | 注册拖动、双击、键盘调整事件 |

---

## 15. 当前状态变量

以下变量只存在于页面内存中：

```js
let currentTaskId;
let selectedGroupId = "all";
let allExpanded = true;
let activeRecordNodeId = null;
```

当前行为：

- 刷新后默认选择第一个任务；
- 刷新后默认选择全部任务分组；
- 当前标签页不持久化；
- 当前滚动位置不持久化；
- 当前打开的浮窗不持久化。

---

## 16. 当前安全和数据处理

已有措施：

- 动态插入到 HTML 的字符串大多经过 `escapeHtml()`；
- `input value` 和 `title` 属性也会转义；
- 不执行用户输入的脚本；
- 无外部 CDN 和第三方脚本。

仍需注意：

- 后端接入后必须继续服务端校验和转义；
- 不能依赖前端 `escapeHtml()` 作为唯一安全措施；
- 应限制标题、记录、笔记的最大长度；
- 树节点新增时要防止循环关系和异常深度；
- 导入 JSON 时必须验证结构，当前尚无导入功能。

---

## 17. 当前已知限制

1. 没有后端，数据只保存在当前浏览器。
2. 清除浏览器数据后内容会丢失。
3. 没有用户登录、多端同步和权限。
4. `today` 不是日期，不能自动随日期变化。
5. 任务级状态不会随节点状态自动更新。
6. 任务级优先级和状态目前不能直接在 UI 修改。
7. 没有任务、分组和节点拖拽排序。
8. 没有导入数据功能。
9. 导出只包含 data，不包含 settings。
10. 搜索不是全文搜索。
11. 历史记录不完整，不是严格审计日志。
12. 时间字段不是 ISO 8601，甚至可能是“未开始”。
13. 节点折叠状态混在业务数据中。
14. 新建双语内容会把同一输入同时写入中文和英文，并不会自动翻译。
15. 记录浮窗关闭时不检查未保存修改。
16. 所有保存都假定成功，没有加载、失败、重试和冲突处理。
17. 文本输入实时同步 localStorage，接 API 后必须加防抖。
18. CSS 和 JavaScript 已经压缩成较长行，可维护性较差。
19. 版本号在两个位置手动维护。
20. 数据结构没有 schema version 和迁移函数。

---

# 18. 前后端融合建议

## 18.1 推荐总体策略

不要直接在每个现有函数中零散插入 `fetch()`。建议先建立一层数据访问接口，使 UI 与数据来源解耦。

建议接口：

```ts
interface TaskRepository {
  bootstrap(): Promise<BootstrapData>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  createGroup(input: CreateGroupInput): Promise<Group>;
  updateGroup(id: string, patch: UpdateGroupInput): Promise<Group>;
  deleteGroup(id: string): Promise<void>;

  createNode(taskId: string, input: CreateNodeInput): Promise<TaskNode>;
  updateNode(nodeId: string, patch: UpdateNodeInput): Promise<TaskNode>;
  deleteNode(nodeId: string): Promise<void>;
  reorderNodes(input: ReorderNodeInput): Promise<void>;

  updateSettings(patch: Partial<UserSettings>): Promise<UserSettings>;
}
```

第一阶段可以实现两个适配器：

```text
LocalStorageRepository
HttpTaskRepository
```

这样可以先保持现有行为，再逐步切换到后端。

## 18.2 推荐数据库实体

### users

```text
id
email / account
password_hash 或外部认证 ID
created_at
updated_at
```

### task_groups

```text
id UUID
user_id UUID
name_zh
name_en
is_system boolean
sort_order integer
created_at
updated_at
deleted_at nullable
```

### tasks

```text
id UUID
user_id UUID
group_id UUID nullable

title_zh
title_en
priority enum
status enum

background_zh
background_en
progress_zh
progress_en
result_zh
result_en
notes_zh
notes_en

sort_order integer
revision integer
created_at
updated_at
deleted_at nullable
```

### daily_focus_tasks

推荐用独立表替换布尔 `today`：

```text
id UUID
user_id UUID
task_id UUID
focus_date date
sort_order integer
created_at
```

优势：

- 真正表达某一天的今日任务；
- 支持查看历史日期；
- 支持每天不同排序；
- 不需要每天批量清空布尔值。

如果项目只需要极简模式，也可以在 task 中使用：

```text
focus_date date nullable
```

但独立表扩展性更好。

### task_nodes

推荐使用邻接表，而不是数据库 JSON 嵌套：

```text
id UUID
task_id UUID
parent_id UUID nullable

title_zh
title_en
record_zh
record_en
relation_zh
relation_en
status enum
sort_order integer
created_at
updated_at
deleted_at nullable
```

规则：

- `parent_id = null` 表示主节点；
- 主节点按 `sort_order` 排序；
- 子节点也按同一父节点下的 `sort_order` 排序；
- API 返回时可组装成当前前端需要的 `children` 树。

`collapsed` 不建议作为节点业务字段。更合理的方案：

- 单用户应用：保存在前端 localStorage；
- 多端同步需要：放在 `user_node_ui_state` 表；
- 不应让一个用户的折叠状态影响其他用户。

### task_history

```text
id UUID
task_id UUID
node_id UUID nullable
actor_id UUID
event_type string
payload JSON
message_zh nullable
message_en nullable
created_at timestamp
```

推荐 `event_type`：

```text
task.created
task.updated
task.deleted
task.group_changed
task.focus_added
task.focus_removed
node.created
node.updated
node.status_changed
node.record_updated
node.deleted
node.reordered
```

### user_settings

```text
user_id UUID
language
compact_mode
show_updated_time
confirm_delete
flow_column_ratios JSON
updated_at
```

## 18.3 推荐 API

### 首屏聚合

```http
GET /api/v1/bootstrap?focusDate=2026-07-12
```

返回：

```json
{
  "groups": [],
  "tasks": [],
  "dailyFocusTaskIds": [],
  "settings": {},
  "serverTime": "2026-07-12T20:00:00+08:00"
}
```

首屏使用聚合接口可以避免大量串行请求。

### 任务

```http
POST   /api/v1/tasks
PATCH  /api/v1/tasks/{taskId}
DELETE /api/v1/tasks/{taskId}
GET    /api/v1/tasks/{taskId}
```

### 今日聚焦

```http
PUT    /api/v1/daily-focus/{date}/tasks/{taskId}
DELETE /api/v1/daily-focus/{date}/tasks/{taskId}
PATCH  /api/v1/daily-focus/{date}/order
```

### 分组

```http
POST   /api/v1/groups
PATCH  /api/v1/groups/{groupId}
DELETE /api/v1/groups/{groupId}
PATCH  /api/v1/groups/order
```

### 节点

```http
POST   /api/v1/tasks/{taskId}/nodes
PATCH  /api/v1/nodes/{nodeId}
DELETE /api/v1/nodes/{nodeId}
PATCH  /api/v1/tasks/{taskId}/nodes/order
```

创建节点请求示例：

```json
{
  "parentId": null,
  "insertAfterId": "node-uuid",
  "title": {
    "zh": "新的处理步骤",
    "en": "New Workflow Step"
  },
  "relation": {
    "zh": "承接前一处理步骤",
    "en": "Follows the previous workflow step"
  },
  "status": "todo"
}
```

### 历史

```http
GET /api/v1/tasks/{taskId}/history?cursor=...
```

### 设置

```http
GET   /api/v1/settings
PATCH /api/v1/settings
```

### 导出

```http
GET /api/v1/export
```

可返回 JSON 文件，包含数据版本和导出时间。

---

## 19. 现有函数到后端接口的映射

| 当前函数 | 后端化后的行为 |
|---|---|
| `createTask()` | `POST /tasks`，成功后加入 store |
| `renameTask()` | `PATCH /tasks/{id}` |
| `toggleToday()` | `PUT/DELETE /daily-focus/{date}/tasks/{id}` |
| `moveTaskToGroup()` | `PATCH /tasks/{id}` 修改 `groupId` |
| `deleteTask()` | `DELETE /tasks/{id}` |
| `createGroup()` | `POST /groups` |
| `renameGroup()` | `PATCH /groups/{id}` |
| `deleteGroup()` | `DELETE /groups/{id}`，后端完成任务迁移 |
| `addRootNode()` | `POST /tasks/{taskId}/nodes`，`parentId=null` |
| `addSiblingNode()` | `POST /tasks/{taskId}/nodes`，传相同 parentId 和 insertAfterId |
| `addChildNode()` | `POST /tasks/{taskId}/nodes`，传 parentId |
| `updateNodeField()` | `PATCH /nodes/{id}` |
| `saveRecordModal()` | `PATCH /nodes/{id}` 修改 record |
| `deleteNode()` | `DELETE /nodes/{id}`，后端级联删除子树 |
| `updateTaskText()` | 防抖后 `PATCH /tasks/{id}` |
| `applySettings()` | 本地立即应用，异步 `PATCH /settings` |
| `exportData()` | 调用服务端导出接口或导出当前 store |

---

## 20. 后端接入时必须增加的前端状态

当前页面只有成功路径。接 API 后至少需要：

```ts
interface AsyncState {
  bootstrapLoading: boolean;
  currentTaskLoading: boolean;
  savingFields: Set<string>;
  deletingIds: Set<string>;
  error: AppError | null;
  offline: boolean;
}
```

用户界面建议：

- 左下角“自动保存已开启”改为动态状态：
  - 已保存；
  - 保存中；
  - 保存失败；
  - 离线，等待同步。
- 删除时禁用重复操作；
- 节点记录保存按钮显示保存中；
- 请求失败时保留用户输入并允许重试；
- 切换任务时取消旧请求，避免响应乱序。

---

## 21. 保存策略建议

### 文本框

背景、进展、结果、笔记当前每个字符都保存。接 API 后建议：

```text
输入时更新本地 store
500–800ms 防抖发送 PATCH
失焦时立即 flush
页面关闭前尝试发送剩余修改
```

### 标题和状态

标题仍可在 `change` 或失焦时保存。

状态应立即保存，并使用乐观更新：

1. 先更新 UI；
2. 调用 API；
3. 失败则回滚；
4. 显示错误提示。

### 并发冲突

任务和节点建议增加：

```text
revision
```

更新时传：

```http
If-Match: revision
```

或请求体：

```json
{
  "revision": 12,
  "status": "done"
}
```

冲突返回 `409 Conflict`，前端提示用户刷新或合并。

---

## 22. 推荐前端工程化目录

可以继续使用 Vanilla JavaScript，也可以迁移到 React/Vue。为了降低风险，建议先保持 DOM 结构和 CSS 类名，再模块化逻辑。

```text
frontend/
├── app/renderer/index.html
├── app/renderer/src/
│   ├── main.js
│   ├── app-version.js
│   ├── styles/
│   │   ├── tokens.css
│   │   ├── layout.css
│   │   ├── sidebar.css
│   │   ├── flow.css
│   │   ├── modal.css
│   │   └── responsive.css
│   ├── i18n/
│   │   ├── zh.js
│   │   ├── en.js
│   │   └── index.js
│   ├── models/
│   │   ├── task.js
│   │   ├── node.js
│   │   └── group.js
│   ├── store/
│   │   ├── state.js
│   │   ├── selectors.js
│   │   └── actions.js
│   ├── repositories/
│   │   ├── task-repository.js
│   │   ├── local-storage-repository.js
│   │   └── http-task-repository.js
│   ├── api/
│   │   ├── client.js
│   │   ├── tasks.js
│   │   ├── groups.js
│   │   ├── nodes.js
│   │   └── settings.js
│   ├── render/
│   │   ├── sidebar.js
│   │   ├── groups.js
│   │   ├── task-detail.js
│   │   ├── flow.js
│   │   └── history.js
│   └── controllers/
│       ├── task-controller.js
│       ├── flow-controller.js
│       ├── modal-controller.js
│       └── settings-controller.js
└── tests/
```

如果迁移到 React，建议组件：

```text
AppShell
Sidebar
TodayFocus
TaskRepository
TaskGroups
TaskWorkspace
TaskContextPanel
WorkspaceTabs
FlowTable
FlowStage
FlowNodeRow
NodeRecordModal
SettingsPopover
ContextMenu
Toast
```

不要在迁移框架时顺便重新设计界面。先做到行为和视觉等价，再逐步优化。

---

## 23. localStorage 到后端的数据迁移

建议提供一次性迁移流程。

### 步骤 1：读取旧数据

```js
const legacyData = JSON.parse(
  localStorage.getItem("task-track-data-v3") || "null"
);
```

### 步骤 2：校验

至少校验：

- groups 和 tasks 是否为数组；
- ID 是否存在；
- status 和 priority 是否在枚举中；
- children 是否为数组；
- 双语字段格式是否正确；
- 节点是否存在循环或过深嵌套。

### 步骤 3：上传

```http
POST /api/v1/import/legacy-v3
```

### 步骤 4：服务端转换

- 数字 ID 转 UUID；
- 数组位置转 `sort_order`；
- children 嵌套转 `parent_id`；
- `today: true` 转为当天的 daily focus；
- `updated: "未开始"` 转为 null；
- 普通时间字符串尽量解析，否则保留在 legacy payload 中。

### 步骤 5：保留备份

迁移成功前不要删除 localStorage。建议写入：

```text
task-track-data-v3-migrated-backup
```

---

## 24. 验收测试清单

### 24.1 今日任务

- 选择任意分组后，今日任务数量和内容不变；
- 搜索关键字仍可过滤今日任务；
- 切换今日状态后列表立即更新；
- 今日任务仍是页面最强视觉区域。

### 24.2 分组

- 横向展示；
- 滚轮可以横移；
- 双击空白新建；
- 双击分组重命名；
- 右键可以增删改；
- 未分组不能删除和重命名；
- 删除分组后任务进入未分组。

### 24.3 处理流

- 主节点顺序轴连续；
- 主节点序号正确；
- 父子节点缩进和连线清晰；
- 主轴与父子线不重叠；
- 四种状态形态区别明显，但没有大面积状态底色；
- 已完成节点有删除线；
- 折叠后子节点隐藏；
- 展开全部 / 收起全部有效；
- 右键节点增删有效；
- 删除父节点时子树一起删除。

### 24.4 节点记录

- 点击摘要打开浮窗；
- 保存后列表摘要更新；
- `Ctrl/Command + Enter` 保存；
- Esc、遮罩和取消可以关闭；
- 保存后更新时间变化；
- 保存后历史增加记录。

### 24.5 列宽

- 桌面端可拖动；
- 双击恢复默认；
- 键盘方向键可调整；
- 刷新后列宽保持；
- 隐藏更新时间后剩余列正常；
- 移动端不启用拖动。

### 24.6 中英文

- 页面 UI 全部切换；
- 状态和优先级切换；
- 用户内容读取当前语言字段；
- 中文编辑不覆盖英文；
- 英文编辑不覆盖中文。

### 24.7 响应式

- 1180px 以下更新时间列隐藏；
- 870px 以下左右布局改为上下布局；
- 移动端处理流表头隐藏；
- 浮窗在移动端可完整使用；
- 页面无横向溢出。

---

## 25. 后续优先级建议

### P0：后端融合前必须完成

1. 把单文件拆分为可维护模块；
2. 定义 TypeScript/JSON Schema；
3. 增加 repository/service 层；
4. 标准化 ID、时间和排序字段；
5. 把 today 布尔值改为日期聚焦模型；
6. 增加 API 错误、加载、重试和保存状态；
7. 增加 localStorage 数据迁移方案；
8. 建立核心交互自动化测试。

### P1：基础项目能力

1. 任务级状态和优先级编辑；
2. 节点和任务拖拽排序；
3. 完整全文搜索；
4. 数据导入；
5. 更完整的历史审计；
6. 未保存记录提醒；
7. 任务创建、节点创建改为自定义浮窗，替代浏览器 prompt。

### P2：扩展能力

1. 截止日期和提醒；
2. 历史日期的今日任务；
3. 标签；
4. 附件；
5. Markdown 笔记渲染；
6. 多用户协作；
7. 实时同步；
8. 离线缓存与冲突合并。

---

## 26. 给 Codex 的执行要求

将本说明和 `prototypes/demos/task-track.html` 一起交给 Codex，并明确以下要求：

1. 以当前 v1.3.1 HTML 为视觉和交互基线；
2. 不要重做 UI，不要引入高饱和状态色；
3. 今日任务必须保持唯一强视觉焦点；
4. 分组选择不得影响今日任务；
5. 主流程顺序和父子关系的两套视觉通道必须保留；
6. 处理流状态必须继续采用删除线、粗细、虚线、空心等形态差异；
7. 中英文业务数据必须保持双字段，不可只翻译 UI；
8. 所有现有 CRUD、右键、双击、列宽、记录浮窗和响应式行为必须有回归测试；
9. 先建立数据访问抽象，再接后端，不要把 fetch 散落在渲染函数中；
10. 后端必须使用标准时间、稳定 ID、显式 sort_order 和并发版本字段；
11. 前后端融合后提供旧 localStorage 数据迁移；
12. 任何有意改变现有交互的地方，必须单独列出并获得确认。

建议给 Codex 的简化任务描述：

```text
请以 prototypes/demos/task-track.html v1.3.1 和《Task Track 前端项目交接说明》为唯一基线，先保持视觉和交互等价，将单文件前端模块化，并建立 LocalStorageRepository / HttpTaskRepository 数据访问层。随后实现后端数据库、REST API、用户设置、按日期的今日聚焦、任务/分组/树节点 CRUD、排序、历史审计和旧数据迁移。不得改变“今日任务是唯一强视觉焦点”“分组筛选不影响今日任务”“主流程顺序与父子层级分开表达”“节点状态通过形态而非大面积色彩区分”等产品原则。完成后为关键逻辑补充自动化测试和前后端契约测试。
```

---

## 27. 最终交接结论

当前版本已经完成了一个功能较完整的纯前端原型，主要价值在于：

- 产品信息架构已经基本稳定；
- 今日任务的视觉优先级已经明确；
- 任务仓库和分组逻辑已经明确；
- 处理流的主顺序和父子层级表达已经形成；
- 节点状态已经形成低色彩、形态化区分方案；
- 中英文 UI 和双语业务内容机制已经建立；
- 节点记录浮窗、列宽调整、右键操作和响应式交互已经实现。

下一阶段不应继续把主要精力放在单文件中堆功能，而应进入：

```text
结构化数据模型
→ 前端模块化
→ 数据访问抽象
→ 后端 API 和数据库
→ 数据迁移
→ 自动化测试
→ 多端同步
```

只要后续开发严格保留本文列出的产品原则、数据语义和交互约束，就可以在不破坏现有体验的前提下，完成前后端融合和正式项目化。
