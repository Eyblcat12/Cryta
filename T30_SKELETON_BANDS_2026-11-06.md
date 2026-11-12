# T30/N6 — Đối chứng skeleton gộp hàng,06/11/2026

**Không tích hợp ứng viên này:** giảm DOM không tạo lợi ích dựng hình ổn định trong đối chứng đã chạy. Source/build frontend sản phẩm giữ nguyên; không dùng40 nhóm geometry xanh để bỏ qua kết quả hiệu năng.

## Ứng viên và kiểm bố cục

[Manifest](tools/test-artifacts/spa/skeleton-bands-20261106/variant-manifest.json) pin ba file source được sao chép và thay đổi. Riêng Users skeleton chuyển25 TR/150 TD/175 span thành1 TR aria-hidden/6 TD, vẽ25 dải cao66px bằng pseudo-element/mask. Loaded table và các bảng khác giữ implementation hiện có. Màu lấy live surface-soft/border token; hover highlight của skeleton được tắt chủ động. Đây là thay đổi cách biểu diễn trong artifact, chưa được duyệt hoặc đưa vào sản phẩm.

Build ON/OFF bằng Vite6.4.5 đạt; không gọi đó là full typecheck/unit/regression. [State comparison40/40](tools/test-artifacts/spa/skeleton-bands-20261106/states-01/results.json) gồm32 normal/empty/short/multiline ×motion/theme/viewport và8 lỗi503→retry pending→403→phục hồi. Do pending DOM khác có chủ đích, harness kiểm tổng chiều cao/column/header/table/scroll, hidden/no-action semantics; dữ liệu loaded được so trực tiếp. Product/candidate files giữ hash trước/sau. Đã xem cặp screenshot mobile dark ON pending, không thấy mất hàng/cột hoặc thay vị trí chung; chưa chứng minh pixel-perfect.

## Đối chứng hiệu năng

[Comparison](tools/test-artifacts/spa/skeleton-bands-20261106/measure-01/comparison.json) **24/24 mẫu**, [analysis](tools/test-artifacts/spa/skeleton-bands-20261106/measure-01/analysis.json) **288/288 route windows**. Edge156.0.4314.58, ba vòng serialized/counterbalanced, ON/OFF ×1440/390 ×control/candidate,12 DOM-link visits650ms mỗi mẫu. CPU4×, latency80ms, down1.6Mbps/up750Kbps, fixture Policies/Dashboard350ms; không thêm delay Users hoặc đổi dữ liệu. Snapshot/filmstrip tắt, Chrome timeline bật; không build/test/parse khác trong capture. Giữ mọi first visit/outlier.

Users renderer work union trung bình trong cửa sổ650ms, ms:

| Mode/width | Control | Candidate | Chênh trung bình | Delta từng vòng |
| --- | ---: | ---: | ---: | --- |
| OFF1440 |75,338|76,422|+1,44%|−3,137 / +3,451 / +2,940|
| ON1440 |89,277|89,000|−0,31%|−3,240 / +14,281 / −11,871|
| OFF390 |96,930|99,713|+2,87%|−8,853 / +9,603 / +7,598|
| ON390 |106,258|108,446|+2,06%|−0,953 / +8,595 / −1,078|

Union clip/merge UpdateLayoutTree/Layout/PrePaint/Paint/Layerize trên renderer main, không cộng nested events. Không là latency, presentation timestamp hoặc bằng chứng thuật toán native. Tổng shift mỗi sample control/candidate bằng nhau desktop0,1560/mobile0,4010; đây là tổng sequence, không CLS session-window và không phải0 shift. Ba vòng không tạo kết luận thống kê rộng hơn môi trường đã đo.

Không so trực tiếp số75–108ms này với124–184ms của [ứng viên không span trước](T30_SKELETON_PERFORMANCE_2026-11-05.md): hai lần capture khác thời điểm/trạng thái máy. Quyết định dựa trên control/candidate cùng lượt hiện tại, không gán cải thiện từ khác biệt giữa hai baseline.

## Trạng thái bàn giao

[Preview cleanup](tools/test-artifacts/spa/skeleton-bands-20261106/measure-preview-cleanup.json) xác nhận driver EXIT0, bốn preview do script tạo đã thoát. State runner cũng đã đóng preview/browser. [Source và hướng dẫn](tools/test-artifacts/spa/skeleton-bands-20261106/README.md) giữ script build/state/measure/analyze.

[Host cleanup](tools/test-artifacts/spa/skeleton-bands-20261106/host-cleanup.json) xác nhận8 preview process của state/capture còn0, port4173–4176 và esbuild0. [Verifier](tools/test-artifacts/spa/skeleton-bands-20261106/evidence-verification.json) kiểm40 state groups,24 sample/trace hashes/288 windows,10 source/build file hashes,3 source variant hashes và cleanup; không là chạy lại hoặc nghiệm thuN6.

extras.cjs/refetch.cjs đã được chuẩn bị nhưng **chưa chạy**: page sizes1/10/25/50/100, live theme/resize/token, timing và same-query refresh không có bằng chứng pass cho ứng viên này. Dừng mở rộng ứng viên sau kết quả performance không ổn định; không bỏ mẫu, đổi điều kiện đo hoặc chạy tiếp chỉ để tìm lượt xanh. Chưa có production integration, visual approval hoặc nghiệm thuN6.

Tiếp tục T30 theo [kế hoạch](KE_HOACH_HOAN_THIEN_DU_AN.md): đối chiếu NAV20 network baseline, rồi xử lý khoảng trống trợ năng/native close/N6 theo bằng chứng. [Toàn dự án](TASK_STATUS_2026-11-05.md) vẫn đủ54+6 task và Goal active.
