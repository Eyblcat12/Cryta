# T30 — Loading danh sách, zoom thật và trace motion — 01/10/2026

Đã mở rộng N4 cho Requests, Notifications và lịch sử tài sản; sửa nút refresh mobile và focus bị khuất ở zoom trình duyệt 200%. Bản cuối đạt **174/174 browser fixture trên mỗi Edge/Chrome**, **18/18 nhóm tích hợp thật trên mỗi browser**, **6/6 nhóm zoom thật trên Chrome**, frontend **123/123** và production/motion-off build. **Goal toàn dự án, T30 và L/N/M vẫn mở.** Trace đã đo/phân tích; N6 chưa nghiệm thu vì vẫn cần xử lý/đối chiếu công việc layout/paint dài của bảng Users.

## Nguồn và môi trường

- HEAD `ff1478c523a40a4291b102c2fcd03ef87a5dff08`; working tree dirty, chưa commit/push. HEAD không đại diện toàn nguồn được kiểm thử.
- Node local 25.9.0, npm 11.12.1; Docker build Node 22 Alpine. Edge `154.0.4258.48`, Chrome `154.0.8037.59`, đều Chromium.
- Bundle cuối on `index-By2DuIlI.js` / `index-CTxLXPoY.css`; off `index-Div_QacB.js` / cùng CSS. Preview 4173/4174 và Nginx test phục vụ đúng các build ghi trong từng report.
- Source allowlist **175 file**, SHA-256 archive cuối `5e24f51f37a36e4f7c8b2e62a8df1e0635303c46775d0c63cd473de3ec951d30`; [manifest nguồn](tools/test-artifacts/frontend-artifacts/t30-n4-lists-zoom-n6-20261001-final/source-manifest.json), [archive](tools/test-artifacts/frontend-artifacts/t30-n4-lists-zoom-n6-20261001-final/application-source.zip). Đối chiếu hồ sơ 04/10 xác minh hash ZIP và đủ 175 entry khớp từng hash trong manifest; không chạy lại test hoặc gán archive này cho thay đổi sau 01/10. Loại trừ secret vận hành, dependency, report và Git history. 75 file backend đối chiếu SHA-256 đều giữ nguyên so với source snapshot của [lượt M/N4 trước](T30_PROGRESS_2026-10-01_M_N4.md); backend 89/89/build là bằng chứng kế thừa đúng phạm vi đó, không gọi là chạy lại trong lượt này.
- [Artifact on/off](tools/test-artifacts/frontend-artifacts/t30-n4-lists-zoom-n6-20261001-final/manifest.json), mỗi ZIP 3 file, đã giải nén và kiểm tra hash. On `8dd0d28b035bd17676ce3c470795d6a5e611476e92dc4ffdd8bb4dbd5bd4384a`; off `16cb350ac3b751136451d44611610c1be44fa4996358bf4813d193d73a57793c`.

## N4 — Danh sách và snapshot

Requests User, lịch sử Approver, Notifications mọi role và lịch sử tài sản dùng outline theo số dòng dự kiến; placeholder `aria-hidden`/inert, không có hành động nghiệp vụ khả dụng. Indicator trễ 180 ms ở vùng resource. Refresh GET cùng query giữ dữ liệu, khóa nút mở/đánh dấu đọc và lineage; 503 giữ snapshot kèm thông báo chưa cập nhật, 403 bỏ snapshot. Đổi page bỏ dòng của query cũ trong lúc GET mới chờ. AssetHistory giữ heading/refresh/pagination khi tải. Nút refresh Notifications giữ đủ bề rộng 36 px và chuyển hàng ở mobile.

- [Baseline đúng selector 0/18](tools/test-artifacts/spa/n4-lists-before/results-filtered.json): Requests mất footprint làm footer dịch 557 px, Notifications 1196 px; lịch sử tài sản chưa giữ pagination, các refresh control mới còn thiếu.
- [Sau sửa 18/18](tools/test-artifacts/spa/n4-lists-after/results-filtered.json): 12 tổ hợp role/page × 1440/390 giữ footer trong ngưỡng 2 px, 6 ca refresh giữ snapshot/503/drop 403/khóa action và chỉ GET.
- Suite cuối thêm 6 ca đổi trang có gate GET thật của fixture; lineage có mặt trong ca refresh lịch sử tài sản để kiểm tra link bị khóa. [Edge 174/174](tools/test-artifacts/spa/n4-lists-20261001/edge-zoom-fix/results.json), [Chrome 174/174](tools/test-artifacts/spa/n4-lists-20261001/chrome-zoom-fix/results-chrome.json), cùng bundle cuối.
- Lượt đầu 167/168 mỗi browser lưu ở `n4-lists-20261001/edge` và `chrome`: một selector cũ giả định header chỉ có một button, sau khi thêm refresh thì locator bị ambiguous. Sửa selector theo tên “Đánh dấu đã đọc”, giữ kiểm tra write bị khóa; không bỏ test hoặc dùng report fail làm report xanh.
- Đã xem ảnh Notifications mobile và lịch sử tài sản desktop. [Ảnh mobile cuối](tools/test-artifacts/spa/n4-lists-20261001/edge-zoom-fix/n4-list-USER--notifications-390.png).

Giới hạn: hình học đại diện trang đầy với chuỗi ngắn. Số dòng thực chưa biết ở initial empty/trang ngắn, chuỗi dài nhiều dòng, lineage xuất hiện lần đầu và mọi detail/dialog/error còn cần đối chiếu. Không đóng toàn N4/NAV-29.

## L/N5 — Zoom trình duyệt thật và focus

[Runner zoom](tools/test-spa-zoom.cjs) tạo profile Chrome riêng trong thư mục artifact; mở Settings/Appearance và đổi Page zoom từ 100% sang 200%. `viewport:null`, không setViewportSize/CSS zoom. Report ghi outer window 1440×1000 giữ nguyên, CSS viewport từ 1422 xuống 711 px, DPR 1→2, `visualViewport.scale` và CSS zoom document/body vẫn 1. Business HTTP dùng fixture, không gọi API thật hoặc sửa profile browser cá nhân.

- [Trước sửa 0/1 với cùng timing](tools/test-artifacts/spa/real-zoom-20261001-before/results.json): Tab vào textarea lý do, top 390.4/bottom 472.4 vượt viewport cao 452 CSS px; ảnh cho thấy phần dưới bị panel cắt. [Ảnh lỗi](tools/test-artifacts/spa/real-zoom-20261001-before/USER-light-failed.png).
- `useDialogBehavior` trước chỉ reveal focus khi footer sticky. Nay kiểm tra vùng hiển thị của panel và viewport cho mọi dialog; trừ vùng footer sticky khi cần, cuộn control vào vùng nhìn được ở frame tiếp theo. Focus trap/Escape/return focus giữ cơ chế hiện có.
- [Sau sửa 6/6](tools/test-artifacts/spa/real-zoom-20261001-after/results.json): ba role × light/dark; 5 page User, 5 Approver, 7 Admin; không body overflow; menu mobile/Tab/Escape/skip-link dùng được. 16 lần Tab mỗi dialog kiểm tra focus ở trong dialog, control không bị cắt hoặc footer che. Có request, reject, create-user và test-email; không mutation.
- Capture zoom dùng CDP screenshot không clip vì Playwright screenshot mặc định ở native zoom cắt mất một phần cửa sổ. [Ảnh sau](tools/test-artifacts/spa/real-zoom-20261001-after/USER-light-dialog.png) ghi toàn cửa sổ; đây không phải bằng chứng screen reader.

Còn zoom thật trên Edge, text/empty/loading/error và các dialog khác, kiểm tra screen reader/announcement thực. Không đổi kiểm tra DOM/keyboard thành nghiệm thu NVDA/JAWS.

## M — DB/API/Nginx thật, hai Approver khác nhau

Stack `crypta-t30-test-ff33057194ec`, PostgreSQL 17, DB riêng `crypta_t30_test`, origin loopback 18080; MOCK và SMTP=false. Runner kiểm tra label/volume/config trước ghi, không intercept HTTP, không lưu trace/HAR/token/cookie/password của phiên thật.

- Đổi ca concurrency từ hai POST cùng Approver sang **hai actor Approver khác nhau**, cùng scope, cùng version. Kết quả một 201/một 409; DB có đúng một decision/audit và version tăng một; approverId thuộc actor thắng. Không dùng fixture để suy ra kết quả DB.
- Bundle cuối: [Edge 18/18](tools/test-artifacts/integration/crypta-t30-test-ff33057194ec/real-msedge-1790849872434/results.json), [Chrome 18/18](tools/test-artifacts/integration/crypta-t30-test-ff33057194ec/real-chrome-1790849940883/results.json). Giữ đầy đủ 18 nhóm owner/scope/page, SoD/version, access rollback, password/refresh/replay, race thu hồi quyền, cookie/login/F5/logout/account switch và Admin cuối của lượt trước.
- Nginx **17/17** chạy lại sau frontend cuối; API smoke **13 kiểm tra** lúc tạo stack. Backend/Postgres giữ nguyên qua hai lượt recreate chỉ frontend. [Report khởi tạo](tools/test-artifacts/integration/crypta-t30-test-ff33057194ec/report.json) giữ asset smoke ban đầu; browser/cleanup report ghi bundle cuối, không gán smoke ban đầu cho bundle khác.
- Backend image `sha256:70b47b3598bf06548ee912dff6873d1a25cb42ef6f2cd222a8b9d85c44111bdd`; frontend cuối `sha256:de233ac7632ffb5d5c4d67115381be20654d56cbb76fc6ca439c6dea56494f32`.
- [Cleanup đã xác minh](tools/test-artifacts/integration/crypta-t30-test-ff33057194ec/cleanup-report.json): trigger/function test count 0/0, ba container/network/volume test đã dọn; ID container project vận hành `crypta` giữ nguyên, backend/Postgres/Redis healthy.

Còn approve/worker/lifecycle, nhiều tab refresh/TTL thật, các race trộn status/access/activation, production TLS/origin và đủ từng NAV. Logout hiện thu hồi refresh; access JWT theo TTL nếu version không đổi, như hợp đồng hiện có đã ghi ở lượt trước. Artifact rollback Nginx/login/F5 đã diễn tập trong lượt M/N4 trước, không gọi diễn tập đó là chạy lại trên artifact mới.

## N6 — Trace root task

`useRouteMotion` chuyển setup entrance sang requestAnimationFrame trước paint tiếp theo. Route/heading/API commit ngay, frame/animation bị hủy khi route/boundary hoặc reduced-motion đổi. Không thêm exit delay hoặc animation dependency.

[Baseline trước](tools/test-artifacts/spa/n4-lists-motion-before-20261001/comparison.json) đo bundle `DSwgZCwf/C6u-C_Yc`, một vòng serialized off/on, CPU 4×/mạng chậm. [Phân tích root](tools/test-artifacts/spa/n4-lists-motion-before-20261001/root-task-analysis.json) cho thấy setup nằm trong hai root >50 ms ở mỗi viewport; lớn nhất desktop 115.887 ms, mobile 157.005 ms. 111.169/153.088 ms đã xảy ra trước setup trong hai root lớn nhất, chủ yếu style/layout; wrapper setup vài ms không đại diện cả task. Đây là bằng chứng vị trí công việc, chưa là đối chứng causal toàn bộ.

Lượt [sau với cả hai lớp trace](tools/test-artifacts/spa/n4-lists-motion-after-20261001/comparison.json), [root analysis](tools/test-artifacts/spa/n4-lists-motion-after-20261001/root-task-analysis.json), đã hoàn tất ba vòng luân phiên on/off trên bundle cuối. 71/72 setup nằm trong root dưới 50 ms; một frame mobile vòng 3 dài **93.734 ms**: trước setup 22.409, setup 6.764, sau setup 64.561 ms, có PrePaint/Paint. Không được gọi N6 đạt chỉ vì wrapper setup ngắn. Các task khác trong vòng đời animation có EvaluateScript của công việc automation/DevTools; trace RunTask và web PerformanceObserver dùng phạm vi khác nhau nên count không bằng nhau.

Phát hiện fixture bật snapshot tracing của Playwright trong lúc runner cũng thu Chrome timeline. Runner performance nay tắt lớp snapshot của Playwright, vẫn giữ raw Chrome timeline/ảnh và PerformanceObserver. [Lượt không snapshot](tools/test-artifacts/spa/n4-lists-motion-no-snapshots-20261001/comparison.json), [root analysis](tools/test-artifacts/spa/n4-lists-motion-no-snapshots-20261001/root-task-analysis.json) đủ ba vòng: 72/72 setup root dưới 50 ms, max desktop 36.809/mobile 37.959 ms. Locator polling vẫn tạo EvaluateScript trong vùng thời gian đo; không tự gán mọi task đó cho motion hoặc coi bỏ snapshot là sửa sản phẩm.

Lượt cuối dùng **một kịch bản chạy trong trang** để bấm đúng link NavLink thật, mở/đóng menu mobile và kiểm tra title sau mỗi lần điều hướng; không external locator polling trong sequence. Bàn phím, pointer/hit testing và focus vẫn kiểm tra riêng bằng suite 174 ca. [Comparison cuối](tools/test-artifacts/spa/n4-lists-motion-in-page-20261001/comparison.json), [phân tích root và cửa sổ từng route](tools/test-artifacts/spa/n4-lists-motion-in-page-20261001/root-task-analysis.json), cùng bundle cuối, Edge, CPU 4×, latency 80 ms, 1.6 Mbps/750 kbps và GET policy/dashboard trễ 350 ms. Mỗi vòng off/on hoặc on/off serialized, 12 Users→Policies→Dashboard ở mỗi mode/viewport; không chạy build/browser regression/DB suite đồng thời.

| Phép đo cuối | Desktop 1440 | Mobile 390 |
| --- | --- | --- |
| Commit median từng vòng off | 83.7 / 108.0 / 84.5 ms | 103.5 / 101.1 / 110.1 ms |
| Commit median từng vòng on | 82.1 / 88.8 / 94.0 ms | 112.3 / 101.3 / 116.4 ms |
| Web observer long task on/off, tổng ba vòng | 7 / 7 | 17 / 13 |
| Renderer RunTask >50 ms on/off, gồm harness/DevTools | 17 / 18 | 27 / 23 |
| Setup root lớn nhất on / số root >50 ms | 29.708 ms / 0 trên 36 | 33.047 ms / 0 trên 36 |
| Tổng shift sequence on/off | 0.1560 / 0.1560 | 0.4010 / 0.4010 |

**Kết luận có giới hạn:** setup không còn nằm trong commit task nặng ở các mẫu cuối; 72/72 setup root dưới 50 ms. Tuy nhiên trong vòng đời 160 ms vẫn có root layout/paint 55–118 ms ở Users; off cũng có công việc cập nhật skeleton/rows tương tự và root đầu có thể tới 186 ms. Không suy ra causal effect từ counts, không ghi “không có long task do motion” hoặc nghiệm thu N6 toàn bộ. Tiếp tục tối ưu/đối chiếu Users layout, kiểm tra filmstrip/paint overhead và mở rộng browser/route trước khi chốt gate.

DOM click của kịch bản cuối không phải trusted input, nên shift không có recent input bằng tổng shift; khác lượt pointer trước đó có recent input. Tổng shift chuỗi bằng nhau giữa on/off trong cùng phép đo, **không phải Core Web Vitals CLS** hoặc bằng chứng cải thiện CLS do đổi driver. Giữ các lượt harness trước và số liệu fail/dao động, không lựa riêng vòng xanh.

## Việc tiếp tục

Theo ưu tiên T30: xử lý/đối chiếu N6 Users layout/paint và instrumentation; bổ sung N4 trạng thái/detail và L/N5 screen reader/zoom còn thiếu; đối chiếu đủ NAV-01…30 và các khoảng trống M, rồi đi tiếp các task theo phụ thuộc. [Thống kê](TASK_STATUS_2026-10-01.md) giữ **35 task chính cập nhật một phần, 19 chưa đối chiếu riêng, 6 mở rộng chưa nghiệm thu riêng, 0 xác nhận toàn tiêu chí R1**. Không tính tỷ lệ hoàn thành từ test hoặc đóng T30/toàn goal từ lát cắt này.

[Đối chiếu từng NAV ngày 04/10](T30_NAV_ACCEPTANCE_2026-10-04.md) ghi rõ ca đã pass và tiêu chí còn thiếu dựa trên hồ sơ này; việc đối chiếu không phải chạy lại test ngày 04/10.
