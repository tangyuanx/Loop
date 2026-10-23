# Loop 功能地图

> 最近核对：2026-09-03，面向 v0.1.159 截至提醒配置版本。
>
> 本文使用函数名和文件职责定位，不再维护容易漂移的行号。查找实现时优先运行
> `rg -n "function 函数名|data-action=\"动作名\"" app tests tools`。

## 1. 架构

```text
app/renderer/index.html
├─ app/renderer/src/styles.css                 主题、布局、响应式、无障碍状态
├─ app/renderer/src/vendor/milkdown-editor.*  由 esbuild 生成的 Milkdown 浏览器资源
└─ app/renderer/src/app.js                    渲染进程的状态、DOM、事件和业务逻辑
   ├─ app/main/preload.cjs                  安全 contextBridge
   ├─ app/main/main.cjs                     BrowserWindow、IPC、剪贴板、导出
   ├─ app/main/deadline-reminders.cjs       截至提醒调度、去重与通知分组
   └─ app/main/storage.cjs                  数据规范化、损坏备份、原子读写
```

核心数据流：

```text
用户操作
→ action(data) / edit(data, value)
→ 修改 state
→ render()
→ capture/flush 编辑器草稿
→ save()
→ Electron IPC 或 localStorage
```

`render()` 会重建主要 DOM。不要跨渲染保留普通 DOM 引用；Milkdown 通过独立缓存和销毁流程处理。

## 2. 文件职责

| 文件 | 职责 |
|------|------|
| `app/renderer/src/app.js` | 全部渲染进程状态、查询、渲染、事件、CRUD、回顾、Markdown、导出编排 |
| `app/renderer/src/styles.css` | 浅色/深色主题、桌面/窄屏布局、组件状态、键盘焦点、减少动效 |
| `app/renderer/src/milkdown-editor.entry.js` | Milkdown/Crepe 封装、持久化图片上传、图片命令 |
| `app/main/main.cjs` | 窗口安全配置、IPC、系统剪贴板、Markdown/PDF 导出 |
| `app/main/deadline-reminders.cjs` | 截至提醒扫描、提前量计算、持久化去重、系统通知及点击路由 |
| `app/main/preload.cjs` | 向渲染进程暴露最小化存储、剪贴板和导出 API |
| `app/main/storage.cjs` | 任务数据规范化、旧字体迁移、损坏 JSON 备份、原子写入 |
| `tests/desktop.test.cjs` | Node 回归测试与渲染脚本 VM 测试夹具 |
| `tools/build-milkdown.cjs` | 构建 Milkdown JS/CSS |
| `tools/build.cjs` | 调用 electron-builder；外置卷自动使用本机临时输出；复制发布产物并清理 AppleDouble |
| `tools/after-pack.cjs` | 清理应用包内 AppleDouble 文件 |
| `.github/workflows/build.yml` | `main`、PR 和手动触发的双平台 CI |
| `.github/workflows/release.yml` | `v*` 标签触发的 GitHub Release |

## 3. 数据模型与兼容

### 任务

```ts
interface Task {
  id: string;
  order: number;
  groupId: string;
  title: string;
  description: string;
  status: "active" | "done";
  priority: "high" | "medium" | "low";
  tags: { today: boolean; later: boolean; blocked: boolean };
  hypothesis: string;
  hypothesisUpdatedAt: string;
  conclusion: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
  deadlineAt: string;
  deadlineReminderMinutes: 0 | 5 | 15 | 30 | 60 | 120 | 1440 | 2880 | 10080 | null;
  nodes: TaskNode[];
}
```

### 节点

```ts
interface TaskNode {
  id: string;
  taskId: string;
  parentId: string | null;
  order: number;
  type: "step" | "subtask";
  title: string;
  status: "todo" | "done" | "blocked" | "later";
  note: string;
  hypothesis: string;
  conclusion: string;
  createdAt: string;
  updatedAt: string;
  collapsed: boolean;
  children: TaskNode[];
}
```

兼容入口：

- 渲染进程：`normalizeTasks()`、`normalizeNodes()`、`normalizeTaskGroups()`、`normalizeAttachments()`。
- 桌面存储：`normalizeTaskData()`、`normalizeTasks()`、`normalizeTaskNodes()`。
- 两端都必须保证字符串字段、状态、优先级、顺序、ID、父子关系、时间戳和附件可安全使用。
- 旧 `font` 值由 `migrateLegacyFont()` 迁移为 `zhFont` / `enFont`。
- 损坏 JSON 由 `backupCorruptData()` 改名保存后返回空数据，不直接覆盖。

## 4. 启动与持久化

| 功能 | 位置 |
|------|------|
| 启动 | `app/renderer/src/app.js` → `bootstrap()` |
| 桌面/浏览器加载 | `loadAppData()` |
| 浏览器任务加载 | `loadBrowserTasks()` |
| 保存队列 | `save()`、`flushSave()` |
| Milkdown 草稿入库 | `captureMountedMilkdownDrafts()`、`flushNodeNoteDrafts()` |
| 桌面读取 | `app/main/storage.cjs` → `readTaskData()` |
| 桌面写入 | `writeTaskData()` |

Electron 保存通过 `.tmp` 文件加 `rename` 完成原子替换。浏览器预览使用多个 localStorage 键。

## 5. 任务、分组与处理流

### 任务

| 功能 | 函数 |
|------|------|
| 创建 | `createTask()`、`createTaskFromBlank()`、`addBlankTask()` |
| 编辑 | `edit()` |
| 删除 | `deleteTask()` |
| 完成/恢复 | `toggleTaskDone()` |
| Today/稍后/卡住 | `toggleTaskTag()` |
| 过滤和搜索 | `filteredTasks()`、`taskListScopeTasks()` |
| 今日聚焦 | `todayFocusItems()`、`nextOpenNode()` |
| 拖拽排序 | `reorderTasks()` 及 `start/update/finishTaskPointerDrag()` |
| 全局打开 | `openTaskFromGlobalList()` |

### 分组

| 功能 | 函数 |
|------|------|
| 选择 | `selectGroup()` |
| 新增 | `addGroup()` |
| 重命名 | `startRenameGroup()`、`renameGroup()` |
| 删除并迁移任务 | `deleteGroup()` |
| 排序 | `reorderGroups()` |

### 节点

| 功能 | 函数 |
|------|------|
| 新增根/子/同级节点 | `addNode()`、`addSiblingNode()` |
| 完成切换 | `toggleNodeDone()` |
| 状态设置 | `markNodeStatus()` |
| 展开/收起 | `toggleNodeCollapse()`、`toggleAllNodes()` |
| 删除子树 | `deleteNode()`、`removeNode()` |
| 查找/展平 | `findNode()`、`findNodeCollection()`、`flatten()` |
| 节点记录浮窗 | `renderNodeDetail()`、`saveSelectedNodeRecord()`、`exitNodeDetail()` |

## 6. 渲染与事件

| 区域 | 函数 |
|------|------|
| 主渲染 | `render()` |
| 侧栏 | `renderSidebar()` |
| 今日任务 | `renderTodayFocus()`、`renderTodayFocusItem()` |
| 分组导航 | `renderGroupTabs()` |
| 任务工作台 | `renderTaskPage()`、`renderTaskPaneTabs()` |
| 处理流 | `renderFlowHeader()`、`renderFlowNode()` |
| 知识笔记 | `renderTaskKnowledge()` |
| 历史处理 | `renderTaskHistory()` |
| 设置 | `renderSettingsPanel()` |
| 回顾 | `renderReviewPanel()` |
| 右键菜单 | `renderContextMenu()`、`syncContextMenuRoot()` |
| 统一动作 | `action()` |
| 输入修改 | `edit()` |
| DOM 事件绑定 | `bind()` |

可交互的非原生按钮项目使用 `role="button"`、`tabindex="0"`，并在 `bind()` 中补 Enter/Space 激活。全局 `Esc` 关闭右键菜单、节点记录、设置或回顾弹层。

## 7. Markdown、图片与导出

### Milkdown

- `mountMilkdownEditors()` 创建任务级知识笔记编辑器。
- `mountFallbackMarkdownEditor()` 在 Milkdown 初始化失败时保留 textarea。
- `app/renderer/src/milkdown-editor.entry.js` 将粘贴图片保存为 data URL，避免 blob URL 在重载后失效。
- `insertMarkdownImage()` 优先调用 Milkdown 官方图片命令，降级路径使用 `task-image:` 附件引用。

### Markdown 渲染

- 完整渲染：`renderMarkdown()`。
- 行内渲染：`renderInlineMarkdown()`。
- URL 白名单边界：`safeMarkdownUrl()`、`resolveMarkdownImageUrl()`。
- 表格：`isMarkdownTableDivider()`、`splitMarkdownTableRow()`、`renderMarkdownTable()`。

### 导出

- 任务序列化：`taskMarkdown()`。
- 任务导出：`shareTask()` → `task:export-document`。
- 节点 PDF：`exportNodePdf()` → `node-detail:export-pdf`。
- 导出前会捕获并刷新当前 Milkdown 草稿，避免丢失最后一次输入。

## 8. 回顾、主题与布局

| 功能 | 函数 |
|------|------|
| 周/月/年/全部/自定义回顾 | `reviewRange()`、`customReviewRange()`、`reviewTasks()` |
| 创建/更新/解决日期切换 | `taskReviewDate()` |
| 主题/字体/筛选设置 | `applySetting()` 和 `normalize*` 设置函数 |
| 处理流列宽 | `startColumnResize()` |
| 侧栏宽度 | `startSidebarResize()` |
| 详情高度 | `startDetailResize()` |
| 主题资源 | `app/renderer/src/styles.css` 中 `:root` 与 `:root[data-theme="dark"]` |

## 9. 检查与发布

```bash
npm test
npm run check
git diff --check
rm -rf release
npm run dist:mac
npm run dist:win
find release -type f -name '._*' -print
```

`npm run check` 会重建 Milkdown、执行关键脚本语法检查并运行 `tests/desktop.test.cjs`。

在 `/Volumes` 外置工作区中，`tools/build.cjs` 会自动把 ASAR 构建输出切换到系统临时目录，再复制最终发布文件回 `release/`；CI 和普通磁盘工作区仍使用默认输出目录。

当前测试覆盖：

- 磁盘数据规范化、旧字体迁移、原子读写和损坏备份；
- 渲染进程对畸形任务/节点的恢复；
- 任务 Markdown 导出；
- 过滤状态下的任务排序；
- 节点状态边界和删除子树后的详情清理；
- Markdown 可执行 URL 拒绝。

发布使用 `main` 加 `v*` 标签；标签由 `.github/workflows/release.yml` 构建 macOS/Windows 安装包并生成 GitHub Release。
