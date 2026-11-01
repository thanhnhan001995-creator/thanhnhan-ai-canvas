/**
 * Danh mục chuyển đổi AI v1.
 *
 * Danh mục này là cầu nối giữa thư viện node hiện hữu và bộ node AI tổng quát
 * của Tesseract. Nó không xóa hoặc đổi wire của workflow cũ; mỗi thay đổi
 * runtime phải đi qua adapter tương thích tương ứng.
 */
export const AI_NODE_AUDIT_V1 = Object.freeze([
  {
    family: "Chọn nhà cung cấp AI",
    inputs: ["APIKey"],
    outputs: ["AIProvider"],
    purpose: "Chọn provider, endpoint local/API và tham chiếu bí mật.",
    decision: "keep",
    target: "Cấu hình AI",
  },
  {
    family: "Chọn mô hình AI",
    inputs: ["AIProvider"],
    outputs: ["AIModel"],
    purpose: "Hoàn thiện AIExecutionProfile với model và giới hạn token.",
    decision: "keep",
    target: "Cấu hình AI",
  },
  {
    family: "Lựa chọn model AI",
    inputs: ["AIProvider", "CachedData", "Dữ liệu"],
    outputs: ["AIModel", "CachedData"],
    purpose: "Cho AI đề xuất model theo tư liệu và ưu tiên.",
    decision: "compatibility-only",
    target: "Trợ lý chọn profile (không là node AI lõi)",
  },
  {
    family: "Soạn system prompt",
    inputs: ["Văn bản"],
    outputs: ["SystemPrompt"],
    purpose: "Tạo vai trò, quy tắc và định dạng phản hồi.",
    decision: "migrate",
    target: "Tạo prompt — chế độ System",
  },
  {
    family: "Tạo prompt từ dữ liệu",
    inputs: ["Dữ liệu"],
    outputs: ["Prompt"],
    purpose: "Ghép dữ liệu workflow vào mẫu chỉ dẫn.",
    decision: "migrate",
    target: "Tạo prompt — chế độ Dữ liệu",
  },
  {
    family: "Gọi AI tạo văn bản",
    inputs: ["Prompt", "AIModel", "SystemPrompt", "CachedData"],
    outputs: ["AIText", "CachedData"],
    purpose: "Gọi model cho văn bản tự do.",
    decision: "migrate",
    target: "Thực thi tác vụ AI — output Text",
  },
  {
    family: "Gọi AI trả JSON",
    inputs: ["Prompt", "AIModel", "SystemPrompt", "CachedData"],
    outputs: ["AIJson", "CachedData"],
    purpose: "Gọi model với ràng buộc JSON.",
    decision: "migrate",
    target: "Thực thi tác vụ AI — output JSON",
  },
  {
    family: "Phân tích hình ảnh bằng AI",
    inputs: ["Image[]", "Prompt", "AttentionRegion", "AIModel", "CachedData"],
    outputs: ["AIAnalysis", "CachedData"],
    purpose: "Gửi ảnh trực tiếp để nhận phân tích đa phương thức.",
    decision: "move-to-media",
    target: "Media — phân tích ảnh bằng AI",
  },
  {
    family: "Phân tích âm thanh bằng AI",
    inputs: ["Audio", "Prompt", "AIModel", "CachedData"],
    outputs: ["AIAnalysis", "CachedData"],
    purpose: "Phiên âm rồi phân tích âm thanh.",
    decision: "move-to-media",
    target: "Media — phân tích âm thanh bằng AI",
  },
  {
    family: "Phân tích video bằng AI",
    inputs: ["Image[]", "FrameIndex", "Audio", "TimedTranscript", "Prompt", "AIModel", "CachedData"],
    outputs: ["AIAnalysis", "CachedData"],
    purpose: "Đối chiếu frame, timeline và âm thanh/transcript.",
    decision: "move-to-media",
    target: "Media — phân tích video bằng AI",
  },
  {
    family: "Chấm điểm đầu ra AI",
    inputs: ["AIText hoặc AIJson hoặc AIAnalysis"],
    outputs: ["AIScore"],
    purpose: "Chấm heuristic cục bộ theo độ dài và cấu trúc.",
    decision: "compatibility-only",
    target: "Kiểm tra không AI — đánh giá cơ bản",
  },
  {
    family: "Duyệt đầu ra AI",
    inputs: ["AIText hoặc AIJson hoặc AIAnalysis", "AIScore"],
    outputs: ["AIApprovedResult"],
    purpose: "Quyết định duyệt theo ngưỡng hoặc thủ công.",
    decision: "compatibility-only",
    target: "Kiểm tra không AI — duyệt theo quy tắc",
  },
]);

export const AI_NODE_AUDIT_DECISIONS = Object.freeze({
  keep: "Giữ là một phần cấu hình AI chung.",
  migrate: "Giữ executor và workflow cũ; node mới thay thế là giao diện chuẩn.",
  "move-to-media": "Giữ executor; chuyển điểm truy cập mới sang nhóm Media ở AIC-04.",
  "compatibility-only": "Không thêm vào thư viện AI lõi mới; workflow cũ vẫn chạy qua adapter.",
});

export const AI_CORE_V1 = Object.freeze([
  "Cấu hình AI",
  "Tạo prompt",
  "Thực thi tác vụ AI",
  "Kiểm tra bằng AI",
]);
