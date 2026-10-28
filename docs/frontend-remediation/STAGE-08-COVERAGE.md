# 阶段8累计覆盖与实现归属

2026-10-27，固定工作区、`codex/frontend-remediation`，版本0.1.248。下列证据均位于 `.local-review/frontend-remediation/stage-08/`。这是工程检查与待审阅候选记录，不是用户最终验收。

## 路线图全项目覆盖

| 范围 / 原始承接 | 本阶段检查与证据 | 结论与限制 |
| --- | --- | --- |
| 基础主题/字体/输入/选区/菜单（0、1） | 三入口 `electron-review.json`；工作台 `workspace-review.json`；`inputs-supplement.json`；`knowledge-confirm/results.json`；`search-confirm.json`；系统/时间/浮窗输入记录 | 明暗、默认/悬停/聚焦及父容器，中性焦点、透明原位编辑；修复知识查找聚焦补底色。阶段1旧启动阻塞已补齐；用户审阅仍待确认 |
| 标题栏/导航/列表/分组/搜索/批量（2） | product-experience、group-context-menu、context-create；native-main.png | 真实范围/排序/撤销/返回与交通灯核实；非原生Windows验证 |
| 标题/属性/简报/历史（3） | task-workspace、workspace-review | 同一编辑会话历史、草稿、Undo及空/错误/禁用/长标题/两宽度通过 |
| 树/记录/连续性（3） | node-interactions-retry、node-context-menu、flow-completed-filter、continuity28；performance-final/supplement/comparison | 真实parentId/order、跨层拖动、取消、折叠、焦点/滚动/编辑器复用；大树成本按交接如实记录 |
| 知识正文/工具/文件/导出（4） | knowledge-confirm、knowledge-image、knowledge-release-regressions；最终实际包的desktop/conflict/feedback/search四组 | CRLF、表格、图片、链接、模式、Undo、长笔记、磁盘故障/冲突/Recovery及导出；不替换生产数据模型。图像/权限故障注入与真实磁盘场景在原套件分别记录 |
| 工作/学习队列/详情/导入（5） | temporal/results.json（9组、28布局）及完整模型单测 | 原时间制度、队列、只读预览后确认、估时范围、来源与顺序保持 |
| 日历/回顾（5） | temporal与product-experience | 截止日语义、月份/所选日期、三种统计口径、结束日及返回上下文通过；时区专项继承阶段5证据，本轮未宣称再次跨所有时区运行 |
| 设置/恢复/帮助/反馈（6） | system-final/results.json（9组、36布局） | 实际恢复事务、故障回滚、撤销、同意/取消、错误保留、动态表单、键盘返回；反馈使用本地响应夹具，未向外部服务提交 |
| 更新/提醒/备份（6、8） | 系统专项、完整updater/data-continuity/deadline-reminders单测、notification-capability专项、包与摘要检查 | 开发不支持状态、权限未知/拒绝、备份/导入失败回滚通过；真实通知授权/横幅、在线更新安装和安装器交互未实测 |
| 今日/独立辅助窗口（7） | widget-retry（11组）、widget-lifecycle、today-widget-draft；native-menu.png、native-main.png | 真BrowserWindow父子层级、一次外点、Esc返回、草稿跨退出、请求防重、单屏几何/缩放/穿透偏好通过；原生Windows/物理跨屏/DPI仍待平台验证 |
| 主进程/存储/服务 | 完整352主测试＋12服务测试；实际包36知识场景；系统备份/Recovery测试 | 本阶段产品改动仅CSS，没有schema/IPC/存储/服务协议变更 |
| 构建/字体/导出资源/安装器 | build-mac-final、build-win-final、package-source-proof、artifact-check | Mac x64/arm64及Windows x64本地包；逐字节源码/资源/依赖/排除项/更新摘要校验。没有提交、发布、上传、替换正式安装 |
| 文档/原型/测试 | preservation.json、本表、阶段8交接、DECISIONS/state | 历史冻结样本与前阶段累计改动保留；修复测试焦点等待与搜索套件隔离路径，增加真实搜索稳定性断言 |

## CSS、事件及资源审计

- `foundation.css`唯一持有共享工作面明暗色值、字重、输入/焦点/选区与减少动效契约。repository与五个workspace层通过局部别名接入；没有扩大为全局旧变量替换，也没有新建phase补丁。移除五组重复暗色覆盖及repository重复色值。
- 局部`--input-surface`/`--field22-bg`不是可机械删除的重复：CSS变量会在声明元素解析，必须随局部`--list/--text`在同一作用域计算；保留以免恢复搜索聚焦跳色。
- `scale`负责列表几何，`brief21`负责输入选区/会话，`management24`负责行内改名/返回回执，`window25`负责标题栏，`manual27`负责文档滚动，`continuity28`负责区域/指针连续性。这些已有render包装承担不同前后置职责，未发现可以在本阶段无损删除的重复包装；保留、用真实交互回归覆盖。没有引入新的render包装或全局监听。
- `notebook23.js`仍被兼容测试执行；Milkdown在实际HTML、构建、旧兼容分支和冻结契约中都有引用。保留这些链路及生成资源，不以文件名或主入口单一引用决定删除。正式资源入口和打包白名单均核对。
- `app/renderer/assets/loop-icon.png`属于未打包的历史位置，真实入口使用`src/assets/loop-icon.png`且有既有防回归测试。包校验按真实白名单检查，不将历史文件误报为漏包；历史原件保留。
- 外置盘拷贝生成的AppleDouble旁文件只在校验魔数后移到`appledouble-release/`，最终release中为0；不修改真实安装包字节。

## 可访问性、性能与平台边界

技术审计为桌面Operate场景：可访问性3/4、性能2/4、主题3/4、桌面缩放3/4、实现一致性4/4，共15/20。评分为本次工程判断，不是WCAG认证。确定的搜索状态问题已修复；大树完整展开的全量渲染仍是主要P2限制。已实测中性键盘焦点、Tab/Esc、角色/名称、错误关联、隐藏子树inert、减少动效、四字号及100–200%DPR模拟；CUA读取真实辅助功能树与原生窗口。未运行VoiceOver/NVDA语音朗读，不宣称完整屏幕阅读验收。

原生Windows、Mac Intel实际运行、跨屏不同DPI、人工中文输入法、通知授权/横幅和更新安装仍待对应平台人工验收。历史“锁屏”推断沿D46更正；本阶段成功绑定当前工作区的原生窗口，不延续该说法。
