export type CapabilityState = "supported" | "unsupported" | "unknown";

export type AiModelCapabilities = {
  text: CapabilityState;
  image: CapabilityState;
  audioAnalysis: CapabilityState;
  reasoning: CapabilityState;
  message: string;
};

function normalizedModel(model?: string): string {
  return String(model ?? "").trim().toLowerCase();
}

// Các workflow cũ có thể còn giữ model đã bị nhà cung cấp ngừng. Giữ danh
// sách này tại một nơi để UI, lúc nạp workflow và lớp gọi API cùng xử lý như
// nhau, thay vì để lỗi deprecation rơi xuống Output của node.
const RETIRED_OPENAI_MODEL_REPLACEMENTS: Record<string, string> = {
  "gpt-4.1-nano": "gpt-5-nano",
};

export function replacementForRetiredOpenAiModel(model?: string): string | undefined {
  return RETIRED_OPENAI_MODEL_REPLACEMENTS[normalizedModel(model)];
}

export function isRetiredOpenAiModel(model?: string): boolean {
  return Boolean(replacementForRetiredOpenAiModel(model));
}

/**
 * Chỉ chuẩn hóa ID model OpenAI đã biết là ngừng hoạt động. Model lạ vẫn được
 * giữ nguyên để người dùng có thể dùng model mới vừa xuất hiện trên API.
 */
export function currentOpenAiModel(model?: string): string {
  const value = String(model ?? "").trim();
  return replacementForRetiredOpenAiModel(value) ?? value;
}

export function supportsOpenAiReasoning(model?: string): boolean {
  // Theo Responses API, reasoning chỉ thuộc họ GPT-5 và o-series.
  return /^(gpt-5(?:[.-]|$)|o(?:1|3|4)(?:[.-]|$))/.test(normalizedModel(model));
}

/**
 * Họ GPT-4.1 trên endpoint hiện tại chỉ chấp nhận mức verbosity "medium".
 * Giữ điều chỉnh này cùng nơi với capability để request không lệch với model đã chọn.
 */
export function openAiResponseVerbosity(model?: string): "low" | "medium" {
  return /^gpt-4\.1(?:[.-]|$)/.test(normalizedModel(model)) ? "medium" : "low";
}

/**
 * `detail` ảnh độc lập với verbosity phản hồi. Chuẩn hóa nhãn UI tiếng Việt
 * về các giá trị Responses API chấp nhận, nhưng không dùng `medium` cho ảnh.
 */
export function openAiImageDetail(model?: string, requested?: string): "low" | "medium" | "high" | "auto" {
  void model;
  const value = String(requested ?? "").trim().toLowerCase();
  if (["low", "medium", "high", "auto"].includes(value)) return value as "low" | "medium" | "high" | "auto";
  if (["tiết kiệm", "ngắn"].includes(value)) return "low";
  if (["chuyên sâu", "cao"].includes(value)) return "high";
  return "auto";
}

export function openAiImageCapability(model?: string): CapabilityState {
  const value = normalizedModel(model);
  if (!value) return "unknown";
  if (/^(gpt-5(?:[.-]|$)|gpt-4o(?:[.-]|$)|gpt-4\.1(?:[.-]|$)|gpt-4-turbo(?:[.-]|$)|gpt-4-vision(?:[.-]|$)|o(?:1|3|4)(?:[.-]|$))/.test(value)) return "supported";
  if (/^(gpt-3\.5|davinci|babbage|text-|code-|whisper|gpt-transcribe|gpt-4o-transcribe|tts-|gpt-audio|gpt-realtime|gpt-image|dall-e|embedding)/.test(value)) return "unsupported";
  return "unknown";
}

function openAiTextCapability(model?: string): CapabilityState {
  const value = normalizedModel(model);
  if (!value) return "unknown";
  if (/^(whisper|gpt-transcribe|gpt-4o-transcribe|tts-|gpt-audio|gpt-realtime|gpt-image|dall-e|embedding)/.test(value)) return "unsupported";
  return "supported";
}

export function getAiModelCapabilities(provider?: string, model?: string): AiModelCapabilities {
  const selectedProvider = String(provider ?? "").trim();
  const selectedModel = String(model ?? "").trim();
  if (!selectedModel || selectedModel === "Khác — nhập ID model") {
    return { text: "unknown", image: "unknown", audioAnalysis: "unknown", reasoning: "unknown", message: "Chọn hoặc nhập ID model để xem khả năng tương thích." };
  }
  if (selectedProvider !== "OpenAI") {
    return { text: "unknown", image: "unknown", audioAnalysis: "unknown", reasoning: "unknown", message: "Khả năng chưa xác minh tự động. Bộ thực thi trực tiếp hiện chỉ hỗ trợ OpenAI." };
  }
  const text = openAiTextCapability(selectedModel);
  const image = openAiImageCapability(selectedModel);
  return {
    text,
    image,
    // App phiên âm bằng model chuyên biệt rồi gửi transcript, nên đây là khả năng
    // của workflow; không đồng nghĩa model đang nhận trực tiếp file âm thanh.
    audioAnalysis: text === "supported" ? "supported" : text,
    reasoning: supportsOpenAiReasoning(selectedModel) ? "supported" : "unsupported",
    message: "Khả năng được suy ra từ ID model. Danh sách model của API không cung cấp đầy đủ metadata tính năng; trạng thái “Chưa xác minh” cần chạy thử node để xác nhận.",
  };
}
