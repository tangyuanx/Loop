# 节点右键菜单与分享面板

用户确认本轮同时整理右键菜单及其分享面板。基线 `46b3278` / 0.2.5；沿用现有工作区与前轮节点分享成果，未提交或发布。

## 实现

- 菜单按创建、分享、删除分三组；同级/子级相邻，删除使用垃圾桶图标，中性悬停与键盘焦点。
- 分享框采用720px双栏：左侧范围与折叠的关联编辑，右侧真实节点树预览；取消与导出固定在底部。
- 同级用语在现有节点操作入口同步。原有父子关系、关联范围、存盘和真实导出实现保持不变。
- 同步捕获分享来源，避免异步命令派发后丢失事件来源；从右键关闭返回节点，从行内入口关闭返回分享按钮。

## 验证

- `node --test tests/desktop.test.cjs tests/node-share.test.cjs tests/frontend-foundation.test.cjs`：243项通过。
- `npm run test:ui:node-menu`：真实创建层级、取消草稿、重载持久化、DOM/滚动保持、跨组键盘与首尾循环、明暗和边缘定位通过。
- `npm run test:ui:node-share`：范围、关联保存/重启、实际Markdown/PDF写盘、取消/失败重试、两种关闭焦点返回通过。
- 集中检查明暗主题 × 1024×680 / 1440×900 的菜单、分享默认、展开关联共12张截图；独立设计复核结论为可交付本地验收，无必须修复项。
- JS语法、`git diff --check`、设计机械检测通过（`[]`）。

最小窗口展开关联后需滚动正文到“保存关联”；底部取消/导出保持可见。未以自动化代替人工手感验收，未测试本轮Windows安装包或物理跨屏/IME。

## 当前候选

- 启动：`LOOP_USER_DATA_DIR=<独立profile> npm run dev`，窗口「Loop · 节点菜单与分享验收（隔离数据）」。
- 源码：`/Volumes/T7/work/personal-task-track`，实际 `app.getAppPath()` 已核对。
- PID：1738，0.2.5；实际 `app.getPath('userData')`：`/Volumes/T7/work/personal-task-track/.local-review/node-menu-redesign-20261030/candidate-0yAkk8/user-data`。
- 数据：生产规范化后的合成样本；启动前备份已校验摘要，未读取或修改正式用户数据。
- 运行身份、备份摘要与候选截图见上述candidate目录；集中截图与单测日志在 `.local-review/node-menu-redesign-20261030/`。

启动辅助脚本首次在主窗口注册完成前读取窗口，已改为等待实际窗口就绪。原实例已成功置前并完成路径核对，无产品启动故障。
