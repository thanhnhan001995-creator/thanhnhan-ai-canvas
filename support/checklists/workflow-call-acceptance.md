# Nghiệm thu workflow gọi lại

Thực hiện trên bản phát triển, không đóng gói hoặc cập nhật bản cài khi chưa có phê duyệt phát hành.

## Chuẩn bị

- Tạo ba workflow `.tess`: `A`, `B`, `C`; mỗi workflow có một `Cổng vào` Text và một `Cổng ra` Text nối thẳng nhau.
- Mở cả ba file thành ba tab để kiểm tra đường gọi tới workflow đang mở. Lưu từng tab sau khi thay đổi interface.

## Luồng chạy hợp lệ

1. Trong `A`, đặt `Gọi workflow` trỏ tới `B`, nối Text vào và Text ra tới node Xem dữ liệu.
2. Bấm **Kiểm tra**: không có lỗi đệ quy. Chạy workflow và xác nhận Text trả về tại node gọi và node Xem dữ liệu đúng với giá trị đã đưa vào `A`.
3. Thay đổi tên hoặc thứ tự một cổng của `B`, lưu, quay lại `A` và xác nhận node gọi báo interface đã đổi cho tới khi đồng bộ lại.

## Vòng gọi bị chặn

1. Đặt `A` gọi chính `A`; bấm **Kiểm tra**. Kết quả phải hiển thị `A → A`, đánh dấu node Gọi workflow và không bắt đầu chạy.
2. Đặt `A → B`, `B → C`, `C → A`; bấm **Kiểm tra** tại `A`. Kết quả phải hiển thị toàn bộ `A → B → C → A`, không treo giao diện và không chạy workflow.
3. Sau khi đã kiểm tra, cố tình đổi file/tab tạo vòng rồi chạy. Runtime phải dừng ngay với lỗi chuỗi call stack, không chạy vô tận.

## Lỗi đích và nhiều tab

1. Đóng tab/file đang là đích của một node `Gọi workflow`, sau đó bấm **Kiểm tra**. App phải báo tab đã đóng/không tồn tại và vẫn thao tác được với tab hiện tại.
2. Đổi đường dẫn của node gọi sang file `.tess` không tồn tại. App phải báo không đọc được workflow, không treo và không làm hỏng canvas hiện tại.
3. Chuyển qua lại ba tab sau các lần kiểm tra/chạy. Xác nhận canvas, selection, history và trạng thái chưa lưu của mỗi tab vẫn độc lập.

## Giới hạn an toàn

- Xác nhận runtime dừng nếu sâu gọi vượt **32** hoặc tổng số lượt gọi vượt **500** trong một lượt chạy; lỗi phải chỉ rõ giới hạn đã chạm.
