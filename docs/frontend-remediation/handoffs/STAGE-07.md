# 阶段07交接：今日浮窗与独立辅助窗口

## 状态与现场

- `ready_for_review`；实现、检查和真实本地预览完成，`review.status=pending`，未填写accepted。
- 工作区 `/Volumes/T7/work/personal-task-track`；分支 `codex/frontend-remediation`；开始/结束HEAD均 `3d70f475d42eb56b474f44effa06fceeb1d087dd`；版本保持0.1.248。fetch后origin/main等于HEAD，未pull/reset/clean、另建worktree、提交或发布。
- 会话 `frontend-stage-07-20261027-root`。接手读取COMMON/state/DECISIONS/STAGE-07、阶段0基线、阶段1及阶段2–6相关交接和路线图阶段7。check7仅因阶段1历史blocked未满足；按本次用户明确执行7指令继续，门禁/历史验收未修改。
- 修改前13文件逐一复制并SHA核对：`stage-07/backup-before/manifest.json`；初始dirty清单与178份产品/版本/锁文件哈希见`status-before.txt`、`source-before.json`。最终171份非本阶段文件哈希不变，新增职责层一份；`preservation.json`无意外差异。
- 当前候选：**Loop · 阶段7菜单修复（隔离数据）**，PID `86684`（原84482候选已保存/备份后重启），主窗1280×820、浅色；**今日 · 阶段7菜单修复**停在今日任务，独立任务菜单可打开；外部点击后辅助窗口会正常隐藏。三个真实BrowserWindow可见，非主窗内模拟。
- 启动：`LOOP_USER_DATA_DIR=/Volumes/T7/work/personal-task-track/.local-review/frontend-remediation/stage-07/review-profile npm run dev -- --remote-debugging-port=10070 --inspect=10071`。appPath/profile/PID与最后源码重载见`final-runtime.json`。
- 数据为生产normalizeTaskData处理的3项合成任务，种子与复制SHA见`preview-seed/manifest.json`。正式用户数据未读取或写入，前阶段实例/profile不关闭或覆盖。不要覆盖本审阅profile。

## 实际交付

### 呈现与输入

- 两个独立入口在foundation前加载`widget-workspace.css`，统一本阶段任务/速记、四类辅助面板的暖白/深灰画布、分隔、字重、菜单与长内容。冻结widget12/13、shell等仍保留原件。
- 普通/强调字重从foundation角色继承，明暗360/460补偿与真实中英文字体/字号传播验证。长任务保持两行，长分组可换行，删除标题可独立滚动，当前面板的主题/记录/分组随主快照更新。
- foundation修复controls22父容器焦点把速记加回一层底色的问题，去掉capture与compose的重复分隔；原位改名保持透明，控件与外层不出现绿色边界。checkbox/range中性键盘线改为内置，保留焦点反馈。此共享规则变化是本阶段独立设置面板的必要依赖。

### 草稿、动作和跨窗口生命周期

- 主窗快照只替换浮窗标题/页签/列表，速记composer保持连接，避免输入、原生Undo、选区与IME会话被DOM重建。背景和偏好回声不覆盖更新的本地文本。
- 窗口失焦保留未确认改名；Enter提交、Esc取消。改名失败保持编辑文本与可重试提示；排队快照在编辑结束后应用，不漏掉后台行更新。旧关闭回执不再拆掉随后打开的改名控件或抢焦点。
- profile内`loop-widget-input-drafts`缓存速记/未确认改名；速记继续走原quickCaptureDraft原生偏好，写入串行避免共用临时文件竞争。启动时先来的空快照不丢弃改名，旧偏好回声不覆盖待恢复速记。没有任务schema、preload或IPC通道/权限变化，也未改变备份格式。
- 原主窗close仍退出整个应用。用独立测试profile真实关闭/退出/重启后，速记与未确认改名均恢复；没有把close替换为hide。
- 主窗mutation/completion监听用同一requestId在途结果及已完成结果缓存，保留最多256项已完成结果；桥接重新初始化与重复投递仅修改一次数据。快速连续Enter只有一笔创建，保存中速记只读、按钮禁用。
- 真实行菜单支持方向键/Home/End，所有辅助面板Tab循环，Esc/关闭/返回焦点沿原协议，IME组合中Esc不关闭。设置slider/checkbox的偏好回声保留实际控件与焦点，持续调节不中断。
- 移动、排序、升级、完成继续调用原任务模型；删除仍由Recovery归档，可恢复，确认文案与真实行为一致。辅助动作写入中主/renderer双重防重复与禁关，失败保持面板和固定重试提示；失败码不再误标成任务不存在。测试失败响应为明确夹具，未冒称真实磁盘故障。
- 手动高度同时应用到面板和真实窗口，fit保持手动高度；自动尺寸/紧凑模式继续原宽度和内容测量。原生header拖动区域、透明阴影ring和sender检查未替换；四角定位、菜单屏幕夹取、上下缩放/重置和键盘nudge经真实控制器验证。

## 前阶段事项的承接与去向

| 来源阶段/文件 | 接手事实 | 本阶段处理与证据 | 结果/后续 |
| --- | --- | --- | --- |
| 阶段0 BASELINE三入口/数据边界 | 今日/辅助需完整核对；只能用隔离数据 | 三真实BrowserWindow，3项normalize种子与SHA；178原产品文件对照 | 本阶段范围完成 |
| 阶段1 D17–18、STAGE-01 | foundation已接入但完整视觉历史blocked | 今日/辅助明暗、字段/父容器与三入口字体传播补验；主窗两宽度截图 | 自动证据已补；历史blocked与人工累计审阅仍→8，不伪造accepted |
| 阶段2 D20–21、STAGE-02 | 导航范围、单次事件代理、稳定身份 | product/context-create真实回归；主窗创建/跳转使用原范围与业务 | 完成，未改导航/树模型 |
| 阶段3 D23–27、STAGE-03 | 真实树、节点草稿/Undo、缩放与大树性能 | 非本阶段任务工作台文件哈希不变，product保留长按排序/Undo/范围 | 保留；3000节点同条件性能复核仍→8 |
| 阶段4 D28–31、中途发布D33–35 | 知识/Recovery与全局偏好、真实node_modules | 不动知识链路、全局设置、版本/锁、依赖；删除仍Recovery事务 | 保留；不恢复旧编辑器/链接 |
| 阶段5 D36–40、STAGE-05 | 工作导航和高级全局偏好 | 主窗snapshot仍真实状态；work/pages/temporal哈希不变 | 保留；整体时间导航回归→8 |
| 阶段6 D41–49、STAGE-06 | 持久错误/忙碌/返回焦点；设置按钮最新参考 | 复用foundation/button；辅助失败固定可见，忙碌防关与焦点循环 | 本阶段完成；主设置D49累计内容哈希不变 |
| 阶段0–6平台/系统待验 | Windows、跨屏/DPI、人工IME、通知/安装等 | 本机macOS单屏2560×1320工作区、DPR1；桌面绑定未选中候选PID | 仍→8；不冒报原生指针、通知横幅或安装验收 |

## 检查与证据

证据根目录：`.local-review/frontend-remediation/stage-07/`。

| 检查 | 结果 | 日志/限制 |
| --- | --- | --- |
| status/fetch/check7 | 固定目录/分支/HEAD正确；check仅保留阶段1历史blocked | `status-before.txt`、`preflight-final.log` |
| 完整npm run check | 主351＋服务12通过，0失败/跳过；两个编辑器与服务构建通过 | `npm-check-complete.log`，未打发布包 |
| 阶段工具/基础/原watcher/数据/偏好 | 33通过，0失败/跳过；末次foundation另3通过 | `stage-tests.log`、`foundation-final.log` |
| 真实浮窗专项 | 10组通过，四角夹取＋四主题/字号组合，24条输入状态（各含字段和两层父容器），0pageerror | `tests/widget-workspace.ui.cjs`、`widget-ui-final.log`、`ui/results.json`及20张PNG；删除失败为响应夹具 |
| 实际退出与重启 | 主窗close导致实际整app退出，同profile重启恢复速记/未确认改名 | `tests/widget-lifecycle.ui.cjs`、`lifecycle-final.log`、`lifecycle/results.json`；合成profile测试后清理 |
| 原有真实回归 | today-widget-draft、context-create、product-experience通过 | `widget-draft-final.log`、`context-create.log`、`product-regression.log` |
| npm run dev候选 | 主窗明暗×1280/1024；今日/4类辅助两主题；18条额外输入/父容器状态；三入口字体字号/字重；0pageerror | `electron-review.json`、`preview.log`、`main-*.png`/`widget-*.png`/`surface-*.png`，最终`final-runtime.json` |
| 视觉确认 | 一轮检查后去掉速记重复分隔、range外置线，确认截图完成 | 最后`widget-quick-light.png`、`surface-settings-dark.png`；不继续视觉打磨 |
| 语法/CSS/空白/设计检测 | 全通过，detector=[] | `diff-check.log`、`design-detector.json`；CSS经postcss parse |
| 源与备份保护 | 13份备份SHA通过，171份非本阶段产品/版本/锁文件不变，unexpected=[] | `preservation.json`；初次交接产品指纹 `0a26f2a90d108c7995f72a45e22b941938bfca8479d4301087808954bb9e10a1`（310文件） |

初次基线脚本相对路径多了一层；早期专项两处断言误把相邻上移当首位、把取消按钮当焦点序列首项，均按真实规则纠正。另有BUSY打开请求被测试忽略后点击旧隐藏DOM的测试问题，现核对原生接受结果及记录身份。真实修复涵盖旧关闭/焦点回调、背景改名被拆、启动空快照与手动面板高度。日志`widget-ui-first`至`tenth`保留失败现场，最终全链10组和真实重启通过，没有删除功能断言掩盖回归。

## 用户审阅

- 用户本次原话：在固定工作区读取COMMON/state/STAGE-07执行该阶段，沿共享工作区/整改分支和累计改动；只本阶段，完成检查、真实本地预览及交接，不单独提交或发布。
- `review.status=pending`。本次实现/自动验证不等于用户接受；没有阶段8继续或最终发布批准。
- 已留下真实独立窗口供审阅。桌面工具正常枚举，但bundle匹配歧义；指定workspace Electron路径返回另一默认Electron窗口，已仅关闭该工具新开的默认窗口。随后AX绑定到阶段6，未对其操作，不能冒称阶段7原生外框/物理指针已核验；详见`native-visibility.json`。**没有确认系统锁屏，也不作锁屏推断。**

## 下一会话

- 执行8前需真实用户继续指令，读取COMMON/state/DECISIONS/D50–54、本交接及STAGE-08，运行check8。沿同一工作区/分支，保留阶段5–7全部未提交改动，尤其主设置D49、知识偏好/Recovery及当前依赖目录。
- 本阶段可重复运行：`node tests/widget-workspace.ui.cjs`、`node tests/widget-lifecycle.ui.cjs`；必须使用真实Electron和隔离profile。预览数据目录不能覆盖。
- 留验：原生Windows、多屏切换与不同DPI、OS标题栏、人工IME、物理拖动/吸附/透明阴影ring与跨应用点击穿透手感；本阶段只证实控制器API/首屏几何和草稿，不将偏好状态冒充实际鼠标穿透验收。
- 继续保留原来源待验：阶段1完整人工累计审阅；阶段3大树同条件性能；阶段6实际权限/通知横幅/更新下载安装、live反馈投递与原生导入重启。中途发布打包知识门禁已补，不再列为未完成。
- 阶段8负责整体收敛、最终本地包和用户验收；没有授权即不发布。

## Git与版本

没有提交、升版本、打标签、推送、远程构建或发布；HEAD与0.1.248保持，累计dirty现场保留。


## 用户反馈修订：任务菜单被遮挡、外部点击与竖向三点

- 用户原话与截图指出：任务设置被浮窗盖住；打开后点其他位置需点击多次；任务设置图标应为竖向三点。截图路径记录为`/var/folders/6r/6tb8rrdx2k38kb0mp8gqt6c80000gn/T/codex-clipboard-e9dad76f-09f0-472c-8dcd-ddd84d7abeea.png`。这是阶段7修订授权，未批准阶段8或发布。
- 根因：两个独立窗口共用macOS screen-saver相对级别1，父浮窗的置顶刷新会moveTop盖住面板；非模态pointerdown吞首击；blur关闭无条件focus父浮窗，重复关闭又使旧返回回调失效。另有260ms关闭宽限，忽略快速外点。
- `app/main/today-widget.cjs`：辅助面板声明真实`parent: widgetWindow`；置顶辅助面板相对级别2，父级保持1，面板打开时父级不raise；刷新始终先父后子。保留原非置顶、编辑临时降级和跨平台策略，未改IPC/preload。
- 关闭按原因恢复焦点：Esc、取消与动作返回保留；blur/outside/hide/removed不拉回焦点。已关闭面板的重复关闭在修改代次前直接返回，既不抢焦点也不使有效通知失效。原生blur只排除同步打开过程与仍有焦点的迟到事件，去掉260ms首击盲区。
- `today-widget-runtime.js`：非模态菜单外pointerdown不拦截事件；同一次点击可切页签、进输入框或操作别的窗口。删除确认保留原模态屏障。行更多按钮改为竖向三点路径，悬停/键盘与原点击区域不变。
- `tests/widget-workspace.ui.cjs`新增明暗完整路径：真实父子关系、编辑释放刷新后子层更高、单击切速记、单击输入、主窗外点后的原生焦点、重复关闭不抢焦点；全链11组通过。`tests/desktop.test.cjs`增加可执行层级策略断言；旧静态断言从硬编码1改验relativeLevel，仍验证默认1并保留原策略测试。
- 检查：`npm run check`主352＋服务12，0失败/跳过；11组真实Electron通过，语法/空白通过，detector=[]。首次完整检查仅旧硬编码层级静态断言失败，已按新行为更新并增加可执行验证，未删保护。日志在`menu-followup/npm-check-final.log`、`widget-ui.log`与`ui/results.json`。
- 修改前10份源码/记录逐文件SHA备份；候选重启前调用原保存/Recovery刷新，并校验复制task-data与widget偏好，缓存草稿另记manifest。重启沿原review-profile，不覆盖种子或其他阶段profile。任务记录和分组字节含义逐项相等，175份非本修订产品文件哈希不变，版本/HEAD仍0.1.248/3d70f47。详见`menu-followup/preservation.json`、`profile-before-restart/manifest.json`。
- 真实候选PID **86684**，窗口「Loop · 阶段7菜单修复（隔离数据）」与「今日 · 阶段7菜单修复」。`menu-followup/review.json`记录appPath、profile、真实父窗口/可见性及明暗截图；竖向图标在`widget-light.png`，菜单在`menu-light.png`/`menu-dark.png`。原主窗/浮窗几何仍跟随用户此前设置。
- 原候选首轮复核连接中断，独立11组测试保持通过；最终在原候选明确打开目标菜单后完成明暗复核。一次预览命令自动权限审核超时且未启动，按工具允许仅重试一次后成功，**没有剩余审批阻塞**。
- 原生桌面工具仍绑定另一Electron默认应用；仅对工具打开的已知默认窗口发出关闭，随后返回procNotFound。没有操作阶段6或正式数据，也没有把单窗口renderer图冒称OS合成层级截图。父子/层级与目标焦点由真实BrowserWindow核对；完整原生跨屏、Windows与物理指针手感仍按原交接留8。
- 当前产品指纹：`de78ca468e203139130ff94d5a8aee4d2faa77f0e1120a535f0c5306c09443cb`；state仍`ready_for_review`、review pending、activeStage清空；累计改动保留，无提交或发布。
