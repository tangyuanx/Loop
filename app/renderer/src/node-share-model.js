(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LoopNodeShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ordered = nodes => [...(nodes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  function indexNodes(nodes) {
    const index = new Map();
    function visit(items) { for (const node of ordered(items)) { index.set(node.id, node); visit(node.children); } }
    visit(nodes);
    return index;
  }
  function depth(value) { return value === 'all' || value === undefined ? Infinity : Math.max(0, Math.floor(Number(value) || 0)); }
  function linkTargets(nodes, sourceId) {
    const index = indexNodes(nodes), reverse = new Map(), seen = new Set(), queue = [sourceId];
    if (!index.has(sourceId)) return new Set();
    for (const node of index.values()) for (const id of [...(node.children || []).map(child => child.id), ...(node.downstreamNodeIds || [])]) {
      if (!reverse.has(id)) reverse.set(id, []);
      reverse.get(id).push(node.id);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(reverse.get(id) || []));
    }
    return new Set([...index.keys()].filter(id => !seen.has(id)));
  }
  function canLink(nodes, sourceId, targetId) { return linkTargets(nodes, sourceId).has(targetId); }
  // Expansion is independent of collapse/status/filter state. Track the best
  // remaining budgets, since a node can be reached along several paths.
  function select(nodes, nodeId, options = {}) {
    const index = indexNodes(nodes), selected = new Set(), budgets = new Map();
    const childDepth = depth(options.childDepth), downstreamDepth = depth(options.downstreamDepth);
    const queue = [{ id: nodeId, children: childDepth, links: downstreamDepth }];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i], node = index.get(item.id);
      if (!node) continue;
      const previous = budgets.get(item.id) || [];
      if (previous.some(b => b.children >= item.children && b.links >= item.links)) continue;
      budgets.set(item.id, [...previous, item]); selected.add(item.id);
      if (item.children > 0) for (const child of ordered(node.children)) queue.push({ id: child.id, children: item.children - 1, links: item.links });
      if (item.links > 0) for (const id of node.downstreamNodeIds || []) queue.push({ id, children: childDepth, links: item.links - 1 });
    }
    function prune(items) {
      return ordered(items).flatMap(node => {
        const children = prune(node.children);
        return selected.has(node.id) ? [{ ...node, children }] : children;
      });
    }
    return { nodes: prune(nodes), ids: [...selected], count: selected.size };
  }
  return { indexNodes, canLink, linkTargets, select };
});
