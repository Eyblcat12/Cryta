# T30/N6 — Skeleton không span từ render đầu, 05/11/2026

Ứng viên khác ngày06/11 gộp cả25 hàng thành1 hàng/6 ô đã được [đo riêng24 mẫu](T30_SKELETON_BANDS_2026-11-06.md), benefit không ổn định nên không tích hợp. Không gán geometry/live-token/performance của ứng viên đó cho hồ sơ không-span bên dưới hoặc ngược lại.

Đã build và đo **artifact riêng**, không sửa frontend sản phẩm. [Manifest](tools/test-artifacts/spa/skeleton-responsive-20261105/variant-manifest.json) xác định ba thay đổi: component có tùy chọn paint, riêng bảng Users bật tùy chọn, CSS vẽ SVG nền. Các bảng khác giữ span như cũ. Users vẫn25 TR/150 TD/175 vạch, nhưng không tạo175 span ngay từ lần render đầu. Cách này cho phép kiểm chi phí mount, khác [prototype gỡ span sau mount](T30_SKELETON_GEOMETRY_2026-11-05.md).

## Geometry và khả năng thích ứng

Build artifact ON/OFF đạt bằng Vite6.4.5; đây không phải full typecheck/unit/browser regression của sản phẩm. [Geometry cuối](tools/test-artifacts/spa/skeleton-responsive-20261105/geometry-02/results.json) đạt **16/16 chuyển trạng thái**: mỗi ON/OFF đi1440→390→1600→390, light/dark ở từng bước. Rect table/header/row/cell, border, text, overflow và scrollLeft khớp control. Skeleton artifact có0 span từ đầu, control175. Sau release GET, hai bản đều25 dòng, không mutation HTTP hoặc pageerror.

CSS kích thước vạch theo chiều rộng TD, giữ hai vạch cột đầu và góc4px. SVG màu light/dark được sinh từ token surface-soft hiện có; đổi theme trực tiếp hoạt động, nhưng tự thay giá trị token sang màu tùy ý chưa được hỗ trợ. Delay180ms và dữ liệu không đổi. Geometry này chỉ có dataset normal; không gán32 nhóm empty/short/multiline của prototype trước sang artifact mới.

Lượt geometry đầu giữ ảnh bắt trúng transition khi đổi theme. Lượt sau chờ250ms như nhau cho hai bản trước chụp; không thay đo performance. [Pixel comparison sau ổn định](tools/test-artifacts/spa/skeleton-responsive-20261105/geometry-02/pixel-comparison.json): desktop khác4667–5218 pixel/kênh tối đa14/255, mobile1538–1750/kênh tối đa3/255; bbox nằm trong các vạch. Đã xem ảnh desktop light/mobile dark, không thấy mất hàng/cột hoặc thay border. Raster SVG chưa pixel-perfect với CSS rounded spans.

## Đo đối chứng hoàn tất

[Comparison](tools/test-artifacts/spa/skeleton-responsive-20261105/measure-01/comparison.json), [analysis](tools/test-artifacts/spa/skeleton-responsive-20261105/measure-01/analysis.json): **24/24 mẫu,288/288 route windows**, ba vòng counterbalanced control/paint × ON/OFF ×1440/390. Edge dùng phiên bản thực ghi trong report. Cùng fixture35 user/25 dòng hiển thị, CPU4×, mạng80ms/1.6Mbps và policy/dashboard delay350ms. Driver giữ12 DOM-link clicks,650ms mỗi lượt; không thêm RAF probe, debug category hoặc lọc first visit/outlier. Capture, build/geometry và parse chạy tách thời điểm. Không chạy DB/build/browser suite khác trong capture.

Renderer work union của Users, trung bình mỗi cửa sổ650ms, đơn vị ms:

| Mode/viewport | Control | Artifact | Chênh trung bình | Chênh từng vòng (artifact−control) |
| --- | ---: | ---: | ---: | --- |
| OFF1440 | 124,622 | 110,432 | −11,39% | −12,504 / −13,854 / −16,212 |
| ON1440 | 142,594 | 129,668 | −9,06% | +3,565 / −23,360 / −18,983 |
| OFF390 | 154,892 | 151,294 | −2,32% | −19,260 / +3,191 / +5,275 |
| ON390 | 184,252 | 164,247 | −10,86% | −28,154 / −10,993 / −20,868 |

Các route so sánh Policies/Dashboard thay đổi trung bình tương ứng OFF1440−2,33%/−4,09%, ON1440+0,73%/+0,28%, OFF390+2,92%/−1,09%, ON390−1,81%/−5,57%. Layout shift tổng mỗi sample control/artifact khớp: desktop0,1560, mobile0,4010. Đây là tổng của sequence, không phải chỉ số CLS session-window và không được gọi là0 shift.

Union clip/merge các khoảng UpdateLayoutTree/Layout/PrePaint/Paint/Layerize trên renderer main, tránh cộng trùng nested events. Không đồng nghĩa latency hoặc frame đã trình chiếu. Tất cả first visits/slow samples giữ nguyên. Không suy ra thuật toán native gây tốn thời gian hoặc độ tin cậy thống kê từ ba vòng.

## Quyết định hiện tại

Cập nhật06/11: [đối chứng trạng thái của đúng artifact](tools/test-artifacts/spa/skeleton-responsive-20261105/states-20261106-02/results.json) đạt **40/40 nhóm**, mỗi nhóm so sánh control/paint riêng, Edge headless. Có32 nhóm normal/empty/short/multiline × ON/OFF ×1440/390 ×light/dark và8 nhóm503→retry pending→403→retry phục hồi. Pending luôn25 hàng aria-hidden và không action; candidate0 span, control175. Rect table/header/row/cell, border, nội dung, overflow và trạng thái khớp; loaded có0/1/25 dòng đúng dataset. Không mutation HTTP hoặc pageerror; 403 không giữ dòng dữ liệu, retry200 phục hồi25 dòng.

Đã xem cặp ảnh mobile dark ON lúc pending và loaded multiline, không thấy mất hàng/cột hoặc khác bố cục. Các file product/candidate build và source được theo dõi giữ hash trước/sau; bốn preview đã thoát, port4173–4176 và esbuild còn0. [Script](tools/test-artifacts/spa/skeleton-responsive-20261105/states.cjs) ghi scope và cleanup. Lượt [states-01](tools/test-artifacts/spa/skeleton-responsive-20261105/states-20261106-01/results.json) không khởi động được preview trong sandbox,0 nhóm; giữ nguyên kết quả lỗi, không tính vào40 nhóm sau khi chạy với quyền host.

Đây là geometry/state fixture, không đo lại performance, kiểm timing180ms, same-query background refetch, screen reader thật hoặc arbitrary token. Delay source vẫn giữ nguyên. Các khoảng trống refetch/raster/token và paired benefit mobile OFF tiếp tục mở; không suy ra performance acceptance từ40 nhóm xanh.

Ứng viên có tín hiệu tốt ở desktop OFF và mobile ON qua cả ba vòng, nhưng mobile OFF tăng ở hai vòng; desktop ON cũng có một vòng tăng. **Chưa tích hợp hoặc nghiệm thu N6**. Sau40 nhóm state/geometry mới, còn kiểm same-query background refetch, cải thiện raster/token contract và xác minh paired benefit mobile OFF trước quyết định production. Bốn mẫu diagnostic debug trước đạt3/4 vẫn giữ lịch sử riêng;24 mẫu performance với baseline categories không thay bằng chứng attribution còn thiếu đó.

Source sản phẩm và source artifact đã đối chiếu lại với manifest sau capture; ba file sản phẩm giữ nguyên hash. Browser/context và bốn preview loopback đã đóng. Source backend, dependency, CI và snapshot196 file đã kiểm trước giữ nguyên. [Script build](tools/test-artifacts/spa/skeleton-responsive-20261105/build-variant.cjs), [geometry](tools/test-artifacts/spa/skeleton-responsive-20261105/geometry.cjs), [measure](tools/test-artifacts/spa/skeleton-responsive-20261105/measure.cjs), [analyzer](tools/test-artifacts/spa/skeleton-responsive-20261105/analyze.cjs).
