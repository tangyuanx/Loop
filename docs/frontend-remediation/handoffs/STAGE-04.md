# 阶段04交接：知识工作区

## 状态与现场

- `ready_for_review`，三个检查点、必要检查和真实 Electron 预览完成，用户审阅仍 `pending`。用户说“稍后自行查看候选”，不是验收或发布授权。
- 固定工作区 `/Volumes/T7/work/personal-task-track`；整改分支 `codex/frontend-remediation`；开始/结束 HEAD 均为 `482912b76c8666af849bbbdfd2ea806ba87bbaa4`；版本 `0.1.245`。
- 会话 `frontend-stage-04-20261027-root`。fetch 后 origin/main 未前进；没有 pull/reset/clean、新 worktree、提交、升版或发布。
- 修改前备份 17 个文件并逐一 SHA-256 核验：`.local-review/frontend-remediation/stage-04/backup-before/manifest.json`。前阶段未提交内容保留；watcher 与 prototypes/README 还对照阶段0原备份核实一致。详见 `preservation.json`。
- 当前候选：**Loop · 阶段4知识工作区（隔离数据）**。从此工作区 `npm run dev` 启动，独立数据目录 `.local-review/frontend-remediation/stage-04/review-profile`，绑定 Markdown 位于同阶段 `review-files/`。`preview-seed/manifest.json` 保留经校验的数据/Markdown原副本；正式用户数据未读写。
- 启动命令：`LOOP_USER_DATA_DIR=/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-04/review-profile npm run dev -- --remote-debugging-port=9890 --inspect=9891`。仅关闭本阶段窗口，不影响其他用户窗口。
- Mac 锁屏阻止 CUA 原生外框截图；用户明确选择稍后自行查看。真实 Electron renderer 明暗截图、IPC、文件写入和 BrowserWindow 元数据均已验证，不能把它们称作原生外框/真人操作验收。

## 实际交付与三个检查点

### 1. 工作区与排版

- 新增 `app/renderer/src/knowledge-workspace.css`，在任务工作台层之后、foundation之前加载。知识区接续任务区明暗画布、文字与细分隔，整理页签/模式/专注、目录/反链、搜索、底部回执与窄窗间距；阅读/表格明确继承用户字体，源码/代码仍等宽。
- 原 `workbench.css` 的 `!important` 全面清除编辑器焦点规则会覆盖阶段1基础层，本阶段移除这一条，将 CodeMirror/阅读焦点交回 foundation。保留原位透明编辑、中性细线，没有绿色输入外框或外扩光晕。原 workbench 菜单键盘修正来自阶段1，本阶段没有覆盖。
- 从阶段0原 `knowledge.js` 仅迁入模式/页宽记忆的具体行为，继续使用 `loop-knowledge-editor-preferences` 键，仅保存 `mode/width` 两项展示偏好。未知值/损坏缓存回落默认；缓存不可写不阻断编辑。没有恢复旧编辑器、旧 app.js 或旧保存路径。
- `knowledge-workspace.js` 与 `actions.js` 的既有模式/页宽入口统一写偏好；真实完整 renderer 重载验证记忆，三模式、页宽、专注、目录、任务/处理流往返维持同一 CodeMirror 实例与 View。
- 反向链接的一轮刷新复用同一份笔记集合，不在逐链接解析时重复过滤全部任务；原链接缓存与解析规则不变。

### 2. 复杂编辑

- 笔记切换搜索增加 composition 生命周期保护，IME 组合期间 Enter/方向键不打开或新建笔记，组合结束后正常查询/确认。没有替换 CodeMirror、Markdown 渲染或第三方选择模型。
- 真 Electron 专项覆盖原文 CRLF、原生键盘 API Undo/Redo、表格输入/Tab/粘贴、格式/代码/列表、图片定位、数学/图表、内部链接、大纲与反链、查找/替换、模式和任务往返。浏览器注入专项另覆盖 CR/混合换行、附件引用迁移后的撤销、异步上传定位和长文不触发外壳重绘。
- 新增 `tests/knowledge-workspace.ui.cjs`：偏好重载/坏值、真实实例身份、CRLF、Undo/Redo、笔记切换组合键、搜索与表格中性焦点、空笔记、明暗1280/1024、600标题长文及滚动。
- 长笔记数据与测量：新样本21,982字符/2,399行，打开约90ms，6次重绘至两个rAF约11.9–15.5ms，scrollTop保持32,839；14字符键盘输入加两个rAF约76.9ms。阶段0原长文52,807字符/4,803行补测单次编辑至两个rAF约13.7ms，DOM389。均为本机当前候选观察，没有改动前同方法对照，不宣称通用性能提升或物理输入端到端延迟。

### 3. 文件状态、恢复与导出

- 保留既有保存队列、Recovery、附件暂存、watcher轮询与IPC。调整回执文字：本地失败明确“当前内容仍在本页”；外部冲突/不可写/丢失说明“当前内容仍保留”；文件尚未同步且本地持久化仍在进行时不提前声称“草稿已保留”。错误与冲突继续保留动作，不自动消失。
- 实测无绑定保存到Loop、有绑定文件自动保存、失败重试、只读/丢失/外部改动、重读/覆盖/另存、第二次冲突、A/B切换、Recovery保留与重启。保存失败测试注入真实主进程磁盘写入错误；文件内容和生产IPC真实执行，非替换整套保存函数。
- `lifecycle.cjs` 实际调用 app.quit，立即退出前的待保存内容落入Recovery；重启恢复；再以更新的Recovery与实际外部磁盘版本重启，保留两份内容并显示EXTERNAL_CHANGED。没有改退出握手协议。
- 只读证据分开：feedback专项因外盘不执行POSIX权限而只注入 W_OK 拒绝，仍走真实 read/watcher；release-regressions 在系统临时目录用真实 chmod 0444 通过。
- Markdown/HTML/PDF真实导出通过；Markdown CRLF逐字节相等，HTML离线附件/公式字体/图表/嵌入完整，导出不改正文或绑定。PDF用Poppler渲染5页并查看，浅色打印、公式/中文、图表、表格与多页代码未裁字，页末标记保留。未修改导出实现。

## 前阶段事项的承接与去向

| 来源阶段/文件 | 接手事实 | 本阶段证据/处理 | 结果与去向 |
| --- | --- | --- | --- |
| 阶段0 D10、BASELINE、原knowledge.js | 旧模式/页宽记忆归档待评估 | 仅迁两值偏好与旧键；真实重载/未知值/原文验证 | 本阶段完成 |
| 阶段0 watcher补偿 | `knowledge-watcher.cjs`已有累计变更 | 原件未改、SHA相同，polling专项及真实外部冲突通过 | 完成；后续继续保留 |
| 阶段0长文种子 | 原先只有fixture，无真实长文证据 | 原52,807字符种子在npm run dev候选测量；另600标题样本及旧注入长文专项 | 本阶段完成；阶段8同机复核性能 |
| 阶段0异常元数据种子 | 不是文件状态实际链路证明 | 本阶段用真实独立磁盘文件触发外部改动/丢失/Recovery；区分真实chmod与W_OK注入 | 完成，不把旧元数据种子当实际冲突 |
| 阶段1 D17/D18、阶段3交接 | foundation焦点被workbench的important规则覆盖 | 移除旧覆盖；常规/查找/单元格/父容器明暗状态核实 | 本阶段区域完成；三入口累计核对→阶段7/8 |
| 阶段2 D21、阶段3 D23–27 | 导航对象身份、工作台草稿/Undo/树连续性须保留 | task-workspace、continuity28、product-experience真实回归通过 | 完成；大树全量重绘问题仍→阶段8 |
| 阶段1启动故障/待审阅 | 状态仍blocked，阶段2/3成功不等于验收 | check 4仍如实失败；本轮用户明确执行阶段4。没有放宽工具或伪造批准 | 历史记录保留；三入口完整验证→阶段7/8 |
| 阶段0–3平台限制 | 原生Windows、多屏/DPI未实测 | 本机Mac Electron证据；不冒充其他平台 | 阶段8/最终平台验收 |

## 检查与证据

以下相对路径均位于 `.local-review/frontend-remediation/stage-04/`。

| 检查 | 结果 | 证据 | 真实范围/限制 |
| --- | --- | --- | --- |
| status / check 4 / fetch | 分支/HEAD正确，check 4因阶段1blocked未满足 | preflight.log、state记录 | 用户本轮明确继续；未改历史状态 |
| npm run check | 主347 + 服务12通过，无跳过；包含构建器和冻结CSS契约 | npm-check.log | 无发布打包 |
| npm run test:knowledge | 21通过 | knowledge-unit.log | 数据/渲染/导出单元检查 |
| foundation/remediation/watcher | 9通过，无跳过 | stage-tests.log | 保持保护工具与watcher补偿 |
| knowledge-workspace.ui.cjs | 通过 | workspace.log、workspace/results.json及截图 | 真实Electron；IME为组合事件 |
| knowledge-desktop.ui.cjs | 11通过，无pageerror | desktop.log、desktop/evidence/results.json | 真实Electron，选择器回答/明确故障注入 |
| knowledge-conflict.ui.cjs | 10通过 | conflict.log、conflict/evidence/ | 真文件/IPC；磁盘故障与延迟注入 |
| knowledge-feedback.ui.cjs | 8通过 | feedback.log、feedback/evidence/ | 真Electron；写入故障/W_OK注入 |
| knowledge-search.ui.cjs | 7通过 | search.log、search/evidence/ | 真Electron，读/编辑搜索、替换撤销、组合保护 |
| knowledge-image.ui.cjs | 6通过 | image.log、image/evidence/ | 真Electron，图片点击/选择/布局 |
| knowledge-release-regressions.ui.cjs | 13通过 | release-regressions.log、release-regressions/evidence/ | 真Electron开发运行时，**名称不代表已打包**；系统临时目录真实只读 |
| knowledge-editor.ui.cjs | 通过 | editor-chrome.log | Chrome headless + 隔离注入IPC/真实文件服务；不是Electron |
| 退出握手与重启 | 3场景通过 | lifecycle/results.json、recovered-conflict.png | 实际app.quit/重新启动与磁盘Recovery |
| 前阶段回归 | task-workspace、continuity28、product-experience全通过 | *-regression.log | 真实Electron独立profile |
| 真实候选 | 明暗×1280/1024×三模式，无文档横向溢出/页面错误；最终留浅色阅读 | electron-review.json、preview-*.png、review-ready.png | npm run dev；Mac锁屏未拍原生外框 |
| 额外输入核对 | 38状态通过：重命名/切换搜索/链接/单元格/表格值与下拉及父容器 | inputs-supplement.json | 单元格失焦即结束编辑，故核对自动聚焦状态，不人为延长生命周期 |
| PDF视觉检查 | 5页检查通过 | desktop/evidence/pdf-rich-1至5.png | 真PDF经Poppler渲染；导出独立浅色 |
| CSS/语法/空白/设计检测 | 通过，detector=[] | css-parse.log、diff-check.log、design-detect.json | 一轮检查/集中修正/确认；未改冻结Demo |

### 排查记录

- 第一次临时baseline脚本相对路径多一层，修正后真实基线截图完成；没有产品改动。
- 新切换测试最初查询也命中了当前笔记正文；改成唯一正文样本后通过，未改变产品搜索范围。
- 首次 `knowledge-editor.ui.cjs` 缺指定Playwright headless浏览器；改用本机已安装Google Chrome，通过全部断言，没有安装或升级依赖。
- 首轮视觉检查发现关联说明旧opacity过低，集中改为secondary实色，最终确认完成。
- 补充输入脚本最初blur表格单元格，按产品语义编辑控件立即移除；改核对真实自动聚焦状态，没有改变表格行为。
- 该临时脚本随后补齐表格源码光标前提、清理失败残留面板，并排除border-width为0的不可见继承颜色；最终38个可见边线/焦点状态通过。没有用删除焦点反馈来规避断言。
- 用户继续消息之后旧开发进程已结束（9890 ECONNREFUSED），沿原合成profile重启；没有重建/覆盖审阅数据。

## 用户审阅与下一会话

- 本轮原始指令明确只执行阶段4、不提交发布。中途“继续”用于完成本阶段收尾；没有开始阶段5。
- 关于Mac锁屏，用户明确回答：**“稍后自行查看候选”**。候选留窗，状态待审阅，不填写accepted。
- 下一会话读取COMMON/state/DECISIONS、本交接及自己的阶段文件。沿同工作区/同分支/累计改动；foundation最后加载，知识职责层不影响工作导航/设置/浮窗。
- 保留所有备份、Markdown副本、真实测试数据与日志。阶段8需跑**打包知识链路**（`tools/test-packaged-knowledge.cjs`），本轮未构建发布包；继续保留阶段1三入口、阶段3大树、原生Windows/多屏/DPI/人工IME及实际指针手感等原待验项。
- 没有新增schema/IPC/业务字段、云同步、完整diff或替换编辑器；`build:milkdown`历史兼容链路保留。

## Git与版本

阶段4产品改动：`index.html`、`knowledge-workspace.js`、新增`knowledge-workspace.css`、`workbench.css`、`actions.js`。检查改动：`tests/desktop.test.cjs`样式加载顺序、新增`tests/knowledge-workspace.ui.cjs`。其余本阶段改动为交接/共享状态/决策/计划。

前阶段所有累计改动保留，HEAD和版本不变，没有提交、标签、推送或远程构建。产品指纹见 `product-fingerprint.json`，仅用于候选识别，不代表用户批准。

## v0.1.248发布补充

用户随后明确要求先发布阶段0–4；已完成，详见[发布回执](RELEASE-0-4.md)。本阶段原候选记录保持历史事实；当前代码已保留正式版v0.1.246/247的全局知识设置和Mermaid增强，模式/页宽采用其全局任务数据链路，取代D29的单独localStorage键。打包知识链路已在本地实际包与远端macOS/Windows补齐通过，不再作为阶段8的未运行项；其他平台手感、人工IME与大树限制仍按原交接继续。
