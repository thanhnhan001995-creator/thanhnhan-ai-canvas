# Danh mục node AI v1

Nguồn máy đọc được: [`shared/ai-node-catalog.mjs`](../../shared/ai-node-catalog.mjs).

## Kết luận AIC-01

Thư viện AI lõi của Tesseract sẽ chỉ có bốn năng lực: **Cấu hình AI**, **Tạo prompt**, **Thực thi tác vụ AI** và **Kiểm tra bằng AI**. Các node hiện hữu không bị xóa trong giai đoạn này: workflow `.tess` cũ tiếp tục chạy qua adapter tương thích.

| Họ hiện hữu | Cổng vào → ra | Quyết định | Đích v1 |
| --- | --- | --- | --- |
| Chọn nhà cung cấp AI | APIKey → AIProvider | Giữ | Cấu hình AI |
| Chọn mô hình AI | AIProvider → AIModel | Giữ | Cấu hình AI |
| Lựa chọn model AI | AIProvider, CachedData, Dữ liệu → AIModel, CachedData | Chỉ tương thích | Trợ lý chọn profile, không là AI lõi |
| Soạn system prompt | Văn bản → SystemPrompt | Chuyển đổi | Tạo prompt / System |
| Tạo prompt từ dữ liệu | Dữ liệu → Prompt | Chuyển đổi | Tạo prompt / Dữ liệu |
| Gọi AI tạo văn bản | Prompt, AIModel, SystemPrompt, CachedData → AIText, CachedData | Chuyển đổi | Thực thi tác vụ AI / Text |
| Gọi AI trả JSON | Prompt, AIModel, SystemPrompt, CachedData → AIJson, CachedData | Chuyển đổi | Thực thi tác vụ AI / JSON |
| Phân tích hình ảnh bằng AI | Image[], Prompt, AttentionRegion, AIModel, CachedData → AIAnalysis, CachedData | Chuyển sang Media | Phân tích ảnh bằng AI |
| Phân tích âm thanh bằng AI | Audio, Prompt, AIModel, CachedData → AIAnalysis, CachedData | Chuyển sang Media | Phân tích âm thanh bằng AI |
| Phân tích video bằng AI | Image[], FrameIndex, Audio, TimedTranscript, Prompt, AIModel, CachedData → AIAnalysis, CachedData | Chuyển sang Media | Phân tích video bằng AI |
| Chấm điểm đầu ra AI | AI output → AIScore | Chỉ tương thích | Kiểm tra không AI / quy tắc |
| Duyệt đầu ra AI | AI output, AIScore → AIApprovedResult | Chỉ tương thích | Kiểm tra không AI / quy tắc |

## Ranh giới chuyển đổi

- **Không xóa node cũ.** Họ cũ được duy trì để mở/chạy workflow `.tess` đã lưu.
- **Không đưa media vào node AI tổng quát v1.** Ảnh, audio và video tiếp tục nằm trong nhóm Media, nơi có những điều kiện đầu vào riêng.
- **Không gọi API trong node prompt.** Prompt chỉ là dữ liệu. Model/profile luôn được nhận qua cổng AIModel khi thực thi.
- **Không gọi heuristic là “kiểm tra bằng AI”.** Hai node đánh giá hiện hữu chỉ là kiểm tra theo quy tắc cục bộ; node AIC-03 sẽ tạo verdict có bằng chứng bằng AI.

## Lộ trình đã duyệt

1. AIC-02 thêm **Thực thi tác vụ AI** cho Text/JSON với `AIExecutionProfile`, instructions và `TaskSpec`.
2. AIC-03 thêm **Kiểm tra bằng AI** tạo `Report` có verdict, lý do, bằng chứng và mục cần sửa.
3. AIC-04 chuyển lối tạo node phân tích media sang nhóm Media, nhưng duy trì adapter cho node cũ.
4. PRM-01 đến PRM-03 hợp nhất việc tạo prompt theo ba chế độ mà không làm mất dây Prompt/SystemPrompt cũ.
