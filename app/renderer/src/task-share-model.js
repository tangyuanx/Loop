(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./node-share-model.js'));
  } else {
    root.LoopTaskShare = factory(root.LoopNodeShare);
  }
})(typeof globalThis === 'object' ? globalThis : this, function (nodeShare) {
  const presets = new Set(['full', 'brief', 'flow', 'node', 'notes', 'custom']);
  const standardNodeStates = new Set(['todo', 'done', 'review']);
  const priorities = new Set(['low', 'medium', 'high']);
  const list = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value : '';
  const enabled = (value, fallback) => typeof value === 'boolean' ? value : fallback;
  const ordered = nodes => [...list(nodes)].sort((a, b) => (a.order || 0) - (b.order || 0));

  function candidates(task, documents, tabIds) {
    if (!task?.id) return [];
    const linked = new Set(list(task.knowledgeLinks));
    const open = new Set(list(tabIds));
    const byId = new Map([[task.id, task]]);
    for (const document of list(documents)) {
      if (document?.id && !byId.has(document.id)) byId.set(document.id, document);
    }
    const orderedIds = new Set([...open, task.id, ...linked, ...byId.keys()]);
    const rows = [];
    for (const id of orderedIds) {
      const document = byId.get(id);
      const metadata = document?.knowledgeNote;
      if (!document || metadata?.isDeleted) continue;
      const main = id === task.id;
      let relation;
      if (main) relation = 'main';
      else if (document.creatorTaskId === task.id) relation = 'owned';
      else if (linked.has(id)) relation = 'linked';
      else if (open.has(id)) relation = 'open';
      else continue;
      const content = text(document.notes ?? document.content);
      const hasContent = Boolean(content.trim() || text(metadata?.filePath).trim());
      rows.push({
        id,
        noteId: text(metadata?.noteId) || text(document.noteId) || id,
        title: text(metadata?.title) || text(document.title) || '未命名笔记',
        content,
        main,
        relation,
        defaultSelected: relation !== 'open' && hasContent,
        documentState: text(metadata?.documentState),
      });
    }
    return rows;
  }

  function nodeDefinitions(items) {
    const definitions = new Map();
    for (const item of list(items)) {
      if (!item?.id || standardNodeStates.has(item.id) || !text(item.name).trim() || definitions.has(item.id)) continue;
      definitions.set(item.id, { id: item.id, name: item.name, color: text(item.color) });
    }
    return definitions;
  }

  function projectTree(nodes, records, definitions, preserveProjectionOrder) {
    const selected = nodeShare.indexNodes(nodes);
    const usedStates = new Set();
    function projectNodes(items) {
      const siblings = preserveProjectionOrder ? list(items) : ordered(items);
      return siblings.map(node => {
        let status = node.status;
        if (definitions.has(status)) usedStates.add(status);
        else if (!standardNodeStates.has(status)) status = 'todo';
        const downstreamNodeIds = [...new Set(list(node.downstreamNodeIds))]
          .filter(id => id !== node.id && selected.has(id));
        return {
          id: node.id,
          title: text(node.title),
          status,
          hypothesis: text(node.hypothesis),
          conclusion: text(node.conclusion),
          ...(records ? { note: text(node.note) } : {}),
          updatedAt: text(node.updatedAt),
          children: projectNodes(node.children),
          downstreamNodeIds,
        };
      });
    }
    const tree = projectNodes(nodes);
    return { nodes: tree, nodeStates: [...usedStates].map(status => definitions.get(status)) };
  }

  function project(snapshot, selection = {}) {
    const task = snapshot?.task;
    if (!task?.id) throw new TypeError('分享的任务不存在');
    let scope = selection.preset;
    if (scope === 'task') scope = 'full';
    if (scope === 'note') scope = 'notes';
    if (!presets.has(scope)) scope = 'full';

    const full = scope === 'full';
    const brief = enabled(selection.brief, full || scope === 'brief');
    const flow = enabled(selection.flow, full || scope === 'flow' || scope === 'node');
    const records = flow && enabled(selection.records, full);
    const allNodes = list(task.nodes);
    const source = selection.nodeId ? nodeShare.indexNodes(allNodes).get(selection.nodeId) : null;
    let selectedNodes = [];
    if (flow && selection.nodeId) {
      selectedNodes = nodeShare.select(allNodes, selection.nodeId, {
        childDepth: selection.childDepth ?? 'all',
        downstreamDepth: selection.downstreamDepth ?? 0,
      }).nodes;
    } else if (flow && scope !== 'node') selectedNodes = allNodes;
    const { nodes, nodeStates } = projectTree(selectedNodes, records, nodeDefinitions(snapshot.nodeStates), Boolean(selection.nodeId));

    const available = candidates(task, snapshot.documents, snapshot.tabIds);
    const noteId = selection.noteId ?? snapshot.noteId;
    let notes;
    if (Array.isArray(selection.noteIds)) {
      const wanted = new Set(selection.noteIds);
      notes = available.filter(note => wanted.has(note.id));
    } else if (full) notes = available.filter(note => note.defaultSelected);
    else if (scope === 'notes' && noteId) notes = available.filter(note => note.id === noteId);
    else notes = [];
    const label = text(selection.title).trim();
    const taskTitle = text(task.title).trim() || '未命名任务';
    let fallbackTitle;
    if (full || brief || scope === 'brief') fallbackTitle = taskTitle;
    else if (flow && source) fallbackTitle = text(source.title).trim() || '未命名节点';
    else if (notes.length) fallbackTitle = notes[0].title;
    else fallbackTitle = flow ? '处理流' : '分享任务';

    return {
      scope,
      records,
      task: {
        title: label || fallbackTitle,
        status: task.status === 'done' ? 'done' : 'active',
        ...(enabled(selection.priority, full) && priorities.has(task.priority) ? { priority: task.priority } : {}),
        ...(enabled(selection.deadline, full) && text(task.deadlineAt) ? { deadlineAt: task.deadlineAt } : {}),
        ...(brief ? { description: text(task.description), hypothesis: text(task.hypothesis), conclusion: text(task.conclusion) } : {}),
        nodes,
      },
      notes: notes.map(({ id, noteId, title, content, main }) => ({ id, noteId, title, content, main })),
      nodeStates,
    };
  }

  return { candidates, project };
});
