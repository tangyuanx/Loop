# 阶段05交接：工作导航、日历与回顾

## 状态与现场

- `ready_for_review`；本阶段实现、检查与真实本地预览完成，用户审阅仍为 `pending`。
- 固定工作区 `/Volumes/T7/work/personal-task-track`，分支 `codex/frontend-remediation`；开始/结束 HEAD 均为 `3d70f475d42eb56b474f44effa06fceeb1d087dd`，版本保持 `0.1.248`。
- 会话 `frontend-stage-05-20261027-root`。fetch 后 `origin/main` 与 HEAD 相同；没有 pull/reset/clean、worktree、提交、升版、打标签或发布。
- 接手读取 COMMON、state、DECISIONS、阶段0基线、阶段4及中途发布交接、路线图阶段5。`check 5` 仍因阶段1历史 `blocked` 失败；本轮依据用户明确执行阶段5的指令继续，不改历史验收或放宽门禁。
- `.local-review/frontend-remediation/stage-05/backup-before/manifest.json`：12个文件的校验备份。9个初始文件修改前复制；foundation修改前追加，两个原本未改的测试文件以开始HEAD原件补入。计划文件均追加记录，既有资料与阶段0–4产品成果保留。
- 真实候选窗口：**Loop · 阶段5工作导航、日历与回顾（隔离数据）**，PID `59227`，1280×820，浅色，当前显示工作导航详情。
- 启动：`LOOP_USER_DATA_DIR=/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-05/review-profile npm run dev -- --remote-debugging-port=10050 --inspect=10051`。
- 数据为经当前生产 `normalizeTaskData` 处理、SHA-256复制校验的6任务合成种子；原件与manifest在 `preview-seed/`。正式用户数据未读取或写入，其他实例未关闭。不要覆盖这个审阅profile，也不要关闭不属于本阶段的窗口。

## 实际交付

### 工作导航与队列

- 新增 `temporal-workspace.css`，在知识职责层之后、foundation之前加载。统一明暗画布、细分隔、字重、详情、全天阶段、任务队列和导入预览；顶部胶囊去掉持续底块，只保留小状态点与时间。长队列标题/下一步分别限制3/2行，打开任务仍可读全文；空、只读、单任务状态按需显露动作。
- 保留冻结的 `work.css`、`time.css`、`journey.css` 和 `work-navigation-model.js`，未另造阶段模型、导航专用任务或估时日历。17:10–18:10学习、周五15:00–16:00例会、分组学习来源和原排序规则不变。
- 工作导航统一使用既有 `loopNow()`；renderer规范化和候选查询显式传入同一时钟。手动阶段改用模型已有 `manualPhaseId/manualPhaseExpiresAt/nextBoundaryAt`，到午休、下一边界及跨日恢复自动阶段。周末“开始学习”写已有 `weekendStartedAt`。
- 胶囊复用当前按钮，30秒只刷新时间区域；打开的导航详情在分钟或数据变化时更新，保留滚动及相同控件焦点，不调用整壳render。关闭、Escape与外部替换同步展开状态；独立导入草稿不被定时详情刷新覆盖。
- 修复完成顺延写回已被查询替换的旧navigation对象；现在写当前runtime。保留自动顺延关闭状态，暂停后可从队列首项重新开始；没有重设用户的autoAdvance配置。
- 卡住恢复原来错传 `saveRecovery` 参数。本阶段新增renderer桥接 `recoverTask`，移除导航runtime卡住标记及任务blocked标签，沿原save/reconcile通道恢复。仍有卡住节点时不修改节点，保留就地说明及打开任务入口。
- 队列预计时长原先只修改snapshot副本；现在通过renderer桥接 `updateEstimate` 写原任务并保存。保留既有1–720整数分钟范围，未新增持久化字段或IPC。
- 完成缺结论/有未完成节点、恢复失败等反馈保留在详情中；成功反馈继续复用阶段1回执。工作日补齐七天，修正周五被错误标成“六”、周六缺失的问题。相关键盘焦点交由foundation追加一条中性内线规则。
- 工作导航初始化优先读既有全局UI偏好快照，旧localStorage键只作回退；修复bootstrap可能先于work.js完成、导致已保存开启状态未显示的时序问题。

### 导入、日历与回顾

- 文本、通用JSON和学习计划统一先走只读 `previewTaskBatchImport`；点击“预览”不再直接导入学习计划。确认后复用原 `importTaskBatch`，保留origin、来源初始化、组内顺序、去重、勾选和时长；未选项的无效时长不阻挡其他有效项，选中项空值/非整数/超范围不可确认。不存在的分组或非法内容显示可纠正提示。
- 日历仍按真实 `deadlineAt` 本地日期查询；循环任务显示当前截止日与循环说明，不投影虚构未来任务。换月同步选中日并夹至月末；当天任务、整日筛选和返回路径继续用阶段2的真实范围模型。
- 日历只留一个Tab入口，方向键按天/周移动，Home/End到周首尾，PageUp/PageDown换月。月份、所选日期、明细和键盘焦点一致；回到今天仍使用应用统一时钟。
- 回顾保留周/月/年/全部/自定义及创建/更新/解决三种口径，摘要与完成数来自同一查询结果。长摘要原生details按需展开，任务内容不截改；状态保留完成、卡住、暂缓及节点进度。
- 自定义范围错误就地显示并关联输入的 `aria-invalid/aria-describedby`，无效范围不显示误导日期或表格；结束日仍包含至本地23:59:59，次日0点排除。原范围、滚动、任务返回与焦点继续复用，不另造返回栈。

## 前阶段事项的承接与去向

| 来源 | 接手事实 | 本阶段处理/证据 | 结果及去向 |
| --- | --- | --- | --- |
| 阶段0 BASELINE时间页清单 | 双队列、本地日期、空/长内容和返回待整合 | 真实专项9组、28布局；三时间区域实测 | 本阶段完成 |
| 阶段1 D17–18，阶段4 D28 | foundation最后加载、无绿边和外扩环 | 日期/时长/来源/导入/密码/父容器等197条记录，中性工作日键盘内线 | 本阶段区域完成；全三入口累计审阅→阶段7/8 |
| 阶段2 D20–21 | 范围、对象身份、日历/回顾返回已接入 | 保留原查询与返回，真实日历/回顾进入任务和返回；product回归 | 完成 |
| 阶段3 D23–27 | 树、记录草稿/Undo及大树成本 | 不改树/折叠/排序；task-workspace及continuity28回归 | 连续性保留；大树全量重绘同条件复核→阶段8 |
| 阶段4 D28–31 | 知识保存、Recovery、编辑器实例需保留 | knowledge-workspace真实回归通过，无知识/文件生命周期修改 | 完成 |
| 中途发布 D33–35/RELEASE-0-4 | 全局笔记偏好、Mermaid、独立node_modules，0.1.248基线 | 未覆盖相关实现、未恢复依赖链接；版本/锁文件不变 | 保留；打包知识门禁已由中途发布补齐 |
| 阶段1历史blocked | 并非本阶段未授权；真实用户本轮明确执行5 | check仍如实失败，未填写accepted | 三入口完整累计确认→阶段7/8 |
| 阶段0–4平台限制 | 原生Windows、多屏/DPI、人工IME/真实指针手感未完整实测 | 本机Mac Electron；CUA确认锁屏导致外框截图不可用 | 继续→阶段8/最终平台验收 |

## 检查与证据

证据目录均为 `.local-review/frontend-remediation/stage-05/`。

| 检查 | 结果 | 证据/范围 |
| --- | --- | --- |
| status / fetch / check 5 | 工作区/分支/基线正确；check仅因阶段1历史blocked未满足 | `preflight.log`、本交接；门禁未修改 |
| 完整 `npm run check` | 主351、服务12通过，0失败/跳过 | `npm-check.log`，含两个编辑器及服务构建；没有打发布包 |
| 工作模型/工作呈现/基础层/阶段工具/watcher | 31通过，0失败/跳过 | `stage-tests.log`；冻结模型/CSS保护继续有效 |
| `tests/temporal-workspace.ui.cjs` | 9组真实操作通过，28布局、72输入记录，无pageerror | `temporal-ui.log`、`ui/results.json`、`ui/*.png`；开发Electron，阶段时间通过应用预览时钟推进 |
| 真实操作范围 | 手动过期、午休/学习/结束/周五、跳过/移尾/卡住恢复、完成顺延与暂停、持久校验、学习/文本导入去重、跨日、周末启动、日历/回顾范围和返回、空队列 | 同上；节点用生产makeNode构造，未用无效节点代替真实数据 |
| 本地时区回归 | 洛杉矶、奥克兰各5项通过 | `dates-los-angeles.log`、`dates-auckland.log`；选中的日历/回顾/模型边界用例，不冒充两地真人测试 |
| 前阶段真实回归 | task-workspace、continuity28、product-experience、knowledge-workspace全部通过 | `task-regression.log`、`continuity-regression.log`、`product-regression.log`、`knowledge-regression.log`；各独立profile |
| `npm run dev`真实预览 | 本工作区、正确profile、明暗×1280/1024×工作/日历/回顾共12布局，无横向溢出/pageerror | `electron-review.json`、`preview-*.png`；通过本机CDP读取实际Electron，未用浏览器替代应用 |
| 定时更新 | 胶囊和工作区DOM身份保留，午休边界刷新 | `electron-review.json.clockRefresh`；Playwright时钟推进已注册30秒timer，应用预览时钟切边界，不称物理端到端延迟 |
| 最终补充输入/重载 | 125条记录通过，含原生select/展开、时间/密码、父容器及两主题工作日真实Tab | `final-preview.json`；与前72条合计197条，不表示全应用所有控件已由本阶段验收 |
| 最终候选 | 最新源码重载、全局开启偏好恢复、1280×820浅色留窗 | `final-preview.json`、`review-ready.png`；Mac锁屏未拍原生外框，未完成人工验收 |
| 语法、CSS、检测、空白 | 通过；detector=[] | `syntax-css.log`、`design-detect.json`、`diff-check.log` |
| 源码保护与指纹 | 阶段0–4非本阶段app文件、冻结层、版本/锁文件保留 | `preservation.json`、`product-fingerprint.json`；当前指纹为候选追踪，非最终验收授权 |

### 排查与收敛

- baseline首次沙箱内Electron启动失败，提权后可启动；脚本最初只等.app，早于work.js加载，补等待LoopWork后截图成功。
- 专项先选了仍保留的学习队列，工作阶段只读，故没有“跳过”按钮；测试显式切工作队列，未改原队列选择语义。
- 完成顺延真实断言暴露旧runtime对象写回问题，已修复；预计时长snapshot写入问题一并通过真实选择/原任务值核对。
- 完整检查初轮2处失败：新增职责层加载顺序断言需同步，空日历原安静文案契约需保留；只更新真实加载列表、保留原空态语义，未删除保护断言。
- 截图一轮集中修正“今天+选中”的复合颜色和队列长内容；第二轮确认后结束视觉调整。
- 工作日程序化focus未进入focus-visible；改用真实Tab验证。扩展卡住节点测试曾直接注入缺notes等字段的节点，触发renderer异常，改用生产makeNode后完整通过。
- 本地CDP初次遭sandbox EPERM，按规则提权连接。真实候选重载发现全局偏好与脚本先后加载竞态，改初值读取方式后重载通过。
- 最终日志以成功重跑结果为准，早期排查说明保留在本节及根计划/进展文件中，不把失败尝试算作通过。

## 用户审阅与下一会话

- 用户本轮原话明确“只做本阶段，完成检查、真实本地预览和交接，不单独提交或发布”。这是执行授权，不是用户已测试候选或最终发布批准。
- 本阶段 `review.status=pending`，没有accepted或下一阶段指令；阶段6–8仍未开始。历史阶段的pending/blocked状态不被自动改写。
- 下一会话读取 COMMON/state/DECISIONS、本交接及自己阶段文件；沿相同工作区、分支和累计文件继续。foundation仍最后加载；时间页职责层不接管知识、任务树或浮窗。
- 保留合成profile、备份、截图及日志。阶段6整理设置/恢复/反馈时沿用本阶段高级导航表单的正确工作日、全局开关偏好、持久错误及renderer桥接；不得重新引入绿色工作日或输入焦点。
- 阶段7/8继续补齐三入口累计控件审阅；阶段8保留大树全量重绘复核、原生Windows/多屏/DPI、人工IME与实际指针操作的验证。
- 不执行提交、升版本、打标签、推送或发布。本阶段没有新数据schema、主进程IPC、云同步、导航专属任务、逐任务估时日历或新的学习制度。
