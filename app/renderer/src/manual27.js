// Phase27 manual: article content, HTML and CSS vocabulary from the approved Demo.
// Navigation and editor capture use the real application, without review scaffolding.
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const icon = shellIcon;
  const section=(title,body,go='')=>({title,body,go});
  const paragraph=t=>`<p>${t}</p>`;
  const steps=items=>`<ol>${items.map(t=>`<li>${t}</li>`).join('')}</ol>`;
  const bullets=items=>`<ul>${items.map(t=>`<li>${t}</li>`).join('')}</ul>`;
  const note=t=>`<aside class="manual27-note">${t}</aside>`;
  const table=(head,rows)=>`<table><thead><tr>${head.map(t=>`<th scope="col">${t}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(t=>`<td>${t}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const articles=[
    {id:'start',group:'开始使用',title:'用 Loop 处理第一件事',keys:'入门 新建 快速开始 完成',lead:'从一件需要解决的事开始，把每一步尝试和最终结论留在同一个任务里。',sections:[
      section('先了解工作空间',paragraph('任务列表在中间，选中任务后，在右侧记录背景、进展和结论。处理流保留逐层拆解的验证过程；知识笔记整理可复用的方法。')+`<div class="manual27-path"><span>记录任务</span>${icon('chevron')}<span>加入今日</span>${icon('chevron')}<span>逐层处理</span>${icon('chevron')}<span>留下结论</span></div>`),
      section('新建一件要解决的事',steps(['进入<strong>任务仓库</strong>，点击右上角的<strong>新建任务</strong>。','输入能说明问题的名称。按需要选择分组、优先级和截止时间。','在任务简报的<strong>背景</strong>中写清目标或出现的现象。点击正文即可输入，支持换行。'])+note('任务名称可以稍后双击修改，点击其他位置后自动保存。'),'tasks'),
      section('选择今天要做什么',paragraph('将任务标记为<strong>今日</strong>。它会出现在今日列表与今日浮窗中，原有分组保持不变。截止日在今天或循环到期的任务也会进入今日视图。')+paragraph('今天不需要处理时，可以移除手动的今日标记。若任务因今日截止或循环到期仍被纳入，先检查它的时间设置。'),'today'),
      section('用处理流保留过程',steps(['点击<strong>添加节点</strong>，直接输入第一步的名称。','需要细分时，在该节点旁添加子节点。每一层都围绕它的上一级问题展开。','打开节点，记录方法、现象、日志和判断；验证后更新节点状态。'])+`<div class="manual27-example"><small>示例 · 排查偶发中断</small><strong>${icon('tasks')}排查设备偶发收不到中断</strong><ul><li>${icon('check')}确认设备与系统环境<span>已完成</span></li><li>${icon('circle')}沿中断路径逐层验证<span>待处理</span></li><li>${icon('circle')}复现并记录触发条件<span>待处理</span></li></ul></div>`,'flow'),
      section('完成并留下结论',paragraph('在<strong>进展</strong>中保留当前判断，在<strong>结论</strong>中记录结果、原因和处理方法。完成前，需要填写结论，并将处理流中的节点全部处理完成。若尚未满足，完成检查会定位到需要补充的内容。')+paragraph('可复用的命令、方法和解释适合整理到知识笔记中，方便下一次查阅。'),'notes')
    ]},
    {id:'organize',group:'开始使用',title:'今日、仓库、分组与速记',keys:'关系 归类 今天 全部 加入 移出',lead:'它们是不同的查看与组织方式，同一个任务不会因为加入今日而失去原来的归属。',sections:[
      section('任务存在哪里',table(['入口','用途'],[['任务仓库','集中查看和管理全部任务、速记。'],['任务分组','按项目、领域或用途归类，任务属于一个分组，也可以未分组。'],['今日','聚合今天需要处理的记录，保留原分组。'],['今日浮窗','在桌面就近查看今日任务；速记在独立页签展示。']])+'<p>先用分组明确任务属于哪里，再用今日决定今天要处理哪些任务。</p>','tasks'),
      section('为什么任务还在今日',paragraph('手动加入今日、截止日期为今天、循环任务在今天到期，都可能使任务进入今日。移除手动标记不会自动修改截止日期或循环计划。')+note('今日浮窗不展示其他分组的任务集合，也不需要在任务行重复显示分组。'),'today'),
      section('什么时候使用速记',paragraph('还没有来得及整理的想法、提醒或一句记录，可以先作为速记保存。它与正式任务分开查看；需要进一步处理时，可以转换为任务并补充背景与处理流。')+paragraph('浮窗中的添加速记只出现在<strong>速记</strong>页签，不占用今日任务页签。'),'quick')
    ]},
    {id:'editing',group:'任务与处理',title:'编辑任务与管理分组',keys:'改名 名称 双击 右键 颜色 排序 移动',lead:'日常修改在原位置完成；需要整理多项内容时，再进入集中管理。',sections:[
      section('直接修改名称',paragraph('双击任务名称或分组名称，原位置会切换为输入框。输入后点击其他位置即可保存，也可以按 Enter 提交。按 Esc 放弃本次修改。')+note('输入框中不要留空。保存后，名称会同步到当前列表和相关位置。'),'tasks'),
      section('修改任务属性',paragraph('选中任务后，在标题下方修改优先级、分组、截止时间或循环计划。背景、进展和结论可以直接点击输入，并支持多行内容。任务操作菜单还提供移动、复制摘要和删除等操作。')+paragraph('背景、进展、结论可以在处理流中整体折叠，保留更多空间给节点。'),'flow'),
      section('整理分组',paragraph('使用<strong>任务分组</strong>标题右侧的管理入口，集中调整分组名称、颜色与顺序。对单个分组点击右键，也可以打开其操作菜单。')+paragraph('删除分组时先确认内容的去向：可以保留其中的任务与速记，也可以连同内容一起归档。已经配置的工作与成长来源，需要同时检查。')+note('内置的“未分组”用于安放没有归属的内容，不按普通分组删除。'),'groups')
    ]},
    {id:'schedule',group:'任务与处理',title:'截止时间、提醒与循环',keys:'日期 到期 每天 每周 通知 时间',lead:'截止时间说明何时要完成，提醒决定何时提示，循环则决定何时重新进入待处理周期。',sections:[
      section('设置截止时间与提醒',steps(['打开任务，点击标题下方的截止时间入口。','选择日期；有明确时刻时，再设置时间。','选择提醒时机，例如截止时、提前 1 小时或提前 1 天。'])+paragraph('没有截止时间的任务无需补一个日期。提醒是否能显示，还取决于桌面应用运行状态和系统通知权限。'),'flow'),
      section('安排循环任务',paragraph('循环支持<strong>每天</strong>或<strong>每周</strong>。每周可以选择多个星期，按需要设置时刻。循环到期会使任务进入今日；完成记录与当前周期相关。')+note('完成本次任务前，同样需要留下结论并完成处理流节点。循环不等于复制一个完全独立的新任务。'),'flow'),
      section('在日历中检查安排',paragraph('日历按日期呈现相关任务，点击某天可以查看当天的任务。先用日历发现拥挤的安排，再回到任务中调整时间。某天没有任务时，保持简洁的空状态。'),'calendar')
    ]},
    {id:'flow',group:'任务与处理',title:'处理流与节点记录',keys:'层级 子节点 拖动 状态 Markdown 日志 卡住 稍后',lead:'处理流展示问题是怎样一步步解决的。把验证过程留在节点中，把整体判断留在任务简报中。',sections:[
      section('添加与拆解节点',paragraph('点击<strong>添加节点</strong>，立即创建待命名的位置。子节点通过所属节点旁的添加入口创建。父节点描述阶段或方向，子节点描述更具体的验证步骤。')+paragraph('拖动节点可以调整顺序或层级。修改层级前，检查它是否仍然属于同一条验证路径。'),'flow'),
      section('记录每一步的证据',paragraph('打开节点详情后，记录验证方法、观察结果和下一步判断。记录支持 Markdown，可插入代码块、图片、链接和表格。日志中的命令和关键输出适合用代码块，避免丢失缩进。')+note('任务简报是整体上下文；节点记录是当前步骤的证据。两个位置不需要重复抄写全部内容。'),'flow'),
      section('更新状态与定位',paragraph('使用节点状态入口切换待处理、已完成、卡住或稍后。卡住时，记录阻塞原因和需要的条件。用<strong>下一待处理</strong>或定位节点入口，在较长的处理流中继续工作。')+paragraph('收起节点隐藏下级内容，保留层级；收起任务简报隐藏背景、进展和结论，正文仍然保留。'),'flow'),
      section('删除与恢复节点',paragraph('删除节点前，确认它包含的子节点与记录。删除的节点可以在最近删除中恢复。原任务已不存在时，先恢复任务；原父节点已不存在时，节点会恢复到任务的处理流根层。'),'recovery')
    ]},
    {id:'search',group:'任务与处理',title:'搜索、筛选与批量整理',keys:'查找 全局 多选 批量 隐藏 搜索框',lead:'先搜索你记得的关键词，再用筛选缩小范围；整理多项内容时使用多选。',sections:[
      section('搜索全部记录',paragraph('顶部搜索框可以查找任务、节点和速记。输入名称或内容关键词，点击结果进入对应记录。搜索不要求先猜出它属于哪个分组。')+paragraph('在非输入区域使用 <kbd data-manual27-shortcut="search"></kbd> 可以打开全局搜索。在笔记编辑区中，该组合键用于链接编辑。'),'tasks'),
      section('减少列表中的干扰',paragraph('未完成、全部与已完成保留在任务列表顶部。优先级等较少使用的条件收在筛选按钮中。没有找到记录时，先检查当前分组、类型和筛选条件。'),'tasks'),
      section('批量移动或删除',paragraph('进入<strong>多选</strong>，选中要整理的记录，再选择批量操作。删除前核对影响范围；移入分组后，原来的今日标记和记录内容会保留。')+note('批量恢复可能有部分项目需要先处理所属任务或名称冲突，结果会逐项说明。'),'tasks')
    ]},
    {id:'widget',group:'任务与处理',title:'今日浮窗',keys:'桌面 置顶 穿透 透明度 大小 拖动 速记',lead:'在主窗口之外，就近查看今天要处理的任务。任务和速记各有自己的页签。',sections:[
      section('打开并使用浮窗',paragraph('点击主窗口顶部的<strong>今日任务浮窗</strong>入口。任务页签显示今日任务，可以完成记录、调整顺序或回到主窗口继续处理。浮窗不显示其他分组的全部任务。'),'widget'),
      section('在速记页签快速记录',paragraph('切换到<strong>速记</strong>页签后，底部显示速记输入区。输入内容并按 Enter 添加；Shift + Enter 换行。速记之后可以转换为正式任务。'),'widget'),
      section('调整浮窗',paragraph('顶部齿轮打开浮窗设置，调整置顶、鼠标穿透、透明度等偏好。拖动标题区域移动浮窗，拖动边缘调整大小；设置入口与关闭按钮始终保留。')+note('鼠标穿透后，点击会落到浮窗后面的窗口。使用 <kbd data-manual27-shortcut="passthrough"></kbd> 切换穿透；也可以回到主窗口的任务与浮窗设置中调整。'),'widget-settings'),
      section('键盘调整顺序',paragraph('聚焦记录的拖动手柄后，使用 <kbd>Alt + ↑</kbd> / <kbd>Alt + ↓</kbd> 调整顺序。聚焦记录后，<kbd>Shift + F10</kbd> 可以打开记录操作菜单。'),'widget')
    ]},
    {id:'calendar',group:'任务与处理',title:'日历与回顾',keys:'月份 完成 历史 时间线 日期',lead:'日历看安排，回顾看结果。它们仍然使用任务中的时间与记录，无需维护另一套数据。',sections:[
      section('按日期检查任务',paragraph('进入日历，切换月份并选择日期。在当天的任务列表中点击记录，回到任务详情查看背景和处理流。月份标题与分隔用于明确当前时间范围。'),'calendar'),
      section('复盘一段时间',paragraph('进入回顾，选择时间范围与日期口径，查看相关任务。创建时间、更新时间、完成时间回答的是不同问题，使用前先检查当前口径。')+paragraph('复盘时重点查看结论、关键节点和仍然卡住的步骤。需要补充记录时，直接打开相关任务。'),'review'),
      section('查看历史处理',paragraph('任务右栏的<strong>历史处理</strong>用于查看该任务保留的处理记录。循环任务和工作过程中留下的记录，可以帮助比较本次与此前的情况。'),'history')
    ]},
    {id:'notebook',group:'知识与资料',title:'编辑知识笔记',keys:'Markdown 预览 工具栏 页宽 表格 代码 图片 数学 目录',lead:'把可复用的经验整理成正文。编辑、Markdown 和预览共享同一份内容。',sections:[
      section('选择编辑方式',table(['模式','适合什么'],[['编辑','直接编辑格式化正文，使用工具栏插入内容。'],['Markdown','编辑 Markdown 源码，精确调整结构和语法。'],['预览','检查最终阅读效果，不在此模式修改正文。']])+paragraph('切换模式前，当前输入会被捕获。仍需检查保存状态，模式切换不代表已经写入磁盘。'),'notes'),
      section('使用顶部工具栏',paragraph('常用文字格式、标题、列表和引用在上方展开。程序员笔记可使用代码块、行内代码、链接、图片、表格、任务列表和其他支持的插入项。将编辑模式切换放在工具栏右侧，便于区分。')+paragraph('代码块中选择对应语言，保留命令或日志缩进。图片与附件是否完整迁移，需要同时检查外部文件和相关资源。'),'notes'),
      section('调整页面宽度',paragraph('在左下角设置的「知识笔记」中选择默认、较宽或全宽，也可统一选择编辑、源码或阅读视图。这些偏好对所有笔记生效，自动保存，重启后保留。笔记内的页宽和视图快捷入口会同步更新同一设置。页宽改变阅读布局，不改变正文内容。'),'notes'),
      section('整理长笔记',paragraph('使用标题形成结构，通过文档目录定位章节。频繁重复的内容可以整理成独立章节；任务的即时进展仍然记录在任务简报，避免笔记承担所有日常状态。'),'notes')
    ]},
    {id:'files',group:'知识与资料',title:'笔记保存与文件管理',keys:'未保存 草稿 已保存 另存为 关联 文件不存在 外部修改 冲突 路径',lead:'软件中的草稿和磁盘上的 Markdown 文件是两层保存。先看状态，再决定保存、重新加载或另存为。',sections:[
      section('确认内容保存在哪里',paragraph('编辑产生的草稿会保留在软件内；点击<strong>保存</strong>才会将知识笔记写入关联的 Markdown 文件。没有关联文件时，保存需要选择文件位置。')+note('<strong>草稿已保留不等于文件已保存。</strong>需要在其他编辑器使用这份笔记时，先确认文档状态和文件位置。'),'notes'),
      section('保存与另存为',paragraph('保存写入当前关联文件；另存为选择新的位置。编辑知识笔记时，使用 <kbd data-manual27-shortcut="save"></kbd> 保存，<kbd data-manual27-shortcut="save-as"></kbd> 另存为。保存失败时正文应保留，先处理提示再重试。')+paragraph('文件选择和写入由桌面应用完成；取消文件选择不会改变原来的关联。'),'notes'),
      section('处理外部变化',table(['状态','建议操作'],[['文件被外部修改','先比较内容，再选择重新加载、明确覆盖或另存为；不会直接静默覆盖。'],['原文件不存在','重新定位文件，或将当前草稿另存为。'],['读取或保存失败','检查文件是否可访问，保留当前草稿后重试。']])+note('重新加载会替换编辑区内容；操作前检查尚未保存的修改。外部文件变化需要由桌面应用检测。'),'notes'),
      section('取消关联与移除笔记',paragraph('<strong>取消文件关联</strong>保留当前正文，也保留磁盘文件。<strong>移除软件内笔记</strong>会归档当前正文，可从最近删除恢复。恢复后的文件关联需要重新选择，已有正文时会恢复为副本。'),'recovery')
    ]},
    {id:'work',group:'可靠使用',title:'工作与成长',keys:'高级 任务来源 自动推进 卡住 暂停',lead:'把任务组织成连续工作的队列。先明确来源，再开始推进。',sections:[
      section('配置任务来源',paragraph('在设置的<strong>高级功能</strong>中检查工作与成长的配置，选择适合的任务来源。来源依赖任务分组；修改或删除相关分组后，需要重新检查来源配置。'),'advanced'),
      section('继续、卡住与暂停',paragraph('按照当前队列打开任务，保留进展和结论。任务卡住时记录原因，再决定是否切换到下一项。完成检查通过后，自动推进行为由对应配置决定。'),'advanced'),
      section('避免来源失效',paragraph('删除作为成长来源的分组时，需要明确选择新的来源或停止成长。恢复分组后也不会自动启动工作流程；先核对来源和当前任务，再继续。'),'groups')
    ]},
    {id:'recovery',group:'可靠使用',title:'删除、撤销与恢复',keys:'误删 最近删除 回收站 永久 清空 副本',lead:'删除后先进入最近删除。恢复时保留已有内容，不把不同操作的影响混在一起。',sections:[
      section('什么可以恢复',paragraph('最近删除包含任务、速记、分组、处理流节点和软件内笔记。删除后的短暂提示可以直接撤销；提示消失后仍可从最近删除恢复。内容保留至手动移除。'),'recovery'),
      section('从最近删除恢复',steps(['进入<strong>设置 → 数据 → 最近删除</strong>。','搜索名称，按类型筛选，选中要恢复的内容。','核对详情中的原分组、所属任务、包含内容及恢复目标。','点击恢复；多项内容可以选择后批量恢复。']),'recovery'),
      section('原来的位置不存在时',table(['情况','恢复方式'],[['原分组不存在','可以选择现有分组，默认恢复到未分组。'],['节点所属任务已删除','先恢复所属任务，再恢复节点。'],['原父节点不存在','恢复到所属任务的处理流根层。'],['任务已有笔记','恢复为新任务中的笔记副本，保留已有正文。'],['分组名称重复','先修改恢复名称，避免与现有分组冲突。']]),'recovery'),
      section('永久移除的范围',paragraph('永久移除或清空最近删除后，无法再通过最近删除恢复。磁盘上的文件、附件和已经导出的备份会保留。此类操作需要独立确认，阅读手册不会执行删除。')+note('备份是额外的恢复来源。重要整理前，先导出一份完整备份。'),'data')
    ]},
    {id:'backup',group:'可靠使用',title:'备份、恢复与迁移',keys:'导出 导入 数据 本地 loopbackup 换电脑 升级 Markdown',lead:'完整备份保存软件中的工作数据；外部关联的 Markdown 文件和资源需要同时照顾。',sections:[
      section('导出完整备份',steps(['进入<strong>设置 → 数据</strong>。','选择导出完整备份，保存 <code>.loopbackup</code> 文件。','将备份保存在便于找到的位置。迁移电脑前，再检查外部笔记及资源是否一起复制。'])+note('软件内数据保存在本地。浏览器预览的数据与桌面应用实际数据库分开。'),'data'),
      section('恢复前检查备份',paragraph('选择完整备份文件或升级备份目录后，先核对来源和内容。桌面应用会在导入前备份当前数据，并校验待导入内容；失败时保留回退路径。不要把未知来源的文件当作自己的最新备份。'),'data'),
      section('迁移外部笔记',paragraph('绑定的 Markdown 文件需要单独备份。将文件及相关图片资源复制到新电脑后，在笔记文件管理中重新定位或选择关联。软件备份不能代替对所有外部文件的备份。'),'notes'),
      section('为什么数据目录仍叫旧名字',paragraph('历史数据目录保留 <code>Personal Task Track</code> 名称，是为了兼容升级后的数据读取。应用显示名称为 Loop，并不代表需要手动重命名或搬动数据库。')+paragraph('macOS 数据位于用户的 Library/Application Support 下；Windows 数据位于用户的 APPDATA 下。日常迁移优先使用数据设置中的导出与恢复。'),'data')
    ]},
    {id:'shortcuts',group:'可靠使用',title:'外观与常用快捷键',keys:'字体 字号 深色 浅色 Mac Windows 键盘',lead:'按工作环境调整阅读方式。快捷键的作用与当前焦点有关，输入区优先处理正文编辑。',sections:[
      section('调整阅读方式',paragraph('在<strong>设置 → 外观</strong>中选择浅色或深色主题，调整字号、中英文字体。设置即时应用，不需要额外保存。界面较密时，优先用标准字号并收起暂时不需要的简报或导航。'),'appearance'),
      section('常用快捷键',table(['操作','组合键与作用范围'],[['搜索记录','<kbd data-manual27-shortcut="search"></kbd> · 非输入区域'],['保存知识笔记','<kbd data-manual27-shortcut="save"></kbd> · 知识笔记编辑区'],['笔记另存为','<kbd data-manual27-shortcut="save-as"></kbd> · 知识笔记编辑区'],['切换浮窗鼠标穿透','<kbd data-manual27-shortcut="passthrough"></kbd> · 桌面应用'],['浮窗排序','<kbd>Alt + ↑ / ↓</kbd> · 记录拖动手柄获得焦点后'],['关闭当前弹窗','<kbd>Esc</kbd> · 打开的弹窗或菜单']])+paragraph('Mac 使用 ⌘，Windows 使用 Ctrl。')),
      section('名称编辑的键盘操作',paragraph('进入名称编辑后，Enter 提交，Esc 取消本次修改。点击其他位置自动保存。输入中文时，确认候选词不会同时提交名称。'),'tasks')
    ]},
    {id:'help',group:'可靠使用',title:'更新与问题反馈',keys:'版本 安装 下载 软件更新 GitHub 隐私 帮助',lead:'先确认软件版本和问题发生的位置，再决定更新、恢复数据或提交反馈。',sections:[
      section('检查软件更新',paragraph('应用图标附近的更新入口与<strong>设置 → 软件更新</strong>用于查看当前版本和更新状态。下载安装后，按更新流程重启应用；重要数据可以先导出完整备份。')+paragraph('当前项目通过 GitHub Releases 提供 macOS 与 Windows 安装包。请使用与自己的平台匹配的文件。'),'update'),
      section('描述遇到的问题',paragraph('在<strong>帮助与反馈</strong>中提交问题标题、现象、复现步骤与预期结果。附上问题发生的模块和版本，更容易判断原因。数据问题先保留当前文件与备份，避免反复覆盖。'),'feedback'),
      section('检查公开内容',paragraph('反馈会成为公开的 GitHub Issue。可选环境信息包括版本、系统、架构、当前模块、时间与随机安装标识；不会自动上传任务、笔记或数据库内容。提交前，检查正文与附件中是否包含私密内容。')+note('手册搜索在本机进行，不向外部服务发送关键词。'),'feedback')
    ]}
  ];
  let manualOpen=false, active='start', query='', anchor='s0', restoreContext=null, returnAvailable=false, observer=null, indexScroll=0;
  const scrolls=new Map();
  const article=()=>articles.find(a=>a.id===active)||articles[0];
  const command=(key,text,extra='')=>`<button type="button" data-manual27="${key}" ${extra}>${text}</button>`;
  const destinations={tasks:'前往任务仓库',today:'查看今日任务',quick:'查看速记',flow:'打开处理流',notes:'打开知识笔记',groups:'前往任务分组',calendar:'打开日历',review:'打开回顾',history:'查看历史处理',widget:'打开今日浮窗','widget-settings':'前往浮窗设置',recovery:'打开最近删除',data:'前往数据设置',appearance:'前往外观设置',advanced:'前往高级功能',update:'查看软件更新',feedback:'返回帮助与反馈'};
  const groups=[...new Set(articles.map(a=>a.group))];
  const plain=value=>value.replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();
  function match(a){const text=[a.title,a.keys,a.lead,...a.sections.map(s=>s.title+' '+plain(s.body))].join(' ').toLowerCase();return query.trim().toLowerCase().split(/\s+/).every(term=>text.includes(term));}
  function highlighted(text){const q=query.trim();if(!q)return esc(text);const terms=q.split(/\s+/).map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));const rx=new RegExp(`(${terms.join('|')})`,'ig');return esc(text).replace(rx,'<mark>$1</mark>');}
  function snippet(a){const text=a.lead+' '+a.sections.map(s=>s.title+' '+plain(s.body)).join(' '),term=query.trim().split(/\s+/)[0],i=text.toLowerCase().indexOf(term.toLowerCase()),start=Math.max(0,i-14);return(start?'…':'')+text.slice(start,start+65)+(start+65<text.length?'…':'');}
  function topics(){if(query.trim()){const found=articles.filter(match);return `<p class="manual27-search-caption" role="status">${found.length} 篇相关说明</p>${found.length?found.map(a=>command('article',`<strong>${highlighted(a.title)}</strong><small>${highlighted(snippet(a))}</small>`,`class="manual27-result" data-id="${a.id}" aria-current="${active===a.id?'page':'false'}"`)).join(''):`<div class="manual27-no-results">没有找到相关说明${command('clear','清除搜索')}</div>`}`;}
    return groups.map(g=>`<section class="manual27-topic-group"><h2>${g}</h2>${articles.filter(a=>a.group===g).map(a=>command('article',esc(a.title),`class="manual27-topic" data-id="${a.id}" aria-current="${active===a.id?'page':'false'}"`)).join('')}</section>`).join('');}
  function toc(){return `<nav class="manual27-toc" aria-label="本页目录"><h2>本页目录</h2>${article().sections.map((s,i)=>command('anchor',esc(s.title),`data-anchor="s${i}" aria-current="${anchor===`s${i}`?'location':'false'}"`)).join('')}</nav>`;}
  function renderManual(){const a=article(),n=articles.indexOf(a);return `<section class="manual27-shell" aria-label="使用手册"><header class="manual27-head">${command('close',`${icon('arrow')}返回帮助与反馈`,'class="manual27-back"')}<span class="manual27-head-divider"></span><strong>使用手册</strong>${command('directory',`${icon('tasks')}本页目录`,'class="button manual27-directory" aria-haspopup="dialog"')}</header><div class="manual27-layout"><aside class="manual27-index" aria-label="手册主题"><label class="manual27-search">${icon('search')}<input type="search" id="manual27-search" placeholder="搜索使用手册" aria-label="搜索使用手册" aria-controls="manual27-topics" value="${esc(query)}" autocomplete="off">${command('clear',icon('close'),`class="icon-button" aria-label="清除搜索" ${query?'':'hidden'}`)}</label><div id="manual27-topics">${topics()}</div></aside><div class="manual27-reader" data-article="${a.id}" role="region" aria-label="${esc(a.title)}"><article class="manual27-article"><h1 tabindex="-1" id="manual27-title">${esc(a.title)}</h1><p class="manual27-lead">${a.lead}</p>${a.sections.map((s,i)=>`<section aria-labelledby="manual27-s${i}"><h2 id="manual27-s${i}" tabindex="-1">${s.title}</h2>${s.body}${s.go?command('go',`${destinations[s.go]}${icon('arrow')}`,`class="manual27-go" data-target="${s.go}"`):''}</section>`).join('')}<footer class="manual27-related">${n>0?command('article',`<small>上一篇</small>${articles[n-1].title}`,`data-id="${articles[n-1].id}"`):'<span></span>'}${n<articles.length-1?command('article',`<small>下一篇</small>${articles[n+1].title}`,`data-id="${articles[n+1].id}"`):command('article','<small>返回开始</small>用 Loop 处理第一件事','data-id="start"')}</footer><p class="manual27-source">说明基于 Loop ${esc(APP_VERSION || "当前版本")} 的功能整理。</p></article></div>${toc()}</div></section>`;}

  function remember() {
    const reader = $('.manual27-reader');
    if (reader) scrolls.set(reader.dataset.article, reader.scrollTop);
    indexScroll = $('.manual27-index')?.scrollTop ?? indexScroll;
  }
  function capture() {
    captureMountedMilkdownDrafts();
    flushNodeNoteDrafts({ persist: true });
  }
  const onManualPage = () => manualOpen && state.settingsOpen && activeSettingsPage === 'help';
  function open(id = active, returning = false) {
    capture();
    if (!returning && !manualOpen) restoreContext = shellCaptureJourneyContext();
    shellCloseOverlay({ restoreFocus: false });
    manualOpen = true;
    active = articles.some(a => a.id === id) ? id : 'start';
    Object.assign(state, { settingsOpen: true, calendarOpen: false, reviewOpen: false, taskMenuOpen: false, contextMenu: null, selectedNodeId: '', globalListReturn: null });
    activeSettingsPage = 'help';
    render();
    $('#manual27-title')?.focus({ preventScroll: true });
  }
  const previousSettings = renderShellSettings;
  renderShellSettings = function () { return onManualPage() ? renderManual() : previousSettings(); };
  function shortcuts() {
    const modifier = desktopPlatform === 'darwin' ? '⌘' : 'Ctrl';
    const values = { search: `${modifier} + K`, save: `${modifier} + S`, 'save-as': `${modifier} + Shift + S`, passthrough: `${modifier} + Shift + T` };
    document.querySelectorAll('[data-manual27-shortcut]').forEach(el => { el.textContent = values[el.dataset.manual27Shortcut]; });
  }
  function bindReader() {
    observer?.disconnect();
    const reader = $('.manual27-reader');
    if (!reader) return;
    reader.scrollTop = scrolls.get(active) || 0;
    const articleId = active;
    reader.addEventListener('scroll', () => scrolls.set(articleId, reader.scrollTop), { passive: true });
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(() => {
        const top = reader.getBoundingClientRect().top;
        const headings = [...reader.querySelectorAll('h2')];
        const current = [...headings].reverse().find(h => h.getBoundingClientRect().top <= top + 90) || headings[0];
        anchor = current?.id.replace('manual27-', '') || 's0';
        document.querySelectorAll('[data-manual27=anchor]').forEach(b => b.setAttribute('aria-current', b.dataset.anchor === anchor ? 'location' : 'false'));
      }, { root: reader, rootMargin: '-10px 0px -65% 0px', threshold: 0 });
      reader.querySelectorAll('h2').forEach(h => observer.observe(h));
    }
    shortcuts();
  }
  const previousRender = render;
  render = function () {
    remember();
    if (!state.settingsOpen || activeSettingsPage !== 'help') manualOpen = false;
    previousRender();
    const showing = onManualPage(), workspace = $('.workspace');
    workspace?.classList.toggle('manual27-workspace', showing);
    if (showing) {
      workspace?.setAttribute('aria-label', '使用手册');
      bindReader();
      const index = $('.manual27-index');
      if (index) index.scrollTop = indexScroll;
      if (!query.trim()) $('[data-manual27=article][aria-current=page]')?.scrollIntoView({ block: 'nearest' });
    } else {
      observer?.disconnect();
      if (returnAvailable) $('.breadcrumb')?.insertAdjacentHTML('afterend', command('return', `${icon('note')}返回手册`, 'class="manual27-return"'));
    }
  };
  function gotoFunction(target) {
    remember();
    capture();
    manualOpen = false;
    returnAvailable = true;
    shellCloseOverlay({ restoreFocus: false });
    Object.assign(state, { taskMenuOpen: false, contextMenu: null, globalListReturn: null, selectedNodeId: '' });
    if (['tasks', 'today', 'quick', 'groups', 'flow', 'notes', 'history'].includes(target)) {
      Object.assign(state, { activeGroupId: ALL_TASKS_GROUP_ID, captureSourceFilter: target === 'quick' ? 'quick' : ['tasks', 'groups'].includes(target) ? 'all' : 'task', priorityFilter: 'all', query: '', taskDateFilter: '', taskDeadlineFilter: 'all', taskPane: target === 'notes' ? 'notes' : target === 'history' ? 'history' : 'flow' });
      applySetting('task-filter', target === 'today' ? 'today' : 'all');
      if (restoreContext?.activeTaskId && filteredTasks().some(t => t.id === restoreContext.activeTaskId)) state.activeTaskId = restoreContext.activeTaskId;
      if (!filteredTasks().some(t => t.id === state.activeTaskId)) state.activeTaskId = filteredTasks()[0]?.id || '';
      render();
      if (target === 'groups') $('[aria-label="整理分组"]')?.focus();
    } else if (target === 'calendar' || target === 'review') {
      Object.assign(state, { settingsOpen: false, calendarOpen: target === 'calendar', reviewOpen: target === 'review' });
      if (target === 'calendar') ensureCalendarState();
      render();
    } else if (target === 'widget') {
      render();
      if (desktopTodayWidget) void desktopTodayWidget.show().catch(error => { console.error('[manual27] widget unavailable', error); shellToast('今日浮窗未能打开，请重试'); });
    } else {
      const pages = { 'widget-settings': 'tasks', feedback: 'help', recovery: 'data', update: 'updates' };
      activeSettingsPage = pages[target] || target;
      Object.assign(state, { settingsOpen: true, calendarOpen: false, reviewOpen: false });
      render();
      if (target === 'recovery') recovery26Open();
    }
  }
  function clearSearch() {
    query = '';
    const input = $('#manual27-search');
    if (input) { input.value = ''; input.focus(); }
    updateSearch();
  }
  function updateSearch() {
    const host = $('#manual27-topics'), clear = $('.manual27-search [data-manual27=clear]');
    if (host) host.innerHTML = topics();
    if (clear) clear.hidden = !query;
  }
  window.addEventListener('click', event => {
    const button = event.target.closest('[data-manual27]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = button.dataset.manual27;
    if (action === 'open') open();
    else if (action === 'return') open(active, true);
    else if (action === 'close') {
      remember(); manualOpen = false; returnAvailable = false;
      shellCloseOverlay({ restoreFocus: false }); render();
      $('[data-manual27=open]')?.focus();
    } else if (action === 'article') {
      remember(); active = articles.some(a => a.id === button.dataset.id) ? button.dataset.id : 'start'; anchor = 's0';
      render(); $('#manual27-title')?.focus({ preventScroll: true });
    } else if (action === 'clear') clearSearch();
    else if (action === 'anchor') {
      shellCloseOverlay({ restoreFocus: false }); anchor = button.dataset.anchor;
      const heading = $(`#manual27-${anchor}`);
      heading?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      heading?.focus({ preventScroll: true });
    } else if (action === 'directory') {
      const surface = shellMountSurface(`<div class="surface-popover manual27-directory-popup" role="dialog" aria-label="本页目录">${shellSurfaceHeader('本页目录')}${toc()}</div>`, button, 252);
      if (surface) surface.dataset.returnFocus = '[data-manual27="directory"]';
    } else if (action === 'go') gotoFunction(button.dataset.target);
  }, true);
  document.addEventListener('input', event => {
    if (event.target.id !== 'manual27-search') return;
    query = event.target.value; updateSearch();
  });
  window.addEventListener('keydown', event => {
    if (!onManualPage() || event.isComposing || event.keyCode === 229) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); event.stopImmediatePropagation(); $('#manual27-search')?.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      // A retained knowledge pane is not the active editor while reading help.
      event.preventDefault(); event.stopImmediatePropagation();
    } else if (event.target.id === 'manual27-search' && event.key === 'Escape' && query) {
      event.preventDefault(); event.stopImmediatePropagation(); clearSearch();
    } else if (event.target.id === 'manual27-search' && event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation(); $('#manual27-topics [data-manual27=article]')?.click();
    } else if (event.key === 'Escape' && !$('#overlay')?.firstElementChild) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  globalThis.LoopManual27 = {
    open,
    entry: () => `<section class="manual27-entry"><div><strong>使用手册</strong><p>从第一件任务，到笔记保存与数据恢复。</p></div>${command('open', '阅读手册', 'class="button"')}</section>`,
  };
})();
