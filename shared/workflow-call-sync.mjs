import { normalizeWorkflowInterface, workflowInterfaceFingerprint } from "./tess-document.mjs";

function portContract(port) {
  return JSON.stringify({
    type: port.type,
    artifactType: port.artifactType ?? "",
    cardinality: port.cardinality ?? "",
  });
}

function portChanges(before, after, direction) {
  const previous = new Map(before[direction].map((port) => [port.id, port]));
  const current = new Map(after[direction].map((port) => [port.id, port]));
  const changes = [];
  for (const [id, port] of previous) {
    const replacement = current.get(id);
    if (!replacement) {
      changes.push({ direction, kind: "removed", id, before: port, after: null, reconnectRequired: true });
      continue;
    }
    if (portContract(port) !== portContract(replacement)) {
      changes.push({ direction, kind: "contract-changed", id, before: port, after: replacement, reconnectRequired: true });
      continue;
    }
    if (port.name !== replacement.name || port.required !== replacement.required || port.description !== replacement.description) {
      changes.push({ direction, kind: "metadata-changed", id, before: port, after: replacement, reconnectRequired: false });
    }
  }
  for (const [id, port] of current) {
    if (!previous.has(id)) changes.push({ direction, kind: "added", id, before: null, after: port, reconnectRequired: false });
  }
  return changes;
}

function directionLabel(direction) {
  return direction === "inputs" ? "đầu vào" : "đầu ra";
}

function changeLabel(change) {
  const port = change.after ?? change.before;
  if (change.kind === "added") return `thêm cổng ${directionLabel(change.direction)} “${port.name}”`;
  if (change.kind === "removed") return `xóa cổng ${directionLabel(change.direction)} “${port.name}”`;
  if (change.kind === "contract-changed") return `đổi hợp đồng cổng ${directionLabel(change.direction)} “${port.name}”`;
  return `cập nhật thông tin cổng ${directionLabel(change.direction)} “${port.name}”`;
}

/**
 * Tạo kế hoạch đồng bộ caller mà không tự thay đổi line. Port ID ổn định là
 * khóa duy nhất để giữ line cũ; mọi thay đổi hợp đồng phải để người dùng nối
 * lại chủ động.
 */
export function planWorkflowCallInterfaceSync(previousValue, nextValue) {
  const previous = normalizeWorkflowInterface(previousValue);
  const next = normalizeWorkflowInterface(nextValue);
  const changes = [...portChanges(previous, next, "inputs"), ...portChanges(previous, next, "outputs")];
  return {
    previous,
    next,
    changed: workflowInterfaceFingerprint(previous) !== workflowInterfaceFingerprint(next),
    changes,
    summary: changes.length ? changes.map(changeLabel).join("; ") : "Không có thay đổi interface.",
  };
}

function portIdFromHandle(handle) {
  return typeof handle === "string" && handle.startsWith("workflow-port-")
    ? handle.slice("workflow-port-".length)
    : "";
}

/**
 * Đánh dấu line cũ chịu tác động, nhưng không xóa hoặc đổi nó. React Flow sẽ
 * giữ lại line; Properties trình bày line nào người dùng cần chủ động kiểm tra.
 */
export function reconnectIssuesForWorkflowCall({ edges, nodeId, plan }) {
  const reconnectChanges = new Map(
    plan.changes
      .filter((change) => change.reconnectRequired)
      .map((change) => [`${change.direction}:${change.id}`, change]),
  );
  const issues = [];
  for (const edge of edges ?? []) {
    const direction = edge?.target === nodeId ? "inputs" : edge?.source === nodeId ? "outputs" : null;
    if (!direction) continue;
    const portId = portIdFromHandle(direction === "inputs" ? edge.targetHandle : edge.sourceHandle);
    const change = reconnectChanges.get(`${direction}:${portId}`);
    if (!change) continue;
    const port = change.after ?? change.before;
    issues.push({
      edgeId: String(edge.id ?? ""),
      portId,
      direction,
      reason: change.kind === "removed"
        ? `Cổng ${directionLabel(direction)} “${port.name}” đã bị xóa.`
        : `Hợp đồng cổng ${directionLabel(direction)} “${port.name}” đã thay đổi.`,
    });
  }
  return issues;
}

export function workflowCallSyncState(plan, reconnectIssues = []) {
  if (reconnectIssues.length) return "needs-reconnect";
  return plan.changed ? "synced" : "synced";
}
