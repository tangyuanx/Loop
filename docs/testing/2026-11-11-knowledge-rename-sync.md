# 知识笔记重命名与本地文件实时同步（#88）

本轮把「知识笔记改名」从只改应用内元数据，改成真正重命名磁盘上的 Markdown 文件。基线为 `main @ 2b6a7fc`（v0.2.18），未升版本、未提交、未发布。

## 行为与边界

- 命名规则集中在一处（`app/renderer/src/knowledge-core.js` 的 `validateNoteName`）：扩展名保持原样；用户输入的 `.md` 不会变成双扩展名；拒绝 `\ / : * ? " < > |`、控制字符、结尾句点、Windows 保留名和超过 200 字节的名称。
- 文件系统先于应用状态：`app/main/knowledge-file.cjs` 的 `renameKnowledgeDocument` 完成重命名后才返回成功；渲染器只在成功之后才改标题与 `filePath`，因此不会出现「页面已改名、磁盘还是旧名」。
- 目标已存在时不让位：POSIX 的 `rename` 会静默覆盖，所以先 `lstat` 目标；同名文件或已绑定其他笔记的名称一律拒绝。
- 重命名与保存共用同一把按路径的串行队列，改名后旧路径不会再被排队中的保存「复活」。主进程在成功时同时放行新旧两个路径，并立即改写文件监听基线，自己的改名不会被误判为外部移动（`file-missing`）。
- 本地记录写入失败时按原名回滚磁盘文件；回滚也失败才提示用户「文件已改名但记录未保存」。
- 未保存草稿不参与改名：正文不动，草稿与 `documentState` 保留，之后保存走新路径。
- 关闭页签仍然只关闭文档，不删除文件。
- 相对 Markdown 链接不静默改写：改名成功后列出受影响的笔记，用户确认后才按新文件名重写并走既有保存通道；`[[note:…]]` 与 `[[标题]]` 由标识符和别名保证不受影响。
- 任务标题（任务列表、Today 浮窗）仍只改元数据，不移动文件。这是刻意的范围边界：把频繁的任务改名绑定到磁盘移动，失败时需要回滚任务标题，代价远高于收益。

## 验证

| 检查 | 结果 |
| --- | --- |
| `node tests/knowledge-rename.test.cjs` | 14 项通过：命名规则、重命名保内容/扩展名、同名拒绝、非法名拒绝、无权限拒绝、跨笔记绑定拒绝、同名空操作、按原名回滚、与保存串行、链接定位与重写、监听基线、改名后静默换基线仍能发现后续外部修改 |
| `node tests/knowledge-rename.ui.cjs` | 6 组通过：真实渲染器 + 真实文件服务；改名同步、链接确认后重写、重载后仍可读、同名/非法/无权限拒绝且状态不变、未保存草稿保留且不被标记为已保存、关闭页签保留文件；无 pageerror |
| `node tests/knowledge-editor.ui.cjs` | 全链路通过（原编辑器、三种模式、输入法、表格、图片、冲突、重命名、删除恢复、长文、明暗主题），确认改名逻辑改动未破坏编辑器 |
| `node tests/knowledge-core.test.cjs`、`node tests/knowledge-export.test.cjs` | 17 项、4 项通过 |
| `node tests/desktop.test.cjs` | 233 项通过；1 项因本机禁止 `spawn`（沙箱管道限制）失败，与本改动无关 |
| `node tests/knowledge-reliability.test.cjs` | 13 项通过，3 项因本机无创建符号链接权限（`fs.symlink EPERM`）失败，与本改动无关 |

## 本机环境限制

- 真实 Electron 无法在本机启动（最小化探测程序在 Chromium 初始化阶段即崩溃，`0xC0000005`，加 `--no-sandbox` 无效），因此 `tests/knowledge-tabs.ui.cjs` 的断言更新与其它 Electron UI 套件未能在本机执行，需要在 CI 或本机可启动 Electron 的环境复跑。
- 沙箱禁止带管道 stdio 的进程启动，`node --test`（每个文件一个子进程）与 Playwright/Electron 启动都需要完全权限；因此 Node 套件用 `node <file>` 直接运行。
- `npm ci` 的 postinstall 会因同样原因失败，依赖用 `npm ci --ignore-scripts` 安装，Electron 二进制另行用 `ELECTRON_CACHE` 指向工作区下载。
