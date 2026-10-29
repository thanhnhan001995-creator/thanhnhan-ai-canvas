# Content Flow AI Canvas

Hệ thống tạo, cấu hình và chạy workflow nội dung bằng node. Content Flow kết
hợp xử lý cục bộ (FFmpeg, transcript cục bộ, tệp và media) với các node AI có
cấu hình API key trực tiếp hoặc qua kết nối workflow.

## Chạy dự án

Yêu cầu Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Ứng dụng không đọc API key từ `.env` khi chạy workflow. Người dùng cấu hình
key trực tiếp hoặc cấp key qua node AI trong canvas. `.env.example` chỉ là mẫu
phục vụ phát triển và kiểm thử.

## Kiểm tra

```bash
npm test
```

Lệnh test build ứng dụng và chạy các kiểm tra cho hợp đồng node, runtime media
và giao diện được render.

## Thành phần chính

- `app/`: canvas, thư viện node, cấu hình và thực thi workflow.
- `support/media/`: dịch vụ media cục bộ, FFmpeg và transcript cục bộ.
- `support/tests/`: kiểm tra hành vi runtime và nội dung giao diện.
- `desktop/`: lớp khởi động ứng dụng desktop.

Model xử lý cục bộ được người dùng quản lý thủ công từ ứng dụng; cache model,
trạng thái máy và dữ liệu media thử nghiệm không được commit vào repository.
