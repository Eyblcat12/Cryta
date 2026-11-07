# T30-N4: trạng thái tải trang chi tiết — 05/10/2026

Phạm vi: trang chi tiết tài sản/yêu cầu, dùng API fixture và production preview riêng. Tài liệu ghi bằng chứng BEFORE/AFTER và giới hạn kiểm thử; không thay thế nghiệm thu toàn bộ T30.

## BEFORE trên bundle đang đóng băng

- Origin: `http://127.0.0.1:4173`; JavaScript `index-BKxJgvfI.js`, CSS `index-CTxLXPoY.css`.
- Edge `154.0.4258.53`, light theme, viewport 1440 × 1000 và 390 × 1000.
- Harness: `tools/test-spa-detail-loading.cjs`, tái sử dụng `fixture`/`visible` từ harness chung. Chỉ HTTP fixture; không DB/SMTP/provider thật, không ghi dữ liệu vận hành. Trace/screenshot chỉ chứa tài khoản fixture.
- Lượt đầy đủ BEFORE: **7/16**, exit 1. Bốn ca initial outline và bốn ca GET refresh không đạt vì bundle cũ chưa có hai khả năng này. Bốn ca fast GET, hai ca empty history/lineage/multiline và ca Back/menu desktop đạt. Một ca Back/menu mobile lỗi harness do chờ button desktop bị ẩn trên mobile.
- Đã sửa điều kiện chờ mobile thành `.table-shell[aria-busy=false]` và dùng đúng tên nút `Mở điều hướng`; chạy lại riêng ca này trên cùng BKx đạt **1/1**, exit 0. Không gọi kết quả này là một lượt đầy đủ 8/16 đã chạy lại.
- Bằng chứng đầy đủ: `tools/test-artifacts/spa/detail-loading-20261005-before/results.json`; lần sửa harness: `tools/test-artifacts/spa/detail-loading-20261005-before-mobile-navigation-corrected/results.json`.

Khối `.resource-body` ban đầu cao 280 px và chưa có frame metadata/timeline/history. Đo sau khi GET detail trả nhưng history vẫn pending:

| Nội dung | Width | Cao pending (px) | Cao đã đọc detail (px) | Y pending → detail (px) | Cao metadata thật (px) |
| --- | ---: | ---: | ---: | --- | ---: |
| Tài sản | 1440 | 280 | 1440.6875 | 221.09375 → 106 | 98 |
| Tài sản | 390 | 280 | 1503.6875 | 195.046875 → 88 | 117 |
| Yêu cầu | 1440 | 280 | 541 | 221.09375 → 106 | 40 |
| Yêu cầu | 390 | 280 | 541 | 195.046875 → 88 | 40 |

Ảnh BEFORE desktop/mobile (`1-pending.png`, `9-pending.png`) đã được xem trực tiếp. Khối trống có thông báo tải và nút Back nhưng không giữ cấu trúc nội dung thật. Số đo trên là bounding boxes của fixture, không phải kết quả CLS hoặc N6 profiling.

## Source mới trong build chung

`frontend/src/LoadingOutline.tsx` bổ sung export `DetailLoadingOutline`, giữ nguyên các export hiện có. Outline dùng frame metadata, timeline ba bước và history 10 dòng sẵn có. Nội dung động để trống; không đoán ID, trạng thái, người dùng hoặc quyền thao tác. Placeholder body được `aria-hidden` và inert; header/footer Back thật ở ngoài body này.

`frontend/src/WorkspaceDetailRoute.tsx` giữ resource key theo scope/path, dùng delayed pending 180 ms và một live status trong region có `aria-busy`. Lỗi 503 cùng key giữ snapshot và khóa thao tác; lỗi 403 bỏ dữ liệu cũ theo hợp đồng `useResource`. Nút GET-only `Làm mới chi tiết` cho người dùng đọc lại metadata/version hiện tại, disabled khi pending. Retry là GET, không tự phát mutation. Không đổi API/session/business flow.

Root bổ sung CSS cho metadata/header outline và `.detail-resource > .resource-pending { left: 0; right: auto; }` để status không chồng icon refresh. Preview BEFORE dùng CSS CTx; AFTER dùng CRAMZK9_.

## AFTER đã chạy

Các lượt nối tiếp trên origin 4173 dùng JavaScript `index-sWnhGYiW.js`, CSS `index-CRAMZK9_.css`, mỗi lượt đủ viewport 1440 × 1000 và 390 × 1000. Không chạy detail harness trên OFF 4174; không thay source hoặc nới assertion sau kết quả AFTER.

| Browser | Version | Theme | Kết quả | Exit | Artifact results |
| --- | --- | --- | --- | ---: | --- |
| Edge | 154.0.4258.53 | Light | 16/16 | 0 | `tools/test-artifacts/spa/t30-20261005/detail-edge-after/results.json` |
| Chrome | 154.0.8037.97 | Dark | 16/16 | 0 | `tools/test-artifacts/spa/t30-20261005/detail-chrome-after/results.json` |
| Playwright Firefox | 153.0 | Light | 16/16 | 0 | `tools/test-artifacts/spa/t30-20261005/detail-firefox-after/results.json` |

Tổng **48/48** ca fixture đạt. Các ca xác nhận status chậm, fast GET không có announcement, placeholder không có business action, GET refresh 503 giữ snapshot và khóa action, retry GET, 403 bỏ dữ liệu cũ, responsive text/history/lineage và Back/menu pending bỏ response đến muộn. Firefox dùng browser local trong `tools/test-artifacts/browsers`; các context/browser đã đóng khi hoàn tất.

AFTER Edge/Chrome: desktop asset resource pending/ready cùng cao 1440.6875 px; request desktop/mobile cùng cao 541 px. Asset mobile pending 1440.6875 → ready 1503.6875 px, gồm provider metadata thêm 19 px và action footer đã xác nhận quyền thêm 44 px. Header/metadata giữ mốc Y; timeline/history/footer chỉ xuống 19 px do caption provider thật. Firefox asset tương ứng 1440.699951171875/1503.699951171875 px do làm tròn engine; các đối chiếu vẫn đạt cùng hợp đồng. Đây là bằng chứng cấu trúc, không phải số đo CLS toàn phiên hoặc N6 performance.

Đã xem trực tiếp ảnh Edge `1-pending.png`, `9-pending.png`, `9-detail-ready.png`; Chrome `9-pending.png`, `6-503.png`, `14-403.png`; Firefox `12-pending.png`. Status nằm bên trái trong dòng dành riêng, icon refresh ở phải, không chồng nhau trên desktop/mobile. Outline hai theme giữ cấu trúc metadata/timeline/history; Back thật hiển thị ngoài placeholder. 503 báo dữ liệu lần tải trước và không còn decision actions; 403 bỏ frame/ID/title dữ liệu cũ, còn đường Back và retry. Ảnh và trace kèm results chỉ chứa fixture.

## Hợp đồng và giới hạn geometry

Harness có 16 ca mặc định (8 ca mỗi width), gồm initial pending detail/history; GET nhanh 35 ms không hiện status; GET chậm qua 180 ms chỉ một status; GET refresh 503 giữ snapshot/khóa actions/retry, tiếp theo 403 bỏ snapshot; empty history/lineage/nội dung nhiều dòng; Back/menu khi pending và bỏ response đến muộn. Ca refresh kiểm đúng bốn GET (initial, 503, retry, 403) và không có mutation.

Đối chiếu geometry giữ vị trí header/metadata/timeline/footer trong sai số 3 px với fixture nội dung ngắn. Provider caption chưa biết trước có thể xuống dòng ở grid hai cột width 390; source fixture giữ `providerReference: 'mock/300'` giống BEFORE. Harness ghi phần metadata tăng do nội dung thật và cho phép tối đa một dòng (22 px) ở asset narrow; mốc timeline/footer được so sau khi cộng phần tăng đã đo. BEFORE metadata asset narrow cao hơn desktop 19 px. Quy tắc này được đặt trước khi chạy AFTER, không dùng để bỏ qua khác biệt frame chưa biết.

Không đặt hành động giả để giữ chiều cao footer: action thật có thể xuất hiện và xuống dòng khi đã xác nhận quyền (BEFORE footer asset mobile cao 109 px, desktop 65 px). Không cam kết chiều cao cố định với title dài, history rỗng/ít dòng, lineage hoặc tên actor nhiều dòng chưa biết trước. Các ca này kiểm dữ liệu đọc được, không overflow ngang và không giữ dòng history giả sau GET, không yêu cầu zero shift.

Harness hỗ trợ `CRYPTA_TEST_BROWSER=msedge`, `chrome`, `firefox`; Firefox dùng `playwright.firefox.launch({headless:true})` và không truyền channel. `CRYPTA_DETAIL_WIDTH`, `CRYPTA_DETAIL_THEME`, `CRYPTA_DETAIL_OUTPUT`, `CRYPTA_DETAIL_FILTER` cho phép focused run. `node --check` cả detail harness và harness chung exit 0; `git diff --check` scoped exit 0. Browser AFTER chỉ bắt đầu sau khi root hoàn tất quiet baseline và cấp slot.

## Điều kiện chờ cần chỉnh trong harness chung

`.asset-detail-page` nay có thể tồn tại khi initial GET vẫn pending, nên frame không chứng minh dữ liệu đã đọc. Trước assertion về quyền/nội dung, chờ `visible(page, <title thật>)` và `.resource-region[aria-label="Chi tiết"][aria-busy="false"]`; chỉ busy=false không đủ vì lỗi cũng hết pending. Đã cập nhật đúng các waits ở 582, 687, 692, 907, 992–993 theo quyền phối hợp của root, giữ nguyên assertion/counts, không đổi N1 hoặc browser launch. Những dòng còn lại là đề xuất review tĩnh, chưa chỉnh.

| Dòng tại thời điểm review | Ý nghĩa | Đề xuất |
| --- | --- | --- |
| 687, 692 | ADMIN+APPROVER / self / outside scope / thiếu version không có decision actions | Chờ `Yêu cầu kiểm thử 1` và busy=false trước count=0; tránh đạt giả trên outline. |
| 907 | ADMIN asset không có action USER | Chờ `Tài sản 300` và busy=false trước count=0. |
| 582 | Notification denied → recovery → detail/read mutation | Chờ `Tài sản 300`; predicate `.route-sync-status` hiện trả ngay khi element vắng mặt. |
| 992–994 | Notification page 2 mở detail và mark read | USER/ADMIN chờ `Tài sản 300`, APPROVER chờ `Yêu cầu kiểm thử 1`; thay predicate status cũ bằng actual-data readiness. |
| 955 | Detail đã đọc → Back phục hồi scroll với list GET chậm | Chờ `Tài sản 30` trước đổi state/delay và Back để ca vẫn kiểm điều hướng từ detail đã đọc. |
| 882, 886 | Detail/Forward/Back giữ query asset | Chờ `Tài sản 32` trước Back và sau Forward nếu mục tiêu là detail đã đọc. |
| 575, 614, 632, 917 | Mở detail rồi Back giữ list/filter/pageSize | Nếu yêu cầu chứng minh detail đọc xong, chờ title thật từ ID vừa chọn và busy=false; nếu cố ý Back pending thì ghi tên ca đúng ý nghĩa mới. |
| 921 | Decision dùng version, giữ note sau 409 | Click button thật đã auto-wait dữ liệu/action, nên chưa có false-pass tương tự count=0; có thể chờ title để rõ ý. |

Các chỗ chờ heading thật ở dòng 890, assert frame bị bỏ sau alert 403 ở 791 và Back sau mutation đã xác nhận ở 390 vẫn đúng mục đích.

Focused AFTER Edge/Chrome/Firefox và kiểm ảnh light/dark/mobile đã hoàn tất; root quản lý kết quả full regression/N6 riêng. Kiểm fixture DOM/ARIA không thay thế nghiệm thu screen reader native hoặc hệ thống DB thật.
