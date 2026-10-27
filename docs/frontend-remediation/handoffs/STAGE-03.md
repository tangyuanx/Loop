# 阶段03交接：任务工作台与真实处理流

## 状态与现场

- 状态：`ready_for_review`，实现、必要检查和真实Electron预览完成；用户审阅仍pending，没有accepted或发布授权。
- 固定工作区 `/Volumes/T7/work/personal-task-track`；分支 `codex/frontend-remediation`；开始/结束HEAD均为 `482912b76c8666af849bbbdfd2ea806ba87bbaa4`；版本保持 `0.1.245`。fetch核实origin/main没有前进，未pull/reset/clean或新建worktree。
- 会话 `frontend-stage-03-20261027-root`，日期2026-10-27（Asia/Shanghai）。开工核对activeStage为空、没有旧阶段3进程；阶段2预览保持不动。
- 修改前18个已有文件备份并SHA校验，位置 `.local-review/frontend-remediation/stage-03/backup-before/manifest.json`。`app.js`、workbench.css未改；阶段1foundation/bridge、阶段2repository/shell/bulk、知识与浮窗原件保留。watcher和prototypes/README与阶段0原件哈希相同。
- 当前预览：**Loop · 阶段3任务工作台与处理流（隔离数据）**，1280×820浅色，今日任务入口，合成数据。正式用户数据没有读写，其他窗口没有关闭。
- 数据目录：`/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-03/review-profile`。启动：`LOOP_USER_DATA_DIR=<该目录> npm run dev -- --remote-debugging-port=9790 --inspect=9791`。运行目录、数据路径、原生窗口大小/标题/交通灯位置核实见`final-preview.json`。后续关闭时只关闭这个阶段3窗口，勿关闭用户或阶段2窗口。

## 实际交付

- 新增`task-workspace.css`并在index中接入，保持foundation最后加载。整理任务标题、属性、简报、页签、历史、保存回执、树线/缩进/状态显隐和记录。局部中性色阶不扩散到设置/日历/知识入口；标题与节点长文继续换行，未固定行高裁字。
- `workspace.js`继续递归渲染真实children；没有假树、新结论列、node-results字段或逐层模式。真实parentId/order、折叠、完成后代筛选、状态和长按移动沿用生产实现。
- Grid过渡复用continuity28的既有render边界。小分支收起期间最多保留160个可见后代、200ms后释放；立即inert/aria-hidden；大分支、原有切换和reduced-motion直接释放。关闭后不留下可Tab到的节点；收起含当前焦点的分支会把焦点放回父折叠按钮。
- 记录有选中节点标题、节点操作入口和展开阅读/退出阅读；窄窗抽屉随真实窗口resize立即更新，不依赖重绘。阅读时flow-pane inert，关闭返回原节点。对记录textarea增加按节点的滚动记忆和同模型/同文本复用，保留选区及编辑日志。
- Chromium的原生文档Undo会在区域DOM脱离后失效，已经真实复现。因此记录控件本地保留有界Undo/Redo（至多24控件，每控件40步/约100万字符），仍经原nodeNoteDrafts及500ms保存路径；同ID但数据模型被恢复/替换时不继承旧日志。没有改存储schema或主进程。
- 简报直接输入保留自动保存；同一会话中多次render不会拆成多条历史，离开后只写一条实际变化；未变化不写。IME确认键不会触发结束编辑。记录绑定使用既有WeakMap入口避免保留DOM重复监听。
- 必要共享调整：工作台焦点记录同时持有动作、节点/任务、页签身份，不再只按首个属性取同节点的首个按钮；阶段2导航/仓库对象焦点分支完整保留。continuity新增记录textarea滚动槽和折叠生命周期接线，原生指针协议未改。
- 三个原浏览器树专项改用`electron-ui-helpers.cjs`启动真实Electron+独立profile，使用真实IPC落盘/重载；不再依赖浏览器localStorage模拟生产数据。continuity专项改用当前生产CodeMirror，并以当前布局的页签往返验证代替已过期历史Demo几何相等。新增`tests/task-workspace.ui.cjs`验证真实会话/草稿/撤销/焦点等行为。

## 前阶段事项的承接与去向

| 来源阶段/文件 | 事项与接手时事实 | 本阶段处理与证据 | 结果/后续目标阶段 |
| --- | --- | --- | --- |
| 阶段0 D11、BASELINE候选8文件 | 工作台/树呈现和Grid/隐藏DOM成本归阶段3；不能整包迁入候选 | 只迁本阶段职责，Grid进入原生命周期并限制短暂DOM；未迁预览字样/临时主题按钮 | 已完成 |
| 阶段0性能清单、阶段0/2交接 | 原先只有8任务/6节点同步render；performance-medium为300任务、每项10节点 | 使用原fixture测普通场景，并把同样3000节点集中到一个真实任务；测DOM、折叠、滚动、输入、长按、冷启动和内存 | 已完成本阶段测量；大树全量重绘成本→阶段8继续同条件复核 |
| 阶段1 D17/D18、阶段2 D19 | foundation持有透明编辑/中性焦点，repository持有导航/仓库 | 未修改原件；10组明暗工作台输入computed style，常驻输入默认/hover/focus、原位自动聚焦状态及父容器；基础专项通过 | 本阶段区域已完成；知识/表格→阶段4，设置/错误→阶段6，今日/辅助完整预览→阶段7，累计复核→阶段8 |
| 阶段1原生启动故障、阶段2 D22 | 阶段1仍blocked，不能把后来成功启动当成阶段1已验收 | 本阶段npm run dev成功、五组真实工作台套件运行、Electron页面截图/运行目录核实。CUA原生外框复核时Mac已锁屏，未取得阶段3原生外框截图 | 旧启动故障未复现；阶段1状态不篡改，三入口完整复核仍按原目标阶段补齐 |
| 阶段2 D21、workspace焦点分支 | 分组/列表不能退回只按动作名定位；bulk稳定代理、范围搜索已接通 | 保留身份分支，补工作台动作身份；product/group/context三组真实回归通过 | 已完成，后续保留 |
| 阶段0 D10、watcher补偿与历史资料 | 必须保留累计原件 | watcher/原型README哈希及冻结CSS检查通过；原件未覆盖 | 已完成，后续保持 |
| 阶段0旧编辑模式/页宽记忆、长笔记 | 已归档，不能整包恢复旧编辑器 | 未改知识编辑器、旧能力不在本阶段恢复 | 仍待处理→阶段4 |
| 阶段0/1/2跨窗与平台项 | 今日/辅助整体、多屏/DPI/原生Windows未实测 | 主窗口在本机Mac真实运行，未用模拟冒充其他平台 | 今日/辅助→阶段7；原生Windows/多屏/DPI→最终平台验收 |

## 检查与证据

下列证据均在`/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-03/`。

| 检查 | 实际操作 | 结果 | 日志/截图 | 限制 |
| --- | --- | --- | --- | --- |
| 前置 | status / check 3、fetch | 工作区/分支/HEAD正确；check 3因阶段1blocked仍未满足，保留失败事实。按本轮真实用户指令继续 | preflight.log | 没有放宽工具或伪造前阶段验收 |
| 工作台专项 | `node tests/task-workspace.ui.cjs` | 简报一次会话历史/IME键保护、12层树键盘、隐藏焦点、折叠中断/裁剪/偏好、记录Undo/Redo/草稿/选区/滚动、替换模型重置日志、删除撤销、下一待处理、精确树落盘重载、明暗窄窗通过 | workspace-ui.log | IME为组合事件，不是人工拼音输入法验证 |
| 树指针/菜单/筛选 | node-interactions、node-context-menu、flow-completed-filter真实Electron套件 | 根/子/同级创建、改名、跨层parentId/order/记录、非法循环、Escape/失焦取消、右键/Shift+F10、完成父节点未完成后代、记录保存、重载均通过 | node-interactions.log、node-menu.log、flow-filter.log | 自动输入不替代所有物理鼠标手感验证 |
| 连续性 | `node tests/continuity28.ui.cjs` | 六向页签、真实编辑器实例/DOM、flow/notes/history独立滚动、记录焦点返回、组身份、当前布局往返通过 | continuity-ui.log | 没有修改原生pointer协议 |
| 阶段1/指针/流程专项 | node --test foundation、remediation、watcher、pointer、continuity-renderer | 28/28，无跳过 | stage-tests.log | Windows指针为单元契约，不是原生Windows实测 |
| 阶段2回归 | product-experience、group-context-menu、context-create真实Electron | 范围/搜索/批量/撤销、分组菜单和键盘焦点、真实空白创建、保留DOM/滚动/落盘通过 | stage2-product.log、stage2-groups.log、stage2-create.log | 仅本机Mac |
| 完整检查 | `npm run check` | 构建、语法、主347/347、服务12/12通过，无跳过 | npm-check.log | 未构建发布包 |
| 语法/样式/保护 | node --check改动脚本、PostCSS、git diff --check、一次Impeccable detector | 通过；detector为[]；备份18文件哈希校验通过 | css-parse.log、diff-check.log、design-detect.json、preservation.json | 原冻结CSS字节检查仍保留 |
| 真实预览 | 从本工作区npm run dev，真实BrowserWindow 1280/1024，light/dark及reduced-motion | 16场景、10组输入及父容器状态，无页面错误、无文档横向溢出；记录/阅读/历史/空/禁用/错误通过 | electron-review.json、workspace/record/drawer/reading/history-{theme}-*.png、empty-flow.png、save-error.png、reduced-motion.png | 是真实Electron renderer截图；没有冒充原生外框或其他平台 |
| 最终现场 | 干净合成数据、清除测试错误反馈、保存并留窗 | 数据路径/appPath/标题/1280×820核实，feedbackVisible=0 | final-preview.json、final-preview.log、review-ready.png | Mac后来锁屏；CUA无法继续原生外框复核，解锁后可直接查看已运行窗口 |

### 性能结果及解释

比较来源为真正修改前`performance-before.json`与其他检查停止后的`performance-idle.json`，同机Electron42.7.0、1280×820、同一数据。中间并行检查时的after/final记录也保留，不作为最终结论。完整方法与限制见`performance-summary.json`。

| 同条件指标 | 改动前 | 最终候选 |
| --- | --- | --- |
| 300任务/3000节点分散、活动任务10节点，12次同步render中位 | 19.75ms | 19.55ms |
| 单任务集中3000节点，全展开同步render中位 / 最大 | 268.45 / 320.9ms | 276.8 / 321.2ms |
| 单任务3000节点，收起全部同步render | 43.6ms | 47.0ms |
| 全展开DOM / 全收起DOM（活动页面） | 41967 / 3087 | 41978 / 3098 |
| 全收起可见行 | 10 | 10，关闭子树内行0 |
| 大树收起后输入到两个rAF中位 | 19.95ms | 13.5ms |
| 大树收起后真实长按激活 / 定位目标 | 208 / 21ms | 210 / 26ms |

候选补测`performance-supplement.json`：300任务冷启动至.app 936ms、两个rAF 974ms；3000节点全展开输入到两个rAF中位31.85ms、最大186.1ms；连续滚动2400px的帧间隔中位6.9ms、最大27.2ms；真实await折叠/展开到两个rAF约341.7/374.1ms。强制GC后JS堆全展开约17.46MB、全收起约16.24MB，关闭子树行0。

- 两个rAF只是绘制机会的代理，不是物理屏幕端到端延迟；全展开输入补测为DOM输入事件，基准收起后输入使用真实Electron键盘。
- 原始measure的单分支collapse/expand字段只计到异步action派发，**不能作为完整渲染耗时**；已明确废弃，完整await测量只在supplement中。本轮没有同方法的改动前冷启动/全展开输入记录，不伪造对照。
- 原始heap/counter取样受GC时机影响；不拿它们宣称内存改善。强制GC补测是当前候选内部对照。
- 3000节点全展开仍有明显全量重绘成本，不能宣称60fps。当前策略避免永久隐藏DOM，阶段8用相同种子/窗口复核；不在本阶段引入另一套树或全面虚拟化。

### 排查与收敛

- 真实截图首轮发现旧绿色选中/白色工作面仍继承、原生resize未切抽屉；集中修正局部令牌和无render布局更新，确认轮完成。输入透明与中性焦点由foundation保持。
- 基础检查发现新resize钩子的轻量测试DOM缺classList，补可选能力检查；阶段2回归发现空工作区cursor两侧均为空时误进入恢复分支，补显式cursor判定。最终完整检查及三组阶段2回归通过。
- 自动检查器最初blur任务标题后控件按产品语义结束编辑，不能继续读原控件；改为记录自动聚焦的原位编辑状态，未改变产品blur语义。一次窄窗指针用例超时后重新记录现场未复现，最终改以真实键盘进入该场景并通过；长按与点击由独立树手势套件覆盖。
- Chromium Undo失效以重绘前enabled=true/之后false证实，改为有界控件日志并验证Undo/Redo与模型替换；没有删减断言掩盖数据回归。

## 用户审阅

- 本轮真实指令：**“在 /Volumes/T7/work/personal-task-track 工作区，读取 docs/frontend-remediation/COMMON.md、state.json 及 STAGE-03.md，执行该阶段。沿用共享状态记录的同一工作区和整改分支，保留前阶段累计改动；只做本阶段，完成检查、真实本地预览和交接，不单独提交或发布。”**
- 该指令授权本阶段继续执行，不代表阶段1/2/3验收或最终发布。没有下一阶段指令。
- 当前候选留在真实本地应用，Mac解锁后可查看；阶段1原三入口完整验证与原生Windows/多屏/DPI/人工输入法/物理指针手感仍按表列限制处理。

## 下一会话

- 先读COMMON、state、DECISIONS、BASELINE、本交接及阶段4；等待真实用户下一步指令，沿同一分支累积，勿重建或覆盖。
- foundation仍是共享输入/焦点所有者；task-workspace仅工作台呈现。阶段4不可把局部任务区色阶扩散为新的全局皮肤，不能回退旧编辑器来满足过期ProseMirror测试。
- 保留repository对象焦点、bulk代理、真实范围搜索、brief会话、记录缓存模型身份与有界日志，以及continuity28的分支取消/清理入口。记录绑定只能安装一次。
- 阶段4处理旧页宽/编辑模式记忆、长笔记与真实文件故障；阶段6处理设置/恢复的累计交互；阶段7补今日/辅助完整预览；阶段8复核大树性能与累计跨平台限制。阶段1blocked不能靠改状态假装验收。

## Git与版本

本阶段没有提交、升版本、打标签、推送或发布。HEAD仍是阶段0基线，前阶段和本阶段累计dirty改动完整保留。
