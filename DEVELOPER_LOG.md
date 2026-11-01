# Developer Log — Content Flow

> Múi giờ chuẩn: `Asia/Bangkok (UTC+07:00)`.
>
> Quy ước từ 2026-10-11 13:16: mọi thay đổi chức năng, giao diện, dữ liệu,
> phím tắt hoặc hành vi Desktop do Codex thực hiện phải có một mục mới trong
> file này, gồm ngày, giờ, phạm vi thay đổi và mức kiểm tra. Không ghi mốc
> thời gian suy đoán.

## 2026-10-13 10:34:00 +07:00 — Phiên âm video lớn theo đường dẫn cục bộ

**Phạm vi:** Dịch vụ media FFmpeg, Electron file bridge, pipeline video.

- Thêm endpoint local `/transcribe-path`; chỉ nhận đường dẫn tuyệt đối tới định dạng video được cho phép, kiểm tra đó là file trước khi gọi FFmpeg.
- Electron gắn lại đường dẫn gốc vào runtime File. Node phiên âm dùng đường này khi có, nên video lớn không đi qua upload 4 GB hay tạo bản sao toàn bộ trong trình duyệt.
- Node tổng hợp video chấp nhận timed transcript khi chưa có scene analysis và ghi rõ báo cáo đó không suy luận hình ảnh.
- Thêm ô API key phiên âm tùy chọn cho node transcript; chỉ chuyển nội bộ tới dịch vụ media khi không dùng key trong `.env`.
- Thêm endpoint `/index-path` để FFmpeg trích frame JPEG thu nhỏ theo mốc thời gian từ video theo đường dẫn; pipeline storyboard dùng các frame này thay vì giải mã cả video trong renderer.
- Sửa request Responses API: chỉ gửi `max_output_tokens` khi giá trị hợp lệ từ 16 token trở lên; giá trị trống dùng mặc định API.
- Kiểm tra thực: trích frame từ `videos long.mp4`, phân tích 3 frame bằng `gpt-4.1-nano` và nhận scene có timestamp; kiểm tra phiên âm/tóm tắt video ngắn cũng thành công.

## 2026-10-13 10:21:00 +07:00 — Ngân sách token theo workflow

**Phạm vi:** Thiết lập AI và runtime gọi AI.

- Thêm trường giới hạn token workflow (1–50.000), mặc định 50.000 token.
- Runtime cộng token thực tế từ API, thêm cảnh báo trong output khi đạt 80% và chặn các lần gọi sau khi dùng hết hạn mức.
- Kiểm tra build và 24/24 test tự động đạt; không gọi API trong lượt kiểm tra.

## 2026-10-13 10:16:00 +07:00 — Trả usage token từ node AI

**Phạm vi:** API Responses của OpenAI và output node AI.

- Truyền giới hạn token đầu ra đã chọn vào request Responses API; giá trị luôn bị chặn tối đa 50.000 token.
- Đọc `input_tokens`, `output_tokens`, `total_tokens` từ response và đưa vào `usage` trong output của node văn bản, JSON, phân tích ảnh và phân tích âm thanh.
- Chưa gọi API khi kiểm tra thay đổi này, nên không phát sinh token thử nghiệm.

## 2026-10-12 12:31:51 +07:00 — Rà điều kiện bắt buộc của nhóm AI

- Node `Thiết lập AI` và `Chọn mô hình AI` giờ là `miss` nếu chưa chọn model; chọn `Khác — nhập ID model` bắt buộc nhập ID tùy chỉnh.
- Khai báo và đánh dấu `*` các trường AI bắt buộc: nhà cung cấp, model, endpoint AI local, thông tin provider tùy chỉnh, các giá trị tùy chỉnh đã chọn, schema JSON tùy chỉnh, mục tiêu phân tích tùy chỉnh và tiêu chí chấm.
- API key là bắt buộc khi dùng provider từ xa; Ollama và AI local không bị yêu cầu API key. API key có thể đến từ ô nhập hoặc cổng APIKey.
- Giữ các lựa chọn điều chỉnh không ảnh hưởng khả năng chạy là tùy chọn: vùng xử lý, cảnh báo chi phí, nhiệt độ/độ dài mặc định, quy tắc bổ sung, ghi chú duyệt.
- Bổ sung kiểm thử tĩnh cho kiểm tra cấu hình AI và dấu bắt buộc.

## 2026-10-12 12:22:42 +07:00 — Ô chọn có lọc và sắp xếp model

- Thay các danh sách chọn đơn trong Properties bằng combobox: giá trị hiện tại hiển thị trực tiếp trong ô, bấm hoặc gõ để lọc lựa chọn rồi chọn từ danh sách.
- Áp dụng combobox cho danh sách model AI và mọi trường cấu hình `select`; các lựa chọn có thứ tự nghiệp vụ giữ nguyên thứ tự định nghĩa.
- Danh sách model được khử trùng lặp và sắp xếp alphabet có nhận biết số trước khi hiển thị, giúp model số lượng lớn dễ tìm hơn.
- Bổ sung kiểm thử tĩnh cho combobox, lọc và sắp xếp model.

## 2026-10-12 12:12:36 +07:00 — Sửa kiểm tra node cơ bản và hiển thị chi tiết lỗi

- Sửa lỗi kiểm tra nhầm node Cơ bản như `Tạo prompt AI`: giờ kiểm tra executor của các bước con đã chọn thay vì kết luận nhãn wrapper không có executor.
- Thêm khối `Kết quả kiểm tra` trong Properties của node đang chọn, đặt ngay phía trên `Output gần nhất`; khối này nêu rõ từng lỗi hoặc dữ liệu/thao tác còn thiếu.
- Thông tin `miss` có viền đỏ sáng theo yêu cầu; lỗi có khối cảnh báo đỏ riêng.
- Khối chỉ hiện khi beacon hiện tại của node là `miss` hoặc `error`, nên không để sót cảnh báo cũ sau khi node được chỉnh sửa.

## 2026-10-12 11:57:40 +07:00 — Beacon trong tóm tắt kiểm tra

- Bỏ thông báo nổi trên canvas do thao tác `Kiểm tra`; thao tác này giờ chỉ dùng tóm tắt trong thanh `Workflow canvas`.
- Thêm beacon phía trước tóm tắt: xanh khi tất cả sẵn sàng, đỏ khi có ít nhất một node lỗi, vàng khi không có lỗi nhưng còn node thiếu.
- Giữ nội dung tóm tắt ngắn gọn theo số node lỗi/thiếu duy nhất.

## 2026-10-12 11:53:20 +07:00 — Đặt tóm tắt kiểm tra trong thanh canvas

- Chuyển thông báo kiểm tra 30 giây từ hàng tên workflow sang thanh `Workflow canvas` ngay phía trên canvas.
- Tóm tắt chỉ đếm node duy nhất, không đếm lặp nhiều vấn đề trên cùng một node.
- Nội dung chỉ nêu số node `lỗi` và/hoặc `thiếu`, ví dụ: `Kiểm tra phát hiện có 4 node lỗi.`; khi không có vấn đề sẽ hiện `Tất cả sẵn sàng.`

## 2026-10-12 11:50:08 +07:00 — Beacon trạng thái và kiểm tra workflow

- Thay đèn trạng thái trên node bằng beacon bốn mức: `uncheck` (xám), `miss` (vàng), `ready` (lục), `error` (đỏ).
- Kiểm tra workflow giờ phân loại riêng: thiếu đầu vào bắt buộc/chưa chọn thao tác là `miss`; dữ liệu không hợp lệ, chưa có bộ thực thi hoặc thiếu API key là `error`; node hợp lệ là `ready`.
- Mọi thay đổi cấu hình, tệp nguồn, thao tác, tên/mô tả hoặc kết nối bắt buộc đều đưa beacon của node liên quan về `uncheck`; xoá dây cũng làm hai node ở hai đầu kiểm tra lại.
- Bổ sung tóm tắt trên hàng workflow: hiển thị số `thiếu` và `lỗi`, hoặc `Tất cả sẵn sàng`; tóm tắt tự biến mất sau 30 giây.
- Khi chạy thực tế, lỗi thực thi đổi beacon thành `error`; lỗi thiếu đầu vào đổi thành `miss`.

## 2026-10-12 11:32:11 +07:00 — Đồng bộ tên hiển thị với level cổng thấp nhất

- Toàn bộ nhãn cổng trên node, bộ lọc và thông báo dùng tên của level thấp nhất trong hợp đồng cổng thay vì tên kiểu kỹ thuật cũ.
- Ví dụ: `AIText` có `kind:text` nên hiện là `text`; `AIAnalysis` hiện là `analysis`; `Video[]` hiện là `video[]`; cổng không chia nhỏ hơn hiện là `free`.
- Mảng vẫn giữ hậu tố `[]` trên tên hiển thị để phân biệt dữ liệu đơn và danh sách.
- Thêm kiểm thử bao phủ việc suy ra tên hiển thị từ Free, Type, Kind và danh sách.

## 2026-10-12 11:21:23 +07:00 — Phân biệt màu cổng theo nhánh dữ liệu

- Giữ hình cổng theo level sâu nhất (`Free`, `Group`, `Type`, `Kind`) để thể hiện cấu trúc phân cấp.
- Đổi màu từ màu theo level sang màu theo đường dẫn hợp đồng cổng: các Type cùng Group `data` như Audio, Document, File, Image và Video vẫn cùng hình tam giác nhưng có năm màu khác nhau.
- Các Kind được tạo màu ổn định từ chính đường dẫn của chúng; màu dây nối tiếp tục lấy đúng màu của cổng nguồn.
- Thêm kiểm thử bảo đảm các Type cùng Group có hình level giống nhau nhưng màu không trùng.

## 2026-10-12 11:15:20 +07:00 — Chuẩn hóa phân cấp và quy tắc kết nối cổng

- Thay hợp đồng cổng cũ bằng bốn level: `Free → Group → Type → Kind`; mọi cổng luôn có `free:free`, level thấp hơn chỉ được tồn tại khi có đủ level cha.
- Thêm bốn kích thước kết nối `exact`, `up`, `down`, `all`; kết nối được chấp nhận khi quy tắc của ít nhất một trong hai cổng phù hợp.
- Chuẩn hóa nhánh dữ liệu: `Video` là `data/video`, các dữ liệu chi tiết của video là `kind` bên dưới; `Video` không còn tương thích với `Audio` chỉ vì cùng nhóm dữ liệu.
- Đồng bộ xác thực khi nối trên canvas, tìm cổng khi bấm tên cổng, bộ thực thi workflow và chú giải kiểu cổng với cùng một hợp đồng.
- Bổ sung kiểm thử cho Exact/Up/All và các trường hợp Video–Audio; kiểm thử toàn bộ dự án đã chạy sau khi cập nhật.

## 2026-10-11 13:16 +07:00 — Tổng hợp lịch sử đã thực hiện

**Loại:** Ghi nhận hồi cứu. Thời điểm triển khai riêng của từng hạng mục trước
đó không được lưu, vì vậy toàn bộ mục này được ghi tại thời điểm tổng hợp,
không phải thời điểm triển khai.

### Kiến trúc và catalog node

- Xây dựng Content Flow thành trình biên tập workflow trực quan dùng React
  Flow, có catalog **Cơ bản** và **Chi tiết**. Catalog Cơ bản gồm các workflow
  con; Catalog Chi tiết giữ các node primitive để cấu hình chuyên sâu.
- Chuẩn hóa cách hiển thị và nhóm node theo luồng sử dụng: đầu vào, nghiên cứu,
  phát triển nội dung, các khâu sản xuất nội dung (Văn bản, Hình ảnh, Âm thanh,
  Video), kiểm tra chất lượng, xuất bản, AI & mô hình, điều khiển workflow và
  quản lý dữ liệu.
- Sắp thứ tự các nhóm sản xuất theo mức độ từ dễ đến khó: **Văn bản → Hình ảnh
  → Âm thanh → Video**. Nhãn nhóm hỗ trợ tối đa hai dòng và giảm padding dọc.
- Bỏ danh sách node dùng gần đây ở thư viện và ở màn thêm nhanh. Thẻ node trong
  màn thêm nhanh hiển thị icon, tên tối đa hai dòng, số thao tác/lựa chọn và
  chú giải khi hover.
- Tab trong màn thêm nhanh đổi qua lại giữa chế độ Cơ bản và Chi tiết; tại các
  vị trí khác, Tab vẫn giữ hành vi điều hướng giao diện thông thường.
- Rà soát icon: chọn biểu tượng có nghĩa trực tiếp, tránh icon quá nhỏ/nét đứt,
  không trùng icon trong cùng một nhóm trừ phiên bản Cơ bản/Chi tiết của cùng
  một khái niệm.

### Phân loại, kết nối và hiển thị cổng

- Đưa kiểu cổng vào thư viện dùng chung: mỗi nhóm dữ liệu có hình cổng riêng,
  mỗi kiểu có màu riêng, viền đen mảnh và đồng nhất. Đầu ra được chuẩn hóa sang
  tiếng Anh; đường nối lấy màu từ cổng ra.
- Sắp xếp các cổng input/output theo alphabet để dễ tìm.
- Dây nối dùng Bezier cong, có mũi tên ở đầu vào và đoạn đi thẳng ngắn trước
  khi uốn, giúp phân biệt các dây giao nhau.
- Thêm nối nhanh: kéo từ node này sang node khác sẽ tự chọn cổng tương thích
  trên cùng; nếu thả đúng cổng, luôn ưu tiên cổng mà người dùng chỉ định.
- Thêm bộ lọc node theo cổng input/output: bấm nhãn kiểu dữ liệu trên canvas để
  lọc thư viện node tương thích, hiển thị trạng thái lọc và nút xóa lọc.
- Mini map nhân hệ số zoom lên x3 khi con trỏ nằm trên mini map.
- Loại bỏ bảng “Hợp đồng dữ liệu” dư thừa khỏi inspector khi nó không giúp thao
  tác hiện tại.

### Tổ chức node nghiệp vụ

- Tái cấu trúc nhóm Video: chỉ giữ node phục vụ cắt ghép/edit/render video;
  tư liệu video chuyển về Quản lý dữ liệu, giọng đọc/âm thanh về Âm thanh,
  subtitle về Văn bản, kịch bản về Phát triển nội dung.
- Gộp các node chọn nguồn chồng chéo: nguồn file phân theo kiểu file, nguồn
  folder riêng và nhập trực tiếp riêng. Loại bỏ “chọn nguồn video” trùng chức
  năng với nguồn media/file.
- Tất cả node chọn nguồn thuộc nhóm Đầu vào; bỏ tiền tố “Chọn” khỏi các nhãn
  nguồn để ngắn và rõ hơn.
- Tách node chỉnh sửa ảnh Cơ bản thành các nhóm thao tác gần nhau thay vì một
  node ôm toàn bộ chức năng.
- Với node nhiều thao tác: mặc định “Không thao tác” hiển thị toàn bộ cổng;
  chọn thao tác chỉ hiện cổng liên quan; kết nối không còn hợp lệ sẽ bị ngắt.

### Nguồn đầu vào, lưu file và chạy workflow

- `Nguồn file` hỗ trợ Không rõ kiểu file, Văn bản, Hình ảnh, Âm thanh và Video;
  Video xuất `Video[]` (không dùng nhãn mơ hồ “Media”).
- Node nguồn file lưu đường dẫn tệp thật trong workflow Desktop, phục hồi tệp
  khi mở lại workflow và hiển thị tên tệp đã chọn trong nút thay vì “Đổi file”.
- Kiểm tra phần mở rộng theo kiểu nguồn; lỗi hiển thị trong inspector và node.
- `Nguồn folder` nhận đường dẫn nhập tay hoặc chọn qua Browse.
- `Nhập trực tiếp` gồm Văn bản, URL, Ngày giờ, Thời gian, Boolean và Biến.
  - Ngày giờ xuất `DateTime` ISO `yyyy-mm-ddTHH:mm`; lịch chạy `Trigger` được
    giữ riêng trong Cấu hình vận hành.
  - Thời gian nhận số giây thuần hoặc chuỗi đơn vị như `3d120m`, `1h30m`,
    `1y2M3d4h5m6s`, xuất chuỗi `seconds`; năm = 365 ngày, tháng = 30 ngày.
  - Boolean hỗ trợ `true`/`false`; Biến hỗ trợ String, Number, Boolean và JSON.
- Giao diện nhập Ngày giờ gồm một hàng: Giờ → nút đồng hồ → Ngày → nút lịch;
  mặc định `00:00` và ngày hiện tại, dùng chuẩn giờ 24h.

### Lưu, thông báo và desktop shell

- `Ctrl+S`: workflow chưa có đường dẫn sẽ mở hộp thoại chọn nơi lưu; workflow
  đã mở/lưu sẽ ghi đè tệp hiện tại.
- `Ctrl+Shift+S`: Lưu mới (Save As). `Ctrl+O`: mở workflow.
- Thông báo tự ẩn sau tối đa 5 giây và được đặt dưới thanh tiêu đề canvas để
  không bị che.
- Desktop Electron dùng IPC an toàn cho chọn file/folder, đọc lại nguồn file,
  mở workflow và lưu workflow.
- `Ctrl+Shift+W` đóng canvas cùng thư viện node và Properties nhưng không thoát
  ứng dụng. Màn hình đóng canvas chỉ cung cấp **Tạo mới** (`Ctrl+N`) và
  **Mở** (`Ctrl+O`); shortcut đóng canvas không dùng lại để mở canvas.

### Các điểm kiểm tra đã ghi nhận

- `npm test` đã chạy thành công ở các lần cập nhật gần nhất: build Vinext và
  16 kiểm tra tự động đạt.
- Kiểm tra cú pháp `desktop/main.mjs` đã đạt sau các thay đổi Electron gần nhất.
- Electron Desktop đã được khởi động lại sau các nhóm thay đổi để nạp source
  mới. Các kiểm tra trên không thay thế việc review cảm quan toàn bộ giao diện
  trên từng kích thước màn hình.

### Tệp chính liên quan

- `app/page.tsx`: canvas React Flow, inspector, phím tắt, thao tác lưu/mở và
  giao diện thư viện.
- `app/node-specs.ts`: primitive node catalog.
- `app/basic-node-presets.ts`: block Cơ bản và thao tác lựa chọn.
- `app/port-library.ts`, `app/node-contracts.ts`: biểu diễn và tương thích cổng.
- `app/research-client.ts`: thực thi node và parser dữ liệu đầu vào.
- `desktop/main.mjs`, `desktop/preload.cjs`: Electron shell và IPC an toàn.
- `support/tests/*.test.mjs`: kiểm tra catalog, render, runtime và media.

## 2026-10-11 13:25 +07:00 — Rà soát trải nghiệm nhóm AI & mô hình

**Phạm vi:** `app/page.tsx`, `app/node-specs.ts`, `app/basic-node-presets.ts`.

- Rà toàn bộ 10 node của nhóm AI & mô hình và thay các trường cấu hình sinh tự
  động, mơ hồ bằng lựa chọn có nhãn giải thích.
- `Thiết lập AI / Chọn nhà cung cấp AI`: chọn rõ OpenAI, Google Gemini,
  Anthropic Claude, Azure OpenAI, Ollama local, API tương thích OpenAI hoặc
  Khác. Chỉ khi chọn Khác mới mở ô nhập tên/URL.
- Làm rõ khu vực xử lý và “Cảnh báo chi phí mỗi tháng (USD)”: đây là mức cảnh
  báo chi phí API cho workflow trong tháng dương lịch, không phải token. Có
  mức chọn sẵn và ô USD tùy chỉnh chỉ hiện khi chọn Khác.
- `Chọn mô hình AI`: dùng preset theo mức tiết kiệm/cân bằng/chất lượng, có
  nhánh nhập ID model tùy chỉnh. “Mức sáng tạo” giải thích độ ổn định/biến thể;
  “Token đầu ra tối đa” được nêu rõ không phải tổng token.
- Soạn prompt, tạo prompt từ dữ liệu, gọi AI văn bản/JSON, phân tích ảnh/video,
  chấm điểm và duyệt đầu ra đều dùng lựa chọn cụ thể; các ô nhập tự do chỉ hiện
  khi chọn Khác hoặc khi nội dung thực sự cần mô tả thêm.
- Bổ sung cơ chế `showWhen` cho ConfigField để không làm người dùng rối bằng
  các ô tùy chỉnh khi chưa cần.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 13:43 +07:00 — Đồng bộ provider và danh mục model AI

**Phạm vi:** `app/page.tsx`, `app/globals.css`, `app/basic-node-presets.ts`,
`app/api/research/route.ts`.

- Chuẩn hóa provider của `Thiết lập AI` còn bốn lựa chọn đã xác nhận: OpenAI,
  Gemini, Claude và Ollama; một giá trị provider được dùng chung giữa bước chọn
  provider và bước chọn model.
- Đổi `Thiết lập AI` thành luồng tuần tự: chọn provider trước, rồi mới chọn
  model. Danh sách model theo provider nên một model thuộc provider khác không
  thể được chọn nhầm; nếu workflow cũ chứa model không phù hợp, Inspector báo
  lỗi tương thích rõ ràng.
- Thêm nút `Cập nhật model`: OpenAI lấy danh sách từ Models API, Gemini từ
  endpoint tương thích OpenAI, Ollama từ máy local. Danh sách vừa cập nhật được
  lưu cục bộ theo từng provider để dùng lại trong app.
- Claude dùng danh mục quản trị qua biến `ANTHROPIC_MODELS` vì luồng hiện tại
  không có API liệt kê model Claude. Khi chưa cấu hình, giao diện báo chính xác
  thay vì tự bịa danh sách mới.
- Giữ danh sách dự phòng để Inspector vẫn dùng được khi chưa cấu hình API key
  hoặc máy Ollama chưa bật; nút cập nhật luôn trả lỗi cụ thể từ provider.
- Bổ sung giao diện picker gọn gồm provider, model và nút cập nhật; ID model
  tùy chỉnh chỉ hiện khi người dùng chọn `Khác`.

**Giới hạn hiện tại:** danh mục và kiểm tra tương thích đã hỗ trợ bốn provider;
runtime gọi AI trong `app/api/research/route.ts` hiện vẫn chỉ gửi request tạo nội
dung qua OpenAI. Chưa được ghi nhận là đã chạy Gemini, Claude hoặc Ollama.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 13:45 +07:00 — Sửa provider khác và bổ sung AI local

**Phạm vi:** `app/page.tsx`, `app/globals.css`, `app/api/research/route.ts`.

- Sửa lỗi làm trang không tải khi chọn `Khác`: danh mục model nay luôn có mảng
  rỗng an toàn cho provider chưa có preset; không còn gọi `.map()` trên giá trị
  không tồn tại.
- Với `Khác`, nút cập nhật danh mục được vô hiệu hóa có chủ đích và Inspector
  hướng dẫn nhập chính xác ID model thay vì gọi nhầm API của OpenAI.
- Bổ sung provider `AI local`, tách biệt với Ollama. Nó hỗ trợ các server cục
  bộ tương thích OpenAI như LM Studio hoặc llama.cpp qua endpoint `/v1/models`;
  địa chỉ mặc định là `http://127.0.0.1:1234/v1` và có thể thay đổi trong node.
- Giữ Ollama riêng, tiếp tục đọc model đã cài từ `/api/tags`.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 13:50 +07:00 — Loại bỏ chọn provider lặp trong chọn model

**Phạm vi:** `app/page.tsx`, `app/globals.css`.

- Bỏ dropdown nhà cung cấp trong bước `Chọn mô hình AI`.
- Bước này chỉ hiển thị provider đã được thiết lập ở bước trước, sau đó liệt kê
  model tương thích và nút cập nhật danh mục. Không thể thay provider ngầm từ
  trong bước chọn model.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 15:21 +07:00 — API key một nguồn và đồng bộ model Chi tiết

**Phạm vi:** `app/page.tsx`, `app/node-specs.ts`, `app/node-contracts.ts`,
`app/port-library.ts`, `app/api/research/route.ts`.

- Thêm cổng vào `APIKey` cho `Chọn nhà cung cấp AI` và khối Cơ bản `Thiết lập
  AI`. Cổng này nhận `Text`, có nhóm Configuration, hình vuông và tương thích
  với node nhập văn bản.
- Thêm ô API key dạng mật khẩu. Chỉ một nguồn key được giữ: kết nối vào cổng
  `APIKey` sẽ xóa key nhập trực tiếp; sửa hoặc xóa key trực tiếp sẽ ngắt chính
  kết nối `APIKey`, kể cả khi nối bằng thao tác kéo nhanh.
- Nút cập nhật model dùng key trực tiếp hoặc key lấy từ node `Text` đã nối,
  trước khi dùng key môi trường. Thông báo lỗi nêu đủ ba cách cung cấp key.
- Node `Chọn mô hình AI` ở bộ Chi tiết nay dùng cùng picker model. Provider và
  API key được lấy từ node `Chọn nhà cung cấp AI` đã nối qua `AIProvider`; khi
  chưa nối, Inspector yêu cầu nối provider trước thay vì cho chọn sai.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 15:34 +07:00 — Cổng và đầu ra tối giản cho Thiết lập AI cơ bản

**Phạm vi:** `app/page.tsx`.

- Cho phép `Chọn nhà cung cấp AI` giữ cổng vào `APIKey` thay vì bị loại bởi
  quy tắc node tự cấu hình; khối Cơ bản `Thiết lập AI` vì thế cũng hiện cổng
  vào này để nối node Text.
- `Thiết lập AI` chỉ xuất `AIModel`. `AIProvider` là dữ liệu trung gian giữa
  hai node Chi tiết và không còn chiếm một cổng đầu ra ở khối Cơ bản.
- Đổi nhãn tóm tắt của khối này thành `Node cơ bản · 1 cấu hình`; không còn
  hiển thị sai là hai thao tác do người dùng phải lựa chọn.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 15:38 +07:00 — APIKey trong Cấu hình vận hành

**Phạm vi:** `app/node-specs.ts`, `app/basic-node-presets.ts`,
`app/page.tsx`, `app/research-client.ts`.

- Bổ sung primitive `Cấu hình API key`, đầu ra `APIKey`, vào nhóm Đầu vào.
- Đưa nó thành lựa chọn `API key` của node Cơ bản `Cấu hình vận hành`, cùng với
  cấu hình video, lịch chạy và webhook.
- Node có ô key dạng mật khẩu, tên ghi nhớ tùy chọn, và khi chạy trả chính chuỗi
  API key thay vì toàn bộ object cấu hình.
- Đồng bộ biểu tượng và resolver kết nối để `Thiết lập AI` có thể lấy key từ
  node cấu hình mới cũng như từ Text/biến.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt. Mốc catalog được cập nhật từ 220 lên 221 node.

## 2026-10-11 15:53 +07:00 — Xem nhanh cấu hình trên node canvas

**Phạm vi:** `app/page.tsx`, `app/globals.css`.

- Thân mỗi node nay hiển thị tối đa ba cặp tên/giá trị cấu hình đã có, để xem
  nhanh mà không cần mở Inspector. Giá trị dài được rút gọn nhưng giữ tooltip.
- API key và mọi trường mật khẩu luôn được che bằng dấu chấm; không hiển thị
  secret trên canvas.
- Di chuyển nhận diện node lên góc phải phía trên: node Chi tiết hiển thị
  `Node chi tiết`; node Cơ bản hiển thị hai dòng `Node cơ bản` và số thao tác
  hoặc bước. Riêng Thiết lập AI ghi `1 cấu hình`.
- Cập nhật chiều cao node theo số dòng xem nhanh để không đè lên cổng dữ liệu.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 15:57 +07:00 — Gọn node canvas và nén tiêu đề

**Phạm vi:** `app/page.tsx`, `app/globals.css`.

- Bỏ thanh chân node cũ `Sẵn sàng · [tên đầu ra]`: nó trùng với chấm trạng
  thái ở đầu node và các cổng đầu ra đang hiển thị.
- Thu chiều cao tối thiểu tương ứng sau khi bỏ thanh chân.
- Giảm một nửa nhịp dòng của tên node khi xuống hàng và khoảng cách đến tên
  nhóm node bên dưới, giúp tiêu đề hai dòng gọn hơn.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 16:00 +07:00 — Thông báo lỗi node tự hết và hiển thị đủ

**Phạm vi:** `app/page.tsx`, `app/globals.css`.

- Banner lỗi cấu hình trên node tự biến mất sau tối đa 5 giây, đồng nhất với
  thông báo canvas.
- Nối APIKey hoặc nhập/sửa API key trực tiếp xóa ngay lỗi cũ trên node đích.
- Banner lỗi nay tự xuống dòng, không cắt bằng dấu ba chấm; chiều cao node được
  tính theo độ dài thông báo để không che nội dung hoặc cổng.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 16:06 +07:00 — Trạng thái key qua cổng trong Inspector

**Phạm vi:** `app/page.tsx`.

- Khi `Thiết lập AI` đang nhận đầu vào `APIKey`, placeholder trong ô API key
  đổi thành `Đã kết nối key API qua cổng APIKey`; hướng dẫn nhập chỉ còn hiện
  khi ô trống và chưa có kết nối.
- Picker của `Chọn mô hình AI` Chi tiết nhận biết key được cấp từ node provider
  qua cổng và hiển thị cùng trạng thái kết nối.
- Cờ trạng thái chỉ dùng trong UI/luồng cấu hình, không làm lộ API key.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 16:09 +07:00 — Nhận diện APIKey cho workflow cũ

**Phạm vi:** `app/page.tsx`.

- Sửa nhận diện kết nối APIKey để không phụ thuộc vào mã handle cũ đã được lưu
  trong workflow trước khi cập nhật catalog cổng.
- Với node có cổng APIKey, một edge đi vào node được nhận là kết nối key; do
  đó placeholder trạng thái và picker model sẽ hoạt động với cả canvas cũ.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 16:11 +07:00 — Hiển thị đúng trạng thái key qua cổng

**Phạm vi:** `app/page.tsx`.

- Đặt placeholder trạng thái vào đúng control mật khẩu API key; bản trước chỉ
  áp dụng nhầm cho control danh sách URL nên giao diện không đổi.
- Nhận diện kết nối theo edge đi vào node đang chọn để đọc được cả canvas cũ
  có metadata cổng APIKey không đồng nhất.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 16:18 +07:00 — Thu khoảng trống dưới cổng node

**Phạm vi:** `app/page.tsx`, `app/globals.css`.

- Bỏ phần chiều cao dự phòng còn sót lại từ thanh chân node đã xóa.
- Giảm padding đáy vùng cổng từ 10px xuống 3px và chiều cao tối thiểu tương
  ứng, đưa cổng cuối sát cạnh dưới còn xấp xỉ một phần tư khoảng cách cũ.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 16:20 +07:00 — Khôi phục dịch vụ khi app không tải

**Phạm vi:** Vận hành desktop Content Flow.

- Chẩn đoán Electron vẫn chạy nhưng dịch vụ web cục bộ cổng 3000 đã dừng,
  khiến cửa sổ không thể tải nội dung.
- Khởi động lại dịch vụ production từ `support/scripts/dev-with-media.mjs` và
  xác nhận `http://127.0.0.1:3000` phản hồi HTTP 200 trước khi tải lại Electron.

**Kiểm tra:** HTTP 200, phản hồi trang chính dài 27.147 bytes.

## 2026-10-11 16:21 +07:00 — Khởi động sạch Electron và dịch vụ web

**Phạm vi:** Vận hành desktop Content Flow.

- Phát hiện restart quá nhanh khiến Electron mới dùng dịch vụ cũ, trong khi
  dịch vụ đó bị Electron trước tắt sau khi cửa sổ mới đã mở.
- Dừng đúng cặp Electron/dịch vụ cũ, chờ 2 giây trước khi mở lại để Electron
  mới tự sở hữu dịch vụ web của mình.

**Kiểm tra:** Electron PID 18212, dịch vụ cổng 3000 PID 14844, HTTP 200.

## 2026-10-11 19:03 +07:00 — Tăng nhẹ khoảng đệm dưới cổng cuối

**Phạm vi:** `app/page.tsx`, `app/globals.css`.

- Tăng khoảng cách từ cổng cuối đến cạnh dưới node từ 3px lên 4,5px (150%).
- Tăng cùng lượng trong công thức chiều cao node để khoảng đệm luôn được giữ.

**Kiểm tra:** `npm test` — build Vinext thành công, 16/16 kiểm tra đạt.

## 2026-10-11 19:11 +07:00 — Thực thi thật cho node tạo Prompt AI

**Phạm vi:** `app/research-client.ts`, `support/tests/content-engine.test.mjs`.

- Thêm bộ thực thi cho `Soạn system prompt`: tạo SystemPrompt từ vai trò, quy
  tắc, định dạng đầu ra và ngữ cảnh văn bản (nếu có).
- Thêm bộ thực thi cho `Tạo prompt từ dữ liệu`: ghép mẫu, dữ liệu đầu vào và
  yêu cầu bổ sung thành chuỗi Prompt thật, gồm cả mẫu tùy chỉnh `{{data}}`.
- Thêm kiểm tra chống hồi quy để hai node không rơi lại vào output mô phỏng.

**Kiểm tra:** `npm test` — build Vinext thành công, 17/17 kiểm tra đạt.

## 2026-10-11 19:15 +07:00 — Chặn output mô phỏng thành công

**Phạm vi:** `app/research-client.ts`, `support/tests/content-engine.test.mjs`.

- Rà soát runtime và loại bỏ fallback từng trả JSON mô phỏng nhưng vẫn gắn
  trạng thái thành công cho mọi node không có executor.
- Node chưa có bộ thực thi nay dừng với lỗi nêu rõ tên node, nhóm node và việc
  không tạo output mô phỏng; không còn thể hiện là chạy thành công.
- Thêm kiểm tra chống hồi quy cho một node render chưa có executor.

**Kiểm tra:** `npm test` — build Vinext thành công, 18/18 kiểm tra đạt.

## 2026-10-11 19:29 +07:00 — Phân biệt node có và chưa có executor

**Phạm vi:** `app/node-execution.ts`, `app/page.tsx`, `app/globals.css`,
`app/research-client.ts`, `support/tests/content-engine.test.mjs`.

- Tạo registry năng lực thực thi dùng chung cho node Chi tiết và từng bước của
  node Cơ bản.
- Tô đỏ sáng tên node chưa có executor thật trong thư viện và bảng thêm nhanh;
  node Cơ bản cũng đỏ nếu có bất kỳ bước nào chưa chạy được.
- Bổ sung executor cấu hình cho chọn nhà cung cấp/model AI và sửa nhận diện sáu
  node phân tích video theo tên hiển thị trên canvas.
- Thêm kiểm tra registry để không thể nhầm node có executor với node bị chặn.

**Kiểm tra:** `npm test` — build Vinext thành công, 19/19 kiểm tra đạt.

## 2026-10-11 19:36 +07:00 — Căn lại vị trí hình cổng node

**Phạm vi:** `app/globals.css`.

- Nâng hình cổng vào/ra lên 2px để tâm hình cổng thẳng hàng hơn với baseline
  của nhãn cổng, không thay đổi vị trí text hay khoảng cách vùng cổng.

**Kiểm tra:** `npm test` — build Vinext thành công, 19/19 kiểm tra đạt.

## 2026-10-11 20:56 +07:00 — Đổi tên node gọi AI theo loại dữ liệu

**Phạm vi:** `app/basic-node-presets.ts`, `app/page.tsx`.

- Đổi node Cơ bản `Gọi AI` thành `Xử lý văn bản bằng AI` để thể hiện rõ node
  chỉ nhận Prompt/SystemPrompt và AIModel, không nhận media trực tiếp.
- Giữ nguyên hai thao tác tạo văn bản và JSON; workflow cũ có tên `Gọi AI`
  được tự đổi tên khi mở lại nhưng không mất cấu hình hay kết nối.

**Kiểm tra:** `npm test` — build Vinext thành công, 19/19 kiểm tra đạt.

## 2026-10-11 21:06 +07:00 — Thực thi node AI và kiểm tra workflow trước khi chạy

**Phạm vi:** `app/research-client.ts`, `app/api/research/route.ts`,
`app/node-execution.ts`, `app/page.tsx`, `support/tests/content-engine.test.mjs`.

- Bổ sung executor thật cho Gọi AI tạo văn bản, Gọi AI trả JSON, Phân tích hình
  ảnh bằng AI và Phân tích video bằng AI. Văn bản/JSON gọi OpenAI Responses;
  ảnh gửi ảnh thật đến Vision; video phiên âm tệp rồi phân tích transcript.
- API key được truyền từ Cấu hình API key qua Thiết lập AI và AIModel đến lời
  gọi API; không còn yêu cầu chỉ dùng biến môi trường đối với các executor mới.
- Thêm nút và mục menu **Kiểm tra**. Kiểm tra rà soát executor, cổng bắt buộc,
  thao tác chưa chọn và API key trước khi chạy; Chạy workflow tự chặn khi còn
  vấn đề và chọn node lỗi đầu tiên.

**Kiểm tra:** `npm test` — build Vinext thành công, 19/19 kiểm tra đạt.

## 2026-10-11 21:12 +07:00 — Phím tắt kiểm tra và chạy workflow

**Phạm vi:** `app/page.tsx`.

- Gán `Ctrl+E` cho **Kiểm tra workflow**.
- Đổi chạy workflow từ `Ctrl+Enter` sang `Ctrl+R`, đồng thời chặn hành vi tải
  lại trang mặc định của trình duyệt.
- Đồng bộ nhãn menu, tooltip, Trợ giúp và thanh trạng thái với hai phím tắt mới.

## 2026-10-12 09:13 +07:00 — Đưa kết quả phân tích AI vào luồng xử lý tiếp

**Phạm vi:** `app/node-contracts.ts`, `app/node-specs.ts`,
`app/port-library.ts`, `app/research-client.ts`, `app/node-execution.ts`.

- Giữ kiểu cổng nội bộ `AIAnalysis` nhưng hiển thị là **Kết quả phân tích AI**.
- Cho phép `AIAnalysis` nối vào `Dữ liệu` của **Tạo prompt từ dữ liệu**. Kết quả
  phân tích vì thế có thể tạo Prompt mới để đưa sang **Xử lý văn bản bằng AI**.
- Thêm `AIAnalysis` vào đầu vào của Chấm điểm đầu ra AI và Duyệt đầu ra AI;
  bổ sung executor thật cho hai node này để chấm và quyết định duyệt theo ngưỡng.

**Kiểm tra:** `npm test` — build Vinext thành công, 19/19 kiểm tra đạt.

## 2026-10-12 09:23 +07:00 — Chuẩn hóa hợp đồng cổng và sao chép canvas

**Phạm vi:** `app/node-contracts.ts`, `app/port-library.ts`, `app/page.tsx`,
`support/tests/content-engine.test.mjs`.

- Chuẩn hóa mọi cổng theo ba loại: **Free** (nhận dữ liệu tự do), **InGroup**
  (chỉ cùng nhóm) và **Define** (chỉ kiểu định nghĩa chính xác). Cổng Define
  có thể đi vào InGroup cùng nhóm hoặc Free; chiều ngược lại không được phép.
- Cập nhật biểu tượng, tooltip và bộ lọc khi nhấp tên cổng để bộ lọc dùng cùng
  luật kết nối, bao gồm các cổng InGroup/Free hợp lệ.
- Thêm `Ctrl+C`/`Ctrl+V` để sao chép các node đã chọn và toàn bộ lane nội bộ
  giữa chúng; node dán được lệch vị trí và có ID mới, không mang trạng thái run.

**Kiểm tra:** `npm test` — build Vinext thành công, 19/19 kiểm tra đạt.

## 2026-10-12 12:49:46 +07:00 — Node xem dữ liệu trên canvas

**Phạm vi:** Node đầu cuối trong Quản lý dữ liệu, có ở thư viện Cơ bản lẫn Chi tiết.

- Thêm `Xem dữ liệu trên canvas`: nhận cổng `Dữ liệu bất kỳ`, không có đầu ra để xác định rõ đây là node cuối workflow.
- Bổ sung executor thật để nhận dữ liệu, lưu lần xem và hiển thị trực tiếp Text, JSON, hình ảnh, âm thanh hoặc video trong chính node trên canvas.
- File đầu vào hiện mang URL preview tạm thời theo phiên chạy để media có thể phát/xem tại node; dữ liệu workflow lưu vẫn chỉ gồm metadata.

**Kiểm tra:** `npm test` — build Vinext thành công, 21/21 kiểm tra đạt.

## 2026-10-12 13:02:53 +07:00 — Chỉnh đúng chức năng phân tích media bằng AI

**Phạm vi:** Làm rõ tuyệt đối sự khác nhau giữa phân tích âm thanh và phân tích thị giác video.

- Loại bỏ node có tên gây hiểu nhầm `Phân tích video bằng AI`: executor cũ chỉ phiên âm audio từ video và chưa từng đọc khung hình.
- Thay bằng `Phân tích âm thanh bằng AI`, chỉ nhận cổng Audio và thông báo rõ đây là phân tích transcript âm thanh.
- Đổi node cơ bản thành `Phân tích ảnh hoặc âm thanh bằng AI`; workflow cũ được tự đổi tên, cổng Video cũ không còn được chấp nhận nhầm là Audio.
- Giữ `Phân tích nội dung video` là pipeline thị giác riêng: nó lập chỉ mục frame, dựng storyboard có timecode và gửi các ảnh frame tới model thị giác để phân tích cảnh.

**Kiểm tra:** `npm test` — build Vinext thành công, 21/21 kiểm tra đạt.

## 2026-10-12 14:43:36 +07:00 — Node Trích frame từ video

**Phạm vi:** Nhóm Video, thư viện Cơ bản và Chi tiết.

- Thêm node `Trích frame từ video`: nhận Video, lấy frame cục bộ theo frame định kỳ và điểm thay đổi hình ảnh, rồi xuất `Image[]` kèm timecode, tên video và thời lượng nguồn.
- Bổ sung các lựa chọn rõ ràng: mức lấy mẫu, khoảng quét thay đổi, độ nhạy, giới hạn frame và vùng ưu tiên.
- Mỗi file video dùng runtime key riêng khi trích frame để nhiều video trong cùng một node không ghi đè frame của nhau.
- Frame đầu ra nối trực tiếp được tới node phân tích hình ảnh bằng AI hoặc node xem dữ liệu trên canvas.

**Kiểm tra:** `npm test` — build Vinext thành công, 21/21 kiểm tra đạt.

## 2026-10-12 14:48:13 +07:00 — Tạm ngưng node

**Phạm vi:** Canvas, kiểm tra workflow và runtime.

- Thêm trạng thái `Tạm ngưng` cho node. Dùng `Ctrl+P` hoặc menu Workflow để bật/tắt node đang chọn.
- Node tạm ngưng có beacon tím, viền tím nét đứt và nhãn trạng thái rõ ràng; runtime bỏ qua hoàn toàn node này.
- Kiểm tra workflow không đánh lỗi chính node bị tạm ngưng. Nếu node sau cần dữ liệu từ node đang tạm ngưng, node sau sẽ được đánh dấu thiếu dữ liệu để tránh chạy với output giả hoặc cũ.
- Khi chạy, thông báo cuối ghi rõ số node đã bị bỏ qua vì tạm ngưng.

**Kiểm tra:** `npm test` — build Vinext thành công, 21/21 kiểm tra đạt.

## 2026-10-12 19:23:43 +07:00 — Nút tạm ngưng trong Properties

**Phạm vi:** Hàng tiêu đề Properties.

- Thay chữ trạng thái `Node` bằng nút bật/tắt node đang chọn.
- Nút đồng bộ với `Ctrl+P`, hiển thị chấm xanh khi node đang hoạt động và chấm tím khi node đang tạm ngưng.

**Kiểm tra:** `npm test` — build Vinext thành công, 21/21 kiểm tra đạt.

## 2026-10-12 19:34:38 +07:00 — Bỏ beacon khỏi nút Properties

**Phạm vi:** Nút bật/tắt node trong hàng Properties.

- Loại bỏ chấm màu khỏi nút `Tạm ngưng`/`Bật node`; beacon trạng thái chỉ hiển thị trên node canvas.

**Kiểm tra:** `npm test` — build Vinext thành công, 21/21 kiểm tra đạt.

## 2026-10-12 19:56:18 +07:00 — Beacon tạm ngưng

**Phạm vi:** Hiển thị node tạm ngưng trên canvas.

- Khôi phục hoàn toàn viền và nền node như trạng thái thông thường; tạm ngưng chỉ thay đổi beacon.
- Đổi beacon tạm ngưng sang tím đậm để phân biệt rõ hơn.

**Kiểm tra:** `npm test` — build Vinext thành công, 21/21 kiểm tra đạt.

## 2026-10-12 20:52:35 +07:00 — Beacon tạm ngưng xanh dương

**Phạm vi:** Beacon trạng thái tạm ngưng trên canvas.

- Đổi beacon tạm ngưng từ tím sang xanh dương sáng; không thay đổi viền hoặc nền node.

**Kiểm tra:** `npm test` hoàn tất: 21/21 bài kiểm tra đạt.

## 2026-10-12 20:54:52 +07:00 — Beacon tạm ngưng dùng tím workflow

**Phạm vi:** Beacon trạng thái tạm ngưng trên canvas.

- Đổi màu beacon tạm ngưng sang `#7c4dff`, trùng màu nhận diện chữ node cơ bản của nhóm Điều khiển workflow.
- Giữ nguyên viền chọn, nền node và các trạng thái beacon khác.

**Kiểm tra:** `npm test` hoàn tất: 21/21 bài kiểm tra đạt.

## 2026-10-12 21:04:26 +07:00 — Viền beacon tạm ngưng trung tính

**Phạm vi:** Beacon trạng thái tạm ngưng trên canvas.

- Giữ tâm beacon tím `#7c4dff` của nhóm Điều khiển workflow.
- Đổi viền sáng bao quanh về xám trung tính, cùng hệ với trạng thái `uncheck`, để màu tâm nổi bật hơn.

**Kiểm tra:** `npm test` hoàn tất: 21/21 bài kiểm tra đạt.

## 2026-10-12 21:05:13 +07:00 — Chuẩn hóa viền beacon

**Phạm vi:** Toàn bộ beacon trạng thái node trên canvas.

- Cố định viền sáng xám trung tính cho mọi trạng thái beacon.
- Mỗi trạng thái chỉ thay đổi màu chấm ở giữa: chưa kiểm tra, thiếu, sẵn sàng, lỗi và tạm ngưng.

**Kiểm tra:** `npm test` hoàn tất: 21/21 bài kiểm tra đạt.

## 2026-10-12 21:26:03 +07:00 — Tạm ngưng nhiều node bằng Ctrl+P

**Phạm vi:** Lệnh tạm ngưng/bật node đang chọn.

- Ctrl+P và nút tạm ngưng trong Properties hiện áp dụng cho toàn bộ node đang được chọn trên canvas.
- Nếu vùng chọn còn tối thiểu một node hoạt động, lệnh tạm ngưng tất cả node trong vùng đó.
- Chỉ khi toàn bộ node được chọn đã tạm ngưng, lệnh mới bật lại tất cả.
- Thông báo cho biết số node đã đổi trạng thái; hành vi với một node giữ nguyên.

**Kiểm tra:** `npm test` hoàn tất: 21/21 bài kiểm tra đạt.

## 2026-10-12 21:28:43 +07:00 — Kiểm tra thao tác node cơ bản

**Phạm vi:** Xác thực node cơ bản có chế độ chọn thao tác.

- Sửa kiểm tra để giá trị mặc định `Không thao tác` được tính là thiếu, tương tự thao tác rỗng.
- Node cơ bản chưa chọn thao tác giờ nhận beacon `miss` và hiển thị lỗi “chưa chọn thao tác”; không thể báo sẵn sàng.
- Thêm kiểm tra hồi quy cho điều kiện `Không thao tác`.

**Kiểm tra:** `npm test` hoàn tất: 21/21 bài kiểm tra đạt.

## 2026-10-12 21:35:29 +07:00 — Chuyển ảnh từ Nguồn file sang AI

**Phạm vi:** Bộ thực thi nguồn ảnh và node AI phân tích ảnh.

- Sửa bộ thực thi `Tải ảnh từ máy` để xuất asset runtime `Image[]`, thay vì trả cấu hình node.
- Khối `Nguồn file` với thao tác `Hình ảnh` giờ chuyển đúng file ảnh đã chọn vào bước `Phân tích hình ảnh bằng AI`.
- Thêm kiểm tra hồi quy cho đường truyền ảnh qua node cơ bản.

**Kiểm tra:** `npm test` hoàn tất: 22/22 bài kiểm tra đạt.

## 2026-10-12 21:39:22 +07:00 — Hiển thị khả năng model AI

**Phạm vi:** Thiết lập model và gọi Responses API.

- Thêm bảng khả năng theo model: văn bản/JSON, phân tích ảnh, phân tích âm thanh và tham số reasoning.
- Bảng phân biệt rõ `Dùng được`, `Không hỗ trợ` và `Chưa xác minh`; âm thanh ghi rõ app phiên âm trước rồi gửi transcript cho model.
- Chặn sớm model đã biết không nhận ảnh, với thông báo hướng dẫn chọn model phù hợp.
- Chỉ gửi `reasoning.effort` cho GPT-5 và o-series; sửa lỗi OpenAI báo tham số này không hỗ trợ ở các model như GPT-4.1.
- Thêm kiểm tra hồi quy cho suy luận khả năng model.

**Kiểm tra:** `npm test` hoàn tất: 23/23 bài kiểm tra đạt.

## 2026-10-12 21:43:14 +07:00 — Làm mới lỗi cũ khi đổi cấu hình AI

**Phạm vi:** Kết quả và trạng thái của node phụ thuộc cấu hình AI.

- Khi đổi nhà cung cấp, model, ID model tùy chỉnh hoặc API key, app truy vết các node ở phía sau qua lane.
- Xóa output/lỗi cũ của các node phụ thuộc, đặt lại beacon thành chưa kiểm tra và nhắc người dùng kiểm tra rồi chạy lại.
- Nhờ đó lỗi từ model trước không tiếp tục hiển thị sau khi đã đổi model.

**Kiểm tra:** `npm test` hoàn tất: 23/23 bài kiểm tra đạt.

## 2026-10-12 21:46:51 +07:00 — Đồng bộ route thực thi với khả năng model

**Phạm vi:** API `/api/research` dùng để chạy node AI và phân tích hình ảnh.

- Xác định app đang thực thi route `app/api/research/route.ts`; route này trước đó vẫn luôn gửi `reasoning.effort`, trái với bảng khả năng model.
- Chỉ thêm `reasoning.effort` cho GPT-5 và o-series ở cả luồng văn bản lẫn phân tích ảnh; GPT-4.1 và GPT-4.1-nano sẽ không nhận tham số này.
- Thêm kiểm tra hồi quy để ngăn route thực thi quay lại gửi reasoning vô điều kiện.

**Kiểm tra:** `npm test` hoàn tất: 24/24 bài kiểm tra đạt.

## 2026-10-12 21:56:40 +07:00 — Mức verbosity theo model AI

**Phạm vi:** Request Responses API cho node văn bản và phân tích hình ảnh.

- `gpt-4.1-nano` báo chỉ nhận `medium`, trong khi route đang cố gửi `text.verbosity: low`.
- Bổ sung quy tắc theo model: riêng `gpt-4.1-nano` gửi `medium`; các model còn lại giữ `low` để kết quả ngắn gọn.
- Áp dụng thống nhất cho cả gọi AI văn bản và phân tích ảnh, có kiểm tra hồi quy cho quy tắc này.

**Kiểm tra:** `npm test` hoàn tất: 24/24 bài kiểm tra đạt.

## 2026-10-12 22:04:45 +07:00 — Node xem dữ liệu thuần túy và vùng xem mở rộng

**Phạm vi:** Node `Xem dữ liệu trên canvas`.

- Bỏ toàn bộ cấu hình riêng của node xem dữ liệu, gồm phần “Chưa có cấu hình” trên canvas và form cấu hình trong Properties.
- Node chỉ nhận dữ liệu nối vào để hiển thị Text, JSON, ảnh, âm thanh hoặc video trực tiếp.
- Thêm nút `Mở rộng` trong vùng dữ liệu; khi bật, vùng xem rộng gấp đôi và cao gấp đôi. Nút chuyển thành `Thu gọn` để đưa node về kích thước ban đầu.
- Trạng thái mở rộng được lưu theo node trong workflow.

**Kiểm tra:** `npm test` hoàn tất: 24/24 bài kiểm tra đạt.

## 2026-10-12 22:06:49 +07:00 — Tách nút mở rộng khỏi khung dữ liệu

**Phạm vi:** Vùng xem của node `Xem dữ liệu trên canvas`.

- Chuyển nút Mở rộng/Thu gọn thành một hàng riêng ngay phía trên khung xem.
- Nút không còn phủ lên nội dung text, JSON, ảnh, âm thanh hoặc video.
- Giữ nguyên vùng dữ liệu 102px khi thu gọn và 204px khi mở rộng.

**Kiểm tra:** `npm test` hoàn tất: 24/24 bài kiểm tra đạt.

## Mẫu mục cho thay đổi tiếp theo

## 2026-10-13 11:04:15 +07:00 — Chuỗi tạo tiêu đề và thumbnail

**Phạm vi:** Node `Tạo tiêu đề`, `Bố cục thumbnail bằng AI`, `Ghép chữ lên thumbnail` và dịch vụ media cục bộ.

- `Tạo tiêu đề` gọi OpenAI với bản tóm tắt/Script, số phương án, độ dài và từ khóa bắt buộc; output chứa các tiêu đề cùng usage thực tế.
- Thêm node `Bố cục thumbnail bằng AI`, nhận ảnh, tiêu đề và AIModel để trả bố cục chữ JSON dựa trên ảnh thực.
- Thêm node `Ghép chữ lên thumbnail` và endpoint `/render-thumbnail`: FFmpeg đặt chữ theo bố cục lên ảnh 1280×720 rồi lưu JPG thật theo tên/thư mục đã chọn.

**Kiểm tra:** `npm test` đạt 24/24. OpenAI tạo 3 tiêu đề thật bằng `gpt-4.1-nano` (297 token). Sau khi người dùng cho phép gửi `image 1.jpg`, AI trả bố cục theo ảnh thật (lượt cuối: 3.945 token) và endpoint cục bộ xuất `test-row11-thumbnail-final.jpg`, JPG 1280×720, 297.770 byte. Bố cục AI có thể trả tên vùng hoặc tọa độ %, runtime chuẩn hóa cả hai để ghép ảnh.

## 2026-10-13 10:44:37 +07:00 — Dựng video cục bộ: cắt, nối, nhạc nền và lưu tệp

**Phạm vi:** Node `Cắt video`, `Nối video`, `Ghép các cảnh`, `Thêm nhạc nền`, `Lưu file` và dịch vụ media cục bộ.

- Thêm endpoint cục bộ `/render-video` dùng FFmpeg cho bốn thao tác thực: cắt đoạn, nối video, trộn nhạc nền và sao chép/lưu video đầu ra.
- Runtime chỉ nhận đường dẫn của tệp người dùng đã chọn; video và nhạc không được gửi tới AI hay tạo output mô phỏng.
- Thêm cấu hình có nghĩa cho điểm cắt, âm lượng nhạc, tên tệp và thư mục lưu. Node `Lưu file` nhận trực tiếp `Video hoặc File` để có thể nối từ pipeline video.
- Đăng ký executor cho cả Canvas Cơ bản và Chi tiết; output giữ runtime asset của video vừa tạo để nối tiếp hoặc xem trên canvas.

**Kiểm tra:** `npm test` đạt 24/24. FFprobe xác nhận: cắt 1–5 giây tạo MP4 4,013 giây; nối hai video ngắn tạo MP4 54,967 giây; trộn hai nhạc nền ở 30% tạo MP4 16,600 giây với audio AAC; lưu tệp tạo bản sao cùng 16,600 giây.

## 2026-10-13 10:01:56 +07:00 — Khôi phục nạp tệp qua Content Flow Desktop

**Phạm vi:** Cầu nối Electron giữa Properties và tệp trên máy.

- Công khai lại `pickFiles` và `readFiles` trong preload, vốn đã có handler ở tiến trình desktop nhưng không đến được giao diện.
- Node nguồn file có thể chọn tệp bằng hộp thoại desktop và nạp lại tệp đã lưu theo đường dẫn khi chạy workflow.

**Kiểm tra:** `node --check desktop/preload.mjs` và `npm test` hoàn tất: 24/24 bài kiểm tra đạt.

## 2026-10-13 16:55:25 +07:00 — Trích frame trả ảnh thật và chỉ mục riêng

**Phạm vi:** Node `Trích frame từ video`, hợp đồng cổng video và node `Xem dữ liệu trên canvas`.

- Tách đầu ra thành `Image[]` và `FrameIndex`: ảnh frame có `previewUrl` để dùng/xem trực tiếp; chỉ mục giữ timestamp, timecode, lý do lấy frame và tham chiếu runtime.
- Bổ sung executor đa cổng để metadata không còn bị trả nhầm vào cổng `Image[]`.
- Node xem dữ liệu nhận mảng ảnh sẽ hiển thị gallery có nút trước/sau, số frame và timecode; khi nối `FrameIndex` nó vẫn hiển thị JSON đúng nghĩa.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-13 17:10:15 +07:00 — Khóa chiều cổng và mở rộng vùng kéo dây

**Phạm vi:** React Flow handles trên canvas, gồm cổng `Video[]` của node `Nguồn file`.

- Cổng input chỉ được dùng làm điểm kết thúc; cổng output chỉ được dùng làm điểm bắt đầu. Điều này loại bỏ trường hợp kéo ngược vào cổng nguồn báo nối nhưng không tạo edge hợp lệ.
- Tăng hitbox cổng từ 12 px lên 20 px, giữ glyph 12 px để giao diện không phình nhưng thao tác kéo chính xác hơn.
- Xác nhận hợp đồng `Video[] → Video` là tương thích exact cùng nhánh `data/video`.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-13 17:18:59 +07:00 — Căn lại glyph cổng trong vùng kéo

**Phạm vi:** Hiển thị cổng trên canvas.

- Căn giữa glyph 12 px trong hitbox 20 px đã thêm ở bản sửa kéo dây, khôi phục vị trí thẳng hàng với nhãn cổng mà vẫn giữ vùng kéo rộng.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-13 17:21:03 +07:00 — Đầu dây chạm đúng tâm cổng

**Phạm vi:** Hình học handle và line trên canvas.

- Khôi phục handle đo bởi React Flow về 12 px, trùng với glyph để hai đầu line bám sát cổng.
- Giữ hitbox kéo 20 px bằng pseudo-element vô hình, không làm thay đổi tọa độ đầu dây.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-13 17:36:08 +07:00 — Nạp video lớn theo đường dẫn cục bộ

**Phạm vi:** Node nguồn file trong Content Flow Desktop và runtime media cục bộ.

- File lớn hơn 128 MB không còn được đọc toàn bộ thành Buffer rồi chuyển qua Electron IPC; app chỉ giữ tên, MIME, dung lượng và đường dẫn cục bộ.
- Node trích frame, phiên âm video, cắt/nối/render tiếp tục truyền đường dẫn thẳng cho dịch vụ FFmpeg cục bộ, nên dùng được video nhiều GB mà không chạm giới hạn Buffer 2 GiB.
- Chặn rõ các thao tác cố upload asset chỉ-đường-dẫn lên API, thay vì gửi File rỗng; người dùng được hướng dẫn dùng node media cục bộ hoặc trích frame trước.

**Kiểm tra:** `npm test` — build thành công, 24/24 bài kiểm tra đạt; `node --check desktop/main.mjs` đạt.

## 2026-10-13 22:18:46 +07:00 — Ba mức xem dữ liệu trên canvas

**Phạm vi:** Node `Xem dữ liệu trên canvas`.

- Thêm trạng thái `compact`, `expanded`, `maximized` cho vùng dữ liệu.
- Một nút duy nhất chạy theo chu kỳ: Mở rộng → Cực đại → Thu gọn.
- Mức cực đại có chiều rộng 920 px và vùng dữ liệu cao 408 px, đúng bằng hai lần mức mở rộng 460 px × 204 px; workflow cũ mở rộng vẫn được migrate sang mức giữa.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-13 22:37:53 +07:00 — Tạm dừng, tiếp tục và dừng workflow

**Phạm vi:** Điều khiển chạy workflow, phím tắt và trạng thái trực quan của node.

- `Ctrl+R` và nút Chạy nay dùng chung một chu kỳ: bắt đầu khi rảnh, tạm dừng khi đang chạy, tiếp tục khi đang tạm dừng. Thanh menu và thanh công cụ canvas phản ánh đúng hành động hiện tại.
- Thêm nút Dừng và phím tắt `Ctrl+T`. Dừng hủy các node đang chờ; thao tác API hoặc FFmpeg đã khởi động được khép lại ở điểm an toàn rồi workflow kết thúc, không mở thêm bước mới.
- Node đang xử lý có beacon xanh dương và glow xanh dương. Khi thực hiện thành công, glow tắt và beacon trở về xanh lục. Cơ chế dùng trạng thái riêng trên từng node nên hỗ trợ đồng thời nhiều node đang chạy.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-13 23:37:19 +07:00 — Pipeline highlight và thumbnail từ tư liệu thật

**Phạm vi:** Nghiên cứu video, dựng video cục bộ, kho ảnh và thumbnail AI.

- Thêm node `Tải kho ảnh từ thư mục`, `Chọn highlight bằng AI`, `Dựng video highlight` và `Chọn ảnh thumbnail bằng AI`; các cổng dùng đúng kiểu `Image[]`, `VideoAnalysis`, `HighlightPlan`, `Video`.
- `Chọn highlight bằng AI` chỉ nhận timecode có bằng chứng, chuẩn hóa thứ tự/không chồng đoạn và giới hạn tổng video ở 420 giây; `Dựng video highlight` dùng FFmpeg cục bộ để cắt và nối, không tải video nhiều GB lên AI.
- Kho ảnh chỉ nạp đường dẫn cục bộ, lọc tối đa số ảnh cấu hình rồi mới đọc các ảnh được chọn để gửi AI. Ảnh được chọn mang `suggestedText`, nên node bố cục có thể dùng luôn mà không bắt buộc thêm node tạo tiêu đề.
- Thêm sổ cái token theo từng lần chạy, reset khi bắt đầu workflow; giới hạn cứng cấu hình là 40.000 input và 20.000 output token. Dữ liệu transcript, phân cảnh, báo cáo và ảnh ứng viên được cắt theo ngân sách mặc định.
- Renderer thumbnail không còn ép ảnh về 1280×720; nó giữ nguyên kích thước pixel của ảnh nguồn và chỉ phủ box/chữ theo kích thước ảnh.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt. Dịch vụ cục bộ đã nạp được kho ảnh `D:\\Youtube\\Ảnh`; thumbnail thử nghiệm giữ nguyên `1215×717`; video `videos long.mp4` dung lượng `5,938,954,222` byte đã dựng được clip highlight `3.02` giây tại `C:\\Users\\Owner\\Desktop\\Test-Media\\Content Flow Output\\highlight-smoke.mp4`.

## 2026-10-14 00:00:39 +07:00 — Chạy thành phẩm highlight và thumbnail final

**Phạm vi:** Khởi động API, tương thích model, render thumbnail và đầu ra thực tế.

- Launcher nay nạp `.env` vào tiến trình cha trước khi mở Vinext và dịch vụ media, nên `OPENAI_API_KEY` được API text/vision và phiên âm dùng chung; không ghi key vào log.
- Tách hai tham số Responses API: GPT-4.1 dùng `verbosity=medium`, còn `detail` ảnh được chuẩn hóa về `low`, `high` hoặc `auto`. Điều này ngăn lỗi tham số khi node chạy model GPT-4.1.
- Sửa renderer thumbnail: dùng `ih` cho vị trí nền `drawbox` và `h` cho vị trí chữ `drawtext`, nên khung nền nằm đúng sau chữ thay vì trôi lên đầu ảnh.
- Chạy pipeline thật với `gpt-4.1-mini`: 24 frame, transcript 3 đoạn, phân tích frame/lời nói, chọn 4 đoạn highlight, dựng video và chọn/đặt chữ thumbnail. Transcript được cache cục bộ để các lần chạy tiếp theo không phiên âm lại.

**Kết quả:** `video-highlight-final.mp4` dài `289.06` giây, H.264/AAC, `211,154,802` byte; `thumbnail-final.jpg` giữ nguyên `915×540` từ ảnh nguồn. AI dùng `15,579` input và `1,788` output token, dưới giới hạn `40,000`/`20,000`.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt; kiểm tra trực quan thumbnail final đạt.

## 2026-10-14 00:18:00 +07:00 — Popup mở workflow gần đây

**Phạm vi:** Nút `Mở`, phím tắt `Ctrl+O` và menu Tệp.

- Thao tác Mở giờ hiện popup trước, liệt kê tối đa năm workflow đã mở gần nhất theo thứ tự mới nhất trước; tên workflow và đường dẫn đầy đủ được giữ để phân biệt các bản cùng tên.
- Mỗi workflow được mở thành công tự lên đầu danh sách. Danh sách được lưu riêng trong localStorage, không làm thay đổi tệp workflow; workflow cũ thứ sáu tự rời danh sách.
- Nút `Tìm workflow…` nằm cuối popup mới gọi hộp chọn file hệ thống. Thêm IPC Electron đọc trực tiếp workflow gần đây theo đường dẫn, nên chọn một mục gần đây không phải tìm lại tệp.
- Nếu tệp đã bị đổi tên, xóa hoặc không đọc được, mục đó tự bị bỏ khỏi danh sách và thông báo lỗi rõ ràng. Escape, Hủy và nút × đều đóng popup.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-14 10:05:00 +07:00 — Sửa mở workflow gần đây và lưới hai cột

**Phạm vi:** Popup `Mở workflow`.

- Tăng lịch sử từ năm lên sáu workflow; danh sách dùng lưới hai cột nên mỗi ô còn nửa bề ngang popup và mỗi hàng hiển thị hai workflow khác nhau.
- Xác nhận trực tiếp tệp `C:\Users\Owner\Desktop\Test-Media\Content Flow 2.json` trong danh sách có tồn tại và JSON hợp lệ.
- Sửa trường hợp cửa sổ Electron đang chạy preload cũ: khi chưa có `openRecentWorkflow`, giao diện tự dùng `readFiles` đã có sẵn để đọc và parse JSON theo đường dẫn gần đây. Vì vậy không cần chọn tệp lại hoặc phụ thuộc vào lần khởi động Electron trước đó.
- Nếu tệp thật sự không thể đọc, lý do được hiển thị ngay trong popup và mục lỗi bị bỏ khỏi lịch sử.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt; web `127.0.0.1:3000` và media health đều trả `200`.

## 2026-10-14 10:12:00 +07:00 — Mở workflow phải mở lại canvas

**Phạm vi:** Luồng nạp workflow khi canvas đang đóng.

- Xác định từ trạng thái giao diện: workflow có thể được nạp nhưng `canvasClosed` còn giữ `true`, khiến màn hình “Canvas đã đóng” che toàn bộ canvas và tạo cảm giác mở tệp thất bại.
- Đưa `setCanvasClosed(false)` vào điểm dùng chung `loadWorkflowData`. Do đó mở workflow gần đây, tìm tệp workflow và import JSON đều chỉ hoàn tất khi canvas được hiện lại.
- Bổ sung kiểm thử tĩnh cho bất biến này.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-14 10:28:00 +07:00 — Ctrl+Shift+W đóng workflow hoàn chỉnh

**Phạm vi:** Ngữ nghĩa đóng workflow và giao diện khi không có workflow đang mở.

- Đổi `Ctrl+Shift+W` và lệnh Xem từ “Đóng canvas” thành “Đóng workflow”.
- Khi đóng, canvas, thư viện node, Properties, thanh trạng thái, tên workflow, menu và các nút điều khiển workflow đều bị gỡ khỏi giao diện. Chỉ còn thương hiệu ứng dụng và màn hình tạo mới/mở workflow.
- Đóng workflow cũng đóng tìm node, popup workflow, lọc/kết nối đang chờ, bỏ chọn node và yêu cầu workflow đang chạy dừng ở điểm an toàn.
- Mở workflow thành công hoặc tạo workflow mới vẫn luôn đưa toàn bộ vùng làm việc trở lại.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-14 10:36:00 +07:00 — Giữ menu ứng dụng khi workflow đóng

**Phạm vi:** Thanh menu khi không có workflow đang mở.

- Khôi phục đầy đủ menu ứng dụng `Tệp`, `Chỉnh sửa`, `Workflow`, `Xem`, `Trợ giúp`; chỉ tên workflow và dãy nút hành động của workflow được ẩn.
- `Tệp → Workflow mới`, `Tệp → Mở workflow` và `Trợ giúp` vẫn hoạt động khi workflow đóng.
- Các mục cần tài liệu workflow như lưu, xuất, chỉnh node, kiểm tra, chạy, xem canvas và đóng workflow được hiển thị nhưng bất hoạt. Phím tắt ngoài `Ctrl+N` và `Ctrl+O` cũng bị chặn trong trạng thái này.

**Kiểm tra:** `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-14 10:52:00 +07:00 — Đồng bộ tên workflow và tên tệp

**Phạm vi:** Mở, Lưu và Lưu mới workflow desktop.

- Khi mở workflow từ tệp, tên hiển thị luôn lấy từ tên tệp (bỏ `.json` hoặc `.contentflow.json`), thay vì giữ một tên JSON cũ có thể khác tên tệp.
- Khi đổi tên workflow rồi Lưu, tệp hiện tại được chuyển sang tên đó trong cùng thư mục. Nếu tên đã tồn tại, ứng dụng tự chọn `Tên (2).json`, `Tên (3).json`… và đưa tên thực tế đó trở lại workflow.
- Workflow chưa lưu dùng tên đang hiển thị làm tên đề xuất khi Lưu. Nếu người dùng chọn tên khác trong hộp Lưu, tên workflow lập tức đồng bộ sang tên tệp được chọn.
- Lưu mới luôn chuyển workflow sang tệp mới; tệp trước đó được giữ nguyên. Lịch sử workflow gần đây được cập nhật khi tệp hiện tại đổi tên.

**Kiểm tra:** `node --check desktop/main.mjs` đạt; `npm test` — build thành công và 24/24 bài kiểm tra đạt.

## 2026-10-14 12:20:00 +07:00 — Cache tư liệu và lựa chọn model AI

**Phạm vi:** Nhóm AI & mô hình và node `Cache kết quả`.

- Thêm node `Lựa chọn model AI`: nhận `AIProvider` và `CachedData`, có ba ưu tiên `Tiết kiệm`, `Tốc độ`, `Trung bình`. Node lấy danh sách model thật từ provider, rồi dùng một lời gọi AI ngắn để chọn đúng một model trong danh sách khả dụng.
- Nâng `Cache kết quả` thành bộ thực thi thật: giữ tư liệu và reference file trong bộ nhớ phiên app, sinh `CachedData` chứa khóa cache/manifest. File video, ảnh và âm thanh không bị sao chép vào localStorage; chỉ metadata phiên được lưu nhanh trong session storage.
- `AIModel` do selector trả về mang `cacheKey`; node tạo văn bản, phân tích ảnh và phân tích âm thanh tự dùng lại prompt/media cache khi chưa được nối lại ở cổng tương ứng. API key được giữ trong bộ nhớ phiên, không xuất hiện trong output canvas của selector.
- Thêm `prompt_cache_key` cho Responses API và ghi nhận `cachedInputTokens` từ usage. Việc cache nội bộ giúp không đọc/upload lại tư liệu; mức giảm input token phía OpenAI phụ thuộc model và kích thước phần prompt lặp.

**Kiểm tra:** `npm test` — build thành công và 25/25 bài kiểm tra đạt. API thật: selector chọn model thành công với 230 token; luồng node `Cache → AIProvider → Lựa chọn model` thành công với 350 token và xác nhận output không có API key; luồng dùng AIModel/cache để tạo tiêu đề không nối lại Prompt thành công với 61 token. Tổng ba lượt thành công: 641 token, dưới hạn mức 10.000 token.

## 2026-10-14 13:05:00 +07:00 — Cache đầu vào cho node xử lý AI

**Phạm vi:** Các node gọi OpenAI trực tiếp để xử lý văn bản, ảnh, âm thanh, phân tích video, highlight và thumbnail.

- Bổ sung cổng `CachedData` cho các node AI xử lý tư liệu và output `CachedData` tương ứng. Cache hợp lệ được ưu tiên hơn tất cả cổng tư liệu trực tiếp; cache hết hạn hoặc không tồn tại tự rơi về tư liệu nối trực tiếp.
- Áp dụng cho `Gọi AI tạo văn bản`, `Gọi AI trả JSON`, phân tích ảnh/âm thanh, phân tích và tổng hợp video, chọn highlight, tạo tiêu đề, chọn ảnh thumbnail và bố cục thumbnail. Mỗi lần xử lý đều làm mới reference cache đầu vào để tiếp tục nối sang node AI kế tiếp.
- Truyền `prompt_cache_key` ổn định cho các request Responses API để tận dụng prompt caching phía OpenAI khi model và phần đầu prompt lặp phù hợp.
- Thêm kiểm thử tự động xác nhận cả hai nhánh: cache hợp lệ thắng tư liệu trực tiếp; cache không tồn tại tự dùng tư liệu trực tiếp và vẫn phát ra cache mới.

**Kiểm tra:** `npm test` — build thành công và 26/26 bài kiểm tra đạt. API thật qua `gpt-4.1-mini`: lượt ưu tiên cache thành công (`cache`, 33 input + 5 output token); lượt cache không tồn tại rơi về tư liệu trực tiếp thành công (`direct`, 35 input + 6 output token). Tổng 79 token, dưới hạn mức 10.000 token.

## 2026-10-14 14:10:00 +07:00 — Vùng chú ý và làm rõ highlight lặp

**Phạm vi:** Pipeline video highlight từ `Test-list.xlsx`; đầu ra chỉ là video highlight, không tạo thumbnail.

- Thêm `Thiết lập vùng chú ý`: nhận ảnh tham chiếu và lưu vùng crop theo tọa độ tỷ lệ 0–1, mặc định phù hợp khu vực bảng điểm. Vùng được mang sang các frame chi tiết dù độ phân giải video thay đổi.
- Thêm `Làm rõ highlight lặp`: nhận video cục bộ, đề xuất highlight, transcript, vùng chú ý và AI model. Node giới hạn cứng tối đa 3 vòng, không dày hơn 1 frame/giây, tối đa 24 mốc mỗi vòng, rồi trả kế hoạch highlight đã xác nhận cùng `SceneAnalysis[]` và `CachedData`.
- Thêm endpoint media cục bộ `/extract-frames-path`: trích đúng timecode bằng FFmpeg, tạo frame toàn cảnh và crop vùng chú ý; video gốc không được upload lên AI.
- Thêm lựa chọn trọng số `Tập trung hình ảnh (80/20)`, `Tập trung âm thanh (20/80)` và `Cân bằng (50/50)`. Prompt của vòng xác nhận luôn ghi rõ tỷ trọng này và yêu cầu AI chỉ trả timecode có bằng chứng.
- Sửa hợp đồng đầu ra của bộ chuẩn hóa highlight: node lặp nay lấy đúng mảng `segments` trong kế hoạch đã chuẩn hóa, thay vì coi toàn bộ kế hoạch là mảng. Đồng thời giữ vị trí của cổng tùy chọn trong `CachedData`, nên transcript/vùng chú ý không bị lệch khi một cổng trước đó chưa nối.
- Đặt tên mặc định của node dựng là `video-highlight-final`, để tệp video chính thức dễ phân biệt với các lần thử.

**Kiểm tra:** `npm test` — build thành công và 28/28 bài kiểm tra đạt. Test cục bộ trên `videos long.mp4` (1.552,84 giây): 2 timecode tạo 4 ảnh (`frame, attention, frame, attention`), xác nhận crop vùng chú ý hoạt động; test mô phỏng chạy đủ 3 vòng trích frame → AI → xác nhận, kiểm tra giới hạn 1 fps và cache. Không gọi API AI, không tiêu token.

## 2026-10-14 16:20:00 +07:00 — Đồng bộ vùng chọn từ cây workflow

**Phạm vi:** Danh sách node ở panel phải và canvas React Flow.

- Click một node trong cây workflow nay cập nhật đồng thời node đang xem ở Properties và cờ `selected` do React Flow điều khiển, nên viền chọn trên canvas chuyển đúng sang node mới.
- Lựa chọn nhiều node bằng thao tác trực tiếp trên canvas vẫn giữ nguyên; click từ cây workflow là chọn đơn node rõ ràng.

**Kiểm tra:** `npm test` — build thành công và 28/28 bài kiểm tra đạt.

## 2026-10-15 01:10:00 +07:00 — Vùng chú ý AI dùng chung cho ảnh và video

**Phạm vi:** Node `Thiết lập vùng chú ý`, node phân tích ảnh AI, highlight lặp và preview media cục bộ.

- Chuyển `Thiết lập vùng chú ý` vào nhóm **AI & mô hình**. Node nhận `Image[]` hoặc `Video`, trả `AttentionRegion` với tối đa ba hình chữ nhật tọa độ chuẩn hóa 0–1; không còn gắn với một góc/video riêng.
- Thêm hai cách chọn: lưới 3×3 (tối đa ba ô) và popup quét chính xác. Popup có `Chọn vùng`, `Xóa vừa chọn`, `Xóa tất cả`; chặn vùng chồng lên nhau, quá ba vùng hoặc vượt 1/3 tổng diện tích. Vùng hiển thị phủ trắng trong suốt, viền xanh dương nhạt.
- Bỏ cấu hình “Vùng ưu tiên” khỏi các node lập chỉ mục/trích frame. Highlight lặp nhận danh sách vùng, trích crop cho từng vùng và ghi vùng này vào prompt AI.
- Node `Phân tích hình ảnh bằng AI` nhận thêm cổng `AttentionRegion` tùy chọn; prompt buộc AI phân tích toàn khung trước rồi quan sát kỹ các vùng được chọn.
- Thêm endpoint `/preview-media` stream ảnh/video cục bộ với HTTP Range. Popup phát được video lớn qua đường dẫn cục bộ mà không nạp toàn bộ file vào RAM.

**Kiểm tra:** `npm test` — build thành công và 28/28 bài kiểm tra đạt. API thật với `image-minh-hoa.jpg`, `gpt-4.1-mini`, hai ô 3×3: AI trả chính xác “Vùng ưu tiên đã nhận: 2” và phân tích riêng từng vùng; dùng 2.643 input + 240 output = **2.883 token**, dưới hạn mức 5.000 token.

## 2026-10-15 01:24:00 +07:00 — Vùng chú ý chỉ dùng media đi qua cổng

**Phạm vi:** Nguồn xem trước của `Thiết lập vùng chú ý` và quy tắc nối `Image[]`/`Video`.

- Bỏ hẳn bộ chọn file tham chiếu khỏi Inspector. Chế độ quét chính xác chỉ mở được khi node đã nhận một line `Image[]` hoặc `Video`.
- Popup truy vết line đi vào, lấy đúng file từ node nguồn (tệp đã chọn ở node nguồn hoặc đầu ra media đã chạy); không ghi thêm đường dẫn/tư liệu riêng trong node vùng chú ý.
- `Image[]` và `Video` trở thành hai cổng loại trừ: nối một cổng sẽ tự tháo mọi line ở cổng còn lại. Quy tắc này áp dụng cho cả kéo line bình thường và nối nhanh.
- Runtime cũng từ chối workflow cũ có đồng thời hai nguồn, tránh chọn nhầm media khi thực thi.

**Kiểm tra:** `npm test` — build thành công, 28/28 bài kiểm tra đạt; bổ sung kiểm thử runtime cho trường hợp cả hai đầu vào.

## 2026-10-15 02:05:00 +07:00 — Chuỗi hậu kỳ video có thể chạy cục bộ

**Phạm vi:** Chuẩn hóa nguồn, subtitle và kiểm tra kỹ thuật trước khi xuất video.

- Thêm node `Chuẩn hóa video nguồn`: đổi video cục bộ về H.264/AAC, yuv420p, FPS và giới hạn khung hình phù hợp để trích frame/dựng ổn định; trả lại `Video` và metadata đã đo.
- Kích hoạt `Tạo subtitle`: nhận `TimedTranscript`, tạo SRT có timecode thật, giới hạn dòng/ký tự và lưu thành artifact dùng tiếp được trong workflow.
- Kích hoạt `Chèn subtitle`: nhận Video + Subtitle, render phụ đề vào hình bằng FFmpeg với ba preset, cỡ chữ và vị trí chọn được.
- Kích hoạt `Kiểm tra kỹ thuật`: dùng FFprobe kiểm tra codec, độ phân giải, FPS, pixel format, audio và bitrate; trả trạng thái pass/warning/fail theo YouTube hoặc Shorts/Reels.

**Kiểm tra:** `npm test` — build thành công, 28/28 bài kiểm tra đạt. Kiểm tra cục bộ không dùng API AI với video mẫu 2 giây: probe → chuẩn hóa H.264/30 FPS → tạo SRT 1 mốc → chèn subtitle → probe lại đều thành công. File tạm và tiến trình dịch vụ test đã được xóa/dừng.

## 2026-10-16 00:20:00 +07:00 — Đo chi phí Vision cho toàn cảnh và vùng chú ý

**Phạm vi:** So sánh token thực tế giữa ảnh toàn cảnh 720p và toàn cảnh 480p kèm crop vùng chú ý lấy từ ảnh gốc.

- Thêm `support/scripts/measure-vision-cost.mjs`: benchmark lặp lại được, dùng API key từ `.env` nhưng chỉ in model, kích thước ảnh và usage; không in key.
- Ảnh nguồn `image-minh-hoa.jpg` 1890×1013. Phương án A dùng một JPEG 1344×720. Phương án B dùng JPEG 896×480 và crop trung tâm nguyên gốc 630×338. Cả hai gọi `gpt-4.1-mini`, `detail: high`, cùng prompt và giới hạn output 24 token.

**Kiểm tra API thật:** A dùng **1.619 input + 3 output = 1.622 token**. B dùng **1.093 input + 3 output = 1.096 token** — ít hơn **526 token (32,4%)**, đồng thời tổng byte ảnh giảm 116.064 xuống 91.586. Tổng benchmark **2.718 token**, dưới hạn mức 3.000. Ba ảnh tạm đã được xóa.

## 2026-10-16 01:15:00 +07:00 — Tối ưu input ảnh bằng node Cơ bản

**Phạm vi:** Giảm chi phí ảnh gửi AI nhưng vẫn truyền được vùng cần ưu tiên bằng tín hiệu thị giác thực tế.

- Thêm node **Cơ bản** `Tối ưu input ảnh`. Node chỉ nhận `Image[]`, nội bộ chạy `Giảm độ phân giải ảnh` rồi `Lấy vùng chú ý`, và chỉ trả `Image[]` đã hoàn thiện cho node AI tiếp theo.
- Tách thành hai node **Chi tiết**: `Giảm độ phân giải ảnh` trong nhóm **Hình ảnh** (chọn 720p hoặc 480p, không phóng to ảnh thấp hơn mức chọn) và `Lấy vùng chú ý` trong nhóm **AI & mô hình** (lưới 3×3 hoặc quét chính xác, tối đa ba vùng).
- `Lấy vùng chú ý` tạo JPEG mới có hai khung lồng nhau: đen 5px ở ngoài và trắng 2px ở trong. `AttentionRegion` vẫn được tạo nội bộ để prompt AI diễn giải đúng các khung đã vẽ, nhưng node Cơ bản không lộ cổng metadata này.
- Giữ node `Thiết lập vùng chú ý video` riêng trong nhóm **Video** để các workflow highlight đang dùng video vẫn chọn vùng được, không bị thay đổi bởi tối ưu ảnh.
- Thêm endpoint cục bộ `/optimize-image-inputs`, dùng FFmpeg để giảm độ phân giải hoặc vẽ viền. Không upload ảnh nguồn lên API khi xử lý hai bước này.

**Kiểm tra:** `npm test` — build thành công và **28/28** bài kiểm tra đạt. Chạy thật trên `image-minh-hoa.jpg`: bước giảm tạo JPEG **896×480**, 91.081 byte; bước đánh dấu tạo JPEG **896×480**, 92.975 byte với một vùng trung tâm và viền đúng thứ tự đen ngoài/trắng trong. Không gọi API AI, không tiêu token.

## 2026-10-16 01:30:00 +07:00 — Chuẩn hóa 720/480 theo cạnh ngắn

**Phạm vi:** Sửa nghĩa và cách thực thi mức ảnh 720/480 trong `Giảm độ phân giải ảnh`.

- Đổi nhãn thành **Cạnh ngắn tối đa** với hai lựa chọn `720 (cạnh ngắn)` và `480 (cạnh ngắn)`.
- Đổi FFmpeg từ giới hạn chiều cao sang giới hạn cạnh ngắn: ảnh ngang 480 tạo 854/896×480 tùy tỷ lệ; ảnh dọc 480 tạo 480×854/896; ảnh có cạnh ngắn nhỏ hơn không bị phóng to.
- Metadata runtime và endpoint cục bộ nay dùng `targetShortSide`; vẫn đọc `targetHeight` cũ khi cần tương thích với lần chạy trước.

**Kiểm tra:** `npm test` — **28/28** đạt. FFmpeg thử thật ở mức 480: ảnh ngang `896×480`; ảnh dọc `480×896`; ảnh nhỏ `320×172` giữ nguyên. Không gọi API AI, không tiêu token.

## 2026-10-16 01:45:00 +07:00 — Sắp lại nhóm node tối ưu input ảnh

**Phạm vi:** Đồng nhất vị trí giữa node Cơ bản và node Chi tiết theo luồng AI.

- Chuyển node **Cơ bản** `Tối ưu input ảnh` vào nhóm **AI & mô hình**. Node vẫn ghép đúng hai bước `Giảm độ phân giải ảnh` → `Lấy vùng chú ý`.
- Giữ `Giảm độ phân giải ảnh` là node **Chi tiết** thuộc nhóm **Hình ảnh** và `Lấy vùng chú ý` là node **Chi tiết** thuộc nhóm **AI & mô hình**.
- Bỏ node **Cơ bản** `Lấy vùng chú ý` dư thừa, để người dùng không nhầm nó với node Chi tiết cùng tên.

**Kiểm tra:** `npm test` — build thành công, **28/28** bài kiểm tra đạt; có kiểm tra riêng để bảo đảm preset Cơ bản này thuộc nhóm AI và preset Cơ bản dư thừa không quay lại.

## 2026-10-16 02:05:00 +07:00 — Tách lưu file khỏi tối ưu ảnh

**Phạm vi:** Làm rõ ranh giới giữa biến đổi ảnh và quản lý dữ liệu.

- Bỏ `Tiền tố file đã giảm`, `Tiền tố ảnh đã đánh dấu` và `Thư mục đầu ra` khỏi `Giảm độ phân giải ảnh`, `Lấy vùng chú ý`, cùng node Cơ bản `Tối ưu input ảnh` ghép hai bước này.
- Ảnh trung gian được lưu tự động vào cache runtime nội bộ để node sau dùng ngay; không còn được hiểu là file đầu ra do người dùng quản lý.
- Việc đặt tên, chọn thư mục và xuất file thuộc node **Quản lý dữ liệu** `Lưu file`.

**Kiểm tra:** `npm test` — build thành công, **28/28** bài kiểm tra đạt; bổ sung kiểm tra để các nhãn cấu hình lưu trung gian không quay lại trang node xử lý ảnh.

## 2026-10-16 02:35:00 +07:00 — Đặt tên và lưu file theo node Quản lý dữ liệu

**Phạm vi:** Bổ sung luồng đặt tên/lưu file thật, dùng được cho file cục bộ bất kể loại media.

- Thêm node Chi tiết `Đặt tên` với mẫu token chính xác; thêm node Chi tiết `Lưu file` nhận `NamedFile hoặc Dữ liệu` và `Folder`.
- Thêm node Cơ bản `Lưu file`, chạy liên tiếp `Đặt tên` rồi `Lưu file`; node này không còn bị lẫn với khối lựa chọn “Lưu trữ và vận hành”.
- `Lưu file` cho phép chọn thư mục trực tiếp hoặc qua cổng `Folder`, hai cách tự động loại trừ nhau. Có hai chế độ xung đột: `Lưu mới` và `Ghi đè`.
- Thêm endpoint cục bộ `/store-files`; đặt tên được resolve từ metadata file thật ngay trước khi copy, gồm kích thước, đuôi file, thư mục đích và thời điểm chạy.

**Kiểm tra:** `npm test` — build thành công, **28/28** bài kiểm tra đạt. Test endpoint cục bộ trên `package.json`: mẫu đủ tám token tạo `package-1-Content Flow Save Test-json-2kb-2026-10-16-13-22-13.json`; lần lưu mới thứ hai tự tạo hậu tố `-1`; mẫu sai `#file name#-1` được giữ nguyên; `Ghi đè` ghi đúng vào cùng `overwrite-check.json` và SHA-256 khớp nguồn. Đã dừng dịch vụ test và xóa thư mục test gồm bốn bản sao.

## 2026-10-17 00:05:00 +07:00 — Hiện rõ cổng Folder của Lưu file Cơ bản

**Phạm vi:** Sửa hai cách chọn thư mục lưu ở node Cơ bản và đồng nhất với node Chi tiết.

- Node Cơ bản `Lưu file` nay hiển thị riêng cổng `Folder` bên cạnh cổng dữ liệu, thay vì để cổng `free` che mất nó.
- Cổng `Folder` vẫn loại trừ với thư mục chọn trong Properties: nối dây sẽ xóa/khóa giá trị chọn trực tiếp; chọn trực tiếp sẽ tháo dây Folder.
- Sửa đầu ra node Cơ bản về đúng `StoredFile` của bước `Lưu file`, không còn áp nhầm bộ lọc đầu ra `Image[]` từ node tối ưu ảnh.

**Kiểm tra:** `npm test` — build thành công, **28/28** bài kiểm tra đạt.

## 2026-10-17 00:30:00 +07:00 — API key chỉ lấy từ workflow khi chạy app

**Phạm vi:** Tách hoàn toàn `.env` thử nghiệm khỏi mọi node và dịch vụ AI khi Content Flow đang chạy.

- Bỏ nạp `.env` trong launcher app và dịch vụ media; route AI, Vision và phiên âm cũng không còn fallback `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_MODELS`, model hay base URL từ environment.
- Tất cả đường gọi AI đang thực thi nay bắt buộc nhận key do workflow truyền: từ node `Thiết lập AI`/`Cấu hình API key` qua cổng `APIKey`, hoặc nhập trực tiếp vào node có gọi AI. Các node nghiên cứu/nội dung gọi trực tiếp AI và node phiên âm đã có cổng `APIKey`, hai nguồn key vẫn tự loại trừ nhau.
- Sửa các lời gọi trước đây bị thiếu key: tạo/biến đổi nội dung, tổng hợp/đối chiếu nguồn, phiên âm video cục bộ và trích xuất transcript file. Node sẽ báo thiếu key trước khi gửi request thay vì vô tình dùng key ở `.env`.
- Giữ `support/scripts/measure-vision-cost.mjs` là script benchmark độc lập duy nhất dùng `.env`; không thuộc luồng chạy app.
- Thêm regression test quét route, client, launcher và dịch vụ media để chặn fallback secret từ environment quay lại; cập nhật fixture AI dùng `test-api-key` trực tiếp.

**Kiểm tra:** `npm test` — build thành công, **29/29** bài kiểm tra đạt.

## 2026-10-17 15:40:00 +07:00 — Lát cắt node kiểm tra chất lượng

**Phạm vi:** Tạo luồng kiểm tra có kết quả hành động được, không mô phỏng gọi AI.

- Đổi hai lựa chọn Cơ bản thành `Kiểm tra sản phẩm` (kiểm tra yêu cầu/cấu trúc hoặc kỹ thuật video) và `Tổng hợp chất lượng và duyệt`.
- Thêm các node Chi tiết hoạt động thật: `Kiểm tra yêu cầu và cấu trúc`, `Chuẩn bị kiểm tra AI`, `Đọc kết quả AI kiểm tra`, `Tổng hợp báo cáo kiểm tra`, `Chấm điểm thành phẩm`, `Duyệt xuất bản`.
- Chuẩn hóa báo cáo thành `QAReport`: có `status` (`Đạt`, `Cần sửa`, `Không đạt`, `Không thể kiểm tra`), `passed`, `needsFix`, `issues` và `repairItems` gồm vị trí, lý do, cách sửa.
- `Chuẩn bị kiểm tra AI` chỉ tạo prompt JSON; node không gọi API. `Đọc kết quả AI kiểm tra` nhận `AIJson` từ node gọi AI tiêu chuẩn và quy về `QAReport`.
- `Kiểm tra kỹ thuật` nay cũng trả cùng `QAReport`, vì vậy có thể nối vào node tổng hợp/chấm điểm/duyệt mà không đổi nghĩa cổng dữ liệu.
- Khi bật tùy chọn tương ứng, một hạng mục `Không thể kiểm tra` được chuyển thành `Không đạt` kèm yêu cầu bổ sung tư liệu; không thể bị chấm nhầm là đạt.

**Kiểm tra:** `npm test` — build thành công, **30/30** bài kiểm tra đạt. Chạy thật `Kiểm tra yêu cầu và cấu trúc` với `C:\Users\Owner\Desktop\Test-Media\Text test.txt` (1.458 từ; yêu cầu `Hades` và `Kêu gọi hành động`) trả `Không đạt`, nêu đúng mục thiếu và cách bổ sung. Không gọi API AI, tiêu **0 token** trong hạn mức 1.000 token.

## 2026-10-17 16:20:00 +07:00 — Kiểm tra QA có AI bằng text thật

**Phạm vi:** Xác nhận đường chạy `Chuẩn bị kiểm tra AI` → route OpenAI → `Đọc kết quả AI kiểm tra`.

- Dùng đoạn đầu của `C:\Users\Owner\Desktop\Test-Media\Text test.txt`, model `gpt-4.1-mini`, API key thử nghiệm chỉ truyền tường minh trong request.
- Lần gọi đầu bị giới hạn 180 output token và JSON bị cắt dở. Phát hiện bộ đọc cũ có thể coi `{ text: <JSON cắt dở> }` là đạt; đã sửa để trả `Không thể kiểm tra` và nêu rõ JSON không hoàn chỉnh.
- Siết prompt QA tối đa ba lỗi, giới hạn độ dài các trường. Lần gọi thứ hai trả JSON hợp lệ, được chuyển đúng thành `QAReport: Cần sửa`, gồm ba mục có vị trí, lý do và cách sửa.

**Kiểm tra API thật:** Hai lần gọi dùng tổng **906 token** (lần 1: 273 input + 180 output; lần 2: 247 input + 206 output), trong hạn mức **1.000 token**. `npm test` — build thành công, **30/30** bài kiểm tra đạt.

## 2026-10-20 15:20:00 +07:00 — Phân tách Loại, Nhóm, Họ và Tên node

**Phạm vi:** Loại bỏ nhập nhằng giữa định danh kỹ thuật và tên người dùng đặt trên canvas.

- Bổ sung `Họ node` bất biến cho mọi node. `Loại` là **Cơ bản/Chi tiết**; `Nhóm` là như **Đầu vào/AI & mô hình**; `Họ` là như **Nguồn file/Nguồn folder**; `Tên` là nhãn người dùng sửa được.
- Node tạo mới lấy tên mặc định theo `Họ + số node cùng Họ`: ví dụ `Nguồn file 1`, `Nguồn file 2`. Việc đổi tên node trước đó không ảnh hưởng số thứ tự node tạo tiếp theo.
- Canvas nay hiển thị Họ ngay dưới Tên; huy hiệu góc phải hiện Loại và Nhóm, thay cho số bước/thao tác.
- Properties không còn các ô Loại, Nhóm, Họ riêng lẻ; các thông tin phân loại không thể sửa.
- Thu gọn phần Properties: Loại, Nhóm và Họ chỉ còn một chuỗi chỉ đọc theo dạng `Loại - Nhóm - Họ` phía trên mô tả; chỉ còn ô `Tên node` để người dùng đổi tên.
- Runtime luôn dùng Họ để chọn executor. Đổi Tên không còn làm node bị mất chức năng hoặc thực thi nhầm. Workflow cũ không có Họ được tự bổ sung từ định nghĩa node khi mở.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt. Có regression test cho `Nguồn file 3` sau khi node thứ hai đã đổi tên, và node kiểm tra đã đổi Tên vẫn chạy đúng theo Họ.

## 2026-10-20 15:35:00 +07:00 — Đồng bộ Properties khi kéo node

**Phạm vi:** Khắc phục phần chi tiết không đổi theo node được chọn bằng thao tác kéo trên canvas.

- React Flow không luôn phát `onNodeClick` sau khi con trỏ chuyển thành kéo node.
- Bổ sung `onNodeDragStart` để cập nhật `selectedId` ngay khi bắt đầu kéo; phần Properties nay luôn theo node đang được chọn trên canvas.
- Thêm regression assertion cho callback kéo node.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Quản lý xử lý cục bộ theo yêu cầu người dùng

- Thêm `Workflow → Điều chỉnh xử lý cục bộ`: cửa sổ liệt kê trạng thái, phiên bản/dung lượng khi có, và các nút Cài đặt, Cập nhật, Gỡ.
- Quản lý FFmpeg + FFprobe qua Winget theo thao tác người dùng; thay đổi FFmpeg yêu cầu khởi động lại Content Flow để tiến trình media nhận PATH mới.
- Quản lý riêng ba model Whisper tiny/base/small: cài hoặc cập nhật tải model vào cache app; gỡ chỉ xóa model đã chọn. Không thao tác nào chạy khi cài app hoặc khi app khởi động.
- Luồng transcript cục bộ đã chặn tải model tự động: thiếu model sẽ báo mở cửa sổ Workflow để cài, không âm thầm tải xuống trong lúc chạy workflow.
- Đã smoke-test API chỉ đọc trạng thái: FFmpeg/FFprobe, Whisper tiny, Whisper base được nhận diện; Whisper small báo chưa cài. Không có processor nào bị cài, cập nhật hoặc gỡ trong lần kiểm tra này.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Tiến độ trực tiếp trong Output node

- Khi workflow xếp hàng, Output của node hiển thị “Đang chờ các node đầu vào hoàn tất”, thay vì khung trống.
- Khi node chạy, Output hiển thị tên công việc đang xử lý trên máy. Node Cơ bản dạng pipeline báo rõ `Bước x/y`, ví dụ: trích frame, tách audio bằng FFmpeg, rồi chuẩn hóa audio/chạy Whisper cục bộ hoặc transcript API.
- Thanh tiến độ thể hiện số bước đã hoàn tất trong pipeline. Trạng thái tiến độ tự xóa khi node thành công, lỗi, hoặc workflow bị dừng.
- Thêm callback tiến độ từ executor về UI; không thay đổi dữ liệu output/hợp đồng cổng của workflow.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-20 15:45:00 +07:00 — Tự chọn thao tác duy nhất

**Phạm vi:** Bỏ điều khiển chọn thao tác thừa trên node Cơ bản chỉ có một thao tác.

- Node Cơ bản kiểu lựa chọn nhưng chỉ có đúng một bước (như `Nguồn folder`, `Hồ sơ thương hiệu`) tự chọn bước đó khi tạo và không hiện mục `Thao tác`.
- Các node có từ hai thao tác trở lên vẫn hiện selector, cùng lựa chọn `Không thao tác` như trước.
- Workflow cũ có node một thao tác đã lưu `Không thao tác` được tự chuẩn hóa sang thao tác duy nhất khi mở; cổng và cấu hình cũng dùng đúng hợp đồng của bước đó.
- Node Chi tiết vốn tương ứng một Họ/thao tác và không có selector, nên không cần thay đổi giao diện.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-21 10:20:00 +07:00 — Phân tích video AI kết hợp ba tư liệu

**Phạm vi:** Bổ sung phân tích video cho họ AI ở cả node Cơ bản và Chi tiết.

- Node Cơ bản `Phân tích hình ảnh, âm thanh hoặc video bằng AI` có thêm thao tác `Phân tích video bằng AI`.
- Bổ sung Họ node Chi tiết `Phân tích video bằng AI`, nhận `Image[]`, `Audio` và `TimedTranscript` (cùng `Prompt`, `AIModel`, `CachedData` theo hợp đồng AI) và trả `AIAnalysis`, `CachedData`.
- Runtime bắt buộc cả ba tư liệu: frame để AI thấy hình, audio được phiên âm, và script có timecode được gửi kèm để AI đối chiếu theo thời gian. Output lưu số lượng frame, audio, segment và phương thức xử lý làm bằng chứng.
- Dịch vụ phiên âm cục bộ nhận thêm đường dẫn file audio hợp lệ, không chỉ video, để cổng `Audio` hoạt động cả với file tách âm thanh.
- Thêm regression contract cho danh sách thao tác Cơ bản và đầu vào Họ node Chi tiết.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt. Chưa gọi API thật trong lượt này vì không có ngân sách token thử nghiệm được cấp.

## 2026-10-21 10:45:00 +07:00 — Chuẩn bị tư liệu và thực thi phân tích video AI

**Phạm vi:** Hoàn tất executor cho `Phân tích video bằng AI`; thêm luồng chuẩn bị tư liệu video ở Cơ bản và Chi tiết.

- Registry và dispatcher nay nhận diện `Phân tích video bằng AI`, nên node Cơ bản không còn báo “chưa có bộ thực thi”.
- Bổ sung node Cơ bản `Chuẩn bị tư liệu phân tích video`: nhận `Video`, trích `Image[]`, tách `Audio` và tạo `TimedTranscript` có timecode. Node bắt buộc API key cho bước phiên âm, có thể nhập trực tiếp hoặc nhận từ cổng `APIKey`.
- Bổ sung node Chi tiết `Tách âm thanh từ video` trong nhóm Video: xuất MP3 (96/128/192 kbps) hoặc WAV từ audio stream đầu tiên của video; nếu video không có audio stream, FFmpeg trả lỗi thật thay vì output rỗng.
- `Trích frame từ video` và `Phiên âm video theo thời gian` là hai node Chi tiết đã có; ba node này ghép thành bộ chuẩn bị tư liệu tương ứng với node Cơ bản mới.
- Phân tích video AI nhận đủ frame, audio và transcript; audio được phiên âm trước rồi gửi kèm transcript/timecode và frame để model đối chiếu.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt. Có regression cho contract ba output, executor mới và lệnh FFmpeg tách audio. Chưa gọi API thật vì lượt này không được cấp ngân sách token.

## 2026-10-21 10:55:00 +07:00 — Gộp chuẩn bị phân tích vào nhóm Video Cơ bản

- Bỏ node Cơ bản `Trích frame từ video` để không trùng với luồng chuẩn bị đầy đủ.
- Chuyển `Chuẩn bị tư liệu phân tích video` từ nhóm `AI & mô hình` sang nhóm `Video`.
- Node Chi tiết `Trích frame từ video` vẫn tồn tại để ghép thủ công với `Tách âm thanh từ video` và `Phiên âm video theo thời gian`.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-21 11:05:00 +07:00 — Rút gọn tên node phân tích media Cơ bản

- Đổi Họ node Cơ bản thành `Phân tích media bằng AI`; các thao tác ảnh, âm thanh và video giữ nguyên.
- Workflow cũ dùng hai tên dài trước đó tự chuyển sang Họ mới khi mở.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Transcript tùy chọn cho chuẩn bị tư liệu video

**Phạm vi:** Node Cơ bản `Chuẩn bị tư liệu phân tích video` và dịch vụ media cục bộ.

- Thêm lựa chọn bắt buộc, không có mặc định: `Không transcript`, `Transcript cục bộ`, hoặc `Transcript bằng API`.
- Cổng `TimedTranscript` chỉ hiện khi chọn một trong hai chế độ có transcript; cổng `APIKey` và ô key chỉ hiện ở chế độ API. Đổi lựa chọn sẽ tự ngắt các dây không còn hợp lệ.
- Chế độ `Không transcript` vẫn trích frame và tách audio; khi nối vào `Phân tích video bằng AI`, node phân tích có thể tự phiên âm audio bằng key của chính nó. Khi đã nhận `TimedTranscript`, nó dùng lại dữ liệu đó và không gọi phiên âm API lần hai.
- Thêm Whisper cục bộ qua Transformers.js: FFmpeg chuẩn hóa audio thành WAV mono 16 kHz, model tiny/base/small được chọn trong node và lưu cache tại `data/local-whisper-cache`. Không cần Python hoặc API key. Timecode đầu ra được chặn trong thời lượng file.
- Smoke test thật: endpoint cục bộ ở cổng riêng đã phiên âm WAV 1 giây bằng `onnx-community/whisper-tiny` không gửi API key; file/log tạm đã xóa, model cache được giữ lại.

**Kiểm tra:** `node --check support/media/video-transcription-service.mjs`; `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Đồng bộ vị trí dây khi cổng động thay đổi

- Nguyên nhân: React Flow giữ toạ độ Handle cũ sau khi node `Chuẩn bị tư liệu phân tích video` thêm/bớt cổng `APIKey` hoặc `TimedTranscript`; dây vì vậy bám vào hàng cổng cũ thay vì glyph đang hiển thị.
- `WorkflowNode` nay gọi `useUpdateNodeInternals(id)` bằng `useLayoutEffect` mỗi khi danh sách ID cổng vào/ra đổi. React Flow sẽ đo lại Handle ngay sau render, nên đầu dây trùng tâm cổng thực.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Ghi nhận mốc cài/cập nhật xử lý cục bộ

**Phạm vi:** Cửa sổ `Workflow → Điều chỉnh xử lý cục bộ` và dịch vụ quản lý FFmpeg/Whisper.

- Sau mỗi thao tác Cài đặt hoặc Cập nhật thành công, app lưu thời điểm ISO thực tế theo từng bộ xử lý trong metadata cục bộ; thao tác Gỡ sẽ xoá mốc của bộ xử lý đó.
- Mỗi bộ đã cài trong cửa sổ quản lý nay hiển thị `Cài/cập nhật gần nhất: dd/mm/yyyy HH:mm`.
- Với model Whisper đã có từ trước khi có metadata, app dùng thời gian sửa đổi mới nhất của tệp model làm mốc và ghi rõ `(mốc tệp tham khảo)` để không trình bày đó như thời điểm cài đặt chính xác.
- FFmpeg đã được cài bên ngoài app nhưng chưa từng được app quản lý sẽ hiện `chưa ghi nhận`; lần Cập nhật sau qua cửa sổ này sẽ có mốc chính xác.

**Kiểm tra:** gọi thật `GET /local-processors` xác nhận Whisper base trả về mốc tệp tham khảo; `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Điều khiển tiến trình media khi tạm dừng/dừng workflow

**Phạm vi:** Thanh điều khiển workflow, `research-client` và dịch vụ media cục bộ.

- Mỗi lần chạy workflow nay có một mã phiên riêng. Toàn bộ lời gọi tới dịch vụ media cục bộ mang mã này và dùng `AbortController` khi cần dừng hẳn.
- `Ctrl+R` khi đang chạy gửi lệnh `pause`: FFmpeg/FFprobe và tiến trình Whisper đang chạy được treo ở cấp tiến trình; khi tiếp tục, cùng phím tắt gửi `resume` để khôi phục chúng và các bước cục bộ đang chờ.
- `Ctrl+T` gửi `stop`: FFmpeg, Whisper cùng cây tiến trình con bị `taskkill /T /F` trên Windows; yêu cầu ở trình duyệt cũng bị hủy, nên node không thể ghi output thành công sau khi người dùng đã dừng.
- Whisper cục bộ nay chạy trong `local-whisper-worker.mjs` tách khỏi dịch vụ media chính. Worker giữ model trong bộ nhớ trong suốt node, nhưng trở thành tiến trình có thể treo/tiếp tục/kết thúc cưỡng bức như FFmpeg.
- Thêm endpoint nội bộ `POST /workflow-control`; endpoint chỉ điều khiển tác vụ đang mang đúng mã phiên, không ảnh hưởng thao tác media khác.

**Kiểm tra:** smoke test thật với `videos long.mp4`: dịch vụ trả `pause.active=true`, `pause.paused=true`, `resume.active=true`, rồi `stop.stopped=true`; sau dừng không còn tiến trình `ffmpeg`. Đã dừng dịch vụ test tạm và xóa toàn bộ output thử. `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Sửa preview audio và ngôn ngữ transcript cục bộ

**Phạm vi:** Node Cơ bản `Chuẩn bị tư liệu phân tích video`, node xem dữ liệu và dịch vụ media.

- Nguyên nhân audio 0:00: output audio cục bộ chỉ lưu metadata/đường dẫn nhằm tránh nạp file lớn vào RAM, nhưng preview đã tạo object URL từ `File` rỗng. Node xem dữ liệu nay đọc trực tiếp tệp qua `preview-media?filePath=...`.
- Dịch vụ preview nay chấp nhận audio cục bộ và trả MIME đúng (`audio/mpeg`, `audio/wav`, `audio/mp4`, …), hỗ trợ Range request để player phát/seek được.
- Thay trường `Ngôn ngữ` mơ hồ trong node chuẩn bị bằng `Ngôn ngữ lời thoại transcript`, với lựa chọn rõ ràng `Tiếng Việt (vi)`, English, Nhật, Hàn, Trung hoặc tự động. Workflow sẽ báo thiếu cấu hình nếu chọn tạo transcript nhưng bỏ trống ngôn ngữ.
- Chuẩn hóa giá trị UI trước khi gọi Whisper/API: lựa chọn `Tiếng Việt (vi)` luôn gửi `vi`, không để model tự đoán nhầm ngôn ngữ.

**Kiểm tra:** preview MP3 thực trả `206`, `Content-Type: audio/mpeg` và 256 byte Range; cắt 20 giây từ `videos long.mp4` và chạy Whisper base cục bộ với `vi` trả transcript tiếng Việt, 9 segment, không dùng API token. `npm test` — build thành công, **31/31** bài kiểm tra đạt. File dịch vụ, WAV và log thử nghiệm đã xóa.

## 2026-10-23 +07:00 — Gom nhóm cấu hình chuẩn bị tư liệu phân tích video

**Phạm vi:** Node Cơ bản `Chuẩn bị tư liệu phân tích video`.

- Sắp xếp lại trường cấu hình theo đúng trình tự xử lý: trích frame, tách audio, rồi transcript.
- Lựa chọn `Transcript` và toàn bộ tùy chọn riêng của transcript (ngôn ngữ, model cục bộ, API key khi dùng API, v.v.) được đặt liền nhau ở cuối.
- Bảng chi tiết tự chèn một gạch ngang giữa hai nhóm liền kề; cơ chế này chỉ áp dụng cho node tổng hợp trên, không làm thay đổi giao diện node khác.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Đồng bộ model transcript cục bộ chưa cài đặt

- Model Whisper thiếu hoặc cài chưa đủ file nay trả thông báo theo ngôn ngữ người dùng: `Chưa có bộ xử lý Whisper …, vui lòng cài đặt và thử lại.`; không còn lộ lỗi đường dẫn của Transformers.
- Danh sách chọn model vẫn lưu giá trị chuẩn của workflow, nhưng hiển thị thêm `(Chưa cài đặt)` bên cạnh model chưa sẵn sàng.
- Trạng thái bộ xử lý được kiểm tra khi app mở, khi thêm node, và cập nhật ngay sau cài/cập nhật/gỡ trong cửa sổ quản lý cục bộ.

**Kiểm tra:** `node --check` cho hai dịch vụ media; `npm test` — build thành công, **31/31** bài kiểm tra đạt. Smoke test thật tại endpoint `/transcribe-path` với lựa chọn Whisper small chưa cài trả đúng `Chưa có bộ xử lý Whisper small, vui lòng cài đặt và thử lại.`; tiến trình và log thử đã được dọn.

## 2026-10-23 +07:00 — Nạp thuật ngữ từ file cho transcript

- Thêm cổng `Thuật ngữ` ở node Cơ bản `Chuẩn bị tư liệu phân tích video` và node Chi tiết `Tạo transcript video theo thời gian`.
- Cổng nhận trực tiếp `Text`, `Document[]` hoặc file từ node nguồn. File TXT, DOCX và PDF được đọc qua bộ đọc tài liệu có sẵn; nội dung cổng luôn được ưu tiên hơn danh sách nhập tay.
- Khi chọn `Không transcript`, cổng này tự ẩn cùng đầu ra `TimedTranscript` để tránh nối một dữ liệu không được dùng.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Khôi phục cấu hình ngôn ngữ transcript

- Sửa nhận diện bước transcript của node tổng hợp theo cả tên nguyên thủy và tên hiển thị trong catalog.
- Khi chọn `Transcript cục bộ`, trường `Ngôn ngữ lời thoại transcript` nay luôn hiện ngay trước lựa chọn model Whisper cục bộ.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Xem trọn dữ liệu trong node canvas

- Bỏ giới hạn cắt 560 ký tự ở vùng xem dữ liệu trên canvas; JSON, transcript và text được giữ nguyên đầy đủ.
- Khung xem vẫn có chiều cao theo chế độ Thu gọn/Mở rộng/Cực đại và cuộn độc lập, nên nội dung dài xem được trọn vẹn mà không làm node phình vô hạn.
- Thêm ngắt từ dài để chuỗi không có khoảng trắng không gây tràn ngang.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Gắn FrameIndex vào phân tích video AI

- Node `Phân tích video bằng AI` (và thao tác Video của node Cơ bản `Phân tích media bằng AI`) nay có cổng bắt buộc `FrameIndex`.
- Bộ thực thi gửi từng frame kèm timecode, lý do trích và điểm thay đổi cảnh tới AI dưới dạng timeline; transcript chỉ dùng để đối chiếu lời thoại.
- Đồng bộ số frame gửi mỗi lượt với giới hạn API là tám frame và báo lỗi rõ nếu thiếu hoặc lệch FrameIndex.

**Kiểm tra:** `npm test` — build thành công, **31/31** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Sửa lỗi cấu hình rỗng ở node Cơ bản

- Node Cơ bản nay chịu được workflow cũ chưa có trường `config`, thay vì lỗi nội bộ khi tạo thông tin tiến trình.
- Khi thiếu dữ liệu, node báo đúng nguyên nhân nghiệp vụ (ví dụ thiếu video) trước khi gọi AI.
- Thêm kiểm tra hồi quy cho workflow Cơ bản thiếu cấu hình.

**Kiểm tra:** `npm test` — build thành công, **32/32** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Ưu tiên node Xem dữ liệu trong nhánh song song

- Khi một nguồn cấp đồng thời cho node Xem dữ liệu và một nhánh AI, node Xem dữ liệu được chạy trước.
- Audio, frame hoặc transcript nối trực tiếp vào viewer vì thế vẫn xem được nếu nhánh AI song song sau đó lỗi.
- Không thay đổi quy tắc: một đầu ra có thể phân nhánh, một đầu vào chỉ nhận một nguồn.

**Kiểm tra:** `npm test` — build thành công, **32/32** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Kiểm tra chuỗi nguồn của cổng bắt buộc

- Khi đã chọn thao tác trong node Cơ bản, các cổng kế thừa đúng trạng thái bắt buộc từ node Chi tiết tương ứng.
- Kiểm tra workflow nay báo rõ cổng bắt buộc không thể nhận dữ liệu khi node nguồn đang tạm ngưng, lỗi hoặc thiếu dữ liệu/cấu hình; lỗi được lan truyền qua cả chuỗi phụ thuộc.
- Một line đơn thuần không còn được xem là dữ liệu hợp lệ nếu nguồn của nó không thể chạy.

**Kiểm tra:** `npm test` — build thành công, **32/32** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Làm rõ đầu vào của Tạo prompt AI

- Đổi nhãn cổng dữ liệu ở thao tác `Tạo prompt từ dữ liệu` thành `Dữ liệu nguồn`; đây là tư liệu mà mẫu prompt xử lý, không phải yêu cầu bổ sung.
- `Yêu cầu bổ sung` vẫn là trường cấu hình tùy chọn, có chú thích rõ rằng có thể để trống.

**Kiểm tra:** `npm test` — build thành công, **32/32** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Sửa lỗi cấu hình rỗng khi phân tích video AI

- Các bộ thực thi AI, video và cache nay luôn dùng cấu hình rỗng an toàn cho workflow cũ chưa lưu object `config`.
- Thay vì lỗi kỹ thuật như `Cannot read properties ... transcriptMode`, node sẽ đi đến bước kiểm tra dữ liệu thực tế và báo đúng dữ liệu còn thiếu.
- Thêm kiểm tra hồi quy cho node `Phân tích video bằng AI` cũ không có cấu hình.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Hoàn tất hợp đồng transcript của Phân tích video AI

- `TimedTranscript` là cổng tùy chọn của `Phân tích video bằng AI`; node chỉ bắt buộc AIModel, Audio, FrameIndex, Image[] và Prompt.
- Khi không nối `TimedTranscript`, node tạo transcript tạm từ Audio cho chính lượt phân tích, không đọc hay phụ thuộc `transcriptMode` của node Chuẩn bị tư liệu.
- Chuẩn hóa `config` cho mọi node khi mở workflow cũ, đồng thời bỏ trạng thái lỗi `transcriptMode` đã được lưu từ bản app cũ để giao diện phản ánh lần chạy mới.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Sửa tận gốc lỗi phiên âm `transcriptMode`

- Đã lần theo stack vào dịch vụ media cục bộ: khi phiên âm audio đã tách theo đoạn, lời gọi `transcribeAudioFile` bị thiếu đối số `fileName`. Vì thế `options` thành `undefined` và lỗi tại `options.transcriptMode`.
- Lời gọi đã được sửa thành `transcribeAudioFile(chunkPath, chunkNames[index], options)`; hai hàm phiên âm cũng nhận cấu hình rỗng an toàn tại biên dịch vụ.
- Lỗi từ dịch vụ cục bộ nay trả thêm chẩn đoán gồm route, các tên tùy chọn nhận được và stack, sau đó được giữ nguyên vào Output của workflow. Không đưa API key hoặc đường dẫn file vào chẩn đoán.
- Đã gọi trực tiếp `/transcribe-path` không có `transcriptMode`: dịch vụ trả đúng lỗi thiếu API key cùng stack, không còn lỗi đọc `transcriptMode` từ `undefined`.

**Kiểm tra:** `node --check support/media/video-transcription-service.mjs`; `npm test` — build thành công, **33/33** bài kiểm tra đạt; kiểm tra API cục bộ thành công.

## 2026-10-23 +07:00 — Lưu cache AI không có tên file gốc

- `Đặt tên` và `Lưu file` nay nhận được cả dữ liệu cache AI trong phiên chạy, không chỉ file có đường dẫn cục bộ.
- Cache được tuần tự hóa thành JSON trước khi lưu; các file/media tham chiếu trong cache chỉ lưu metadata và đường dẫn cục bộ, không sao chép media nặng vào JSON.
- Nếu mẫu tên có `#file-name#` mà dữ liệu không có tên file gốc, token được thay bằng đúng chuỗi `undefine`; cache mặc định thành `undefine.json`.
- Dịch vụ lưu file hỗ trợ dữ liệu JSON nội tuyến song song với cơ chế sao chép file cục bộ hiện có. Tên và phần mở rộng của file cục bộ không thay đổi.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt; gọi `/store-files` với cache JSON giả lập tạo đúng `undefine.json`, kiểm tra nội dung, rồi xóa thư mục thử trong Temp.

## 2026-10-23 +07:00 — Hoàn tác và phục hồi canvas

- Thêm lịch sử canvas tối đa 100 trạng thái cho thêm/xóa/dán node, nối hoặc tháo line, đổi cấu hình, tạm ngưng node, kéo vị trí và xóa canvas.
- `Ctrl+Z` hoàn tác, `Ctrl+Shift+Z` phục hồi. Khi đang nhập trong input/textarea/select, phím tắt được giữ cho thao tác hoàn tác văn bản mặc định của trình duyệt.
- Lịch sử chỉ chứa cấu trúc và cấu hình workflow. Kết quả chạy, tiến độ, lỗi tạm và file cache runtime được xóa khi hoàn tác/phục hồi để không hiển thị dữ liệu đã lỗi thời.
- Không cho hoàn tác hoặc phục hồi trong khi workflow đang chạy.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Lưu file giữ kiểu dữ liệu gốc

- Cổng đầu ra của node Lưu file không còn luôn là `StoredFile`. Khi cổng dữ liệu nhận Audio, Video, Image[], File[], Document[] hoặc Subtitle, đầu ra đổi sang đúng kiểu đó để nối và tái sử dụng trực tiếp.
- Cache/JSON và các kiểu không phải file media vẫn dùng `StoredFile`, tránh nối nhầm dữ liệu không thể phát/đọc vào node media.
- Kiểu đầu ra được lưu trong cấu hình node và được suy ra lại từ line đầu vào khi mở workflow cũ.
- Bộ thực thi Lưu file Cơ bản chuyển đúng danh sách file đã lưu vào kiểu đầu ra kế thừa, không chỉ thay đổi nhãn trên canvas.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Tooltip và kéo dây từ cổng vào

- Tooltip ở cổng vào nay hiển thị đúng hợp đồng dữ liệu như cổng ra: nhánh `free/group/type/kind`, phạm vi nhận và kiểu dữ liệu hiển thị.
- Có thể bắt đầu kéo line từ cổng vào rồi thả vào cổng ra, đồng thời vẫn hỗ trợ thao tác cổng ra → cổng vào cũ.
- Khi kéo ngược, React Flow vẫn tạo lane theo đúng quy tắc dữ liệu `output → input`; không có dữ liệu nào bị đảo chiều. Kiểm tra kiểu dữ liệu và quy tắc một line cho mỗi cổng vào vẫn được giữ nguyên.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-23 +07:00 — Chế độ cổng ra cho Lưu file

- Thêm lựa chọn `Cổng ra` trong node Lưu file: mặc định `Tương đồng node kết nối`, hoặc `Tự do`.
- Ở chế độ tương đồng, cổng ra kế thừa nguyên kiểu của cổng ra đang nối vào cổng dữ liệu của Lưu file; không còn giới hạn chỉ Audio/Video/Ảnh.
- Ở chế độ tự do, cổng ra chuyển sang hợp đồng `Free` (`Dữ liệu`) để người dùng chủ động nối tiếp theo nhu cầu.
- Khi đổi chế độ, nối line mới, tháo line nguồn hoặc mở workflow cũ, kiểu cổng ra được tính lại ngay. Nếu chưa có line ở chế độ tương đồng, node giữ `StoredFile`.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-24 +07:00 — Sửa Folder và đầu ra của Lưu file Cơ bản

- Bộ thực thi node Cơ bản nay ưu tiên cổng có kiểu trùng chính xác trước khi dùng hợp đồng tương thích. Vì vậy `Folder` luôn nhận đường dẫn thư mục, không thể lấy nhầm frame index từ cổng Free.
- Node Lưu file kiểm tra rõ cổng Folder phải là chuỗi đường dẫn; lỗi dữ liệu sai kiểu được báo tại node thay vì để dịch vụ tạo thư mục với chuỗi `[object Object]`.
- Lưu file Cơ bản luôn trả chính các file vừa được lưu. Trước đây, khi cổng ra kế thừa Audio/Video, UI có thể lấy lại file nguồn trong pool thay vì kết quả lưu mới.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-24 +07:00 — Lưu frame ảnh và lô nhiều file

- Frame `Image[]` nằm trong RuntimeFileStore dưới dạng byte JPG nay được nhận là file thật khi đi vào Lưu file; app gửi binary base64 tới dịch vụ cục bộ và ghi ra `.jpg`, không chuyển metadata frame thành `undefine.json`.
- Khi có hơn một file cần lưu, dịch vụ tạo thư mục con từ mẫu tên của file đầu tiên. Thư mục trùng luôn nhận hậu tố `-1`, `-2`… và không bị ghi đè, kể cả khi tùy chọn file là `Ghi đè`.
- File trong thư mục con vẫn áp dụng quy tắc tránh trùng tên cũ; kết quả trả về giữ chính xác đường dẫn từng file đã lưu.

**Kiểm tra:** `node --check support/media/video-transcription-service.mjs`; `npm test` — build thành công, **33/33** bài kiểm tra đạt; gọi `/store-files` thật hai lần với 2 JPEG binary tạo `frames` và `frames-1`, đủ 4 file `.jpg`, sau đó xóa thư mục Temp kiểm tra.

## 2026-10-24 +07:00 — Tên gốc dự phòng từ cổng nguồn

- Khi dữ liệu không mang tên file thật, canvas chuyển nhãn cổng ra của node nguồn theo line vào executor (ví dụ `image[]` được chuẩn hóa thành `image`).
- Đặt tên và Lưu file dùng nhãn đó làm `#file-name#` trước khi mới dùng `undefine`.
- Tên file thật và `sourceName` đã được node trước đó xác định luôn được ưu tiên, nên quy tắc mới không đổi tên các file có nguồn gốc sẵn có.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-24 +07:00 — Tên thư mục lô theo cổng nguồn

- Khi Lưu file nhận nhiều file, thư mục con nay dùng cấu trúc `Tên cổng nguồn - Mẫu tên`.
- Mẫu tên vẫn được áp dụng đầy đủ (ví dụ `image - frame-0001`); nếu trùng, thư mục tự nhận hậu tố `-1`, `-2`… mà không ghi đè.
- Tên từng file bên trong vẫn theo mẫu tên và tên file gốc như trước.

**Kiểm tra:** `npm test` — build thành công, **33/33** bài kiểm tra đạt.

## 2026-10-24 +07:00 — Giữ nhãn cổng qua bước Đặt tên

- Đã sửa lỗi nội bộ của node Cơ bản Lưu file: bước `Đặt tên` không còn làm mất nhãn cổng nguồn trước khi chuyển sang bước `Lưu file`.
- Vì vậy dữ liệu nối từ `image[]` nay tạo folder `image - …`, thay vì rơi về `data - …`; quy tắc tương tự cũng áp dụng cho `audio` và `frameindex`.
- `FrameIndex` là metadata độc lập và chỉ được ghi khi nó được nối vào một node Lưu file riêng; nó không thể bị hỏng bởi việc ghi các frame JPG.

**Kiểm tra:** `npm test` — build thành công, **34/34** bài kiểm tra đạt, gồm test mô phỏng toàn pipeline xác nhận mọi file nhận `sourcePortName: "image"`.

## 2026-10-24 +07:00 — Lưu FrameIndex thành một timeline

- Cổng `frameindex` nay được nhận diện là một timeline duy nhất. Dù nó có nhiều frame, Lưu file sẽ ghi một `frameindex.json` thay vì tách thành nhiều JSON theo từng frame.
- Nhánh FrameIndex độc lập hoàn toàn với nhánh `image[]`; quá trình ghi các frame JPG không thể đổi hay làm mất FrameIndex.

**Kiểm tra:** `npm test` — build thành công, **35/35** bài kiểm tra đạt, gồm test xác nhận `frameindex.json` chứa đủ frame của timeline.

## 2026-10-24 +07:00 — Không diễn giải FrameIndex thành ảnh

- Đã xác định và sửa lỗi thực tế: các item của FrameIndex mang `runtimeKey` và `fileIndex` để AI tìm frame theo timecode. Bộ Lưu file trước đây nhầm hai trường metadata này là asset ảnh cần ghi.
- Khi cổng nguồn là `frameindex`, cả bước Đặt tên và Lưu file nay bỏ qua cơ chế trích asset; chúng ghi duy nhất `frameindex.json` chứa toàn bộ timeline.

**Kiểm tra:** `npm test` — build thành công, **35/35** bài kiểm tra đạt, gồm pipeline Lưu file Cơ bản với FrameIndex có runtimeKey/fileIndex trỏ tới JPG; request lưu chỉ có một JSON timeline, không có JPEG.

## 2026-10-24 +07:00 — Giữ đủ danh sách ảnh frame

- Đã sửa lỗi `frameImageAssets`: khi tạo Image[] từ frame index, code cũ dựng metadata từng frame từ mảng chỉ có một phần tử nên mọi frame đều nhận `fileIndex: 0`.
- Mỗi frame nay giữ index gốc riêng (`0`, `1`, `2`…), do đó Lưu file không khử trùng nhầm toàn bộ danh sách thành `frame-0001.jpg` duy nhất và sẽ tạo folder `image - …` với đầy đủ JPG.

**Kiểm tra:** `npm test` — build thành công, **36/36** bài kiểm tra đạt, gồm test hai frame có index `0`/`1` xác nhận Image[] giữ đúng cả index và tên ảnh.

## 2026-10-24 +07:00 — Tái sử dụng Stored file

- Lưu file nay lưu liên kết bền vững tới các file đã ghi (đường dẫn, tên, loại, kích thước). Ở lượt chạy sau, node nạp lại các file này và hoạt động như nguồn dữ liệu đầu ra mà không cần input hoặc Folder mới.
- Kiểm tra workflow không báo thiếu input cho node Lưu file đang có stored file; node mới/chưa lưu vẫn được kiểm tra như cũ.
- Thêm nút `Reset stored file` trong Output. Nút chỉ ngắt liên kết cached với file đã lưu, không xóa file thật trên máy; sau đó node trở lại trạng thái mới để nhận input và lưu vòng mới.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt, gồm test Lưu file có liên kết cũ trả lại đúng file cục bộ mà không gọi lại endpoint lưu.

## 2026-10-24 +07:00 — Nhóm node trong Workflow

- Thêm nhóm workflow bền vững: `Ctrl+G` gom các node đang chọn vào `Group 1`, `Group 2`…; `Ctrl+Shift+G` tách nhóm. Một node chỉ thuộc một nhóm để danh sách Workflow luôn rõ ràng.
- Nhóm hiển thị trong panel Workflow, không can thiệp luồng dữ liệu. Bấm tên nhóm chọn toàn bộ node; nhấn đúp tên để đổi tên; mũi tên bên phải ẩn/hiện toàn bộ node của nhóm trên canvas.
- Nhóm được lưu cùng workflow (phiên bản 6), khôi phục từ file/lần mở app gần nhất, và tham gia lịch sử Ctrl+Z/Ctrl+Shift+Z.
- Phần ngăn giữa Workflow và Properties nay kéo lên/xuống được; nhấn đúp thanh ngăn để trả về chiều cao mặc định.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; bổ sung kiểm tra tĩnh cho tạo/tách nhóm, đổi tên, ẩn/hiện, lưu workflow và thanh kéo dọc.

## 2026-10-24 +07:00 — Cây Workflow và kéo-thả nhóm

- Sửa ý nghĩa ẩn/hiện: mũi tên của node nhóm chỉ thu gọn/mở các node con trong panel Workflow. Node cha luôn hiện; canvas, kết nối và việc chạy workflow không còn bị ảnh hưởng.
- Workflow cũ từng lưu trạng thái `hidden` được chuyển thành `collapsed`; đồng thời app luôn mở lại node trên canvas để phục hồi lỗi ẩn nhầm trước đây.
- Thêm kéo-thả trong panel Workflow: kéo node vào tiêu đề nhóm để nhận cha mới, kéo lên node con để chèn/sắp xếp trong nhóm, hoặc kéo ra node/vùng gốc để tách khỏi nhóm và đổi thứ tự node gốc. Tiêu đề nhóm cũng kéo được để sắp xếp các nhóm.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; gồm kiểm tra tĩnh cho thu gọn cây Workflow, kéo-thả node/nhóm và không còn thông báo ẩn canvas.

## 2026-10-24 +07:00 — Bảo đảm ID node canvas là duy nhất

- Đã xác định nguyên nhân nhiều dòng Workflow chọn cùng một node canvas: `idCounter` quay về `20` sau khi mở app, có thể đụng ID của node đã nạp từ workflow cũ; React Flow xem các ID trùng là một node.
- Mọi node thêm mới hoặc dán từ clipboard giờ dò ID đang tồn tại trước khi cấp ID tiếp theo, nên không thể tạo collision sau khi mở lại app.
- Khi khôi phục/mở/import workflow có ID trùng, app tự đặt ID phục hồi riêng cho từng bản trùng và thông báo số node đã sửa. Các line cũ không thể xác định chủ sở hữu vẫn giữ tại node gốc, không đoán sang node khác.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; bổ sung kiểm tra hồi quy cho cấp ID không trùng và phục hồi workflow có ID trùng.

## 2026-10-24 +07:00 — Chọn nhiều node trong Workflow

- `Ctrl + click` (hoặc `Cmd + click`) trong cây Workflow thêm/bỏ từng node khỏi vùng chọn hiện tại.
- `Shift + click` chọn dải node theo thứ tự đang hiển thị; giữ `Shift` và quét qua các dòng node để cộng dồn node đi qua vào vùng chọn.
- Mọi node được chọn đều hiện trạng thái chọn trong Workflow, không chỉ node đang được mở trong Properties. Chức năng chỉ điều chỉnh selection, không đổi canvas, kết nối hoặc nhóm.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; thêm kiểm tra tĩnh cho Ctrl/Shift selection, thứ tự node Workflow và quét selection.

## 2026-10-24 +07:00 — Khung quét chọn trong Workflow

- Thay Shift quét theo dòng bằng khung quét hình chữ nhật như canvas: giữ `Shift`, bấm-kéo trong Workflow; mọi node con và tiêu đề node nhóm giao với khung đều được chọn.
- Chọn tiêu đề nhóm qua khung chọn toàn bộ node con của nhóm, kể cả nhóm đang thu gọn. Click vùng trống của Workflow bỏ toàn bộ vùng chọn.
- Selection thực hiện từ Workflow (chọn một node, Ctrl thêm/bỏ, chọn nhóm, khung quét, hoặc click bỏ chọn) được ghi một lần vào lịch sử; `Ctrl+Z` và `Ctrl+Shift+Z` hoàn tác/phục hồi đúng vùng chọn.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; thêm kiểm tra tĩnh cho marquee, click vùng trống và selection history.

## 2026-10-24 +07:00 — Kiểm tra Stored file là nguồn độc lập

- Sửa hai nhánh kiểm tra còn sót cho node Lưu file có Stored file: không còn yêu cầu thư mục lưu/Forder hoặc cổng `free` từ lượt lưu cũ.
- Bỏ kiểm tra phụ thuộc nguồn cũ cho node đang liên kết Stored file, nên việc node nguồn tạm ngưng không thể làm Stored file báo thiếu dữ liệu.
- Chỉ `Reset stored file` mới đưa node về trạng thái mới và kích hoạt lại đầy đủ yêu cầu Folder, `free` và nguồn đầu vào.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; thêm hồi quy tĩnh cho bypass Folder và dependency validation của Stored file.

## 2026-10-24 +07:00 — Nút Kiểm tra phản hồi và không im lặng khi gặp workflow cũ

- Chuẩn hóa thao tác **Kiểm tra** thành callback an toàn: sau mỗi lần bấm, màn hình luôn báo đã kiểm tra bao nhiêu node và tổng số node lỗi/thiếu; đồng thời vẫn chọn node lỗi đầu tiên để người dùng sửa ngay.
- Nếu một workflow cũ hoặc dữ liệu node bất thường làm bộ kiểm tra phát sinh ngoại lệ, app hiện rõ `Không thể kiểm tra workflow: ...` thay vì không phản hồi; lỗi cũng được ghi vào console để chẩn đoán kỹ thuật.
- Sửa `Ctrl+E` dùng ref tới callback hiện tại, không còn giữ closure của canvas cũ sau khi mở, nhập hoặc thay đổi workflow.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; đã kiểm thử trực tiếp nút Kiểm tra trên `http://localhost:3000` và xác nhận không có console error.

## 2026-10-24 +07:00 — Sửa lỗi Kiểm tra gặp node Lưu file

- Đã xác định lỗi `u is not a function`: biến Boolean cục bộ của nhánh Stored file che khuất hàm `hasReusableStoredFiles`. Khi Kiểm tra đi tới node Lưu file, code gọi nhầm Boolean như hàm.
- Đổi biến cục bộ thành `reusesStoredFiles`, giữ hàm kiểm tra Stored file nguyên vẹn và áp dụng cùng kết quả cho cả kiểm tra input lẫn thư mục lưu.
- Bổ sung kiểm thử hồi quy để bảo đảm Boolean không thể che khuất hàm kiểm tra Stored file lần nữa.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt.

## 2026-10-24 +07:00 — Ảnh kéo node trong Workflow

- Thay drag image mặc định của Chromium/Electron bằng preview độc lập, được tạo từ đúng hàng node/nhóm đang kéo.
- Preview chỉ mang nhãn của phần tử được kéo; không còn có thể chụp nhầm layer của panel Workflow, Properties hoặc canvas phía dưới.
- Preview bị loại khỏi DOM ngay ở frame kế tiếp sau khi hệ điều hành đã nhận ảnh kéo.

**Kiểm tra:** `npm test` — build thành công, **37/37** bài kiểm tra đạt; bổ sung kiểm tra hồi quy cho custom drag image và CSS preview.

## 2026-10-24 +07:00 — Lưu file: dùng lại hoặc cộng dồn Stored file

- Khi node Lưu file còn Stored file nhưng không nhận dữ liệu mới, nó được chạy như node đầu vào: trả lại các file đã liên kết và bỏ qua hoàn toàn chuỗi Đặt tên/Lưu file mới.
- Khi có dữ liệu vào, node đợi node nguồn hoàn tất, thực hiện lưu mới và gộp file mới với Stored file cũ; các file trùng đường dẫn không bị nhân đôi.
- Truyền Stored file từ node Cơ bản xuống virtual step Lưu file, nhờ đó cả hai loại node đều có cùng quy tắc tái sử dụng/cộng dồn.

**Kiểm tra:** `npm test` — build thành công, **39/39** bài kiểm tra đạt; thêm kiểm thử cho node Cơ bản dùng Stored file như nguồn và luồng cộng dồn file mới.

## 2026-10-25 +07:00 — Phân tích AI đọc FrameIndex đã lưu

- Chẩn đoán dữ liệu thật trong `C:\Users\Owner\Desktop\Test-Media`: `frameindex.json` có 120 mốc hợp lệ và thư mục `image - frame-0001` chứa bộ frame tương ứng; file lưu không bị mất mốc.
- Sửa node Phân tích video bằng AI: khi cổng FrameIndex nhận `frameindex.json` từ Lưu file, app đọc và parse JSON thành timeline thay vì coi bản thân file JSON là một entry frame.
- Giữ hỗ trợ cho FrameIndex trực tiếp từ node chuẩn bị tư liệu; lỗi mới chỉ xuất hiện khi JSON không đọc được hoặc không chứa timeline hợp lệ.

**Kiểm tra:** `npm test` — build thành công, **40/40** bài kiểm tra đạt; thêm test hồi quy cho FrameIndex JSON đã lưu, xác nhận 2 frame thử nhận đúng 2 timecode từ JSON.

## 2026-10-25 +07:00 — Sao chép Output và thay model OpenAI đã ngừng

- Output ở Properties có nút `Sao chép output`; vùng JSON/lỗi cũng cho phép bôi đen văn bản và `Ctrl+C`. Khi Clipboard API không khả dụng, app dùng cơ chế copy dự phòng của Electron/trình duyệt.
- Loại `gpt-4.1-nano` khỏi chính sách tự chọn model. Workflow cũ hoặc model trong cache còn ID này được chuyển thành `gpt-5-nano` khi nạp UI và ngay trước cả hai đường gọi Responses API (văn bản và vision), nên không còn gửi model đã ngừng tới OpenAI.
- Danh sách model OpenAI được làm mới cũng chuẩn hóa ID đã ngừng, tránh để lựa chọn cũ quay lại giao diện.

**Kiểm tra:** `npm test` — build thành công, **40/40** bài kiểm tra đạt.

## 2026-10-25 +07:00 — Model tập trung ở Thiết lập AI cho phân tích media

- Bỏ lựa chọn Model AI khỏi node `Phân tích video bằng AI`; node Phân tích hình ảnh/âm thanh vốn không có lựa chọn trùng này.
- Cả ba node phân tích media chỉ dùng nhà cung cấp, model và API key nhận qua cổng `AIModel` từ `Thiết lập AI`; không còn âm thầm dùng model/key cũ trong cấu hình riêng của node phân tích.
- Khi thiếu kết nối đó, bộ thực thi báo rõ cần nối cổng AIModel thay vì phát sinh lỗi API khó hiểu.

**Kiểm tra:** `npm test` — build thành công, **41/41** bài kiểm tra đạt.

## 2026-10-25 +07:00 — Tìm ảnh tương đồng cục bộ và điều kiện qua dây

- Thêm node Chi tiết `Tìm ảnh tương đồng` trong nhóm Hình ảnh. Node nhận `Mẫu ảnh`, `Kho ảnh` và `FrameIndex`; người dùng có thể cắt một vùng mẫu trực tiếp từ ảnh đã nối. Khi chạy, app quét cục bộ từng frame, trả ảnh mẫu đã cắt (có thể nối sang Lưu file), các frame đạt ngưỡng kèm điểm tương đồng/timecode, và `Condition` để điều khiển nhánh.
- Bổ sung `Condition` cho If/Else và Switch. If/Else ưu tiên Boolean nối qua dây (vẫn có điều kiện dự phòng khi chưa nối); Switch nhận giá trị qua dây, so với Nhánh 1/Nhánh 2 rồi đưa dữ liệu sang Mặc định khi không khớp.
- Chuẩn hóa hợp đồng cổng: `Boolean` nối được với `Condition`; `Mẫu ảnh`, `Kho ảnh`, `Ảnh mẫu` dùng đúng kiểu Image, do đó có thể nối với node nguồn ảnh/Lưu file mà không phải chuyển kiểu thủ công.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt; có test hồi quy cho tương thích Boolean → Condition và chọn nhánh If/Else/Switch qua cổng.

## 2026-10-25 +07:00 — Hiển thị block tìm ảnh ở thư viện Cơ bản

- Bổ sung block Cơ bản `Tìm ảnh tương đồng` vào nhóm Hình ảnh; trước đó node mới chỉ có ở tab Chi tiết nên không hiện khi thư viện đang mở mặc định ở Cơ bản.
- Block có một thao tác cố định, vì vậy khi thêm sẽ tạo trực tiếp node tìm ảnh, không buộc người dùng chọn thao tác thừa.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt.

## 2026-10-25 +07:00 — Tìm ảnh: nguồn trực tiếp, folder và đầu ra theo số lượng ảnh

- Ảnh mẫu có thể nhận qua cổng `Mẫu ảnh` hoặc chọn trực tiếp trong Properties; hai nguồn loại trừ nhau. Trình cắt vùng chính xác dùng được cho cả hai nguồn và ảnh mẫu cắt vẫn xuất ra cổng `Ảnh mẫu` để lưu lại.
- `FrameIndex` trở thành cổng tùy chọn. Khi có FrameIndex, danh sách khớp có timestamp/timecode; khi không có, kết quả giữ tên ảnh khớp thay vì bịa timecode.
- Ảnh cần tìm có chế độ `Chọn ảnh` (nối `Kho ảnh` hoặc chọn trực tiếp một/nhiều ảnh) và `Chọn folder ảnh` (chọn thư mục, quét ảnh cục bộ, có tùy chọn thư mục con/giới hạn số ảnh).
- Một ảnh ở chế độ Chọn ảnh chỉ xuất `Condition` true/false; nhiều ảnh hoặc folder xuất `ImageMatch[]`. Cả hai vẫn giữ `Ảnh mẫu` làm output có thể lưu.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt.

## 2026-10-25 +07:00 — Phân vai cổng cho node Tìm ảnh tương đồng

- Thay hai cổng `image` trùng vai trò bằng `image-sample`, `image-search`, `image-search-list` và `search-folder`; `frameindex` vẫn là tùy chọn để đính timestamp/timecode.
- `image-sample` chỉ nhận mẫu đối chiếu; `image-search` nhận một ảnh để trả `Condition` đúng/sai; `image-search-list` nhận nhiều ảnh; `search-folder` nhận đường dẫn thư mục. Cả bốn vẫn tương thích trực tiếp với Image/Image[]/Folder chuẩn qua dây.
- Bộ thực thi chỉ dùng đúng một nguồn ảnh cần tìm, giữ lựa chọn trực tiếp trong Properties, và không nhầm dữ liệu đã chọn ở chế độ ảnh với chế độ folder. Workflow cũ tự map `Mẫu ảnh` sang `image-sample` và `Kho ảnh` sang `image-search-list` khi mở lại.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt.

## 2026-10-25 +07:00 — Tối ưu vận hành node Tìm ảnh tương đồng

- Sắp xếp lại Properties thành ba cụm ngăn cách rõ: ảnh mẫu, nguồn ảnh cần tìm, và ngưỡng/kết quả; phần hướng dẫn nêu đúng cổng tương ứng cho từng cách nạp.
- Khi thay ảnh mẫu hoặc nối `image-sample`, app xóa vùng cắt cũ để không dùng tọa độ của ảnh trước; khi nối một nguồn tìm kiếm, app xóa lựa chọn trực tiếp xung đột. Kiểm tra workflow giờ báo cụ thể thiếu ảnh mẫu, thiếu nguồn ảnh để tìm, nhiều nguồn cùng lúc, hoặc chưa cắt vùng mẫu.
- Tìm tương đồng dùng quét thưa để giữ tốc độ rồi rà từng pixel quanh vị trí tốt nhất, giúp kết quả không bị lệch bởi bước quét thô.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt.

## 2026-10-26 +07:00 — PhoWhisper cho transcript tiếng Việt cục bộ

- Bổ sung hai bộ xử lý cục bộ quản lý thủ công: `PhoWhisper base` và `PhoWhisper small`. Chúng xuất hiện trong Workflow → Điều chỉnh xử lý cục bộ, mặc định chưa cài đặt, và chỉ tải/cập nhật/gỡ khi người dùng bấm thao tác tương ứng.
- Bổ sung hai lựa chọn tương ứng trong node Chuẩn bị tư liệu phân tích video; model chưa cài luôn có nhãn `(Chưa cài đặt)` đồng bộ với trạng thái quản lý.
- PhoWhisper chạy bằng checkpoint ONNX tương thích Transformers.js hiện có. Khi chọn PhoWhisper, bộ thực thi ép `language=vi` vì đây là model chuyên tiếng Việt; vẫn giữ timestamp và cơ chế tạm dừng/dừng tiến trình cục bộ.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt.

## 2026-10-27 +07:00 — Trình ghi kết quả kiểm thử transcript cục bộ

- Bổ sung `support/scripts/capture-local-transcript.mjs` để gửi một tệp media đến bộ transcript cục bộ đang chạy và lưu nguyên phản hồi JSON. Dùng khi đánh giá chất lượng model trên video thực tế mà không làm mất transcript sau khi tác vụ hoàn tất.
- Script nhận đường dẫn nguồn, đường dẫn kết quả và nhãn model tùy chọn; mặc định là PhoWhisper small tiếng Việt, đồng thời dùng đúng cấu hình app: tiếng Việt, tách đoạn 10 phút và làm rõ giọng nói.
- Sửa worker Whisper: audio dài được chia thành cửa sổ 30 giây, chồng 5 giây trước khi nhận dạng. Nếu không có cấu hình này, Transformers.js chỉ nhận dạng phần đầu mỗi khối audio lớn và trả timestamp không đáng tin cậy. PhoWhisper small ONNX hiện không xuất cross-attention, vì vậy không thể dùng timestamp từng từ; app giữ timestamp theo đoạn an toàn thay vì làm lỗi tác vụ.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt. PhoWhisper small đã xử lý lại đủ 120 giây audio mẫu sau khi khởi động lại dịch vụ; xác nhận chunking hoạt động và timestamp từng từ không được checkpoint ONNX hỗ trợ.

## 2026-10-27 +07:00 — Hợp nhất node transcript chi tiết

- Ẩn node API cũ `Trích xuất transcript video` khỏi thư viện Chi tiết và chỉ giữ `Tạo transcript video theo thời gian` làm node phiên âm video thống nhất.
- Node còn lại bắt buộc chọn `Transcript cục bộ` hoặc `Transcript bằng API`. Chế độ cục bộ hiển thị model đã quản lý trong Workflow → Điều chỉnh xử lý cục bộ và không hiển thị/không nhận cổng API key. Chế độ API mới hiển thị API key và cổng APIKey.
- Workflow cũ dùng node API bị gỡ được tự chuyển sang node thống nhất, giữ tên do người dùng đổi; node tên mặc định được đổi theo họ mới. Kiểm tra workflow và executor chỉ yêu cầu API key khi người dùng chọn chế độ API.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt.

## 2026-10-29 +07:00 — Đưa mã nguồn Content Flow vào Git

- Bổ sung README theo đúng Content Flow AI Canvas, kèm hướng dẫn chạy, kiểm tra, nguyên tắc cấp API key và ranh giới dữ liệu cục bộ.
- Cập nhật `.gitignore` để không đưa cache model, trạng thái processor theo máy, log, audio/media thử nghiệm và dependency vendor trong tài liệu tham chiếu vào repository.

**Kiểm tra:** `npm test` — build thành công, **42/42** bài kiểm tra đạt.

## 2026-10-30 +07:00 — Định dạng Tesseract và đóng gói Windows

- Đổi workflow mới sang tệp `.tess` có header `TESSERACT/1` và envelope định dạng riêng; app vẫn nhận workflow JSON cũ để người dùng mở rồi lưu chuyển đổi an toàn.
- Thêm icon Tesseract dạng SVG và `.ico` đa kích cỡ, dùng cho metadata web, cửa sổ Electron và file association `.tess` khi cài ứng dụng Windows.
- Đổi nhận diện desktop thành Tesseract, thêm cấu hình `electron-builder` tạo ứng dụng cài đặt với file thực thi `Tesseract.exe`; script đóng gói đăng ký phần mở rộng `.tess`.

**Kiểm tra:** `npm test` — build thành công, **44/44** bài kiểm tra đạt.

## 2026-10-30 +07:00 — Phân biệt icon ứng dụng và icon workflow

- Thay chữ `T` trên thanh ứng dụng bằng icon khối Tesseract thực tế.
- Tạo icon `.tess` riêng: tờ giấy có biểu tượng Tesseract, dùng khi Windows liên kết tệp workflow với ứng dụng.
- Cập nhật công cụ tạo `.ico` để sinh đồng thời icon ứng dụng và icon tài liệu đa kích cỡ; cấu hình installer dùng đúng icon tài liệu cho phần mở rộng `.tess`.

**Kiểm tra:** `npm test` — build thành công, **44/44** bài kiểm tra đạt. Đã cài installer, xác nhận registry `.tess` trỏ đến `tesseract-document.ico` và `Tesseract.exe` khởi động với server nội bộ HTTP 200.

## 2026-10-31 +07:00 — Quy trình YCKT

- Thống nhất dùng `YCKT.xlsx` làm sổ yêu cầu kỹ thuật: đề xuất phạm vi, đầu ra, trạng thái; chỉ triển khai khi kế hoạch được người dùng phê duyệt.
- Bỏ qua `YCKT.xlsx` trong Git để đây luôn là tài liệu làm việc cục bộ, không bị stage hay push nhầm.

**Kiểm tra:** `git check-ignore -v YCKT.xlsx` xác nhận quy tắc bỏ qua hoạt động.

## 2026-10-31 +07:00 — REC-01: Hợp đồng workflow gọi lại

- Mỗi workflow `.tess` mới có `workflowId` ổn định, được tạo một lần và giữ nguyên qua các lượt lưu, mở lại hoặc xuất tệp.
- Định nghĩa interface phiên bản 1 được lưu cả trong envelope `.tess` lẫn workflow: danh sách cổng vào/cổng ra gồm ID, tên, kiểu dữ liệu, cờ bắt buộc và mô tả tùy chọn. Dữ liệu bị thiếu, sai kiểu hoặc trùng ID bị chặn ngay khi lưu/mở.
- File `.tess` phiên bản cũ và JSON workflow cũ vẫn mở được; chỉ workflow mới/lần lưu mới mới nhận metadata ổn định. Desktop trả lại workflow đã chuẩn hóa để giao diện đồng bộ ID/interface sau khi lưu.

**Kiểm tra:** `npm test` — build thành công, **45/45** bài kiểm tra đạt.

## 2026-10-31 +07:00 — REC-02: Node Cổng vào / Cổng ra

- Thêm hai node Chi tiết trong nhóm Điều khiển workflow: `Cổng vào` công bố dữ liệu workflow nhận từ caller; `Cổng ra` nhận dữ liệu workflow trả lại caller. Mỗi workflow chỉ có một node mỗi loại để interface không mơ hồ.
- Properties cho phép thêm, xóa, đổi tên, đổi kiểu dữ liệu, đặt bắt buộc và sắp thứ tự cổng. Mỗi cổng có ID ổn định, nên đổi tên/sắp thứ tự không làm đứt dây đã nối hoặc interface đã lưu.
- Interface `.tess` nay được tạo trực tiếp từ hai node gateway mỗi khi lưu/xuất. Gateway có executor tối thiểu để phát lại dữ liệu caller theo ID cổng; chưa thực hiện việc đọc/chạy workflow con (thuộc REC-03).

**Kiểm tra:** `npm test` — build thành công, **46/46** bài kiểm tra đạt.

## 2026-10-31 +07:00 — REC-03: Node Gọi workflow

- Thêm node Chi tiết `Gọi workflow` trong nhóm Điều khiển workflow. Node có thể chọn một file `.tess` hoặc dùng snapshot workflow hiện đang mở; sau khi chọn đích, toàn bộ cổng vào/cổng ra được tạo lại theo interface công bố bởi Cổng vào/Cổng ra.
- Luồng chạy tuần tự được thực thi thật: dữ liệu từ node cha đi vào Cổng vào của workflow con theo ID cổng ổn định, dữ liệu tại Cổng ra quay lại output của node gọi. Workflow con có thể tiếp tục gọi workflow khác; tiến trình trả về Properties của node gọi.
- Đọc file workflow qua IPC ở main process, kiểm tra file/interface đã đổi trước khi chạy, và báo rõ mục tiêu thiếu hoặc interface không còn khớp. Khi đổi đích, các dây cũ tại node gọi được tháo để tránh giữ kết nối sai hợp đồng.
- Chế độ workflow đang mở dùng snapshot canvas hiện tại, do đó có thể tự gọi. Bộ chặn sâu tối đa 32 và tổng tối đa 500 lượt gọi đã có ở runtime; kiểm tra đồ thị vòng gọi đầy đủ sẽ hoàn tất ở REC-05.

**Kiểm tra:** `npm test` — build thành công, **48/48** bài kiểm tra đạt; thêm kiểm thử truyền dữ liệu qua Cổng vào/Cổng ra và gọi workflow lồng qua resolver.

## 2026-10-31 +07:00 — REC-04: Mở nhiều workflow

- Thêm thanh tab workflow. Mở `.tess` mới tạo một tab riêng; nếu tệp đã mở, app chuyển về đúng tab thay vì nạp đè canvas đang xem. Nút `Mới`/`Ctrl+N` cũng tạo tab riêng.
- Mỗi tab giữ canvas, dây, nhóm, node đang chọn, undo/redo, đường dẫn và mốc lưu riêng. Khi chuyển tab, runtime file tạm được nạp lại theo tab mới để không lẫn dữ liệu giao diện; chỉ tab đang hoạt động được render lên canvas.
- Tab hiện dấu vàng khi có thay đổi chưa lưu; lưu workflow cập nhật đúng mốc của tab đó. Đóng tab chưa lưu yêu cầu xác nhận; đóng tab đang hoạt động chuyển sang tab còn lại, chỉ hiện màn hình đóng khi không còn tab nào.
- Node `Gọi workflow` ở chế độ Workflow đang mở có danh sách các tab, có thể tham chiếu và chạy một workflow đang mở khác hoặc chính tab hiện tại. Dữ liệu runtime của tab đang gọi được ưu tiên, tránh dùng snapshot giao diện cũ.

**Kiểm tra:** `npm test` — build thành công, **48/48** bài kiểm tra đạt; test SSR kiểm tra các điểm neo của thanh tab và đường đồng bộ workflow đang mở.

## 2026-10-31 +07:00 — REC-05: Chặn đệ quy workflow

- Khi bấm Kiểm tra hoặc Chạy, app duyệt đồ thị workflow đang mở và các file `.tess` được gọi để phát hiện cả vòng trực tiếp `A → A` lẫn vòng gián tiếp `A → B → C → A` trước khi thực thi.
- Lỗi chỉ rõ đầy đủ chuỗi workflow tạo vòng và đánh dấu node `Gọi workflow` khởi đầu đường gọi đó; workflow không được chạy khi còn vòng hoặc không thể đọc đích được gọi.
- Bổ sung chặn dự phòng ngay tại runtime theo call stack, nên một thay đổi file sau lúc kiểm tra hoặc một đường gọi không thể duyệt trước cũng bị dừng có thông báo thay vì chạy vô tận. Vẫn giữ giới hạn sâu 32 và tối đa 500 lượt gọi mỗi lượt chạy.
- Tách bộ dò đồ thị dùng chung vào `shared/workflow-recursion.mjs`, có kiểm thử trực tiếp cho vòng `A → A`, `A → B → C → A`, và đồ thị hợp lệ không vòng.

**Kiểm tra:** `npm test` — build thành công, **51/51** bài kiểm tra đạt.

## 2026-10-31 +07:00 — REC-06: Kiểm thử và nghiệm thu workflow gọi lại

- Mở rộng regression bằng ca workflow có vòng trực tiếp, vòng ba workflow, đồ thị hợp lệ, đích `.tess` không đọc được và đường gọi qua các tab có `workflowId` ổn định. Tổng suite hiện có 53 ca.
- Thêm checklist nghiệm thu thủ công tại `support/checklists/workflow-call-acceptance.md`: truyền dữ liệu qua Cổng vào/Cổng ra, interface thay đổi, vòng trước khi chạy, vòng phát sinh sau kiểm tra, file/tab không tồn tại, nhiều tab và hai giới hạn runtime.
- Checklist nêu rõ đây là bản phát triển: không đóng gói hoặc cập nhật bản cài cho đến khi người dùng duyệt phát hành chính thức.

**Kiểm tra:** `npm test` — build thành công, **54/54** bài kiểm tra đạt.

## 2026-10-31 +07:00 — Sửa tab workflow mới bị ghi đè

- Sửa cơ chế khôi phục workflow cục bộ: chỉ nạp workflow gần nhất đúng một lần khi app khởi động.
- Tạo tab bằng `+`, `Mới` hoặc `Ctrl+N` nay giữ workflow trống với `workflowId` riêng; mở một file khác giữ dữ liệu của file đó ở tab mới, không bị file/tab trước ghi đè.

**Kiểm tra:** `npm test` — build thành công, **54/54** bài kiểm tra đạt.

## 2026-10-31 +07:00 — Chọn workflow trên web và chuẩn hóa tên cổng

- Node `Gọi workflow` nay nhận file `.tess` từ input trình duyệt khi không có Tesseract Desktop. App đọc và lưu bản workflow nhúng vào node, đồng bộ cổng, kiểm tra đệ quy và cho phép chạy thử không cần IPC/đường dẫn máy.
- Bản Desktop vẫn ưu tiên đọc file qua IPC để dùng đúng tệp tại đường dẫn đã chọn.
- Tên cổng của `Cổng vào`/`Cổng ra` tự bỏ khoảng trắng và thay bằng `_`. Khi người dùng rời ô tên để trống, tên trở về mặc định `Cổng_1`, `Cổng_2`…; cổng mới cũng dùng mẫu này.

**Kiểm tra:** `npm test` — build thành công, **54/54** bài kiểm tra đạt.

## 2026-10-31 +07:00 — Run_App luôn chạy source mới

- Xác định `Run_App.bat` trước đây mở Electron nhưng Electron dùng `vinext start`; server chỉ đọc `dist` đã build nên source mới có thể không xuất hiện sau khi mở lại.
- Khi chạy từ thư mục source, launcher nay dùng `vinext dev` trên cổng `4318`, tách khỏi server cũ ở cổng `3000` và tự phản ánh source hiện tại. Bản Electron đóng gói vẫn dùng `vinext start` trên cổng `3000`, không thay đổi hành vi phát hành.

**Kiểm tra:** `npm test` — build thành công, **55/55** bài kiểm tra đạt.

## 2026-10-31 +07:00 — Khôi phục quyền đọc workflow trong Tesseract Desktop

- **Vấn đề:** node **Gọi workflow** báo sai rằng chỉ dùng được trong Tesseract Desktop, dù người dùng đã mở đúng từ `Run_App`.
- **Nguyên nhân:** cửa sổ Electron dùng `desktop/preload.cjs`, nhưng cầu nối `readWorkflowAtPath` chỉ có trong `preload.mjs`; giao diện vì vậy không thấy hàm đọc `.tess`.
- **Thực hiện:** bổ sung `readWorkflowAtPath` vào đúng preload `.cjs` và kiểm thử hồi quy rằng preload cùng main process đều có kênh IPC này.
- **Kết quả mong đợi:** chọn `.tess` trong node Gọi workflow sẽ đọc file, đồng bộ các cổng Cổng vào/Cổng ra và không còn báo nhầm là ngoài Desktop.
- **Kiểm tra:** `npm test` — build thành công, **56/56** bài kiểm tra đạt.

## 2026-10-31 +07:00 — Quản lý AI local Ollama

- Thêm **Workflow → Quản lý AI**: quét `Ollama` tại máy cục bộ, hiển thị tên model, dung lượng, thời điểm cập nhật, rồi cho người dùng chủ động thêm/gỡ khỏi danh mục Tesseract.
- Danh mục model được lưu theo máy trong profile app, không ghi vào workflow `.tess`. Nút **Gỡ khỏi Tesseract** chỉ gỡ lựa chọn của app, không gọi `ollama rm` và không xóa model vật lý.
- Node **Thiết lập AI** khi chọn Ollama nay chỉ hiển thị model đã thêm; Ollama không yêu cầu API key. Node **Xử lý văn bản bằng AI** đã gọi được Ollama cho văn bản/JSON.
- Bổ sung endpoint quét cục bộ, thông báo lỗi kết nối rõ ràng, kiểm thử registry và regression UI. Tắt `thinking` mặc định cho lượt gọi Ollama để các model Qwen trả output thực thay vì dùng hết giới hạn ngắn cho reasoning nội bộ.
- Đã thử trên máy: quét được 6 model Ollama và gọi `qwen3:1.7b` qua API Tesseract thành công, trả `sẵn sàng` với 40 token vào, 5 token ra, không dùng API key.

**Kiểm tra:** `npm test` — build thành công, **58/58** bài kiểm tra đạt.

## 2026-11-01 +07:00 — DAT-01 đến DAT-04: Hợp đồng dữ liệu và runtime Artifact

- Thêm `app/data-contracts.ts` làm nguồn chuẩn v1 cho `ArtifactType`, `PortSpec`, `Artifact`, provenance, `NodeRunRecord` và `NodeDiagnostic`. Các kiểu `ImageSet`, `FrameIndex`, `TimedTranscript`, `StoredFiles`, `Report` và profile AI được phân biệt thay vì suy đoán từ JSON/đường dẫn.
- Mỗi cổng mới và cổng gateway workflow nay suy ra kiểu Artifact cùng cardinality `một`/`nhiều`. Canvas từ chối line có số lượng không phù hợp; cổng `nhiều` có thể nhận nhiều nguồn và runtime gộp đúng payload cho executor.
- Runtime workflow tạo Artifact có ID, type, name, metadata và provenance theo workflow/node/cổng/run. Trong giai đoạn chuyển đổi, executor cũ nhận payload đã unbox để workflow `.tess` cũ tiếp tục chạy; Properties hiển thị số Artifact input/output và chẩn đoán của lần chạy gần nhất.
- Trạng thái chạy chuẩn hóa thành queued/running/success/failed/cancelled. Khi lỗi, node giữ Diagnostic có mã, thông điệp và gợi ý chạy lại; khi dừng, các node đang chờ/chạy được đánh dấu cancelled.

**Kiểm tra:** `npm test` — build thành công, **59/59** bài kiểm tra đạt. Regression mới xác nhận `Image[]` là `ImageSet`, cardinality, provenance, unwrap payload cũ và Diagnostic.

## 2026-11-01 +07:00 — DAT-05: Stored file giữ hợp đồng Artifact

- Node `Lưu file` khi chạy thành công nay lưu thêm tóm tắt Artifact của tập file đang liên kết, gồm kiểu dữ liệu và provenance runtime; điều này làm rõ file đang tái sử dụng là audio, image set, frame index… thay vì chỉ là một danh sách đường dẫn.
- `Reset stored file` giờ xóa đồng thời file liên kết, Artifact, output và lịch sử lần chạy của node, đưa node về đúng trạng thái node lưu mới.
- Inspector hiển thị kiểu Artifact đang được tái sử dụng và nguồn runtime, trong khi hành vi có sẵn vẫn được giữ: không có input mới thì dùng stored file như node nguồn; có input mới thì lưu thêm vào tập stored file.

**Kiểm tra:** `npm test` — build thành công, **59/59** bài kiểm tra đạt. Bổ sung regression tĩnh cho metadata Artifact của Stored file và thao tác reset.

## 2026-11-01 +07:00 — DAT-06: AIExecutionProfile, TaskSpec và Report

- Thêm hợp đồng `AIExecutionProfile`: provider, model, chế độ `api`/`local`, endpoint, các giới hạn token và `secretRef`. API key không còn nằm trong profile/output/Artifact; nó chỉ sống trong cache phiên runtime và được tra lại bằng `secretRef` khi gọi AI.
- Node `Chọn nhà cung cấp AI` và `Chọn mô hình AI` nay phát profile chuẩn. Workflow cũ vẫn được đọc qua adapter trong `aiCallSettings`, nên không phải sửa lại dây hay file `.tess` đã có.
- Node gọi AI tạo `TaskSpec` (mục tiêu, kiểu input/output, tiêu chí) và bao kết quả bằng `Report` chuẩn gồm kết luận, bằng chứng, độ tin cậy khi có, trạng thái cần xem lại/cần sửa và mục sửa. Các trường output cũ được giữ nguyên để node sau tương thích.

**Kiểm tra:** `npm test` — build thành công, **61/61** bài kiểm tra đạt. Regression xác nhận profile Ollama/API không chứa API key, giữ `secretRef`, và Report luôn truy được TaskSpec/bằng chứng.

## 2026-11-01 +07:00 — DAT-07: Interface workflow gọi lại có hợp đồng typed

- `.tess` nay giữ lại `artifactType` và cardinality `một`/`nhiều` cho từng cổng của Cổng vào/Cổng ra. Workflow cũ không có hai trường này vẫn được adapter suy ra từ `type` như trước.
- Node `Gọi workflow` lưu dấu vân tay interface tại thời điểm đồng bộ. Lúc chạy, app đối chiếu dấu vân tay thay vì chỉ so JSON mơ hồ; nếu workflow con thay đổi, lỗi nêu cụ thể cổng vào/ra nào bị thêm, mất hoặc đổi hợp đồng và yêu cầu người dùng bấm Đồng bộ để xác nhận.
- Giữ toàn bộ giới hạn an toàn đã có: chặn đệ quy trực tiếp/lồng vòng, sâu tối đa 32, tổng lời gọi tối đa 500. Không tự đồng bộ hoặc tự thay dây của caller khi interface workflow con đổi.

**Kiểm tra:** `npm test` — build thành công, **62/62** bài kiểm tra đạt. Regression mới xác nhận .tess giữ typed port, nhận ra lỗi thay đổi hợp đồng, cùng các test vòng đệ quy đã có.

## 2026-11-01 +07:00 — DAT-08: Version và tương thích workflow .tess

- Nâng version tài liệu `.tess` lên 3, thêm `dataContractVersion: 1` vào envelope và workflow khi lưu. Phiên bản này thể hiện rõ hợp đồng Artifact/PortSpec được ghi trong file, không biến dữ liệu lớn thành JSON nhúng.
- Adapter tiếp tục đọc các file `.tess` v1/v2 và workflow JSON cũ. File mới hơn version Tesseract hoặc hợp đồng dữ liệu app hỗ trợ sẽ dừng với thông báo cần cập nhật app, thay vì mở sai dữ liệu.
- Hoàn tất regression cho lưu/đọc `.tess`, cổng typed, thay đổi interface caller, đệ quy, stored file, AI local/API và schema cũ. Không đóng gói, không push, không thay bản cài chính thức.

**Kiểm tra:** `npm test` — build thành công, **63/63** bài kiểm tra đạt. Có test mới cho migration `.tess` v2 và chặn file mới hơn app.

## 2026-11-01 +07:00 — SYNC-01 đến SYNC-03, RCR-01 đến RCR-02: Đồng bộ workflow gọi lại an toàn

**Phạm vi:** Đồng bộ interface của node `Gọi workflow`, kiểm lỗi line sau khi interface đổi và nhận diện vòng đệ quy theo định danh workflow thực.

- Khi Cổng vào/Cổng ra của workflow được gọi thay đổi, app tạo kế hoạch đồng bộ cổng, giữ nguyên các line còn hợp đồng tương thích và chỉ liệt kê line cần người dùng nối lại. App không còn xóa toàn bộ line quanh node `Gọi workflow`.
- Trước khi kiểm tra/chạy workflow, app đối chiếu interface đã lưu với interface hiện tại; chặn rõ ràng khi caller chưa đồng bộ hoặc còn cổng/line không hợp lệ.
- Định danh đệ quy nay kết hợp `workflowId` với đường dẫn chuẩn hóa. Vì vậy các file Save As/copy giữ cùng ID không còn bị báo sai là tự gọi chính mình, trong khi vòng A → B → C → A thật vẫn bị chặn và chỉ đúng node gọi tạo vòng.

**Kiểm tra:** `npm.cmd test` — build thành công, **68/68** bài kiểm tra đạt; bao gồm hồi quy giữ line khi đồng bộ, cổng mới không buộc nối lại, line mất/đổi kiểu cần nối lại, nhận diện đường dẫn Windows và vòng đệ quy thật. Không đóng gói và không push.

## 2026-11-01 +07:00 — AIC-01: Danh mục node AI v1

**Phạm vi:** Rà soát thư viện node AI hiện hữu để xác định ranh giới của AI tổng quát, Media và kiểm tra theo quy tắc.

- Thêm danh mục máy đọc được `shared/ai-node-catalog.mjs` cho 12 họ node AI, mô tả đúng cổng vào/ra hiện có, mục đích, quyết định chuyển đổi và đích v1.
- Chốt bốn năng lực AI lõi: **Cấu hình AI**, **Tạo prompt**, **Thực thi tác vụ AI**, **Kiểm tra bằng AI**. Node media sẽ chuyển lối tạo sang nhóm Media; các node chấm/duyệt heuristic chỉ là tương thích cho kiểm tra không AI.
- Ghi tài liệu `references/AI_NODE_AUDIT_V1.md`: không xóa node hoặc làm đứt line workflow cũ trong quá trình chuyển đổi.

**Kiểm tra:** `npm.cmd test` — build thành công, **70/70** bài kiểm tra đạt. Regression xác nhận 12 họ node được danh mục hóa đúng một lần, có mặt trong specs và giữ ranh giới AI tổng quát/Media/kiểm tra quy tắc.

## 2026-11-01 +07:00 — AIC-02: Node Thực thi tác vụ AI

**Phạm vi:** Thêm một node AI tổng quát cho tác vụ văn bản/JSON, không gắn tên video hoặc media.

- Thêm node cơ bản **Thực thi tác vụ AI**. Node chỉ nhận profile qua cổng `AIModel`; không có lựa chọn model/API key riêng, nên dùng đúng provider/model mà node Thiết lập AI truyền tới.
- Hỗ trợ bốn loại tác vụ v1: tạo nội dung, phân loại, trích xuất và phân tích. Node nhận Dữ liệu hoặc Prompt, SystemPrompt tùy chọn, chỉ dẫn bắt buộc, tiêu chí hoàn thành và chọn output Văn bản/JSON.
- Mỗi lần chạy trả `AIResult`, `Report` và `CachedData`. Kết quả được bao cùng `TaskSpec`, bằng chứng nguồn input, mức dùng token và trạng thái cần xem lại; API key không nằm trong output.

**Kiểm tra:** `npm.cmd test` — build thành công, **71/71** bài kiểm tra đạt. Regression mô phỏng lời gọi AI xác nhận profile bắt buộc, request dùng profile nối dây, và ba output gồm kết quả/TaskSpec, Report, cache đều đúng.

## 2026-11-01 +07:00 — AIC-03: Node Kiểm tra bằng AI

**Phạm vi:** Bổ sung kiểm tra chất lượng bằng AI có kết luận và hướng sửa dùng được cho vòng phản hồi.

- Thêm node cơ bản **Kiểm tra bằng AI** trong nhóm Kiểm tra chất lượng. Node nhận sản phẩm qua `Dữ liệu`, profile qua `AIModel`, cùng Mục tiêu, Checklist và mức nghiêm ngặt.
- AI bị ràng buộc trả JSON có status, evidence và issues. Runtime chuẩn hóa thành `Đạt`, `Cần sửa` hoặc `Không đạt`, đồng thời tạo `repairItems` gồm vị trí, lý do và cách sửa.
- Output có `QAReport`, `Report` chuẩn chứa TaskSpec và `CachedData`. Cổng AIModel bắt buộc; node cũ Chấm điểm/Duyệt đầu ra AI vẫn là kiểm tra quy tắc tương thích, không bị gọi nhầm là AI check.

**Kiểm tra:** `npm.cmd test` — build thành công, **72/72** bài kiểm tra đạt. Regression mô phỏng AI trả cảnh báo có bằng chứng, xác nhận verdict Cần sửa, repair item, Report và profile bắt buộc.

```md
## YYYY-MM-DD HH:mm +07:00 — Tên thay đổi

**Phạm vi:** …

- Thay đổi cụ thể 1.
- Thay đổi cụ thể 2.

**Kiểm tra:** `npm test` — …
```
