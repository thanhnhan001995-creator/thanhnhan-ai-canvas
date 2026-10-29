import { getPortContract, portHierarchyLabel } from "./node-contracts.ts";

// Thư viện hiển thị cổng dùng chung cho canvas, inspector, lọc node và dây nối.
// `type` nội bộ được giữ nguyên để tương thích workflow cũ; chỉ nhãn hiển thị được chuẩn hóa.
export type PortShape = "circle" | "triangle" | "triangle-down" | "square" | "diamond" | "pentagon" | "pentagon-down" | "hexagon";

export type PortVisual = { label: string; shape: PortShape; color: string };

type PortGroup = { label: string; shape: PortShape; pattern: RegExp };

export const PORT_GROUP_LEGEND: PortVisual[] = [
  { label: "Free", shape: "circle", color: "#94a3b8" },
  { label: "Group", shape: "diamond", color: "#38bdf8" },
  { label: "Type", shape: "triangle", color: "#a78bfa" },
  { label: "Kind", shape: "square", color: "#f472b6" },
];

const PORT_GROUPS: PortGroup[] = [
  { label: "Request", shape: "triangle", pattern: /prompt|query|brief|request|yêu cầu|từ khóa|truy vấn/i },
  { label: "Control", shape: "triangle-down", pattern: /trigger|workflow|branch|condition|command|action|lệnh|nhánh/i },
  { label: "Configuration", shape: "square", pattern: /model|provider|profile|brand|config|setting|api.?key|secret|token|cấu hình|người dùng/i },
  { label: "Research", shape: "diamond", pattern: /source|research|fact|search|transcript|nguồn|dữ kiện/i },
  { label: "Review", shape: "pentagon", pattern: /score|review|approval|policy|quality|rank|đánh giá|duyệt/i },
  { label: "Operation", shape: "pentagon-down", pattern: /timeline|scene|render|export|publish|upload|job|log|cost|cache|cleanup|result|report|trạng thái|lỗi|chạy/i },
  { label: "Content", shape: "circle", pattern: /text|content|script|outline|chapter|image|ảnh|thumbnail|video|audio|voice|narration|âm thanh|nhạc|file|asset|document|tài liệu|data|dữ liệu/i },
  { label: "System", shape: "hexagon", pattern: /.*/i },
];

const PORT_TYPE_COLORS = [
  "#38bdf8", "#f472b6", "#34d399", "#facc15", "#a78bfa", "#fb923c", "#2dd4bf", "#fb7185",
  "#60a5fa", "#c084fc", "#a3e635", "#f59e0b", "#22d3ee", "#e879f9", "#4ade80", "#f87171",
  "#818cf8", "#fbbf24", "#14b8a6", "#eab308", "#67e8f9", "#d946ef", "#84cc16", "#fb7185",
];

// Hình cho biết level sâu nhất; màu nhận diện nhánh dữ liệu cụ thể. Vì vậy các
// cổng cùng Group vẫn có thể cùng hình nhưng không bị lẫn màu (Video, Image,
// Audio, Document, File… là các Type khác nhau trong Group data).
const HIERARCHY_COLORS: Record<string, string> = {
  "free": "#94a3b8",
  "data/ai": "#f472b6",
  "data/audio": "#fbbf24",
  "data/document": "#a78bfa",
  "data/file": "#22d3ee",
  "data/folder": "#fb7185",
  "data/image": "#a3e635",
  "data/research": "#14b8a6",
  "data/text": "#60a5fa",
  "data/url": "#34d399",
  "data/variable": "#fb923c",
  "data/video": "#f97316",
  "request/prompt": "#e879f9",
  "configuration/settings": "#38bdf8",
  "control/trigger": "#818cf8",
  "control/command": "#c084fc",
  "control/action": "#f59e0b",
  "control/condition": "#2dd4bf",
  "control/branch": "#f87171",
};

function hashColor(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return PORT_TYPE_COLORS[(hash >>> 0) % PORT_TYPE_COLORS.length];
}

function colorForContract(type: string): string {
  const hierarchy = getPortContract(type).hierarchy;
  const path = [hierarchy.group, hierarchy.type].filter(Boolean).join("/");
  const kind = hierarchy.kind;
  // Kind được tách màu tiếp khỏi Type cha, nhưng Type phổ biến vẫn giữ màu
  // ổn định và dễ học khi không có Kind.
  if (kind) return hashColor([path, kind].filter(Boolean).join("/"));
  return HIERARCHY_COLORS[path] ?? hashColor(path || hierarchy.free);
}

const ENGLISH_PORT_LABELS: Record<string, string> = {
  "ảnh tham chiếu": "ReferenceImage",
  "aianalysis": "Kết quả phân tích AI",
  "cấu hình lịch": "ScheduleConfig",
  "cho chạy hoặc dừng": "RunState",
  "danh sách": "List",
  "dữ liệu": "Data",
  "dữ liệu ban đầu": "InitialData",
  "dữ liệu bất kỳ": "AnyData",
  "dữ liệu cũ": "PreviousData",
  "dữ liệu đã ghép": "MergedData",
  "dữ liệu đã gộp": "CombinedData",
  "dữ liệu giữ nguyên": "OriginalData",
  "dữ liệu hoặc file": "DataOrFile",
  "dữ liệu mới": "NewData",
  "dữ liệu thực thi": "ExecutionData",
  "dữ liệu tùy chỉnh": "CustomData",
  "file âm thanh": "AudioFile",
  "file ảnh": "ImageFile",
  "file tạm": "TemporaryFile",
  "giá trị": "Value",
  "kết quả hoặc lỗi": "ResultOrError",
  "kết quả job": "JobResult",
  "kết quả node": "NodeResult",
  "kết quả workflow con": "SubworkflowResult",
  "kết quả xử lý": "ProcessingResult",
  "một phần tử": "Item",
  "một trong nhiều nhánh": "BranchResult",
  "người dùng cấu hình": "UserConfiguration",
  "người dùng nhập": "UserInput",
  "nguồn": "Source",
  "nhạc": "Music",
  "nhánh đúng/sai": "BooleanBranch",
  "nhiều đầu vào": "MultipleInputs",
  "nhiều dữ liệu": "MultipleData",
  "nhiều tiến trình": "MultipleProcesses",
  "thư viện": "Library",
  "trạng thái chờ": "WaitingStatus",
  "truy vấn": "Query",
  "từng scene": "SceneItem",
  "văn bản": "Text",
  "yêu cầu âm nhạc": "MusicRequest",
  "yêu cầu giọng": "VoiceRequest",
};

const EXPLICIT_PORT_LABELS: Record<string, string> = {
  imagesample: "image-sample",
  imagesearch: "image-search",
  imagesearchlist: "image-search-list",
  searchfolder: "search-folder",
};

export function displayPortLabel(type: string): string {
  return type.split(/\s+hoặc\s+/i).map((part) => {
    const listSuffix = part.endsWith("[]") ? "[]" : "";
    const explicit = EXPLICIT_PORT_LABELS[part.slice(0, listSuffix ? -2 : undefined).trim().toLowerCase()];
    if (explicit) return explicit + listSuffix;
    const contract = getPortContract(listSuffix ? part.slice(0, -2) : part);
    // Tên nhìn thấy trên node luôn là tên ở level thấp nhất được khai báo.
    // Ví dụ AIText -> kind:text -> "text", không lộ tên kiểu kỹ thuật cũ.
    const name = contract.hierarchy[contract.lowestLevel] ?? "free";
    return name + listSuffix;
  }).join(" or ");
}

export function getPortVisual(type: string): PortVisual {
  const contract = getPortContract(type);
  const level = `${contract.lowestLevel[0].toUpperCase()}${contract.lowestLevel.slice(1)}`;
  const visual = PORT_GROUP_LEGEND.find((item) => item.label === level) ?? PORT_GROUP_LEGEND[0];
  return { ...visual, color: colorForContract(type), label: portHierarchyLabel(type) };
}
