export type NodeIdentityLike = {
  data: {
    family?: unknown;
    label?: unknown;
  };
};

/** Họ là định danh bất biến của node; tên có thể do người dùng sửa. */
export function nodeFamilyOf(node: NodeIdentityLike, fallback = "Node"): string {
  const family = String(node.data.family ?? "").trim();
  if (family) return family;
  const legacyLabel = String(node.data.label ?? "").trim();
  return legacyLabel || fallback;
}

/** Tên ban đầu luôn là Họ + số node hiện có cùng Họ, kể cả khi node trước đã đổi tên. */
export function nextNodeName(family: string, currentNodes: readonly NodeIdentityLike[]): string {
  const normalizedFamily = String(family ?? "").trim() || "Node";
  const sameFamilyCount = currentNodes.filter((node) => nodeFamilyOf(node) === normalizedFamily).length;
  return `${normalizedFamily} ${sameFamilyCount + 1}`;
}
