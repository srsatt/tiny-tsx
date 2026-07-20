export function validateTasks(tasks) {
  const byId = new Map();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    if (!Array.isArray(task.commands) || task.commands.length === 0) {
      throw new Error(`task ${task.id} must declare at least one command`);
    }
    byId.set(task.id, task);
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies ?? []) {
      if (!byId.has(dependency)) throw new Error(`task ${task.id} depends on unknown task: ${dependency}`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error(`dependency cycle includes task: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
  return byId;
}

export function selectTaskIds(tasks, roots) {
  const byId = validateTasks(tasks);
  const selected = new Set();
  const select = id => {
    const task = byId.get(id);
    if (task === undefined) throw new Error(`unknown selected task: ${id}`);
    if (selected.has(id)) return;
    for (const dependency of task.dependencies ?? []) select(dependency);
    selected.add(id);
  };
  for (const root of roots) select(root);
  return selected;
}

export function pickRunnableTasks(
  tasks,
  pending,
  completed,
  activeResources,
  capacity,
) {
  const selected = [];
  const reserved = new Set(activeResources);
  for (const task of tasks) {
    if (selected.length >= capacity || !pending.has(task.id)) continue;
    if (!(task.dependencies ?? []).every(dependency => completed.has(dependency))) continue;
    if (task.exclusive && reserved.has("runner:active")) continue;
    if (!task.exclusive && reserved.has("runner:exclusive")) continue;
    const resources = task.resources ?? [];
    if (resources.some(resource => reserved.has(resource))) continue;
    selected.push(task);
    reserved.add("runner:active");
    if (task.exclusive) reserved.add("runner:exclusive");
    for (const resource of resources) reserved.add(resource);
  }
  return selected;
}
