/** Định danh workflow không chỉ dùng workflowId: Save As/copy file có thể giữ
 * lại ID cũ. Đường dẫn chuẩn hóa là phần bắt buộc để không báo nhầm A → B là
 * A → A khi A và B là hai file khác nhau. */
export function workflowReferenceKey({ workflowId, path }) {
  const id = typeof workflowId === "string" && workflowId.trim() ? workflowId.trim() : "unknown-workflow";
  const location = typeof path === "string" && path.trim()
    ? path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase()
    : "unsaved";
  return `${id}::${location}`;
}

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

  async function walk(owner, stack) {
    for (const call of getCalls(owner)) {
      const target = await resolveTarget(call, owner);
      if (!target) continue;
      const repeatedAt = stack.findIndex((item) => getKey(item) === getKey(target));
      if (repeatedAt >= 0) {
        cycles.push({
          // Đây là đúng node tạo cạnh khép vòng, không phải node gọi đầu tiên
          // của cả chuỗi. UI vì vậy chọn đúng node người dùng cần sửa.
          originCall: call,
          chain: [...stack.slice(repeatedAt), target].map(getLabel),
        });
        continue;
      }
      await walk(target, [...stack, target]);
    }
  }

  await walk(root, [root]);
  return cycles;
}
