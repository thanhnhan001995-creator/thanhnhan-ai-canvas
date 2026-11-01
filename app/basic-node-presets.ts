export type BasicNodePreset = {
  id: string;
  label: string;
  category: string;
  description: string;
  mode: "pipeline" | "choice";
  nodes: string[];
  /** The block obtains its source through its own configuration, not an edge. */
  sourceNode?: boolean;
  operationLabels?: Record<string, string>;
};

export const BASIC_NODE_PRESETS: BasicNodePreset[] = [
  { id: "ai-setup", label: "Thiết lập AI", category: "AI & mô hình", description: "Chọn nhà cung cấp, model, mức sáng tạo, token đầu ra và cảnh báo chi phí rõ ràng.", mode: "pipeline", nodes: ["Chọn nhà cung cấp AI", "Chọn mô hình AI"] },
  { id: "ai-model-choice", label: "Lựa chọn model AI", category: "AI & mô hình", description: "AI đánh giá prompt và tư liệu đã cache để chọn model ưu tiên tiết kiệm, tốc độ hoặc cân bằng.", mode: "pipeline", nodes: ["Lựa chọn model AI"] },
  { id: "image-input-optimize", label: "Tối ưu input ảnh", category: "AI & mô hình", description: "Giảm ảnh về 720p hoặc 480p, rồi vẽ vùng chú ý để gửi AI vừa nhẹ vừa rõ trọng tâm.", mode: "pipeline", nodes: ["Giảm độ phân giải ảnh", "Lấy vùng chú ý"] },
  { id: "ai-prompt", label: "Tạo prompt AI", category: "AI & mô hình", description: "Soạn system prompt và tạo prompt từ dữ liệu workflow.", mode: "choice", nodes: ["Soạn system prompt", "Tạo prompt từ dữ liệu"] },
  { id: "ai-run", label: "Xử lý văn bản bằng AI", category: "AI & mô hình", description: "Dùng AI để tạo văn bản hoặc dữ liệu JSON từ Prompt và SystemPrompt; không nhận media trực tiếp.", mode: "choice", nodes: ["Gọi AI tạo văn bản", "Gọi AI trả JSON"] },
  { id: "ai-task", label: "Thực thi tác vụ AI", category: "AI & mô hình", description: "Thực hiện một tác vụ văn bản hoặc JSON bằng AI profile được nối vào; trả kết quả, TaskSpec và Report có bằng chứng.", mode: "pipeline", nodes: ["Thực thi tác vụ AI"] },
  { id: "ai-media", label: "Phân tích media bằng AI", category: "AI & mô hình", description: "Phân tích riêng hình ảnh hoặc âm thanh, hoặc kết hợp frame, audio và transcript để phân tích video.", mode: "choice", nodes: ["Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI"] },
  { id: "prepare-video-analysis", label: "Chuẩn bị tư liệu phân tích video", category: "Video", description: "Từ một video, trích frame, tách audio và tạo transcript có timecode để cấp đủ ba tư liệu cho Phân tích video bằng AI.", mode: "pipeline", nodes: ["Trích frame từ video", "Tách âm thanh từ video", "Phiên âm video theo thời gian"] },
  { id: "ai-review", label: "Đánh giá đầu ra AI", category: "AI & mô hình", description: "Chấm điểm và duyệt đầu ra trước khi đưa sang bước sau.", mode: "pipeline", nodes: ["Chấm điểm đầu ra AI", "Duyệt đầu ra AI"] },

  { id: "topic-input", label: "Nhập chủ đề và yêu cầu", category: "Đầu vào", description: "Nhập chủ đề, mục tiêu, đối tượng xem và độ dài mong muốn.", mode: "choice", nodes: ["Nhập đề tài"] },
  { id: "direct-input", label: "Nhập trực tiếp", category: "Đầu vào", description: "Nhập văn bản, URL, ngày giờ, thời gian, Boolean hoặc biến trực tiếp trong node.", mode: "choice", sourceNode: true, nodes: ["Nhập văn bản", "Nhập URL", "Nhập ngày giờ", "Nhập thời gian", "Nhập Boolean", "Nhập biến"], operationLabels: { "Nhập văn bản": "Văn bản", "Nhập URL": "URL", "Nhập ngày giờ": "Ngày giờ", "Nhập thời gian": "Thời gian", "Nhập Boolean": "Boolean", "Nhập biến": "Biến" } },
  { id: "file-source", label: "Nguồn file", category: "Đầu vào", description: "Chọn file từ máy, xác định kiểu để nhận đúng đầu ra và kiểm tra phần mở rộng.", mode: "choice", sourceNode: true, nodes: ["Tải file không rõ kiểu", "Nhập tài liệu", "Tải ảnh lên", "Tải âm thanh lên", "Tải video lên"], operationLabels: { "Tải file không rõ kiểu": "Không rõ kiểu file", "Nhập tài liệu": "Văn bản", "Tải ảnh lên": "Hình ảnh", "Tải âm thanh lên": "Âm thanh", "Tải video lên": "Video" } },
  { id: "folder-source", label: "Nguồn folder", category: "Đầu vào", description: "Nhập đường dẫn folder hoặc Browse để chọn folder trên máy.", mode: "choice", sourceNode: true, nodes: ["Chọn thư mục trên máy"] },
  { id: "image-folder-source", label: "Kho ảnh từ thư mục", category: "Đầu vào", description: "Quét kho ảnh cục bộ, giữ đường dẫn gốc và xuất Image[] để AI chọn thumbnail.", mode: "choice", sourceNode: true, nodes: ["Tải kho ảnh từ thư mục"] },
  { id: "brand-input", label: "Hồ sơ thương hiệu", category: "Đầu vào", description: "Giọng văn, màu sắc, logo, font và quy tắc thương hiệu.", mode: "choice", nodes: ["Hồ sơ thương hiệu"] },
  { id: "production-config", label: "Cấu hình vận hành", category: "Đầu vào", description: "Thiết lập video, lịch chạy, webhook hoặc API key.", mode: "choice", nodes: ["Cấu hình video", "Lịch chạy", "Webhook", "Cấu hình API key"], operationLabels: { "Cấu hình API key": "API key" } },

  { id: "web-research", label: "Nghiên cứu Internet", category: "Nghiên cứu", description: "Tìm kiếm, đọc trang và tổng hợp thành bản nghiên cứu.", mode: "pipeline", sourceNode: true, nodes: ["Tìm kiếm Internet", "Đọc trang web", "Tổng hợp nguồn"] },
  { id: "read-source", label: "Đọc nguồn", category: "Nghiên cứu", description: "Đọc trang web, tài liệu hoặc transcript video.", mode: "choice", nodes: ["Đọc trang web", "Đọc tài liệu", "Lấy transcript"] },
  { id: "fact-verification", label: "Xác minh dữ kiện", category: "Nghiên cứu", description: "Trích xuất dữ kiện rồi đối chiếu với nguồn.", mode: "pipeline", nodes: ["Trích xuất dữ kiện", "Kiểm tra dữ kiện"] },
  { id: "source-quality", label: "Đánh giá và duyệt nguồn", category: "Nghiên cứu", description: "So sánh, xếp hạng độ tin cậy và duyệt nguồn.", mode: "pipeline", nodes: ["So sánh nguồn", "Xếp hạng nguồn", "Duyệt nguồn"] },

  { id: "idea-development", label: "Phát triển ý tưởng", category: "Phát triển nội dung", description: "Tạo, chấm điểm và xếp hạng ý tưởng.", mode: "pipeline", nodes: ["Tạo ý tưởng", "Chấm điểm ý tưởng"] },
  { id: "audience-profile", label: "Phân tích khán giả", category: "Phát triển nội dung", description: "Xác định nhu cầu, nỗi đau và sở thích nội dung.", mode: "choice", nodes: ["Xác định khán giả"] },
  { id: "content-angle", label: "Góc tiếp cận", category: "Phát triển nội dung", description: "Phát triển góc kể chuyện và lời hứa nội dung.", mode: "choice", nodes: ["Tạo góc tiếp cận"] },
  { id: "content-outline", label: "Dàn ý nội dung", category: "Phát triển nội dung", description: "Tạo cấu trúc và luận điểm cho nội dung.", mode: "choice", nodes: ["Tạo dàn ý"] },
  { id: "write-edit-content", label: "Viết và biên tập", category: "Phát triển nội dung", description: "Viết mới, viết lại, mở rộng, rút gọn hoặc đổi giọng văn.", mode: "choice", nodes: ["Viết nội dung", "Viết lại", "Mở rộng", "Rút gọn", "Thay đổi giọng văn"] },
  { id: "content-quality", label: "Kiểm tra và duyệt nội dung", category: "Phát triển nội dung", description: "Kiểm tra chất lượng, trùng lặp, chính sách và duyệt.", mode: "pipeline", nodes: ["Kiểm tra nội dung", "Kiểm tra trùng lặp", "Kiểm tra chính sách", "Duyệt nội dung"] },

  { id: "script-writing", label: "Viết kịch bản hoàn chỉnh", category: "Phát triển nội dung", description: "Viết hook, mở đầu, kịch bản, CTA và intro/outro.", mode: "choice", nodes: ["Viết hook", "Viết mở đầu", "Viết kịch bản", "Tạo CTA", "Tạo intro/outro"] },
  { id: "scene-script", label: "Thiết kế phân cảnh", category: "Phát triển nội dung", description: "Chia chương, phân cảnh, lời thoại, hình ảnh và chỉ dẫn dựng.", mode: "pipeline", nodes: ["Chia chương", "Chia phân cảnh", "Tạo lời thoại cảnh", "Mô tả hình ảnh cảnh", "Chỉ dẫn dựng phim"] },
  { id: "script-review", label: "Kiểm tra kịch bản", category: "Phát triển nội dung", description: "Kiểm tra thời lượng, nhịp độ và thứ tự phân cảnh.", mode: "pipeline", nodes: ["Ước tính thời lượng", "Kiểm tra nhịp độ", "Sắp xếp phân cảnh"] },

  { id: "generate-image", label: "Tạo ảnh", category: "Hình ảnh", description: "Tạo ảnh mới, image-to-image hoặc nhiều phương án.", mode: "choice", nodes: ["Tạo ảnh AI", "Image-to-image", "Tạo phương án ảnh"] },
  { id: "edit-image", label: "Xử lý nền và khung ảnh", category: "Hình ảnh", description: "Xóa hoặc thay nền, mở rộng khung, cắt khung và nâng độ phân giải ảnh.", mode: "choice", nodes: ["Xóa nền ảnh", "Thay nền ảnh", "Mở rộng khung ảnh", "Resize/crop ảnh", "Upscale ảnh"] },
  { id: "image-search", label: "Tìm ảnh tương đồng", category: "Hình ảnh", description: "Cắt một vùng từ ảnh mẫu rồi tìm các frame tương đồng, đối chiếu FrameIndex để trả đúng timecode và Condition.", mode: "choice", nodes: ["Tìm ảnh tương đồng"] },
  { id: "finish-image", label: "Hoàn thiện hình ảnh", category: "Hình ảnh", description: "Chỉnh màu, thêm chữ hoặc logo cho hình ảnh đã chọn.", mode: "choice", nodes: ["Chỉnh màu ảnh", "Thêm chữ vào ảnh", "Thêm logo vào ảnh"] },
  { id: "review-image", label: "Đánh giá và duyệt ảnh", category: "Hình ảnh", description: "Chấm điểm, chọn ảnh phù hợp và duyệt thủ công trước khi dùng.", mode: "choice", nodes: ["Chấm điểm ảnh", "Chọn ảnh", "Duyệt ảnh"] },

  { id: "analyze-video-content", label: "Phân tích nội dung video", category: "Nghiên cứu", description: "Lập chỉ mục, làm rõ lời nói, phân tích cảnh theo thời gian và tổng hợp nội dung có timecode.", mode: "pipeline", nodes: ["Lập chỉ mục video", "Phiên âm video theo thời gian", "Tạo storyboard video", "Phân tích từng đoạn video", "Kiểm tra đoạn chưa chắc chắn", "Tổng hợp nội dung video"] },
  { id: "video-highlight", label: "Tạo highlight bằng AI", category: "Video", description: "AI chọn timecode từ phân tích video, sau đó FFmpeg cục bộ cắt và ghép thành video dưới giới hạn thời lượng.", mode: "choice", nodes: ["Chọn highlight bằng AI", "Dựng video highlight"] },
  { id: "generate-video", label: "Tạo tư liệu video bằng AI", category: "AI & mô hình", description: "Tạo video từ văn bản, ảnh, chuyển động hoặc B-roll.", mode: "choice", nodes: ["Text-to-video", "Image-to-video", "Tạo chuyển động ảnh", "Tạo B-roll"] },
  { id: "edit-video", label: "Chỉnh sửa video", category: "Video", description: "Cắt, chuẩn hóa, xử lý, ghép và duyệt các đoạn video.", mode: "choice", nodes: ["Cắt video", "Tách cảnh video", "Crop/resize video", "Đổi tốc độ video", "Ổn định video", "Xóa nền video", "Chỉnh màu video", "Nối video", "Tạo phương án video", "Chấm điểm video", "Chọn video", "Duyệt video"] },
  { id: "voice-production", label: "Sản xuất giọng đọc", category: "Âm thanh", description: "Chọn, tạo hoặc clone giọng và điều khiển cách đọc.", mode: "choice", nodes: ["Chọn giọng", "Tạo giọng đọc", "Clone giọng", "Điều chỉnh tốc độ giọng", "Điều chỉnh cảm xúc"] },
  { id: "voice-editing", label: "Biên tập lời đọc", category: "Âm thanh", description: "Chia, ghép, làm sạch và chuẩn hóa lời đọc.", mode: "pipeline", nodes: ["Chia lời đọc", "Ghép lời đọc", "Làm sạch âm thanh", "Chuẩn hóa âm lượng"] },
  { id: "audio-mix", label: "Nhạc, hiệu ứng và phối âm", category: "Âm thanh", description: "Tìm hoặc tạo nhạc, hiệu ứng, mix và ducking.", mode: "choice", nodes: ["Tìm nhạc nền", "Tạo nhạc nền", "Tạo hiệu ứng âm thanh", "Trộn voice và nhạc", "Ducking", "Duyệt âm thanh"] },

  { id: "subtitle-create", label: "Tạo subtitle", category: "Văn bản", description: "Tạo subtitle từ âm thanh hoặc kịch bản.", mode: "choice", nodes: ["Speech-to-text", "Tạo subtitle"] },
  { id: "subtitle-finish", label: "Chuẩn hóa và xuất subtitle", category: "Văn bản", description: "Đồng bộ, sửa, dịch, tạo kiểu, chèn và xuất subtitle.", mode: "choice", nodes: ["Đồng bộ subtitle", "Sửa chính tả subtitle", "Chia dòng subtitle", "Dịch subtitle", "Chọn kiểu subtitle", "Chèn subtitle", "Xuất SRT/VTT", "Text nhấn mạnh", "Lower third"] },

  { id: "scene-compose", label: "Dựng cảnh", category: "Video", description: "Tạo timeline, ghép thoại, tư liệu và hoàn thiện hiệu ứng cảnh.", mode: "pipeline", nodes: ["Tạo timeline cảnh", "Ghép thoại và tư liệu", "Căn thời lượng hình", "Tạo chuyển động ảnh cho cảnh", "Chèn text cảnh", "Chèn hiệu ứng", "Chèn chuyển cảnh"] },
  { id: "scene-finish", label: "Render và duyệt cảnh", category: "Video", description: "Preview, render, kiểm tra, duyệt và khóa cảnh.", mode: "pipeline", nodes: ["Preview cảnh", "Render cảnh", "Kiểm tra cảnh", "Duyệt cảnh", "Khóa cảnh"] },

  { id: "master-edit", label: "Dựng video tổng", category: "Video", description: "Sắp xếp, ghép cảnh và áp dụng toàn bộ nhận diện.", mode: "pipeline", nodes: ["Sắp xếp cảnh", "Ghép các cảnh", "Tạo timeline tổng", "Thêm intro", "Thêm outro", "Thêm nhạc nền", "Chèn logo", "Chèn chapter", "Áp dụng thương hiệu"] },
  { id: "master-render", label: "Render video", category: "Video", description: "Preview, render nháp, render chính và xuất nhiều tỷ lệ.", mode: "choice", nodes: ["Preview chất lượng thấp", "Render nháp", "Render chính", "Xuất nhiều tỷ lệ"] },

  { id: "quality-check", label: "Kiểm tra sản phẩm", category: "Kiểm tra chất lượng", description: "Kiểm tra yêu cầu của nội dung hoặc thông số kỹ thuật của video; chỉ hiện thao tác đã chạy thật.", mode: "choice", nodes: ["Kiểm tra yêu cầu và cấu trúc", "Kiểm tra kỹ thuật"] },
  { id: "quality-approval", label: "Tổng hợp chất lượng và duyệt", category: "Kiểm tra chất lượng", description: "Gộp báo cáo, chấm điểm và đưa ra quyết định xuất bản kèm các việc cần sửa.", mode: "pipeline", nodes: ["Tổng hợp báo cáo kiểm tra", "Chấm điểm thành phẩm", "Duyệt xuất bản"] },

  { id: "publish-metadata", label: "Metadata xuất bản", category: "Xuất bản", description: "Tạo tiêu đề, mô tả, chapter và hashtag.", mode: "pipeline", nodes: ["Tạo tiêu đề", "Tạo mô tả", "Tạo chapter metadata", "Tạo hashtag"] },
  { id: "publish-thumbnail", label: "Thumbnail", category: "Xuất bản", description: "Tạo, chấm điểm và chuẩn bị A/B thumbnail.", mode: "pipeline", nodes: ["Tạo thumbnail", "Chấm thumbnail", "A/B thumbnail"] },
  { id: "thumbnail-image-select", label: "Chọn ảnh thumbnail bằng AI", category: "Xuất bản", description: "Lọc kho ảnh theo tên, để AI chọn ảnh phù hợp với nội dung video trước khi ghép chữ.", mode: "choice", nodes: ["Chọn ảnh thumbnail bằng AI"] },
  { id: "publish-youtube", label: "Đăng YouTube", category: "Xuất bản", description: "Upload, đặt lịch, playlist, quyền riêng tư và lưu kết quả.", mode: "pipeline", nodes: ["Upload YouTube", "Đặt lịch đăng", "Thêm playlist", "Thiết lập quyền riêng tư", "Ghim bình luận", "Lưu kết quả xuất bản"] },

  { id: "workflow-routing", label: "Phân nhánh workflow", category: "Điều khiển workflow", description: "Điều kiện If/Else hoặc Switch nhiều nhánh.", mode: "choice", nodes: ["If/Else", "Switch"] },
  { id: "workflow-parallel", label: "Chạy song song và gộp", category: "Điều khiển workflow", description: "Chạy nhiều nhánh song song rồi gộp kết quả.", mode: "pipeline", nodes: ["Chạy song song", "Gộp kết quả"] },
  { id: "workflow-resilience", label: "Chờ, thử lại và xử lý lỗi", category: "Điều khiển workflow", description: "Delay, chờ, retry, giới hạn thử và xử lý lỗi.", mode: "choice", nodes: ["Chờ xử lý", "Delay", "Retry", "Giới hạn thử lại", "Xử lý lỗi"] },
  { id: "workflow-tools", label: "Tự động hóa nâng cao", category: "Điều khiển workflow", description: "Phê duyệt, workflow con, API hoặc mã tùy chỉnh.", mode: "choice", nodes: ["Bắt đầu", "Kết thúc", "Loop từng cảnh", "Chạy thủ công", "Yêu cầu phê duyệt", "Tạm dừng", "Workflow con", "Gọi API", "Chạy mã"] },

  { id: "data-transform", label: "Xử lý dữ liệu", category: "Quản lý dữ liệu", description: "Biến đổi, ghép, lọc, sắp xếp hoặc chọn dữ liệu.", mode: "choice", nodes: ["Lưu biến", "Chuyển đổi dữ liệu", "Ghép dữ liệu", "Lọc danh sách", "Sắp xếp danh sách", "Chọn phần tử"] },
  { id: "data-save-file", label: "Lưu file", category: "Quản lý dữ liệu", description: "Đặt tên theo mẫu rồi lưu file vào thư mục đã chọn hoặc nhận từ cổng Folder.", mode: "pipeline", nodes: ["Đặt tên", "Lưu file"] },
  { id: "data-storage", label: "Lưu trữ và vận hành", category: "Quản lý dữ liệu", description: "Lưu phiên bản, log, chi phí, cache và file tạm.", mode: "choice", nodes: ["Lưu phiên bản", "Lấy phiên bản cũ", "Đọc thư viện", "Ghi log", "Theo dõi chi phí", "Cache kết quả", "Xóa file tạm"] },
  { id: "canvas-data-viewer", label: "Xem dữ liệu trên canvas", category: "Quản lý dữ liệu", description: "Node đầu cuối để xem ngay Text, JSON, hình ảnh, âm thanh hoặc video đã nối vào canvas.", mode: "pipeline", nodes: ["Xem dữ liệu trên canvas"] },
];
