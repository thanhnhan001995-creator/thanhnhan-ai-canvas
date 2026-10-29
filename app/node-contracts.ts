// Mỗi cổng có một đường dẫn kế thừa: Free -> Group -> Type -> Kind.
// `size` mô tả phạm vi cổng chấp nhận trong chính nhánh đó.
export type PortLevel = "free" | "group" | "type" | "kind";
export type PortConnectSize = "all" | "up" | "down" | "exact";
export type PortHierarchy = Partial<Record<PortLevel, string>> & { free: "free" };
export type PortContract = { hierarchy: PortHierarchy; size: PortConnectSize; lowestLevel: PortLevel };
export type PortReference = string | { type: string; connectSize?: PortConnectSize };

const LEVELS: PortLevel[] = ["free", "group", "type", "kind"];
const FREE_TOKENS = new Set(["any", "dữ liệu", "dữ liệu bất kỳ", "nhiều đầu vào", "nhiều dữ liệu", "giá trị", "dữ liệu thực thi", "kết quả node", "trạng thái chạy", "workflow"]);

const CANONICAL_NAMES: Record<string, string> = {
  "content": "text", "văn bản": "text", "script": "text", "kịch bản": "text",
  "approvedsource": "source", "rankedsource": "source", "nguồn": "source",
  "searchresult": "url", "voice": "audio", "audiosample": "audio", "nhạc": "audio",
  "ảnh tham chiếu": "image", "referenceimage": "image", "nền": "image",
  "mẫu ảnh": "image", "ảnh mẫu": "image", "kho ảnh": "image",
  "boolean": "condition",
};

export const SELF_CONFIGURED_NODE_NAMES = new Set([
  "Chọn nhà cung cấp AI", "Chọn giọng", "Tạo nhạc nền", "Chạy thủ công", "Đọc thư viện",
]);

function token(value: string): string { return value.replace(/\[\]$/, "").trim().toLowerCase(); }
function alternatives(value: string): string[] { return token(value).split(/\s+hoặc\s+|\//i).map((item) => item.trim()).filter(Boolean); }
function canonical(value: string): string { const raw = token(value); return CANONICAL_NAMES[raw] ?? raw; }

function hierarchyFor(value: string): PortHierarchy {
  const name = canonical(value);
  if (FREE_TOKENS.has(name)) return { free: "free" };
  if (/^(aianalysis|aitext|aijson|aiscore|aiapprovedresult)$/i.test(name)) return { free: "free", group: "data", type: "ai", kind: name.slice(2) };
  // Cache tư liệu là một gói dữ liệu, nhưng không thể nối nhầm vào cổng media
  // trực tiếp.  Chỉ node chọn model/cache mới đọc được khóa và metadata này.
  if (/^cacheddata$/i.test(name)) return { free: "free", group: "data", type: "cache", kind: "cacheddata" };
  if (/^(prompt|systemprompt|query|brief|request)$/i.test(name)) return { free: "free", group: "request", type: "prompt", kind: name };
  if (/^(apikey|aimodel|aiprovider|config|configuration|profile|brandprofile|videoconfig)$/i.test(name)) return { free: "free", group: "configuration", type: "settings", kind: name };
  if (/^(attentionregion)$/i.test(name)) return { free: "free", group: "configuration", type: "settings", kind: "attentionregion" };
  if (/^(trigger|command|action|condition|branch|runstate)$/i.test(name)) return { free: "free", group: "control", type: name };
  if (/^(imagematch|image-match)$/i.test(name)) return { free: "free", group: "data", type: "image-match" };
  if (/^(video|videoindex|frameindex|storyboard|scene|sceneanalysis|timedtranscript|reviewinterval)$/i.test(name)) {
    const kind = name === "video" ? undefined : name.replace(/^video/, "") || undefined;
    return kind ? { free: "free", group: "data", type: "video", kind } : { free: "free", group: "data", type: "video" };
  }
  // Ba vai trò ảnh của node tìm tương đồng cần hiện khác nhau trên canvas,
  // nhưng vẫn nhận được Image/Image[] thông thường qua connectSize `up`.
  if (/^imagesample$/i.test(name)) return { free: "free", group: "data", type: "image", kind: "image-sample" };
  if (/^imagesearch$/i.test(name)) return { free: "free", group: "data", type: "image", kind: "image-search" };
  if (/^imagesearchlist$/i.test(name)) return { free: "free", group: "data", type: "image", kind: "image-search-list" };
  if (/^searchfolder$/i.test(name)) return { free: "free", group: "data", type: "folder", kind: "search-folder" };
  if (/^(image|thumbnail)$/i.test(name)) return { free: "free", group: "data", type: "image" };
  if (/^(audio|music)$/i.test(name)) return { free: "free", group: "data", type: "audio" };
  if (/^(text|outline|chapter|subtitle|caption)$/i.test(name)) return { free: "free", group: "data", type: "text" };
  if (/^(source|research|fact|transcript)$/i.test(name)) return { free: "free", group: "data", type: "research", kind: name === "research" ? undefined : name };
  if (/^(namedfile|storedfile)$/i.test(name)) return { free: "free", group: "data", type: "file", kind: name };
  if (/^(url|document|file|folder|variable)$/i.test(name)) return { free: "free", group: "data", type: name };
  // Cổng chưa được chia nhỏ hơn giữ đúng mặc định Free.
  return { free: "free" };
}

export function getPortConnectSize(type: string): PortConnectSize {
  // Các cổng tổng quát cố ý nhận toàn bộ cây dữ liệu; các cổng khác mặc định Exact.
  const name = canonical(type);
  // Các vai trò chuyên biệt của node tìm ảnh nhận kiểu cha thông dụng (Image,
  // Image[] hoặc Folder), nhưng không nhận nhầm vai trò chuyên biệt khác.
  if (/^(imagesample|imagesearch|imagesearchlist|searchfolder)$/i.test(name)) return "up";
  return FREE_TOKENS.has(name) ? "all" : "exact";
}

function referenceType(reference: PortReference): string { return typeof reference === "string" ? reference : reference.type; }
function referenceSize(reference: PortReference): PortConnectSize { return typeof reference === "string" ? getPortConnectSize(reference) : reference.connectSize ?? getPortConnectSize(reference.type); }

export function getPortContract(reference: PortReference): PortContract {
  const type = referenceType(reference);
  const hierarchy = hierarchyFor(type);
  const lowestLevel = [...LEVELS].reverse().find((level) => hierarchy[level] !== undefined) ?? "free";
  return { hierarchy, size: referenceSize(reference), lowestLevel };
}

export function portHierarchyLabel(reference: PortReference): string {
  const { hierarchy, size } = getPortContract(reference);
  const chain = LEVELS.filter((level) => hierarchy[level] !== undefined).map((level) => `${level}:${hierarchy[level]}`).join(", ");
  return `[${chain}] · ${size}`;
}

// Tương thích cũ cho các vị trí UI trước đây gọi tên hàm này.
export function portContractLabel(reference: PortReference): string { return portHierarchyLabel(reference); }

function isPrefix(parent: PortHierarchy, child: PortHierarchy): boolean {
  return LEVELS.every((level) => parent[level] === undefined || parent[level] === child[level]);
}

function equalPath(left: PortHierarchy, right: PortHierarchy): boolean {
  return LEVELS.every((level) => left[level] === right[level]);
}

function accepts(receiver: PortContract, other: PortContract): boolean {
  if (receiver.size === "exact") return equalPath(receiver.hierarchy, other.hierarchy);
  if (receiver.size === "up") return isPrefix(other.hierarchy, receiver.hierarchy);
  if (receiver.size === "down") return isPrefix(receiver.hierarchy, other.hierarchy);
  return isPrefix(receiver.hierarchy, other.hierarchy) || isPrefix(other.hierarchy, receiver.hierarchy);
}

export function portTypesCompatible(sourceReference: PortReference, targetReference: PortReference): boolean {
  // Mỗi bên có thể là "A hoặc B"; và một phía mở phạm vi là đủ để tạo line.
  const sourceType = referenceType(sourceReference);
  const targetType = referenceType(targetReference);
  const sourceSize = referenceSize(sourceReference);
  const targetSize = referenceSize(targetReference);
  return alternatives(sourceType).some((source) => alternatives(targetType).some((target) => {
    const left = getPortContract({ type: source, connectSize: sourceSize });
    const right = getPortContract({ type: target, connectSize: targetSize });
    return accepts(left, right) || accepts(right, left);
  }));
}

export { FREE_TOKENS as UNIVERSAL_PORT_TYPES };
