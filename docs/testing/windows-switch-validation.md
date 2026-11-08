# Loop v0.2.13 Windows 切换稳定性验证

状态：待 Windows 实机执行。此清单用于补验原生窗口、物理指针和显示缩放。发布流水线的安装升级与实际包检查有独立记录。

## 准备

1. 从 [v0.2.13 发布页](https://github.com/tangyuanx/Loop/releases/tag/v0.2.13) 安装 Windows x64 版本，在「设置 → 更新」核对版本号。
2. 通过 Loop 的退出入口结束已运行的实例。若机器里有日常任务数据，使用下方 PowerShell 命令启动独立测试资料目录。把第一行改成快捷方式「目标」里 `Loop.exe` 的完整路径。

   ```powershell
   $exe = Join-Path $env:LOCALAPPDATA 'Programs\Loop\Loop.exe'
   if (-not (Test-Path -LiteralPath $exe)) { throw "请将 $exe 改为 Loop.exe 的实际路径" }
   $qa = Join-Path $env:TEMP ('Loop-switch-qa-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
   New-Item -ItemType Directory -Path $qa -ErrorAction Stop | Out-Null
   $previous = $env:LOOP_USER_DATA_DIR
   try {
     $env:LOOP_USER_DATA_DIR = $qa
     Start-Process -FilePath $exe
   } finally {
     $env:LOOP_USER_DATA_DIR = $previous
   }
   Write-Host "测试资料目录：$qa"
   ```

3. 确认打开的是空测试资料。新建一条任务，填入多行任务简报，添加父节点和子节点，再建两篇笔记。其中一篇要能滚动。修改一次节点状态，给「历史处理」生成记录。

## 优先验证

| 验证点 | 操作 | 通过标准 |
| --- | --- | --- |
| 三个任务页签 | 简报展开和收起时分别连点「处理流 → 知识笔记 → 历史处理 → 知识笔记 → 处理流」。再用 Tab、Enter 重做一遍。 | 简报在上、页签在下。简报状态相同时，互切中三个页签和正文起点留在原位。键盘焦点留在激活的页签。 |
| 顶栏开关 | 在鼠标不挪动的情况下，分别对侧栏开关、任务列表开关点两次。交叉收起两栏后再展开。 | 原位置可以再次点击。下方列随收展改变宽度，两个开关与系统最小化、最大化、关闭按钮都能正常点击。 |
| 笔记连续性 | 在长笔记中滚动、选中文字并做一次可撤销的编辑。切到处理流和历史处理，再切回原笔记。换文档页签后返回。 | 原笔记的位置、选区和草稿保留，Ctrl+Z 可撤销刚才的编辑。 |
| 遮挡与返回焦点 | 收起简报并展开任务详情，进入笔记，点击查找、专注和「⋯」。打开笔记大纲，展开查找替换，再关闭大纲。回到处理流，从「定位节点」选中子节点，再关闭记录。 | 详情和大纲的按钮可直接点击，定位弹层会关闭，节点记录可操作，Escape 能回到原节点。 |
| 页面内控件 | 添加并清除筛选条件、输入和清空搜索；切日历月份、回顾范围、设置分类。有开启「工作与成长」时切换它的三个页签。 | 控件留在原位。只有结果列表或所选正文按预期更新，工作导航弹窗外框不随内容重新居中。 |
| 今日浮窗 | 将浮窗设在右上角，切换「今日任务／速记」，反复收起和展开。各打开一次偏好和行菜单再按 Esc。 | 右上角状态下顶栏按钮在屏幕上的位置一致；菜单在浮窗上方且能一次关闭。速记草稿仍在。 |

## 缩放、跨屏与指针

- 在 Windows「设置 → 系统 → 屏幕」用 100% 与 125% 或 150% 分别重复前三项。先测普通窗口，再缩到应用允许的最小窗口并最大化。检查标题栏控件没有重叠，页签可命中，焦点可见，窗口无横向溢出。
- 若有两台不同缩放的显示器，把整个窗口拖过去、等位置稳定后再拖回来。两边重复同坐标点击。单屏机器将跨屏项记为「未测」。
- 在 Loop「设置 → 高级」选「连续切换」，打开「操作组移动时跟随鼠标」。先点固定页签，指针应保持不动。若遇到确实会移动的操作组，核对指针没有落到相邻按钮上；手动移动鼠标、按键或移动窗口应能立即接管。若没有触发移动的操作组，记为「固定控件通过，移动跟随未触发」。
- 补测时记录 Loop 版本、Windows 版本、显示器数量及各自缩放、窗口状态和「通过／失败／未测」。若失败，记录从空测试资料可复现的点击序列。录屏尽量只包含隔离窗口。

## 可选源码回归

若本机已准备 Git 与 Node.js，以下测试启动独立 Electron 资料目录。它们覆盖控件坐标、键盘焦点、编辑器竞态及指针协议。显示器与物理指针体验仍按上面的实机步骤判定。

```powershell
git clone --branch v0.2.13 --depth 1 https://github.com/tangyuanx/Loop.git Loop-switch-qa
Set-Location Loop-switch-qa
npm ci
npm run build:knowledge
node tests/switch-anchors.ui.cjs
node tests/switch-continuity.ui.cjs
node --test tests/pointer-continuity.test.cjs tests/window25-renderer.test.cjs
```
