type JsonRecord = Record<string, unknown>;
import { supportsOpenAiReasoning } from "./app/ai-model-capabilities";

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_TRANSCRIBE_MODEL = "gpt-transcribe";
const DEFAULT_DIARIZE_MODEL = "gpt-4o-transcribe-diarize";
const MAX_WEB_CHARS = 60_000;

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Lỗi nghiên cứu không xác định";
  return Response.json({ error: message }, { status });
}

async function listProviderModels(provider: string, localEndpoint?: string, suppliedApiKey?: string): Promise<string[]> {
  if (provider === "OpenAI") {
    const key = suppliedApiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Chưa có API key. Nhập trực tiếp trong Thiết lập AI, nối cổng APIKey, hoặc đặt OPENAI_API_KEY trong file .env.");
    const response = await fetch(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${key}` } });
    const body = await response.json() as { data?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || "Không thể lấy model OpenAI");
    return (body.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)).sort();
  }
  if (provider === "Gemini") {
    const key = suppliedApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Chưa có API key. Nhập trực tiếp trong Thiết lập AI, nối cổng APIKey, hoặc đặt GEMINI_API_KEY trong file .env.");
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/models", { headers: { authorization: `Bearer ${key}` } });
    const body = await response.json() as { data?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || "Không thể lấy model Gemini");
    return (body.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)).sort();
  }
  if (provider === "Ollama") {
    const response = await fetch(`${(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/api/tags`);
    const body = await response.json() as { models?: Array<{ name?: string }> };
    if (!response.ok) throw new Error("Không thể kết nối Ollama local");
    return (body.models ?? []).map((item) => item.name).filter((name): name is string => Boolean(name)).sort();
  }
  if (provider === "AI local") {
    const endpoint = (localEndpoint || process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:1234/v1").replace(/\/$/, "");
    const response = await fetch(`${endpoint}/models`);
    const body = await response.json() as { data?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || "Không thể kết nối API AI local. Hãy kiểm tra địa chỉ API và chắc rằng server đang chạy.");
    return (body.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)).sort();
  }
  const models = String(process.env.ANTHROPIC_MODELS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!models.length) throw new Error("Claude không có API liệt kê model. Hãy đặt ANTHROPIC_MODELS=id1,id2 trong file .env để cập nhật danh sách.");
  return models;
}

function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—",
  };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => entities[name.toLowerCase()] ?? entity);
}

function stripHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function textFromMeta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
}

function safePublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`URL không được hỗ trợ: ${raw}`);
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" || hostname.endsWith(".local") || hostname === "0.0.0.0" ||
    /^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname === "::1"
  ) throw new Error(`Không cho phép truy cập địa chỉ nội bộ: ${hostname}`);
  return url;
}

async function searchWikipedia(query: string, limit: number) {
  const endpoint = new URL("https://vi.wikipedia.org/w/api.php");
  endpoint.searchParams.set("action", "opensearch");
  endpoint.searchParams.set("search", query);
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("namespace", "0");
  endpoint.searchParams.set("format", "json");
  const response = await fetch(endpoint, {
    headers: { accept: "application/json", "user-agent": "ContentFlow/1.0 (local research workflow)" },
  });
  if (!response.ok) throw new Error(`Wikipedia trả về lỗi ${response.status}`);
  const data = await response.json() as [string, string[], string[], string[]];
  return data[1].map((title, index) => ({
    title,
    url: data[3][index],
    snippet: data[2][index] || "Bài viết Wikipedia",
    domain: "vi.wikipedia.org",
    provider: "Wikipedia",
  }));
}

async function searchDuckDuckGo(query: string, limit: number) {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 ContentFlow/1.0", accept: "text/html" },
  });
  if (!response.ok) throw new Error(`DuckDuckGo trả về lỗi ${response.status}`);
  const html = await response.text();
  const blocks = html.match(/<div[^>]+class="[^"]*result[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];
  const results: JsonRecord[] = [];
  for (const block of blocks) {
    const anchor = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    let href = decodeHtml(anchor[1]);
    try {
      const redirect = new URL(href, "https://duckduckgo.com");
      href = redirect.searchParams.get("uddg") || redirect.href;
    } catch { /* bỏ qua URL chuyển hướng lỗi */ }
    if (!/^https?:\/\//i.test(href)) continue;
    const parsedHref = new URL(href);
    if (parsedHref.hostname.endsWith("duckduckgo.com")) continue;
    const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    results.push({
      title: stripHtml(anchor[2]),
      url: href,
      snippet: snippetMatch ? stripHtml(snippetMatch[1]) : "",
      domain: parsedHref.hostname,
      provider: "DuckDuckGo",
    });
    if (results.length >= limit) break;
  }
  if (!results.length) throw new Error("DuckDuckGo không trả về kết quả có thể đọc được");
  return results;
}

async function readWebPage(rawUrl: string, maxChars = MAX_WEB_CHARS) {
  const url = safePublicUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 ContentFlow/1.0", accept: "text/html,text/plain,application/json" },
    });
    if (!response.ok) throw new Error(`${url.hostname} trả về lỗi ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    const raw = (await response.text()).slice(0, 2_000_000);
    const isHtml = contentType.includes("html") || /<html/i.test(raw);
    const title = isHtml
      ? stripHtml(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      : url.pathname.split("/").filter(Boolean).pop() || url.hostname;
    const content = (isHtml ? stripHtml(raw) : raw.trim()).slice(0, maxChars);
    if (!content) throw new Error(`Không trích xuất được nội dung từ ${url.href}`);
    return {
      id: crypto.randomUUID(),
      title: title || textFromMeta(raw, "og:title") || url.hostname,
      url: url.href,
      domain: url.hostname,
      description: isHtml ? textFromMeta(raw, "description") || textFromMeta(raw, "og:description") : undefined,
      author: isHtml ? textFromMeta(raw, "author") : undefined,
      publishedAt: isHtml ? textFromMeta(raw, "article:published_time") || textFromMeta(raw, "date") : undefined,
      content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      retrievedAt: new Date().toISOString(),
      sourceType: "web",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function youtubeId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (url.hostname.endsWith("youtube.com")) return url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1] || null;
  } catch { return null; }
  return null;
}

async function youtubeTranscript(rawUrl: string, preferredLanguage?: string) {
  const id = youtubeId(rawUrl);
  if (!id) throw new Error("URL không phải video YouTube hợp lệ");
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, {
    headers: { "user-agent": "Mozilla/5.0 ContentFlow/1.0" },
  });
  if (!response.ok) throw new Error(`YouTube trả về lỗi ${response.status}`);
  const html = await response.text();
  const match = html.match(/"captionTracks":(\[.*?\])(?=,"audioTracks")/s);
  if (!match) throw new Error("Video không có subtitle công khai; hãy bật AI và cung cấp API key để phiên âm file.");
  const tracks = JSON.parse(match[1]) as Array<{ baseUrl: string; languageCode: string; name?: { simpleText?: string } }>;
  const track = tracks.find((item) => item.languageCode === preferredLanguage) ?? tracks[0];
  const captions = await fetch(`${track.baseUrl}&fmt=json3`);
  if (!captions.ok) throw new Error("Không tải được subtitle của video");
  const payload = await captions.json() as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };
  const segments = (payload.events ?? []).flatMap((event) => {
    const text = (event.segs ?? []).map((segment) => segment.utf8 ?? "").join("").replace(/\n/g, " ").trim();
    return text ? [{ startMs: event.tStartMs ?? 0, durationMs: event.dDurationMs ?? 0, text }] : [];
  });
  return {
    videoId: id,
    language: track.languageCode,
    languageName: track.name?.simpleText,
    text: segments.map((segment) => segment.text).join(" "),
    segments,
    sourceUrl: rawUrl,
  };
}

function responseText(payload: JsonRecord): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as JsonRecord).content) ? (item as JsonRecord).content as unknown[] : [];
    return content.flatMap((part) => part && typeof part === "object" && typeof (part as JsonRecord).text === "string" ? [(part as JsonRecord).text as string] : []);
  }).join("\n");
}

async function callAi(system: string, prompt: string, requestedModel?: string, suppliedApiKey?: string) {
  const apiKey = suppliedApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Chưa có API key. Nhập trong Thiết lập AI hoặc nối cổng APIKey.");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = requestedModel && /^[a-z0-9._-]+$/i.test(requestedModel) ? requestedModel : process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const request: JsonRecord = {
    model,
    text: { verbosity: "low" },
    input: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };
  if (supportsOpenAiReasoning(model)) request.reasoning = { effort: "low" };
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok) {
    const apiError = payload.error && typeof payload.error === "object" ? (payload.error as JsonRecord).message : undefined;
    throw new Error(typeof apiError === "string" ? apiError : `AI API trả về lỗi ${response.status}`);
  }
  const text = responseText(payload).trim();
  if (!text) throw new Error("AI API không trả về nội dung");
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned) as unknown; } catch { return { text }; }
}

async function callAiVision(system: string, prompt: string, files: File[], detail: string, requestedModel?: string, suppliedApiKey?: string) {
  const apiKey = suppliedApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Phân tích hình ảnh hoặc video cần API key.");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = requestedModel && /^[a-z0-9._-]+$/i.test(requestedModel) ? requestedModel : process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const imageParts = await Promise.all(files.map(async (file) => ({
    type: "input_image",
    image_url: `data:${file.type || "image/jpeg"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
    detail: ["low", "high", "auto"].includes(detail) ? detail : "low",
  })));
  const request: JsonRecord = {
    model,
    text: { verbosity: "low" },
    input: [
      { role: "system", content: system },
      { role: "user", content: [{ type: "input_text", text: prompt }, ...imageParts] },
    ],
  };
  if (supportsOpenAiReasoning(model)) request.reasoning = { effort: "low" };
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok) {
    const apiError = payload.error && typeof payload.error === "object" ? (payload.error as JsonRecord).message : undefined;
    throw new Error(typeof apiError === "string" ? apiError : `Vision API trả về lỗi ${response.status}`);
  }
  const text = responseText(payload).trim();
  if (!text) throw new Error("Vision API không trả về nội dung");
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned) as unknown; } catch { return { text }; }
}

async function transcribeFile(file: File, options: { language?: string; knownTerms?: string; diarize?: boolean; apiKey?: string }): Promise<JsonRecord & { model: string }> {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Phiên âm file media cần API key.");
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} vượt quá giới hạn phiên âm 25 MB`);
  const model = options.diarize
    ? process.env.OPENAI_DIARIZE_MODEL || DEFAULT_DIARIZE_MODEL
    : process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
  const apiForm = new FormData();
  apiForm.set("file", file, file.name);
  apiForm.set("model", model);
  if (options.language && options.language !== "auto") apiForm.set("language", options.language);
  if (options.knownTerms) apiForm.set("prompt", `Tên riêng và thuật ngữ cần nhận diện chính xác: ${options.knownTerms}`);
  if (options.diarize) {
    apiForm.set("response_format", "diarized_json");
    apiForm.set("chunking_strategy", "auto");
  } else if (model === "whisper-1") {
    apiForm.set("response_format", "verbose_json");
    apiForm.append("timestamp_granularities[]", "segment");
  } else {
    apiForm.set("response_format", "json");
  }
  const response = await fetch(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: apiForm,
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok) throw new Error(typeof payload.error === "object" && payload.error ? String((payload.error as JsonRecord).message) : `Phiên âm lỗi ${response.status}`);
  return { ...payload, model } as JsonRecord & { model: string };
}

async function parseDocument(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} vượt quá giới hạn 20 MB`);
  const extension = file.name.split(".").pop()?.toLowerCase();
  let content = "";
  if (["txt", "md", "csv", "json", "html", "htm"].includes(extension ?? "")) {
    const raw = await file.text();
    content = extension === "html" || extension === "htm" ? stripHtml(raw) : raw;
  } else if (extension === "docx") {
    const imported = await import("mammoth");
    const mammoth = imported.default ?? imported;
    const result = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
    content = result.value;
  } else if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(text.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    content = pages.join("\n\n");
  } else if (extension === "doc") {
    throw new Error("Định dạng DOC cũ chưa được hỗ trợ; hãy lưu lại thành DOCX hoặc PDF.");
  } else {
    throw new Error(`Chưa hỗ trợ định dạng .${extension || "không xác định"}`);
  }
  content = content.replace(/\u0000/g, "").trim();
  if (!content) throw new Error(`Không đọc được nội dung trong ${file.name}`);
  return {
    id: crypto.randomUUID(), title: file.name, fileName: file.name, content: content.slice(0, 120_000),
    wordCount: content.split(/\s+/).filter(Boolean).length, sourceType: "document", retrievedAt: new Date().toISOString(),
  };
}

async function handleMultipart(request: Request) {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (!files.length) throw new Error("Chưa chọn file");
  if (action === "read-document") return { sources: await Promise.all(files.map(parseDocument)) };
  if (action === "transcribe-media") {
    const transcripts = [];
    for (const file of files) {
      const payload = await transcribeFile(file, { language: String(form.get("language") ?? "auto"), knownTerms: String(form.get("knownTerms") ?? ""), diarize: false, apiKey: String(form.get("apiKey") ?? "") });
      transcripts.push({ fileName: file.name, ...payload, sourceType: "transcription" });
    }
    return { transcripts };
  }
  if (action === "analyze-video-frames") {
    if (files.length > 8) throw new Error("Mỗi lượt phân tích tối đa 8 storyboard");
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > 40 * 1024 * 1024) throw new Error("Nhóm storyboard vượt quá 40 MB");
    const timeline = String(form.get("timeline") ?? "[]");
    const transcript = String(form.get("transcript") ?? "").slice(0, 30_000);
    const goal = String(form.get("goal") ?? "Tóm tắt nội dung");
    const instructions = String(form.get("instructions") ?? "");
    const result = await callAiVision(
      "Bạn là chuyên gia phân tích video theo timeline. Các ảnh là storyboard có timestamp. Hãy kết hợp hình ảnh với transcript, không suy đoán khi bằng chứng không đủ. Trả về JSON hợp lệ; mọi sự kiện và điểm chưa chắc chắn phải có start, end và confidence từ 0 đến 1.",
      `Mục tiêu: ${goal}\nYêu cầu thêm: ${instructions || "Không có"}\nTimeline storyboard: ${timeline}\nTranscript cùng khoảng thời gian:\n${transcript}\n\nTrả về {"scenes":[{"start":0,"end":0,"summary":"","visualEvents":[],"spokenContent":"","participants":[],"narrativeFunction":"","confidence":0.0,"uncertainties":[]}]}.`,
      files,
      String(form.get("detail") ?? "low"),
      String(form.get("model") ?? ""),
      String(form.get("apiKey") ?? ""),
    );
    return { result };
  }
  if (action === "analyze-images") {
    if (files.length > 12) throw new Error("Mỗi lượt phân tích tối đa 12 ảnh");
    const result = await callAiVision(
      String(form.get("system") ?? "Bạn là chuyên gia phân tích hình ảnh. Chỉ mô tả điều thấy rõ, không suy đoán."),
      `Mục tiêu: ${String(form.get("goal") ?? "Mô tả ảnh")}\nYêu cầu: ${String(form.get("prompt") ?? "Phân tích nội dung hình ảnh")}`,
      files,
      String(form.get("detail") ?? "auto"),
      String(form.get("model") ?? ""),
      String(form.get("apiKey") ?? ""),
    );
    return { result };
  }
  throw new Error("Tác vụ upload không hợp lệ");
}

export async function POST(request: Request) {
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      return Response.json(await handleMultipart(request));
    }
    const body = await request.json() as JsonRecord;
    const action = String(body.action ?? "");
    if (action === "search") {
      const query = String(body.query ?? "").trim();
      if (!query) return errorResponse(new Error("Thiếu từ khóa tìm kiếm"), 400);
      const limit = Math.min(20, Math.max(1, Number(body.limit) || 8));
      const provider = String(body.provider ?? "DuckDuckGo");
      let results;
      if (provider.includes("Wikipedia")) {
        try { results = await searchWikipedia(query, limit); }
        catch { results = await searchDuckDuckGo(`site:vi.wikipedia.org ${query}`, limit); }
      }
      else {
        try { results = await searchDuckDuckGo(query, limit); }
        catch { results = await searchWikipedia(query, limit); }
      }
      const domains = Array.isArray(body.domains) ? body.domains.map(String).filter(Boolean) : [];
      if (domains.length) results = results.filter((item) => domains.some((domain) => String(item.domain).includes(domain)));
      return Response.json({ query, results, provider: results[0]?.provider ?? provider, searchedAt: new Date().toISOString() });
    }
    if (action === "read-web") {
      const urls = Array.isArray(body.urls) ? body.urls.map(String).filter(Boolean) : [];
      if (!urls.length) return errorResponse(new Error("Thiếu URL cần đọc"), 400);
      const settled = await Promise.allSettled(urls.slice(0, 20).map((url) => readWebPage(url, Math.min(MAX_WEB_CHARS, Number(body.maxChars) || MAX_WEB_CHARS))));
      const sources = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
      const errors = settled.flatMap((item, index) => item.status === "rejected" ? [{ url: urls[index], error: item.reason instanceof Error ? item.reason.message : String(item.reason) }] : []);
      if (!sources.length) throw new Error(errors.map((item) => item.error).join("; ") || "Không đọc được trang nào");
      return Response.json({ sources, errors });
    }
    if (action === "youtube-transcript") {
      return Response.json({ transcript: await youtubeTranscript(String(body.url ?? ""), typeof body.language === "string" ? body.language : undefined) });
    }
    if (action === "list-models") {
      const provider = ["OpenAI", "Gemini", "Claude", "Ollama", "AI local"].includes(String(body.provider)) ? String(body.provider) : "OpenAI";
      return Response.json({ provider, models: await listProviderModels(provider, typeof body.localEndpoint === "string" ? body.localEndpoint : undefined, typeof body.apiKey === "string" ? body.apiKey : undefined), updatedAt: new Date().toISOString() });
    }
    if (action === "ai") {
      const json = Boolean(body.json);
      const system = `${String(body.system ?? "")} ${json ? "Trả về JSON hợp lệ, không dùng markdown." : ""}`.trim();
      return Response.json({ result: await callAi(system, String(body.prompt ?? ""), typeof body.model === "string" ? body.model : undefined, typeof body.apiKey === "string" ? body.apiKey : undefined) });
    }
    return errorResponse(new Error("Tác vụ nghiên cứu không hợp lệ"), 400);
  } catch (error) {
    return errorResponse(error);
  }
}
