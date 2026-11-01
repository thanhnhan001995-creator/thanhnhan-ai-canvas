export type NodeSpec = {
  group: string;
  order: number;
  name: string;
  settings: string;
  input: string;
  output: string;
};

export const NODE_SPECS: NodeSpec[] = [
  {
    "group": "Đầu vào",
    "order": 1,
    "name": "Nhập đề tài",
    "settings": "Chủ đề, mục tiêu, đối tượng, độ dài",
    "input": "Người dùng nhập",
    "output": "Topic"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 9,
    "name": "Xem dữ liệu trên canvas",
    "settings": "Xem trực tiếp text, JSON, hình ảnh, âm thanh hoặc video",
    "input": "Dữ liệu bất kỳ",
    "output": ""
  },
  {
    "group": "Đầu vào",
    "order": 2,
    "name": "Nhập văn bản",
    "settings": "Trình nhập hoặc dán nội dung",
    "input": "Văn bản",
    "output": "Text"
  },
  {
    "group": "Đầu vào",
    "order": 3,
    "name": "Nhập URL",
    "settings": "URL và tùy chọn đọc nội dung",
    "input": "URL",
    "output": "URL[]"
  },
  {
    "group": "Đầu vào",
    "order": 4,
    "name": "Nhập ngày giờ",
    "settings": "Ngày giờ và múi giờ",
    "input": "Người dùng nhập",
    "output": "DateTime"
  },
  {
    "group": "Đầu vào",
    "order": 5,
    "name": "Nhập thời gian",
    "settings": "Chuỗi đơn vị hoặc tổng số giây",
    "input": "Người dùng nhập",
    "output": "seconds"
  },
  {
    "group": "Đầu vào",
    "order": 6,
    "name": "Nhập Boolean",
    "settings": "Giá trị true hoặc false",
    "input": "Người dùng chọn",
    "output": "Boolean"
  },
  {
    "group": "Đầu vào",
    "order": 7,
    "name": "Nhập biến",
    "settings": "Tên biến, giá trị và kiểu dữ liệu",
    "input": "Người dùng nhập",
    "output": "Variable"
  },
  {
    "group": "Đầu vào",
    "order": 8,
    "name": "Nhập tài liệu",
    "settings": "Upload PDF, DOCX, TXT",
    "input": "File",
    "output": "Document[]"
  },
  {
    "group": "Đầu vào",
    "order": 9,
    "name": "Tải file không rõ kiểu",
    "settings": "Chọn file, không xác định kiểu nội dung",
    "input": "File",
    "output": "File[]"
  },
  {
    "group": "Đầu vào",
    "order": 10,
    "name": "Tải ảnh lên",
    "settings": "Upload, xem trước, mô tả",
    "input": "File ảnh",
    "output": "Image[]"
  },
  {
    "group": "Đầu vào",
    "order": 11,
    "name": "Tải video lên",
    "settings": "Upload, xem trước, metadata",
    "input": "File video",
    "output": "Video[]"
  },
  {
    "group": "Đầu vào",
    "order": 12,
    "name": "Tải âm thanh lên",
    "settings": "Upload, nghe thử, metadata",
    "input": "File âm thanh",
    "output": "Audio[]"
  },
  {
    "group": "Đầu vào",
    "order": 14,
    "name": "Chọn thư mục trên máy",
    "settings": "Chọn thư mục, quét tệp và thư mục con",
    "input": "Thư mục trên máy",
    "output": "Folder"
  },
  {
    "group": "Đầu vào",
    "order": 15,
    "name": "Tải kho ảnh từ thư mục",
    "settings": "Thư mục ảnh, quét thư mục con, giới hạn ứng viên",
    "input": "Thư mục trên máy",
    "output": "Image[]"
  },
  {
    "group": "Đầu vào",
    "order": 13,
    "name": "Hồ sơ thương hiệu",
    "settings": "Giọng văn, màu sắc, logo, font, điều cấm",
    "input": "Người dùng cấu hình",
    "output": "BrandProfile"
  },
  {
    "group": "Đầu vào",
    "order": 15,
    "name": "Cấu hình video",
    "settings": "Tỷ lệ, thời lượng, FPS, độ phân giải, ngôn ngữ",
    "input": "Người dùng cấu hình",
    "output": "VideoConfig"
  },
  {
    "group": "Đầu vào",
    "order": 16,
    "name": "Lịch chạy",
    "settings": "Thời gian, chu kỳ, múi giờ",
    "input": "Cấu hình lịch",
    "output": "Trigger"
  },
  {
    "group": "Đầu vào",
    "order": 17,
    "name": "Webhook",
    "settings": "URL nhận dữ liệu, phương thức, xác thực",
    "input": "HTTP request",
    "output": "Data"
  },
  {
    "group": "Đầu vào",
    "order": 18,
    "name": "Cấu hình API key",
    "settings": "API key, tên ghi nhớ",
    "input": "",
    "output": "APIKey"
  },
  {
    "group": "Nghiên cứu",
    "order": 1,
    "name": "Tìm kiếm Internet",
    "settings": "Từ khóa, thời gian, domain, số kết quả",
    "input": "Topic, Query[]",
    "output": "SearchResult[]"
  },
  {
    "group": "Nghiên cứu",
    "order": 2,
    "name": "Đọc trang web",
    "settings": "Trích xuất tiêu đề, nội dung, ngày đăng",
    "input": "URL[]",
    "output": "Source[]"
  },
  {
    "group": "Nghiên cứu",
    "order": 3,
    "name": "Đọc tài liệu",
    "settings": "OCR, phân trang, trích nội dung",
    "input": "Document[]",
    "output": "Source[]"
  },
  {
    "group": "Nghiên cứu",
    "order": 4,
    "name": "Lấy transcript",
    "settings": "Ngôn ngữ, timestamp, nhận diện người nói",
    "input": "Video hoặc URL",
    "output": "Transcript"
  },
  {
    "group": "Nghiên cứu",
    "order": 5,
    "name": "Tổng hợp nguồn",
    "settings": "Nhóm nguồn theo chủ đề, loại trùng",
    "input": "Source[]",
    "output": "ResearchBrief"
  },
  {
    "group": "Nghiên cứu",
    "order": 6,
    "name": "Trích xuất dữ kiện",
    "settings": "Dữ kiện, số liệu, nhân vật, thời gian",
    "input": "Source[]",
    "output": "Fact[]"
  },
  {
    "group": "Nghiên cứu",
    "order": 7,
    "name": "Kiểm tra dữ kiện",
    "settings": "Đối chiếu tuyên bố với nguồn",
    "input": "Fact[], Source[]",
    "output": "FactCheckResult[]"
  },
  {
    "group": "Nghiên cứu",
    "order": 8,
    "name": "So sánh nguồn",
    "settings": "Tìm điểm giống, khác, mâu thuẫn",
    "input": "Source[]",
    "output": "Comparison"
  },
  {
    "group": "Nghiên cứu",
    "order": 9,
    "name": "Xếp hạng nguồn",
    "settings": "Uy tín, ngày đăng, tính trực tiếp",
    "input": "Source[]",
    "output": "ScoredSource[]"
  },
  {
    "group": "Nghiên cứu",
    "order": 10,
    "name": "Duyệt nguồn",
    "settings": "Danh sách nguồn, chọn/loại, ghi chú",
    "input": "Source[]",
    "output": "ApprovedSource[]"
  },
  {
    "group": "Phát triển nội dung",
    "order": 1,
    "name": "Tạo ý tưởng",
    "settings": "Số lượng, phong cách, chủ đề",
    "input": "Topic, ResearchBrief",
    "output": "Idea[]"
  },
  {
    "group": "Phát triển nội dung",
    "order": 2,
    "name": "Chấm điểm ý tưởng",
    "settings": "Hấp dẫn, mới lạ, phù hợp kênh",
    "input": "Idea[]",
    "output": "ScoredIdea[]"
  },
  {
    "group": "Phát triển nội dung",
    "order": 3,
    "name": "Xác định khán giả",
    "settings": "Nhu cầu, kiến thức, nỗi đau",
    "input": "Topic",
    "output": "AudienceProfile"
  },
  {
    "group": "Phát triển nội dung",
    "order": 4,
    "name": "Tạo góc tiếp cận",
    "settings": "Góc kể chuyện, lời hứa nội dung",
    "input": "Idea, AudienceProfile",
    "output": "Angle[]"
  },
  {
    "group": "Phát triển nội dung",
    "order": 5,
    "name": "Tạo dàn ý",
    "settings": "Cấu trúc chương, luận điểm, thời lượng",
    "input": "Angle, Source[]",
    "output": "Outline"
  },
  {
    "group": "Phát triển nội dung",
    "order": 6,
    "name": "Viết nội dung",
    "settings": "Model, prompt, độ dài, giọng văn",
    "input": "Outline, Source[], BrandProfile",
    "output": "Content"
  },
  {
    "group": "Phát triển nội dung",
    "order": 7,
    "name": "Viết lại",
    "settings": "Yêu cầu sửa, mức độ thay đổi",
    "input": "Content",
    "output": "Content"
  },
  {
    "group": "Phát triển nội dung",
    "order": 8,
    "name": "Mở rộng",
    "settings": "Phần cần mở rộng, độ dài mục tiêu",
    "input": "Content, Source[]",
    "output": "Content"
  },
  {
    "group": "Phát triển nội dung",
    "order": 9,
    "name": "Rút gọn",
    "settings": "Độ dài mục tiêu, phần cần giữ",
    "input": "Content",
    "output": "Content"
  },
  {
    "group": "Phát triển nội dung",
    "order": 10,
    "name": "Thay đổi giọng văn",
    "settings": "Phong cách, cảm xúc, độ trang trọng",
    "input": "Content, BrandProfile",
    "output": "Content"
  },
  {
    "group": "Phát triển nội dung",
    "order": 11,
    "name": "Kiểm tra nội dung",
    "settings": "Logic, mạch lạc, giọng văn",
    "input": "Content",
    "output": "ReviewResult"
  },
  {
    "group": "Phát triển nội dung",
    "order": 12,
    "name": "Kiểm tra trùng lặp",
    "settings": "Ngưỡng tương đồng, nguồn đối chiếu",
    "input": "Content, nguồn",
    "output": "DuplicateReport"
  },
  {
    "group": "Phát triển nội dung",
    "order": 13,
    "name": "Kiểm tra chính sách",
    "settings": "Chính sách nền tảng, nội dung nhạy cảm",
    "input": "Content",
    "output": "PolicyReport"
  },
  {
    "group": "Phát triển nội dung",
    "order": 14,
    "name": "Duyệt nội dung",
    "settings": "Xem, sửa, duyệt hoặc từ chối",
    "input": "Content, ReviewResult",
    "output": "Approval, Content"
  },
  {
    "group": "Kịch bản video",
    "order": 1,
    "name": "Viết hook",
    "settings": "Loại hook, thời lượng, lời hứa",
    "input": "Topic, AudienceProfile",
    "output": "Text"
  },
  {
    "group": "Kịch bản video",
    "order": 2,
    "name": "Viết mở đầu",
    "settings": "Hook, giới thiệu, dẫn vào nội dung",
    "input": "Text, Outline",
    "output": "Text"
  },
  {
    "group": "Kịch bản video",
    "order": 3,
    "name": "Viết kịch bản",
    "settings": "Lời thoại, ghi chú hình ảnh, nguồn",
    "input": "Outline, Source[]",
    "output": "Script"
  },
  {
    "group": "Kịch bản video",
    "order": 4,
    "name": "Chia chương",
    "settings": "Tiêu đề và thời gian từng chương",
    "input": "Script",
    "output": "Chapter[]"
  },
  {
    "group": "Kịch bản video",
    "order": 5,
    "name": "Chia phân cảnh",
    "settings": "Lời thoại, thời lượng, mục đích cảnh",
    "input": "Script, VideoConfig",
    "output": "Scene[]"
  },
  {
    "group": "Kịch bản video",
    "order": 6,
    "name": "Ước tính thời lượng",
    "settings": "Tốc độ đọc, khoảng nghỉ",
    "input": "Script hoặc Scene[]",
    "output": "DurationReport"
  },
  {
    "group": "Kịch bản video",
    "order": 7,
    "name": "Tạo lời thoại cảnh",
    "settings": "Viết hoặc tinh chỉnh từng đoạn thoại",
    "input": "Scene",
    "output": "Narration"
  },
  {
    "group": "Kịch bản video",
    "order": 8,
    "name": "Mô tả hình ảnh cảnh",
    "settings": "Chủ thể, hành động, bối cảnh, phong cách",
    "input": "Scene",
    "output": "VisualBrief"
  },
  {
    "group": "Kịch bản video",
    "order": 9,
    "name": "Chỉ dẫn dựng phim",
    "settings": "Loại cảnh, chuyển động, hiệu ứng, text",
    "input": "Scene",
    "output": "EditingInstruction"
  },
  {
    "group": "Kịch bản video",
    "order": 10,
    "name": "Tạo CTA",
    "settings": "Hành động, vị trí, mức độ trực tiếp",
    "input": "Script, BrandProfile",
    "output": "Text"
  },
  {
    "group": "Kịch bản video",
    "order": 11,
    "name": "Tạo intro/outro",
    "settings": "Logo, lời dẫn, CTA, thời lượng",
    "input": "BrandProfile, VideoConfig",
    "output": "Scene[]"
  },
  {
    "group": "Kịch bản video",
    "order": 12,
    "name": "Kiểm tra nhịp độ",
    "settings": "Độ dài cảnh, mật độ thông tin",
    "input": "Scene[]",
    "output": "PacingReport"
  },
  {
    "group": "Kịch bản video",
    "order": 13,
    "name": "Sắp xếp phân cảnh",
    "settings": "Kéo thả hoặc AI đề xuất thứ tự",
    "input": "Scene[]",
    "output": "Scene[]"
  },
  {
    "group": "Hình ảnh",
    "order": 1,
    "name": "Tạo từ khóa ảnh",
    "settings": "Chủ thể, bối cảnh, từ khóa loại trừ",
    "input": "VisualBrief",
    "output": "Query[]"
  },
  {
    "group": "Hình ảnh",
    "order": 2,
    "name": "Tìm kho ảnh",
    "settings": "Nhà cung cấp, giấy phép, tỷ lệ",
    "input": "Query[]",
    "output": "Image[]"
  },
  {
    "group": "Hình ảnh",
    "order": 3,
    "name": "Tìm thư viện ảnh nội bộ",
    "settings": "Từ khóa, tag, dự án, ngày tạo",
    "input": "Query[]",
    "output": "Image[]"
  },
  {
    "group": "Hình ảnh",
    "order": 4,
    "name": "Tạo ảnh AI",
    "settings": "Model, prompt, tỷ lệ, seed, số lượng",
    "input": "VisualBrief, ảnh tham chiếu",
    "output": "Image[]"
  },
  {
    "group": "Hình ảnh",
    "order": 5,
    "name": "Image-to-image",
    "settings": "Prompt, độ ảnh hưởng, ảnh gốc",
    "input": "Image, Text",
    "output": "Image[]"
  },
  {
    "group": "Hình ảnh",
    "order": 6,
    "name": "Xóa nền ảnh",
    "settings": "Ngưỡng tách nền, định dạng",
    "input": "Image",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 7,
    "name": "Thay nền ảnh",
    "settings": "Ảnh nền hoặc prompt nền",
    "input": "Image, Image",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 8,
    "name": "Mở rộng khung ảnh",
    "settings": "Tỷ lệ mới, vùng mở rộng",
    "input": "Image, VideoConfig",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 9,
    "name": "Resize/crop ảnh",
    "settings": "Kích thước, tỷ lệ, điểm lấy nét",
    "input": "Image",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 9.5,
    "name": "Giảm độ phân giải ảnh",
    "settings": "Giảm cạnh dọc về 720p hoặc 480p; không phóng to ảnh gốc nhỏ hơn mức chọn",
    "input": "Image[]",
    "output": "Image[]"
  },
  {
    "group": "Hình ảnh",
    "order": 9.75,
    "name": "Tìm ảnh tương đồng",
    "settings": "Ảnh mẫu, nguồn ảnh cần tìm, vùng mẫu, ngưỡng tương đồng",
    "input": "ImageSample, ImageSearch, ImageSearchList, SearchFolder, FrameIndex",
    "output": "ImageSample, ImageMatch[], Condition"
  },
  {
    "group": "Hình ảnh",
    "order": 10,
    "name": "Upscale ảnh",
    "settings": "Model, độ phân giải mục tiêu",
    "input": "Image",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 11,
    "name": "Chỉnh màu ảnh",
    "settings": "Preset, độ sáng, tương phản",
    "input": "Image, BrandProfile",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 12,
    "name": "Thêm chữ vào ảnh",
    "settings": "Nội dung, font, vị trí, animation",
    "input": "Image, Text",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 13,
    "name": "Thêm logo vào ảnh",
    "settings": "Logo, vị trí, kích thước, opacity",
    "input": "Image, BrandProfile",
    "output": "Image"
  },
  {
    "group": "Hình ảnh",
    "order": 14,
    "name": "Tạo phương án ảnh",
    "settings": "Số lượng, mức độ biến đổi",
    "input": "Image hoặc VisualBrief",
    "output": "Image[]"
  },
  {
    "group": "Hình ảnh",
    "order": 15,
    "name": "Chấm điểm ảnh",
    "settings": "Đúng nội dung, chất lượng, thương hiệu",
    "input": "Image[], Scene",
    "output": "ScoredImage[]"
  },
  {
    "group": "Hình ảnh",
    "order": 16,
    "name": "Chọn ảnh",
    "settings": "Gallery, so sánh, chọn, loại, khóa",
    "input": "Image[]",
    "output": "SelectedImage"
  },
  {
    "group": "Hình ảnh",
    "order": 17,
    "name": "Duyệt ảnh",
    "settings": "Phê duyệt hoặc yêu cầu làm lại",
    "input": "SelectedImage",
    "output": "Approval, Image"
  },
  {
    "group": "Video",
    "order": 1,
    "name": "Tìm kho video",
    "settings": "Từ khóa, thời lượng, giấy phép",
    "input": "Query[]",
    "output": "Video[]"
  },
  {
    "group": "Video",
    "order": 2,
    "name": "Tìm thư viện video nội bộ",
    "settings": "Tag, nội dung, dự án",
    "input": "Query[]",
    "output": "Video[]"
  },
  {
    "group": "Video",
    "order": 3,
    "name": "Text-to-video",
    "settings": "Model, prompt, thời lượng, tỷ lệ",
    "input": "VisualBrief",
    "output": "Video[]"
  },
  {
    "group": "Video",
    "order": 4,
    "name": "Image-to-video",
    "settings": "Prompt chuyển động, camera, thời lượng",
    "input": "Image, VisualBrief",
    "output": "Video[]"
  },
  {
    "group": "Video",
    "order": 5,
    "name": "Tải video từ nguồn",
    "settings": "URL, quyền sử dụng, đoạn cần lấy",
    "input": "URL",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 6,
    "name": "Cắt video",
    "settings": "Điểm đầu, điểm cuối",
    "input": "Video",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 7,
    "name": "Tách cảnh video",
    "settings": "Phát hiện điểm cắt, độ nhạy",
    "input": "Video",
    "output": "Video[]"
  },
  {
    "group": "Video",
    "order": 8,
    "name": "Crop/resize video",
    "settings": "Tỷ lệ, kích thước, tracking chủ thể",
    "input": "Video",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 9,
    "name": "Đổi tốc độ video",
    "settings": "Tốc độ, giữ cao độ âm thanh",
    "input": "Video",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 10,
    "name": "Ổn định video",
    "settings": "Mức ổn định, crop tự động",
    "input": "Video",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 11,
    "name": "Xóa nền video",
    "settings": "Model tách nền, chất lượng",
    "input": "Video",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 12,
    "name": "Chỉnh màu video",
    "settings": "LUT, độ sáng, tương phản",
    "input": "Video, BrandProfile",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 13,
    "name": "Tạo chuyển động ảnh",
    "settings": "Pan, zoom, parallax",
    "input": "Image",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 14,
    "name": "Tạo B-roll",
    "settings": "Prompt, thời lượng, số phương án",
    "input": "Scene, VisualBrief",
    "output": "Video[]"
  },
  {
    "group": "Video",
    "order": 15,
    "name": "Nối video",
    "settings": "Thứ tự, chuyển cảnh",
    "input": "Video[]",
    "output": "Video"
  },
  {
    "group": "Video",
    "order": 16,
    "name": "Tạo phương án video",
    "settings": "Model, seed, biến thể",
    "input": "Video hoặc VisualBrief",
    "output": "Video[]"
  },
  {
    "group": "Video",
    "order": 17,
    "name": "Chấm điểm video",
    "settings": "Đúng nội dung, chất lượng, chuyển động",
    "input": "Video[], Scene",
    "output": "ScoredVideo[]"
  },
  {
    "group": "Video",
    "order": 18,
    "name": "Chọn video",
    "settings": "Preview, trim, chọn, loại, khóa",
    "input": "Video[]",
    "output": "SelectedVideo"
  },
  {
    "group": "Video",
    "order": 19,
    "name": "Duyệt video",
    "settings": "Phê duyệt hoặc yêu cầu tạo lại",
    "input": "SelectedVideo",
    "output": "Approval, Video"
  },
  {
    "group": "Video",
    "order": 20,
    "name": "Lập chỉ mục video",
    "settings": "Loại video, chế độ lấy mẫu, frame định kỳ, độ nhạy thay đổi, giới hạn frame",
    "input": "Video",
    "output": "VideoIndex"
  },
  {
    "group": "Video",
    "order": 20.5,
    "name": "Chuẩn hóa video nguồn",
    "settings": "H.264/AAC, khung hình, FPS và pixel format sẵn sàng để dựng",
    "input": "Video",
    "output": "Video, VideoMetadata"
  },
  {
    "group": "Video",
    "order": 21,
    "name": "Trích frame từ video",
    "settings": "Mức lấy mẫu, frame định kỳ, độ nhạy thay đổi, giới hạn frame",
    "input": "Video",
    "output": "Image[], FrameIndex"
  },
  {
    "group": "Video",
    "order": 21.25,
    "name": "Tách âm thanh từ video",
    "settings": "Định dạng audio, bitrate",
    "input": "Video",
    "output": "Audio"
  },
  {
    "group": "AI & mô hình",
    "order": 21.5,
    "name": "Lấy vùng chú ý",
    "settings": "Chọn tối đa 3 vùng trên ảnh và vẽ viền đen ngoài, trắng trong",
    "input": "Image[]",
    "output": "Image[], AttentionRegion"
  },
  {
    "group": "Video",
    "order": 21.55,
    "name": "Thiết lập vùng chú ý video",
    "settings": "Chọn tối đa 3 vùng trên video để AI ưu tiên khi phân tích frame và highlight",
    "input": "Video",
    "output": "AttentionRegion"
  },
  {
    "group": "Video",
    "order": 21.6,
    "name": "Làm rõ highlight lặp",
    "settings": "Video, đề xuất highlight, vùng chú ý, trọng số hình/âm thanh, tối đa 3 vòng",
    "input": "Video, HighlightPlan, TimedTranscript, AttentionRegion, AIModel, CachedData",
    "output": "HighlightPlan, SceneAnalysis[], CachedData"
  },
  {
    "group": "Video",
    "order": 22,
    "name": "Phiên âm video theo thời gian",
    "settings": "Làm rõ giọng nói, ngôn ngữ, thuật ngữ, nhận diện người nói, chia đoạn tự động",
    "input": "Video",
    "output": "TimedTranscript"
  },
  {
    "group": "Video",
    "order": 23,
    "name": "Tạo storyboard video",
    "settings": "Số frame mỗi bảng, số cột, kích thước, nhãn timestamp",
    "input": "VideoIndex",
    "output": "Storyboard[]"
  },
  {
    "group": "Video",
    "order": 24,
    "name": "Phân tích từng đoạn video",
    "settings": "Mục tiêu phân tích, độ dài đoạn, mức chi tiết, model AI, chỉ dẫn",
    "input": "Storyboard[], TimedTranscript, AIModel, CachedData",
    "output": "SceneAnalysis[], CachedData"
  },
  {
    "group": "Video",
    "order": 25,
    "name": "Kiểm tra đoạn chưa chắc chắn",
    "settings": "Ngưỡng tin cậy, khoảng đệm, yêu cầu duyệt thủ công",
    "input": "SceneAnalysis[]",
    "output": "ReviewInterval[]"
  },
  {
    "group": "Video",
    "order": 26,
    "name": "Tổng hợp nội dung video",
    "settings": "Kiểu phân tích, mức chi tiết báo cáo, giữ timecode, model AI",
    "input": "SceneAnalysis[], TimedTranscript, ReviewInterval[], AIModel, CachedData",
    "output": "VideoAnalysis, CachedData"
  },
  {
    "group": "Video",
    "order": 27,
    "name": "Chọn highlight bằng AI",
    "settings": "Mục tiêu highlight, tổng thời lượng tối đa, độ dài mỗi đoạn, model AI",
    "input": "VideoAnalysis, AIModel, CachedData",
    "output": "HighlightPlan, CachedData"
  },
  {
    "group": "Video",
    "order": 28,
    "name": "Dựng video highlight",
    "settings": "Kế hoạch highlight, giới hạn thời lượng, tên file, thư mục lưu",
    "input": "Video, HighlightPlan",
    "output": "Video"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 1,
    "name": "Chọn giọng",
    "settings": "Thư viện giọng, ngôn ngữ, nghe thử",
    "input": "Yêu cầu giọng",
    "output": "VoiceProfile"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 2,
    "name": "Tạo giọng đọc",
    "settings": "Model, giọng, tốc độ, cảm xúc",
    "input": "Narration, VoiceProfile",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 3,
    "name": "Clone giọng",
    "settings": "Mẫu giọng, đồng ý sử dụng",
    "input": "AudioSample",
    "output": "VoiceProfile"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 4,
    "name": "Chia lời đọc",
    "settings": "Theo câu, cảnh hoặc giới hạn ký tự",
    "input": "Narration",
    "output": "Text[]"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 5,
    "name": "Ghép lời đọc",
    "settings": "Khoảng nghỉ, crossfade",
    "input": "Audio[]",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 6,
    "name": "Điều chỉnh tốc độ giọng",
    "settings": "Tốc độ, giữ cao độ",
    "input": "Audio",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 7,
    "name": "Điều chỉnh cảm xúc",
    "settings": "Cảm xúc, cường độ, điểm nhấn",
    "input": "Audio",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 8,
    "name": "Làm sạch âm thanh",
    "settings": "Khử nhiễu, echo, tiếng thở",
    "input": "Audio",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 9,
    "name": "Chuẩn hóa âm lượng",
    "settings": "LUFS mục tiêu, giới hạn peak",
    "input": "Audio",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 10,
    "name": "Tìm nhạc nền",
    "settings": "Thể loại, mood, giấy phép",
    "input": "Scene[], BrandProfile",
    "output": "Audio[]"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 11,
    "name": "Tạo nhạc nền",
    "settings": "Prompt, thời lượng, vòng lặp",
    "input": "Yêu cầu âm nhạc",
    "output": "Audio[]"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 12,
    "name": "Tạo hiệu ứng âm thanh",
    "settings": "Loại hiệu ứng, thời điểm",
    "input": "Scene",
    "output": "Audio[]"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 13,
    "name": "Trộn voice và nhạc",
    "settings": "Mức âm lượng, fade",
    "input": "Voice, nhạc",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 14,
    "name": "Ducking",
    "settings": "Mức giảm nhạc khi có thoại",
    "input": "Voice, nhạc",
    "output": "Audio"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 15,
    "name": "Duyệt âm thanh",
    "settings": "Nghe thử, chọn, khóa",
    "input": "Audio[]",
    "output": "Approval, Audio"
  },
  {
    "group": "Subtitle và chữ",
    "order": 1,
    "name": "Speech-to-text",
    "settings": "Model, ngôn ngữ, timestamp",
    "input": "Audio hoặc Video",
    "output": "Transcript"
  },
  {
    "group": "Subtitle và chữ",
    "order": 2,
    "name": "Tạo subtitle",
    "settings": "Tạo SRT đúng timecode từ transcript đã phiên âm",
    "input": "TimedTranscript",
    "output": "Subtitle"
  },
  {
    "group": "Subtitle và chữ",
    "order": 3,
    "name": "Đồng bộ subtitle",
    "settings": "Căn theo waveform hoặc lời đọc",
    "input": "Subtitle, Audio",
    "output": "Subtitle"
  },
  {
    "group": "Subtitle và chữ",
    "order": 4,
    "name": "Sửa chính tả subtitle",
    "settings": "Từ điển riêng, tên nhân vật",
    "input": "Subtitle",
    "output": "Subtitle"
  },
  {
    "group": "Subtitle và chữ",
    "order": 5,
    "name": "Chia dòng subtitle",
    "settings": "Số ký tự, số dòng, tốc độ đọc",
    "input": "Subtitle",
    "output": "Subtitle"
  },
  {
    "group": "Subtitle và chữ",
    "order": 6,
    "name": "Dịch subtitle",
    "settings": "Ngôn ngữ đích, thuật ngữ",
    "input": "Subtitle",
    "output": "Subtitle"
  },
  {
    "group": "Subtitle và chữ",
    "order": 7,
    "name": "Chọn kiểu subtitle",
    "settings": "Font, màu, vị trí, animation",
    "input": "BrandProfile",
    "output": "SubtitleStyle"
  },
  {
    "group": "Subtitle và chữ",
    "order": 8,
    "name": "Chèn subtitle",
    "settings": "Kiểu hiển thị, vùng an toàn",
    "input": "Video, Subtitle",
    "output": "Video"
  },
  {
    "group": "Subtitle và chữ",
    "order": 9,
    "name": "Xuất SRT/VTT",
    "settings": "Định dạng, encoding",
    "input": "Subtitle",
    "output": "File"
  },
  {
    "group": "Subtitle và chữ",
    "order": 10,
    "name": "Text nhấn mạnh",
    "settings": "Từ khóa, thời gian, kiểu hiệu ứng",
    "input": "Scene, Subtitle",
    "output": "TextOverlay[]"
  },
  {
    "group": "Subtitle và chữ",
    "order": 11,
    "name": "Lower third",
    "settings": "Tên, chức danh, vị trí",
    "input": "Text, BrandProfile",
    "output": "TextOverlay"
  },
  {
    "group": "Dựng cảnh",
    "order": 1,
    "name": "Tạo timeline cảnh",
    "settings": "Track, lớp, thời gian bắt đầu/kết thúc",
    "input": "Scene, Asset[]",
    "output": "SceneTimeline"
  },
  {
    "group": "Dựng cảnh",
    "order": 2,
    "name": "Ghép thoại và tư liệu",
    "settings": "Đồng bộ theo nội dung và thời lượng",
    "input": "Voice, Image hoặc Video",
    "output": "SceneTimeline"
  },
  {
    "group": "Dựng cảnh",
    "order": 3,
    "name": "Căn thời lượng hình",
    "settings": "Tự cắt hoặc kéo dài theo voice",
    "input": "SceneTimeline",
    "output": "SceneTimeline"
  },
  {
    "group": "Dựng cảnh",
    "order": 4,
    "name": "Tạo chuyển động ảnh cho cảnh",
    "settings": "Pan, zoom, focus, parallax",
    "input": "Image, Scene",
    "output": "Video"
  },
  {
    "group": "Dựng cảnh",
    "order": 5,
    "name": "Chèn text cảnh",
    "settings": "Nội dung, thời điểm, style",
    "input": "SceneTimeline, TextOverlay[]",
    "output": "SceneTimeline"
  },
  {
    "group": "Dựng cảnh",
    "order": 6,
    "name": "Chèn hiệu ứng",
    "settings": "Hiệu ứng, cường độ, thời điểm",
    "input": "SceneTimeline",
    "output": "SceneTimeline"
  },
  {
    "group": "Dựng cảnh",
    "order": 7,
    "name": "Chèn chuyển cảnh",
    "settings": "Loại chuyển cảnh, thời lượng",
    "input": "Scene[], Scene[]",
    "output": "Transition"
  },
  {
    "group": "Dựng cảnh",
    "order": 8,
    "name": "Preview cảnh",
    "settings": "Chất lượng thấp, watermark",
    "input": "SceneTimeline",
    "output": "PreviewFile"
  },
  {
    "group": "Dựng cảnh",
    "order": 9,
    "name": "Render cảnh",
    "settings": "Codec, độ phân giải, FPS",
    "input": "SceneTimeline, VideoConfig",
    "output": "Video"
  },
  {
    "group": "Dựng cảnh",
    "order": 10,
    "name": "Kiểm tra cảnh",
    "settings": "Hình–lời, lỗi file, cảnh trống",
    "input": "Video, Scene",
    "output": "SceneQAReport"
  },
  {
    "group": "Dựng cảnh",
    "order": 11,
    "name": "Duyệt cảnh",
    "settings": "Xem, ghi chú, duyệt/từ chối",
    "input": "Video, SceneQAReport",
    "output": "Approval"
  },
  {
    "group": "Dựng cảnh",
    "order": 12,
    "name": "Khóa cảnh",
    "settings": "Chặn workflow ghi đè kết quả",
    "input": "Scene, Approval",
    "output": "LockedScene"
  },
  {
    "group": "Dựng video tổng",
    "order": 1,
    "name": "Sắp xếp cảnh",
    "settings": "Kéo thả, số thứ tự",
    "input": "Scene[]",
    "output": "Scene[]"
  },
  {
    "group": "Dựng video tổng",
    "order": 2,
    "name": "Ghép các cảnh",
    "settings": "Thứ tự, khoảng cách, transition",
    "input": "Video[]",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 3,
    "name": "Thêm intro",
    "settings": "Chọn mẫu, vị trí",
    "input": "Timeline, Video",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 4,
    "name": "Thêm outro",
    "settings": "Chọn mẫu, CTA",
    "input": "Timeline, Video",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 5,
    "name": "Thêm nhạc nền",
    "settings": "Nhạc, loop, fade, ducking",
    "input": "Timeline, Audio",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 6,
    "name": "Chèn logo",
    "settings": "Logo, vị trí, thời gian",
    "input": "Timeline, BrandProfile",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 7,
    "name": "Chèn chapter",
    "settings": "Tên chương, timestamp",
    "input": "Timeline, Chapter[]",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 8,
    "name": "Áp dụng thương hiệu",
    "settings": "Font, màu, logo, preset",
    "input": "Timeline, BrandProfile",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 9,
    "name": "Tạo timeline tổng",
    "settings": "Toàn bộ track hình, tiếng, chữ",
    "input": "SceneTimeline, Audio, Subtitle[]",
    "output": "Timeline"
  },
  {
    "group": "Dựng video tổng",
    "order": 10,
    "name": "Preview chất lượng thấp",
    "settings": "Độ phân giải, watermark",
    "input": "Timeline",
    "output": "PreviewFile"
  },
  {
    "group": "Dựng video tổng",
    "order": 11,
    "name": "Render nháp",
    "settings": "Preset render nhanh",
    "input": "Timeline",
    "output": "Video"
  },
  {
    "group": "Dựng video tổng",
    "order": 12,
    "name": "Render chính",
    "settings": "Codec, bitrate, độ phân giải",
    "input": "Timeline, VideoConfig",
    "output": "Video"
  },
  {
    "group": "Dựng video tổng",
    "order": 13,
    "name": "Xuất nhiều tỷ lệ",
    "settings": "16:9, 9:16, 1:1",
    "input": "Timeline, VideoConfig",
    "output": "Video[]"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 1,
    "name": "Kiểm tra yêu cầu và cấu trúc",
    "settings": "Yêu cầu bắt buộc, số từ tối thiểu, số từ tối đa",
    "input": "Dữ liệu",
    "output": "QAReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 2,
    "name": "Chuẩn bị kiểm tra AI",
    "settings": "Mục tiêu kiểm tra, checklist",
    "input": "Dữ liệu",
    "output": "Prompt"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 3,
    "name": "Đọc kết quả AI kiểm tra",
    "settings": "Chuẩn hóa trạng thái, lỗi và hướng sửa",
    "input": "Dữ liệu, AIJson",
    "output": "QAReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 2.5,
    "name": "Kiểm tra bằng AI",
    "settings": "Mục tiêu, checklist, mức nghiêm ngặt; nhận AIExecutionProfile từ AIModel",
    "input": "Dữ liệu, AIModel, CachedData",
    "output": "QAReport, Report, CachedData"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 4,
    "name": "Tổng hợp báo cáo kiểm tra",
    "settings": "Ngưỡng đạt, cách gộp lỗi",
    "input": "QAReport",
    "output": "QAReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 5,
    "name": "Kiểm tra subtitle",
    "settings": "Lệch thời gian, tràn khung, lỗi chữ",
    "input": "Video, Subtitle",
    "output": "QAReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 6,
    "name": "Kiểm tra hình–lời",
    "settings": "So sánh ngữ nghĩa cảnh và lời thoại",
    "input": "Scene[], Video",
    "output": "QAReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 7,
    "name": "Kiểm tra kỹ thuật",
    "settings": "Codec, FPS, bitrate, độ phân giải",
    "input": "Video",
    "output": "QAReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 8,
    "name": "Kiểm tra bản quyền",
    "settings": "Nguồn, giấy phép, thời hạn sử dụng",
    "input": "Asset[]",
    "output": "RightsReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 9,
    "name": "Kiểm tra nhạy cảm",
    "settings": "Bạo lực, tình dục, nhận diện cá nhân",
    "input": "Video, Script",
    "output": "SafetyReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 10,
    "name": "Kiểm tra YouTube",
    "settings": "Tiêu đề, nội dung, thumbnail, chính sách",
    "input": "Dữ liệu đã gộp",
    "output": "PolicyReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 11,
    "name": "Chấm điểm thành phẩm",
    "settings": "Trừ điểm lỗi cần sửa, trừ điểm lỗi không đạt",
    "input": "QAReport",
    "output": "QAReport"
  },
  {
    "group": "Kiểm tra chất lượng",
    "order": 12,
    "name": "Duyệt xuất bản",
    "settings": "Quyết định, ghi chú",
    "input": "QAReport",
    "output": "Approval"
  },
  {
    "group": "Xuất bản",
    "order": 1,
    "name": "Tạo tiêu đề",
    "settings": "Số phương án, độ dài, từ khóa",
    "input": "Script, AudienceProfile, AIModel, CachedData",
    "output": "Title[], CachedData"
  },
  {
    "group": "Xuất bản",
    "order": 2,
    "name": "Bố cục thumbnail bằng AI",
    "settings": "Phong cách, độ nổi bật, vùng chữ",
    "input": "Image[], Title[], AIModel, CachedData",
    "output": "ThumbnailLayout, CachedData"
  },
  {
    "group": "Xuất bản",
    "order": 3,
    "name": "Ghép chữ lên thumbnail",
    "settings": "Tên file, thư mục",
    "input": "Image[], ThumbnailLayout",
    "output": "Image"
  },
  {
    "group": "Xuất bản",
    "order": 4,
    "name": "Chọn ảnh thumbnail bằng AI",
    "settings": "Số ảnh ứng viên, mức phân tích, tiêu chí chọn, model AI",
    "input": "Image[], VideoAnalysis, AIModel, CachedData",
    "output": "Image[], CachedData"
  },
  {
    "group": "Xuất bản",
    "order": 4,
    "name": "Tạo mô tả",
    "settings": "Tóm tắt, CTA, link, nguồn",
    "input": "Script, Source[]",
    "output": "Description"
  },
  {
    "group": "Xuất bản",
    "order": 3,
    "name": "Tạo chapter metadata",
    "settings": "Tên chương và timestamp",
    "input": "Chapter[], Timeline",
    "output": "ChapterMetadata"
  },
  {
    "group": "Xuất bản",
    "order": 4,
    "name": "Tạo hashtag",
    "settings": "Chủ đề, số lượng, nền tảng",
    "input": "Script",
    "output": "Tag[]"
  },
  {
    "group": "Xuất bản",
    "order": 5,
    "name": "Tạo thumbnail",
    "settings": "Prompt, template, nhân vật, text",
    "input": "Script, BrandProfile",
    "output": "Image[]"
  },
  {
    "group": "Xuất bản",
    "order": 6,
    "name": "Chấm thumbnail",
    "settings": "Dễ đọc, tương phản, đúng nội dung",
    "input": "Image[]",
    "output": "ScoredImage[]"
  },
  {
    "group": "Xuất bản",
    "order": 7,
    "name": "A/B thumbnail",
    "settings": "Chọn các phương án thử nghiệm",
    "input": "Image[]",
    "output": "ThumbnailTest"
  },
  {
    "group": "Xuất bản",
    "order": 8,
    "name": "Upload YouTube",
    "settings": "Kênh, quyền riêng tư, file",
    "input": "Video, Dữ liệu đã gộp",
    "output": "UploadResult"
  },
  {
    "group": "Xuất bản",
    "order": 9,
    "name": "Đặt lịch đăng",
    "settings": "Ngày giờ, múi giờ",
    "input": "UploadResult, Trigger",
    "output": "PublishSchedule"
  },
  {
    "group": "Xuất bản",
    "order": 10,
    "name": "Thêm playlist",
    "settings": "Playlist đích, vị trí",
    "input": "UploadResult",
    "output": "PlaylistResult"
  },
  {
    "group": "Xuất bản",
    "order": 11,
    "name": "Thiết lập quyền riêng tư",
    "settings": "Private, unlisted, public",
    "input": "UploadResult",
    "output": "PublishResult"
  },
  {
    "group": "Xuất bản",
    "order": 12,
    "name": "Ghim bình luận",
    "settings": "Nội dung bình luận",
    "input": "UploadResult, Text",
    "output": "CommentResult"
  },
  {
    "group": "Xuất bản",
    "order": 13,
    "name": "Lưu kết quả xuất bản",
    "settings": "URL, Video ID, ngày đăng, trạng thái",
    "input": "PublishResult",
    "output": "PublishedVideo"
  },
  {
    "group": "Điều khiển workflow",
    "order": 1,
    "name": "Bắt đầu",
    "settings": "Kiểu kích hoạt",
    "input": "Trigger",
    "output": "Dữ liệu ban đầu"
  },
  {
    "group": "Điều khiển workflow",
    "order": 2,
    "name": "Kết thúc",
    "settings": "Trạng thái và dữ liệu cần trả",
    "input": "Dữ liệu bất kỳ",
    "output": "WorkflowResult"
  },
  {
    "group": "Điều khiển workflow",
    "order": 3,
    "name": "If/Else",
    "settings": "Điều kiện qua cổng, điều kiện dự phòng",
    "input": "Dữ liệu bất kỳ, Condition",
    "output": "Nhánh đúng, Nhánh sai"
  },
  {
    "group": "Điều khiển workflow",
    "order": 4,
    "name": "Switch",
    "settings": "Giá trị điều kiện qua cổng, các nhánh",
    "input": "Dữ liệu bất kỳ, Condition",
    "output": "Nhánh 1, Nhánh 2, Mặc định"
  },
  {
    "group": "Điều khiển workflow",
    "order": 5,
    "name": "Chạy song song",
    "settings": "Danh sách nhánh",
    "input": "Dữ liệu",
    "output": "Nhiều tiến trình"
  },
  {
    "group": "Điều khiển workflow",
    "order": 6,
    "name": "Gộp kết quả",
    "settings": "Kiểu merge, khóa liên kết",
    "input": "Nhiều đầu vào",
    "output": "Dữ liệu đã gộp"
  },
  {
    "group": "Điều khiển workflow",
    "order": 7,
    "name": "Loop từng cảnh",
    "settings": "Biến phần tử, giới hạn đồng thời",
    "input": "Scene[]",
    "output": "Từng Scene"
  },
  {
    "group": "Điều khiển workflow",
    "order": 8,
    "name": "Chờ xử lý",
    "settings": "Điều kiện hoàn thành, timeout",
    "input": "Job ID",
    "output": "Kết quả job"
  },
  {
    "group": "Điều khiển workflow",
    "order": 9,
    "name": "Delay",
    "settings": "Thời gian chờ",
    "input": "Dữ liệu",
    "output": "Dữ liệu giữ nguyên"
  },
  {
    "group": "Điều khiển workflow",
    "order": 10,
    "name": "Retry",
    "settings": "Số lần, khoảng chờ",
    "input": "Dữ liệu bất kỳ",
    "output": "Kết quả hoặc lỗi"
  },
  {
    "group": "Điều khiển workflow",
    "order": 11,
    "name": "Giới hạn thử lại",
    "settings": "Số lần tối đa",
    "input": "Dữ liệu bất kỳ",
    "output": "Cho chạy hoặc dừng"
  },
  {
    "group": "Điều khiển workflow",
    "order": 12,
    "name": "Chạy thủ công",
    "settings": "Nút thực thi",
    "input": "",
    "output": "Trigger"
  },
  {
    "group": "Điều khiển workflow",
    "order": 13,
    "name": "Yêu cầu phê duyệt",
    "settings": "Nội dung cần duyệt, người duyệt",
    "input": "Dữ liệu bất kỳ",
    "output": "Approval"
  },
  {
    "group": "Điều khiển workflow",
    "order": 14,
    "name": "Tạm dừng",
    "settings": "Lý do, điều kiện tiếp tục",
    "input": "Dữ liệu bất kỳ",
    "output": "Trạng thái chờ"
  },
  {
    "group": "Điều khiển workflow",
    "order": 15,
    "name": "Xử lý lỗi",
    "settings": "Loại lỗi, nhánh dự phòng",
    "input": "Dữ liệu bất kỳ",
    "output": "Kết quả xử lý"
  },
  {
    "group": "Điều khiển workflow",
    "order": 16,
    "name": "Workflow con",
    "settings": "Chọn workflow, ánh xạ dữ liệu",
    "input": "Dữ liệu",
    "output": "Kết quả workflow con"
  },
  {
    "group": "Điều khiển workflow",
    "order": 17,
    "name": "Gọi API",
    "settings": "URL, method, header, body",
    "input": "Dữ liệu",
    "output": "API response"
  },
  {
    "group": "Điều khiển workflow",
    "order": 18,
    "name": "Chạy mã",
    "settings": "JavaScript, giới hạn thực thi",
    "input": "Dữ liệu",
    "output": "Dữ liệu tùy chỉnh"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 1,
    "name": "Lưu biến",
    "settings": "Tên, kiểu, phạm vi",
    "input": "Giá trị",
    "output": "Variable"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 2,
    "name": "Chuyển đổi dữ liệu",
    "settings": "Ánh xạ trường, đổi kiểu",
    "input": "Dữ liệu",
    "output": "Dữ liệu mới"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 3,
    "name": "Ghép dữ liệu",
    "settings": "Khóa ghép, chiến lược",
    "input": "Nhiều dữ liệu",
    "output": "Dữ liệu đã ghép"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 4,
    "name": "Lọc danh sách",
    "settings": "Điều kiện lọc",
    "input": "Danh sách",
    "output": "Danh sách"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 5,
    "name": "Sắp xếp danh sách",
    "settings": "Trường, tăng/giảm",
    "input": "Danh sách",
    "output": "Danh sách"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 6,
    "name": "Chọn phần tử",
    "settings": "Theo vị trí, điểm số hoặc điều kiện",
    "input": "Danh sách",
    "output": "Một phần tử"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 7,
    "name": "Đặt tên",
    "settings": "Mẫu tên",
    "input": "Dữ liệu",
    "output": "NamedFile"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 8,
    "name": "Lưu file",
    "settings": "Thư mục, xử lý trùng",
    "input": "NamedFile hoặc Dữ liệu, Folder",
    "output": "StoredFile"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 9,
    "name": "Lưu phiên bản",
    "settings": "Tên phiên bản, ghi chú",
    "input": "Dữ liệu hoặc file",
    "output": "Version"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 10,
    "name": "Lấy phiên bản cũ",
    "settings": "Phiên bản hoặc thời điểm",
    "input": "Version",
    "output": "Dữ liệu cũ"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 11,
    "name": "Đọc thư viện",
    "settings": "Bộ lọc, tag, loại file",
    "input": "Truy vấn",
    "output": "Asset[]"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 12,
    "name": "Ghi log",
    "settings": "Mức log, nội dung, node nguồn",
    "input": "Dữ liệu thực thi",
    "output": "LogEntry"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 13,
    "name": "Theo dõi chi phí",
    "settings": "Provider, model, token, credit",
    "input": "Kết quả node",
    "output": "CostRecord"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 14,
    "name": "Cache kết quả",
    "settings": "Khóa cache, thời hạn",
    "input": "Dữ liệu",
    "output": "CachedData"
  },
  {
    "group": "Quản lý dữ liệu",
    "order": 15,
    "name": "Xóa file tạm",
    "settings": "Tuổi file, trạng thái sử dụng",
    "input": "File tạm",
    "output": "CleanupResult"
  },
  {
    "group": "AI & mô hình",
    "order": 1,
    "name": "Chọn nhà cung cấp AI",
    "settings": "Nhà cung cấp, API key, khu vực xử lý, cảnh báo chi phí mỗi tháng",
    "input": "APIKey",
    "output": "AIProvider"
  },
  {
    "group": "AI & mô hình",
    "order": 2,
    "name": "Chọn mô hình AI",
    "settings": "Model, mức sáng tạo, token đầu ra tối đa",
    "input": "AIProvider",
    "output": "AIModel"
  },
  {
    "group": "AI & mô hình",
    "order": 3,
    "name": "Lựa chọn model AI",
    "settings": "Ưu tiên chi phí hoặc tốc độ, token đánh giá tối đa",
    "input": "AIProvider, CachedData, Dữ liệu",
    "output": "AIModel, CachedData"
  },
  {
    "group": "AI & mô hình",
    "order": 4,
    "name": "Soạn system prompt",
    "settings": "Vai trò AI, quy tắc, định dạng trả về",
    "input": "Văn bản",
    "output": "SystemPrompt"
  },
  {
    "group": "AI & mô hình",
    "order": 5,
    "name": "Tạo prompt từ dữ liệu",
    "settings": "Dữ liệu nguồn, mẫu prompt, yêu cầu tùy chọn",
    "input": "Dữ liệu",
    "output": "Prompt"
  },
  {
    "group": "AI & mô hình",
    "order": 6,
    "name": "Gọi AI tạo văn bản",
    "settings": "Prompt, độ dài phản hồi, model dự phòng",
    "input": "Prompt, AIModel, SystemPrompt, CachedData",
    "output": "AIText, CachedData"
  },
  {
    "group": "AI & mô hình",
    "order": 7,
    "name": "Gọi AI trả JSON",
    "settings": "Prompt, kiểu JSON, model dự phòng",
    "input": "Prompt, AIModel, SystemPrompt, CachedData",
    "output": "AIJson, CachedData"
  },
  {
    "group": "AI & mô hình",
    "order": 7.5,
    "name": "Thực thi tác vụ AI",
    "settings": "Loại tác vụ, chỉ dẫn, tiêu chí hoàn thành, định dạng đầu ra; nhận AIExecutionProfile từ AIModel",
    "input": "Dữ liệu, Prompt, SystemPrompt, AIModel, CachedData",
    "output": "AIResult, Report, CachedData"
  },
  {
    "group": "Hình ảnh",
    "order": 8,
    "name": "Phân tích hình ảnh bằng AI",
    "settings": "Yêu cầu phân tích, vùng ưu tiên, mức chi tiết; model nhận từ AIModel",
    "input": "Image[], Prompt, AttentionRegion, AIModel, CachedData",
    "output": "AIAnalysis, CachedData"
  },
  {
    "group": "Âm thanh",
    "order": 9,
    "name": "Phân tích âm thanh bằng AI",
    "settings": "Yêu cầu phân tích, ngôn ngữ âm thanh; model nhận từ AIModel",
    "input": "Audio, Prompt, AIModel, CachedData",
    "output": "AIAnalysis, CachedData"
  },
  {
    "group": "Video",
    "order": 9.5,
    "name": "Phân tích video bằng AI",
    "settings": "Mục tiêu, frame, timeline frame, âm thanh, transcript theo thời gian (tùy chọn); model nhận từ AIModel",
    "input": "Image[], FrameIndex, Audio, TimedTranscript, Prompt, AIModel, CachedData",
    "output": "AIAnalysis, CachedData"
  },
  {
    "group": "AI & mô hình",
    "order": 10,
    "name": "Chấm điểm đầu ra AI",
    "settings": "Tiêu chí chấm, thang điểm, yêu cầu tối thiểu",
    "input": "AIText hoặc AIJson hoặc AIAnalysis",
    "output": "AIScore"
  },
  {
    "group": "AI & mô hình",
    "order": 11,
    "name": "Duyệt đầu ra AI",
    "settings": "Ngưỡng điểm, hướng dẫn duyệt, người duyệt",
    "input": "AIText hoặc AIJson hoặc AIAnalysis, AIScore",
    "output": "AIApprovedResult"
  },
  {
    "group": "Đầu vào",
    "order": 13,
    "name": "Tìm nội dung trong kho",
    "settings": "Từ khóa, nguồn ưu tiên, số kết quả",
    "input": "",
    "output": "Text[]"
  },
  {
    "group": "Đầu vào",
    "order": 14,
    "name": "Tìm thư viện tài liệu nội bộ",
    "settings": "Thư mục, lọc theo tên hoặc tag",
    "input": "",
    "output": "Document[]"
  },
  {
    "group": "Hình ảnh",
    "order": 18,
    "name": "Tải ảnh từ URL",
    "settings": "Danh sách URL ảnh, quyền sử dụng",
    "input": "URL[]",
    "output": "Image[]"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 17,
    "name": "Tìm kho âm thanh",
    "settings": "Từ khóa, loại âm thanh, giấy phép",
    "input": "Query[]",
    "output": "Audio[]"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 18,
    "name": "Tìm thư viện âm thanh nội bộ",
    "settings": "Thư mục, lọc theo tên hoặc tag",
    "input": "Query[]",
    "output": "Audio[]"
  },
  {
    "group": "Giọng đọc và âm thanh",
    "order": 19,
    "name": "Tải âm thanh từ URL",
    "settings": "Danh sách URL âm thanh, quyền sử dụng",
    "input": "URL[]",
    "output": "Audio[]"
  }
];
