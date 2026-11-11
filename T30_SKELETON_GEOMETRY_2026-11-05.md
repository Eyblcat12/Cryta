# T30/N6 — Đối chứng hình học skeleton Users, 05/11/2026

Thử nghiệm fixture đạt **32/32 nhóm**: ON/OFF ×1440/390 px ×light/dark ×normal/empty/short/multiline. [Summary](tools/test-artifacts/spa/skeleton-geometry-20261105/summary.json) liên kết bốn report và checksum. **Chưa sửa sản phẩm hoặc chứng minh hiệu năng.**

Prototype giữ đủ25 hàng,150 TD và175 vạch; chỉ thay175 span đã mount bằng SVG nền trong chính150 TD. SVG lấy tọa độ/kích thước/màu từ baseline của từng ô, giữ hai vạch ở cột đầu. Không dùng pseudo-element hoặc giảm dữ liệu. Mỗi nhóm kiểm hidden/visible, đủ **64 đối chiếu hình học**: rect bảng/header/row/cell, border, text, focusable controls, overflow và scrollLeft khớp tuyệt đối trước/sau. Mobile chủ động cuộn hết chiều ngang. Sau release GET, normal/multiline có25 dòng, short1, empty0; không có mutation HTTP hoặc pageerror.

Ảnh hidden/visible được chụp theo cặp, cùng ảnh dữ liệu sau tải. Đã xem cặp mobile light, desktop dark, ảnh hidden và dữ liệu multiline/short: không thấy mất cột, thay border hoặc thay footprint. [Pixel comparison normal](tools/test-artifacts/spa/skeleton-geometry-20261105/run-01/pixel-comparison.json): tám cặp hidden khác0 pixel; visible desktop khác7171–7268 pixel, mobile1907–2004, chênh kênh màu tối đa6–9/255. Khác biệt tập trung ở các vạch, đặc biệt mép bo tròn; SVG và CSS rounded box chưa raster giống hệt. [Ảnh phóng góc vạch](tools/test-artifacts/spa/skeleton-geometry-20261105/run-01/line-corner-inspection.png) giữ baseline/candidate/difference. Không gọi đây là pixel-perfect.

Source LoadingOutline/styles/useDelayedPending và bundle ON/OFF có hash trước/sau khớp cả bốn lượt. Normal dùng revision harness ban đầu; ba trạng thái sau dùng harness mở rộng có lựa chọn dataset và ảnh loaded. Cả bốn lượt giữ nguyên source/build sản phẩm. Lượt normal chờ person1 xuất hiện; ba lượt sau chờ aria-busy=false và kiểm row count theo dataset. Không gán các lượt cho một revision harness duy nhất.

Giới hạn và bước tiếp theo:

- Hidden paint class được bật/tắt có chủ đích **sau khi trạng thái pending thật đã visible**. Đây là so cách vẽ/footprint, không kiểm thời điểm180 ms. Source delay không đổi.
- Tọa độ SVG được chụp từng ô; chưa hỗ trợ resize hoặc đổi theme/token trực tiếp. Cần representation responsive trước production.
- Gỡ span sau mount vẫn trả chi phí mount cũ và thêm mutation. Không dùng lượt này làm phép đo performance hoặc chứng minh175 span là toàn bộ nguyên nhân Layout dài.
- Cần isolated source-derived variant được render ngay không có span, matched multi-round với accepted protocol và dữ liệu giữ nguyên, rồi regression/loading/resize/theme. Chưa chạy bước đó và chưa tích hợp prototype.
- N6 còn mở; failed diagnostic ON390650 ms trước vẫn giữ nguyên phạm vi, không biến32 geometry groups thành bốn mẫu performance đã đạt.

Hai preview riêng của lượt này đã dừng; browser/context đã đóng và cổng4173/4174 không còn listener. Không chạy lại DB, build hoặc sửa snapshot backend đã kiểm chứng. [Hướng đề xuất trước](tools/test-artifacts/spa/users-layout-diagnostic-20261006/SKELETON_GEOMETRY_PROPOSAL_2026-11-05.md), [harness hiện tại](tools/test-artifacts/spa/skeleton-geometry-20261105/geometry.cjs).
