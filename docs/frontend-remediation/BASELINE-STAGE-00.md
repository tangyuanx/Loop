# 阶段0基线、边界与验证清单

日期：2026-10-26（Asia/Shanghai）。本文件记录阶段0实际结果，不能替代用户验收，也不启动阶段1。

## 固定现场

| 项目 | 实际值 |
| --- | --- |
| 工作区 | `/Volumes/T7/work/personal-task-track` |
| 唯一整改分支 | `codex/frontend-remediation`，后续阶段继续在此累计 |
| 基线 | `482912b76c8666af849bbbdfd2ea806ba87bbaa4`，已 fetch 并用 ls-remote 核对 main |
| 基线版本 | `0.1.245`；从原 working package 0.1.232 同步已有远端代码，不是本轮升版 |
| origin | `git@github.com:tangyuanx/personal-task-track.git`；远端 package 已使用 Loop 名称，未自行更换 origin |
| 标签事实 | 远端已有 v0.1.246、v0.1.247 标签，但 main 指向上述基线；本阶段未以标签替代 main、未创建版本 |
| 原现场 | `codex/preserved-main-20261024`，HEAD `4a16c1bad515bf39d24c76aa34a6d08b2b2eb059`；原分支指针保留 |
| 其他工作区 | main、flow-empty-state、settings-control-width 等原 worktree 均未修改或删除 |
| 检查环境 | Apple M4 / 16 GiB / macOS arm64；命令行 Node 25.3.0；Electron 42.7.0 / Chromium 148 |

## 原工作与备份

所有本阶段证据位于 `.local-review/frontend-remediation/stage-00/`。

`backup-original/manifest.json` 记录1920个原文件，218816202字节，逐文件SHA-256复制验证后再次复核。`MANIFEST.sha256`校验清单本身。范围包括原 tracked 工作内容、必要 untracked 源码和历史资料、执行包、共享状态、研究文档及计划。另有原Git索引 `git-index`、`staged.patch`、`unstaged.patch`、`head.patch`、`refs.txt`、`worktrees.txt`；可恢复原 staged/unstaged 区别及旧分支对应文件内容。忽略的依赖和各活动profile不是这份源码备份的范围。

原 `node_modules` 目录完整移至 `dependencies-original/`。当前 `node_modules` 仅链接到本机已安装且与当前锁文件一致的运行时：`/Users/xuetangyuan/.codex/worktrees/knowledge-release-fixes/personal-task-track/node_modules`。核对625项版本相同，25项缺省均为其他平台optional依赖。没有更新锁文件或安装新版本。后续不要删除该运行时所在worktree；若需要独立依赖，先准备同锁文件运行时再替换链接。该链接以 `.git/info/exclude` 的本地规则忽略，禁止再次把它加入Git。

### 差异归类与去向

完整逐文件清单及原/远端校验值在 `classification.json`，具体归档/切换在 `transition-report.json`，备份和授权范围的复核证据在 `alignment-safety-proof.json`。

| 分类 | 处理与原因 |
| --- | --- |
| 远端已有内容 | 5个原文件与远端相同；基线保留远端版本，原件仍在备份。包括旧发布工作流等，不执行历史发布 |
| 旧编辑器/体验实现 | 17个 tracked 差异按文件归档后对齐基线；旧 CodeMirror 入口、资产scope、保存队列、改名和测试等与远端 v0.1.233–245 的后续实现重叠，不覆盖已修复的Recovery、冲突和工作台链路 |
| 仍有独立价值的用户工作 | `app/main/knowledge-watcher.cjs` 的外部卷 stat polling 补偿原样保留；从旧desktop测试保留轮询清理用例为 `tests/knowledge-watcher-polling.test.cjs`，专项通过 |
| 旧未跟踪源码/生成资源 | 73个文件移到 `archived-old-extra/`，均另有 `backup-original/files/` 原件。包括旧编辑器源文件、60个旧生成字体、已进远端的碰撞文件及旧测试；不是删除 |
| 历史/演示资料 | `prototypes/`、其README及原候选原路径保留，不加入正式入口；不以模拟Demo替换真实应用 |
| 当前规范/工具/研究 | AGENTS、PRODUCT、整改执行包、架构分析、历史测试资料、只读工具和规划文件保留。原根目录任务计划不覆盖 |
| 仍需阶段4判断 | 原 `shellRememberKnowledgePreferences` 的编辑模式/页宽记忆等细节只做归档，不宣称与远端完全等价；阶段4结合当前 `knowledge-workspace.js` 决定是否迁入。不能把旧 `app.js` 或旧编辑器整包恢复 |

首次广泛归档请求被自动审批拒绝，未执行任何文件切换。补充“用户明确调用阶段0第2/4/5项、没有前阶段成果、1920文件再次校验、17 tracked/73 untracked精确清单”的证据后，复审允许才执行。没有绕过审批、reset/clean、提交、stash丢弃或整目录覆盖。

外置盘 `.git/objects/pack/._*.idx` 为AppleDouble附属文件，曾导致non-monotonic index报错；只把已校验的附属文件移至 `backup-original/git-appledouble/`。fetch新生的一份同类文件也先核对魔数再归档；真实pack和idx不动。

### 恢复注意

- 需要查看旧工作时，优先读取备份或归档中的单文件；不要把旧编辑器整包覆盖到整改工作区。
- 原HEAD、原索引与三份binary patch能重建原现场。恢复完整旧现场前须先保护届时的累计整改内容，并明确切回原preserved基线；不能把旧索引直接套在新分支。
- 原正式默认数据目录为 `~/Library/Application Support/Personal Task Track`。本阶段未读取其任务内容、未写入该目录，也未关闭已有实例；因此没有对正在使用的正式数据做不一致的热复制。
- 旧候选source、DESIGN/direction和flat-editors证据共535文件校验未变。候选各活动profile和其他会话窗口保持独立，不声称其缓存永不被自身进程更新。

## 候选8文件的迁入边界

参考路径：`.local-review/microcontrast-20261026/`。已核对 `source`、`DESIGN.md`、`direction.md` 及 `evidence/flat-editors/`；候选与最新origin/main恰有以下8个产品/测试差异。机器清单为 `candidate-and-entries.json`，5个既有文件的逐项diff已存同目录。

| 文件 | 后续处理 |
| --- | --- |
| `app/renderer/index.html` | 阶段1按公共层职责接入三个入口，不能只照抄主窗口末层CSS/script |
| `app/renderer/src/neutral-inputs.css` | 阶段1提取用户硬规则：输入/父容器无绿边、原位透明、稳定搜索微色阶、中性可见键盘焦点；收口样式归属，不把高权重覆盖堆积作为永久方案 |
| `app/renderer/src/quiet-surface.css` | 阶段1迁基础色/字重/动效角色，阶段2迁导航与列表，阶段3迁处理流呈现；保留字体字号偏好和 reduced-motion |
| `app/renderer/src/quiet-surface.js` | 阶段3评估折叠render包装、Grid过渡及清理；必须比较大树DOM/遍历成本，沿用真实折叠与拖动 |
| `app/renderer/src/workspace.js` | 阶段3评估保留收起子树DOM、`inert`/`aria-hidden`；不提前整包迁入 |
| `app/renderer/src/app.js` | 阶段1只评估无动作、无关闭回调的纯通知2.5秒自熄；错误/冲突/撤销等保留原语义和时长 |
| `app/renderer/src/shell.js` | 差异中的“设计预览”字样和临时主题按钮为预览专属，不进入正式版 |
| `tests/desktop.test.cjs` | 候选仅调整加载顺序断言；实际公共层接入时按真实新顺序更新，不能删除保护用例 |

候选演示任务、独立profile、`launch.cjs`、`seed.cjs`、检查辅助和调试端口同样是预览资料。本阶段未复制候选应用、未改正式CSS或渲染业务。

## 三入口、功能与状态清单

| 入口/区域 | 现有归属与保留能力 | 必须覆盖的状态与后续阶段 |
| --- | --- | --- |
| 主入口 `index.html`（29 CSS / 28 script） | shell/app区域复用；navigation/topbar/task-list/workspace；真实状态和持久化 | 明暗、窄窗、键盘、加载、禁用、错误；阶段1公共规则 |
| 导航、仓库、分组、搜索/筛选/批量 | shell/actions/management24；今日/全部/分组/速记与范围模型 | 默认、空列表、无匹配、长标题、多分组、筛选摘要、返回范围；阶段2 |
| 标题/简报/历史/处理树/记录 | workspace/brief21/app；父子ID、状态、折叠、长按拖动与区域复用 | 空树、多层/大树、长记录、改名、拖动取消、Undo/草稿；阶段3 |
| 知识工作区 | knowledge-core/editor/workspace/document；CodeMirror实例/DOM缓存、SerialQueue、Recovery、外部监听 | 阅读/编辑/源码、查找、表格、图片、链接、保存中/失败/冲突/丢失/只读/恢复；阶段4 |
| 工作导航、日历、回顾 | work/work-navigation-model/pages/time/clock；真实阶段和双队列 | 空/长列表、日期范围、返回上下文、时区边界；阶段5 |
| 设置、恢复、帮助与反馈 | settings/recovery26/manual27/main；六类设置、最近删除、提醒、更新、导出、备份 | 成功/加载/失败/重试/确认/撤销、缺权限和损坏数据；阶段6 |
| 今日 `today-widget.html`（9 CSS / 2 script） | today-widget-runtime/main；任务/速记、草稿、排序、置顶、穿透、几何 | 默认、空、长标题、改名、键盘、跨窗同步；阶段1基础硬规则先接入，阶段7整体设计 |
| 辅助 `widget-surface.html`（8 CSS / 2 script） | 独立BrowserWindow；设置、行菜单、速记升级、删除确认 | 明暗、焦点返回、取消、窗口定位、关闭和多屏；阶段7 |

本阶段实际验证：正常8任务/6节点、空数据、明暗、主窗口1280×820与1024×820、今日与设置辅助窗、搜索默认/聚焦及Tab、实际树折叠、CodeMirror真实键盘输入与Undo、无renderer pageerror。其他状态是明确的后续核对项，不能把fixture准备或单元测试当作原生视觉验收。

### 发现的既有界面问题

`electron-baseline.json` 的focus记录显示：搜索内部透明，但父 `.list-search:focus-within` 仍转为带绿色分量的边线，且聚焦会换底色，明暗均存在。阶段1必须按用户硬规则统一消除，覆盖父容器、hover/focus-visible和全部输入类别。当前截图是未整改基线，不能声称已符合最终输入契约。阶段0没有引入新输入样式，也不越界实施阶段1。

## 隔离数据与检查

`fixtures/manifest.json` 记录经过生产 `normalizeTaskData` 的7类合成种子与校验值：empty、normal（8任务）、long-content（长标题/52807字符、148813字节笔记）、multi-group（16组/80任务）、multi-level（4层树）、performance-medium（300任务/3000节点）、error-states（冲突/只读/丢失元数据）。异常元数据种子不是实际文件权限或外部写入故障的证明，阶段4/6仍需真实IPC专项。

- `review-profile/`：正常合成数据，已校验副本；当前保持打开供用户审阅。
- `empty-profile/`：独立空数据；真实Electron明暗检查完成，测试实例已关闭。
- `prepare-fixtures.cjs` 初次运行拒绝覆盖已有profile；`--fixtures-only`只更新合成种子，不碰任何profile。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| `node tools/frontend-remediation.cjs check 0` | 通过；dirty提示为正常累计状态 | `preflight-final.log` |
| `npm run check` | 两个编辑器构建、服务构建、347主测试及12服务测试全部通过，无跳过 | `npm-check.log` |
| 阶段工具+原watcher专项 | 6/6通过；fixture显式清空activeStage，不继承活动现场污染场景 | `stage-tests.log` |
| `git diff --check`、新增脚本语法 | 通过 | `final-checks.log` |
| 原生真实主/今日/辅助入口 | 明暗、两个原生主窗宽度、无页级横向溢出；折叠/输入/Undo通过 | `electron-baseline.json`及PNG |
| 原生空数据 | 明暗通过，无pageerror | `empty-preview.json`及PNG |
| 旧候选保护 | 535个源码/参考/flat-editors文件哈希不变 | `candidate-preservation.json` |

检查过程中旧依赖缺7项渲染依赖，首次构建失败；按锁文件复用完整本机运行时后重跑全量通过。阶段工具首次2项失败源于fixture继承真实activeStage，已修正测试隔离后6项通过。预览检查器首次无全局require，改用该实例主模块访问后通过，未改应用源码。

## 性能基线与待补

同机、真实Electron、正常8任务/6节点，12次采样，仅测同步 `render()` 的CPU耗时：

| 操作 | 中位数 | P95 |
| --- | --- | --- |
| 任务切换render | 4.6ms | 5.3ms |
| 搜索render | 3.8ms | 5.3ms |

这些数值不是输入到绘制延迟或整机性能保证。阶段3用performance-medium补充冷启动、折叠/展开、DOM规模、连续滚动、输入到绘制、长按拖动与内存；阶段4增加长笔记与缓存切换；阶段8做相同机器/数据/窗口的前后对照。Windows原生、多屏、不同DPI/字体和打包安装器均未实测；本阶段不构建发布包。

## 当前预览与后续接手

主实例由本工作区 `npm run dev -- --remote-debugging-port=9490 --inspect=9491` 启动，环境变量 `LOOP_USER_DATA_DIR` 指向 `stage-00/review-profile`。可识别窗口标题为“Loop · 阶段0基线（隔离数据）”；当前浅色1280×820，附属今日窗口属于同一profile。调试端口仅为本地检查辅助，关闭本实例时即可释放。不要关闭已有其他profile窗口。

下一会话读取COMMON/state/DECISIONS、本文件和handoffs/STAGE-00，核对真实用户继续指令后运行对应阶段check。沿用当前分支和全部累计文件，不重新pull/reset或建立新worktree。阶段0状态ready_for_review仅表示可审阅；没有下一阶段或发布批准。
