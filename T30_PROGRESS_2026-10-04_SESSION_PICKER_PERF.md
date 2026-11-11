# T30 — Session nhiều tab, picker và hiệu năng — 04/10/2026

T30 vẫn mở; phạm vi dự án giữ đủ T01–T54 và X01–X06 theo kế hoạch. Không suy ra nghiệm thu toàn task từ số test. HEAD `ff1478c523a40a4291b102c2fcd03ef87a5dff08`, working tree dirty; source chưa commit.

## Bản sửa đã kiểm chứng

- Frontend dùng Web Locks cùng origin cho refresh và cookie-changing auth operations; revision opaque chặn response/GET/mutation của account cũ kể cả storage event trễ. Logout/account switch làm tab cùng origin bỏ user/draft/mutation cũ và ở trạng thái đăng xuất. JWT chỉ trong bộ nhớ, cookie refresh vẫn HttpOnly. Context thiếu Web Locks hoặc storage còn giới hạn.
- AssetPicker xác minh detail hiện tại (owner/trạng thái/policy) trước khi gửi. Pending/503 giữ ID/lý do nhưng khóa gửi; 403/404 hoặc không đủ điều kiện bỏ tham chiếu, không đưa option cũ trở lại. Retry chỉ GET; handler vẫn chặn submit DOM trực tiếp.
- Scroll cache offset từ sự kiện scroll, bỏ no-op về đầu ở offset0; POP/query/reset cần thiết chạy trước paint qua RAF, ngoài React commit. Back/query và wheel cancellation có browser evidence.

## Source/build và kết quả

Production `index-BKxJgvfI.js`, motion-off `index-fQCdLjVQ.js`, CSS `index-CTxLXPoY.css`; hai build TypeScript/Vite đạt. Browser mới Edge154.0.4258.53/Chrome154.0.8037.97 đều Chromium.

- FE131/131: [JSON](tools/test-artifacts/unit/session-cookie-20261004/results.json), [command/source hashes](tools/test-artifacts/unit/session-cookie-20261004/source-state.json).
- Fixture Edge179/179: [kết quả](tools/test-artifacts/spa/t30-20261004/edge-corrected/results.json); Chrome179/179: [kết quả](tools/test-artifacts/spa/t30-20261004/chrome-corrected/results-chrome.json). HTTP fixture toàn bộ API, không chứng minh DB/provider/SMTP. Thêm queue trang2 version detail success/409, blocker trong native Animation đang chạy, 10routes→logout→account mới khi GET cũ pending, scroll POP/menu/wheel.
- Picker5/5 Edge1440/light và5/5 Chrome390/dark: [Edge](tools/test-artifacts/spa/t30-20261004/picker-edge-final/results.json), [Chrome](tools/test-artifacts/spa/t30-20261004/picker-chrome-final/results.json). Ảnh503/403 đã review; [review và gap](T30_LOADING_REVIEW_2026-10-04.md).
- API/Nginx/PostgreSQL thật, testproject `crypta-t30-test-2f8f7b75aea5`, loopback18080, MOCK/SMTP=false, TTL15m: [Edge20/20](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/real-msedge-1791118359603/results.json), [Chrome20/20](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/real-chrome-1791118475724/results.json). Hai tab cookie chung restore thành công dưới DB delay2s, sibling logout/account switch clear; không intercept, trace/HAR/storage-state thật.
- Hết hạn thật phase TTL12s, backend riêng được recreate, không đổi đồng hồ browser: [Edge2/2](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/expiry-msedge-1791118711210/results.json), [Chrome2/2](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/expiry-chrome-1791118783538/results.json). Server401 với JWT hết hạn; UI đang mở refresh một lần/cookie rotate, rồi refresh DB+access hết hạn đưa về guest, không loop/F5 restore. Không chứng minh proactive idle timeout/TLS/origin. BE image ở các report này là trước logout hardening.

## Đối chứng và sửa test

- Picker bản cũ By2/CTx0/5: [before](tools/test-artifacts/spa/asset-picker-20261004-before/results.json); intermediate Caw5/5 có phạm vi riêng, không gán cho BKx.
- Multitab thật bản cũ By2/CTx0/2: [before](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/real-msedge-1791117809841/results.json).
- Fixture lượt đầu Edge177/179, Chrome178/179 được giữ ở edge-final/chrome-final. Foreign-owner test cũ click nút nay bị disable đúng yêu cầu, nên sửa thành disabled+submit-bypass0POST. Scroll test release data khi native wheel còn hoạt động: diagnostic thấy y0→279→709, không có app scrollTo sau wheel; quiet450ms giữ y0. [Diagnostic](tools/test-artifacts/spa/t30-20261004/scroll-diagnostic-results.json). Không sửa product để làm expectation cũ pass.

## Logout server và N6 đang kiểm chứng

Đã tái hiện logout backend cũ: cookie malformed gây500, cookie UUID của user khác hoặc secret sai vẫn thu hồi session. [Đối chứng](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/real-msedge-1791120298993/logout-observations.json). Đã sửa predicate gồm actor+hashsecret, kiểm tra exact2parts/UUID trước SQL; giữ logout idempotent200 và accessJWT TTL policy. BE95/95 [unit](tools/test-artifacts/unit/logout-20261004/results.json)/build đạt.

Backend test mới `sha256:dab40360de9d6cb5bb73cf8bd09f84201108320d3b30a9cab64ec76f7c9935f8` đạt **21/21 mỗi browser**, EXIT0: [Edge](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/real-msedge-1791122597537/results.json), [Chrome](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/real-chrome-1791122706279/results.json). Logout malformed trả200 cả ba biến thể; foreign/wrong-secret session còn hiệu lực, own session được thu hồi và lặp lại vẫn200 ([observations](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/real-msedge-1791122597537/logout-observations.json)). Hai lượt vẫn không HTTP intercept, dùng BKx/CTx và DB riêng; phase TTL12s trước đó giữ phạm vi image cũ.

N6 có baseline và after cùng máy ngày04/10, ba vòng luân phiên1440/390, CPU4×, không snapshot Playwright/polling locator/filmstrip: [before](tools/test-artifacts/spa/scroll-motion-before-20261004-host/comparison.json), [after](tools/test-artifacts/spa/scroll-motion-after-20261004-final/comparison.json), [root/lifetime after](tools/test-artifacts/spa/scroll-motion-after-20261004-final/root-task-analysis.json). After web long task desktop ON/OFF4/3, mobile28/17; 25/72 setup root vượt50ms, tối đa203.342ms. Root dài chứa Layout/Paint sau callback RAF; OFF cũng có render task dài, nên overlap chưa chứng minh motion gây task. Shift chuỗi ON/OFF bằng nhau (desktop0.1560, mobile0.4010); driver click DOM không phải input trusted, không dùng làm CWV CLS.

Median commit after thấp hơn baseline, nhưng môi trường nền đã thay đổi (Docker chạy ở baseline, không hoạt động trong after), và có một lượt đọc/phân tích trace trong round1. Không quy toàn bộ chênh lệch cho scroll hoặc dùng số liệu này để nghiệm thu N6. Lượt after bị ngắt ở `scroll-motion-after-20261004` chỉ có hai mẫu, không dùng làm kết quả cuối. Cần lượt đo yên tĩnh và đối chiếu công việc render cùng trigger trước khi chốt ngưỡng.

**Lượt đo lại sau khi dọn test stack:** [quiet comparison](tools/test-artifacts/spa/scroll-motion-after-20261004-quiet/comparison.json), [quiet root/lifetime](tools/test-artifacts/spa/scroll-motion-after-20261004-quiet/root-task-analysis.json), EXIT0. Cùng BKx/fQCd/CTx, ba vòng serialized, chỉ Docker vận hành đang chạy; không build/DB/browser suite hay parse trace song song. Web long task ON/OFF desktop **16/2**, mobile **28/20**; renderer root >50ms desktop32/27, mobile40/38. **35/72** root chứa setup vượt50ms, max205.368ms. Shift ON/OFF giữ0.1560/0.4010. Phân loại web long task và renderer root khác nhau; callback RAF cùng layout/paint có thể cùng root, chưa suy causal từ count. Lượt quiet giảm hạn chế của lượt after đầu nhưng vẫn chưa đạt N6; cần đối chiếu render cùng route/window và kiểm tra toàn matrix.

Analyzer đã tính union khoảng UpdateLayoutTree/Layout/PrePaint/Paint/Layerize trên renderer main, clip vào650ms từ click điều hướng; nested/duplicate Paint không cộng hai lần. FireAnimationFrame có union riêng và có thể trùng render, không cộng hai đại lượng này. [Bảng so sánh/provenance](tools/test-artifacts/spa/scroll-motion-after-20261004-quiet/renderer-work-comparison.json) giữ288 windows,12 windows mỗi route/mode/width/phase, cả first visit/outlier. Hai analysis chạy tuần tự EXIT0; syntax và6 ca interval/clipping đạt. Đây là thời gian chiếm trong cửa sổ, không phải latency điều hướng hoặc compositor/GPU.

| Viewport | Route | Render union trước, ON/OFF ms | Quiet sau, ON/OFF ms |
| --- | --- | ---: | ---: |
| 1440 | Users | 194.417 / 178.679 | 196.444 / 189.941 |
| 1440 | Policies | 103.731 / 95.960 | 106.954 / 101.587 |
| 1440 | Dashboard | 167.159 / 157.806 | 176.290 / 160.371 |
| 390 | Users | 219.772 / 213.353 | 216.955 / 197.661 |
| 390 | Policies | 120.863 / 117.777 | 118.576 / 112.568 |
| 390 | Dashboard | 185.259 / 181.758 | 188.349 / 174.366 |

Quiet ON chiếm nhiều render hơn OFF trong các nhóm đo, trong khi phần lớn render vẫn có cả ở OFF. Các mẫu/build/host khác nhau chưa chứng minh nguyên nhân hoặc cải thiện hiệu năng. N6 tiếp tục cần tối ưu/đối chiếu render cùng trigger, ảnh hưởng compositor và matrix đầy đủ; không đóng từ wrapper setup hay tổng test xanh.

Source180 file và frontend ON/OFF đã lưu/kiểm SHA-256/giải nén ở [manifest cuối](tools/test-artifacts/frontend-artifacts/t30-session-picker-scroll-20261004-final/manifest.json). [Đối chiếu report/hash hiện tại](tools/test-artifacts/frontend-artifacts/t30-session-picker-scroll-20261004-final/evidence-verification.json) xác nhận source180/build6 file, FE131/BE95/UI179/M21 mỗi browser và phạm vi TTL cũ. Archive trước tại `t30-session-picker-scroll-20261004` giữ trạng thái trước cập nhật analyzer/README; không gán cho công cụ cuối.

## Còn thiếu và vận hành

N4 detail/empty/short/multiline, CreateUser reference announcement/accessibility label, zoom Edge/native screen reader, đủ NAV toàn tiêu chí và N6 performance còn mở. TLS/origin, unsupported coordination contexts, login lock/error disclosure và provider/SMTP thật chưa nghiệm thu. [NAV audit](T30_NAV_ACCEPTANCE_2026-10-04.md) giữ rõ evidence scope. Không đóng T30/R1/toàn dự án.

Docker báo lỗi socket `dockerInference`; lệnh `docker desktop stop --timeout 30` dừng thành công và tự gỡ socket runtime. Mở lại Desktop đã khôi phục daemon28.5.1; không cần đổi tên/xóa socket, không reset cấu hình/volume. Bốn container vận hành trở lại cùng ID trong snapshot trước.

Sau21/21 mỗi browser, [cleanup report](tools/test-artifacts/integration/crypta-t30-test-2f8f7b75aea5/cleanup-report.json) xác nhận trigger/function tạm0/0, đúng ba container/volume/network test đã gỡ và ID container vận hành giữ nguyên. Cả report.json/report-ttl.json đã cập nhật cleanupCompleted=true/keptStack=false; không đổi scope bundle/TTL lịch sử. Vận hành không seed/reset/rebuild trong lượt này. [Thống kê04/10](TASK_STATUS_2026-10-04.md) giữ35 task chính một phần/19 chưa đối chiếu riêng/6 mở rộng chưa nghiệm thu/0 toàn tiêu chí R1.
