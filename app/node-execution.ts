// Một node chỉ được coi là sẵn sàng khi runtime có bộ thực thi thật.
// Danh sách này được dùng chung bởi canvas Cơ bản và Chi tiết để thư viện
// không làm người dùng hiểu nhầm một node mô phỏng là node có thể chạy.
const EXECUTABLE_LABELS = new Set([
  "Chọn nhà cung cấp AI", "Chọn mô hình AI", "Lựa chọn model AI", "Cache kết quả",
  "Soạn system prompt", "Tạo prompt từ dữ liệu",
  "Gọi AI tạo văn bản", "Gọi AI trả JSON", "Thực thi tác vụ AI", "Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI",
  "Chấm điểm đầu ra AI", "Duyệt đầu ra AI",
  "Tạo ý tưởng", "Chấm điểm ý tưởng", "Xác định đối tượng xem", "Tạo góc tiếp cận", "Tạo dàn ý", "Viết nội dung",
  "Viết lại nội dung", "Mở rộng nội dung", "Rút gọn nội dung", "Thay đổi giọng văn", "Kiểm tra nội dung", "Kiểm tra nội dung trùng lặp", "Kiểm tra chính sách", "Duyệt nội dung thủ công",
  "Tìm kiếm Internet", "Đọc trang web", "Đọc tài liệu", "Tổng hợp các nguồn", "Trích xuất dữ kiện", "Kiểm tra dữ kiện", "So sánh các nguồn", "Xếp hạng độ tin cậy nguồn", "Duyệt nguồn thủ công",
  "Lập chỉ mục video theo thời gian", "Chuẩn hóa video nguồn", "Trích frame từ video", "Tách âm thanh từ video", "Thiết lập vùng chú ý video", "Làm rõ highlight lặp", "Tạo transcript video theo thời gian", "Tạo storyboard từ video", "Phân tích video theo từng đoạn", "Rà soát đoạn video chưa chắc chắn", "Tổng hợp nội dung video", "Chọn highlight bằng AI", "Dựng video highlight",
  "Giảm độ phân giải ảnh", "Lấy vùng chú ý", "Tìm ảnh tương đồng",
  "If/Else", "Switch",
  "Cổng vào", "Cổng ra", "Gọi workflow",
  "Xem dữ liệu trên canvas",
  "Cắt video", "Nối video", "Ghép các cảnh", "Thêm nhạc nền", "Đặt tên", "Lưu file", "Tạo subtitle", "Chèn subtitle", "Kiểm tra kỹ thuật",
  "Kiểm tra yêu cầu và cấu trúc", "Chuẩn bị kiểm tra AI", "Đọc kết quả AI kiểm tra", "Tổng hợp báo cáo kiểm tra", "Chấm điểm thành phẩm", "Duyệt xuất bản",
  "Tạo tiêu đề", "Bố cục thumbnail bằng AI", "Chọn ảnh thumbnail bằng AI", "Ghép chữ lên thumbnail",
]);

export function hasNodeExecutor(label: string, category: string): boolean {
  // Các node Đầu vào đọc giá trị cấu hình hoặc file cục bộ; chúng đều có
  // executor chung trong executeInput.
  return category === "Đầu vào" || EXECUTABLE_LABELS.has(label);
}

export function executionUnavailableReason(label: string, category: string): string {
  return `“${label}” chưa có bộ thực thi thật cho nhóm ${category}.`;
}
