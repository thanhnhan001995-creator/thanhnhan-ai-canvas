/**
 * Finds recursive references in a workflow-call graph. The caller supplies
 * document/call accessors so this stays usable for both saved .tess files and
 * unsaved tabs that only exist in memory.
 */
export async function findWorkflowReferenceCycles(root, {
  getKey,
  getLabel,
  getCalls,
  resolveTarget,
}) {
  const cycles = [];

  async function walk(owner, stack, originCall = null) {
    for (const call of getCalls(owner)) {
      const target = await resolveTarget(call, owner);
      if (!target) continue;
      const repeatedAt = stack.findIndex((item) => getKey(item) === getKey(target));
      if (repeatedAt >= 0) {
        cycles.push({
          originCall: originCall ?? call,
          chain: [...stack.slice(repeatedAt), target].map(getLabel),
        });
        continue;
      }
      await walk(target, [...stack, target], originCall ?? call);
    }
  }

  await walk(root, [root]);
  return cycles;
}
