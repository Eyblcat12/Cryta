# Kiểm thử tích hợp trong CI

Bằng chứng ngày 12/11/2026 trên head `8bc9f71` và merge `5614a25` đạt đủ năm job, với 18/18 ca nháp, 66/66 Chromium PostgreSQL, 197/197 UI fixture và 0 High/Critical trên hai image khớp manifest. Repo đã public và main đã có năm required checks áp dụng cả Admin. [Bằng chứng và cách phục hồi CI](../../docs/CI_REMOTE_2026-11-07.md#đối-chiếu-head-và-merge-ngày-12-tháng-11-năm-2026).

Lịch sử ngày 07/11 trên `a599aae` đạt đủ năm job. Backend 419/419, frontend 147/147, SMTP loopback 6/6 và tích hợp Ubuntu 158/158. Nhánh thử lỗi riêng đã kiểm đúng bước thất bại và artifact cleanup. Khi repo còn private, required checks bị GitHub trả 403 do điều kiện gói. [Bằng chứng remote và digest artifact](../../docs/CI_REMOTE_2026-11-07.md)

Lượt mới sau chỉnh schema cài mới và validator đạt 158/158 nhóm. Ledger có thêm ca từ chối nạp lại schema và giữ dữ liệu cùng lịch sử migration. Backend 419/419, lint và OpenAPI đạt. Stack đã được dọn và danh tính chín container ngoài test khớp. [Kết quả](../test-artifacts/integration/crypta-t30-test-f1f20ec87e12/ci-verification.json)

Workflow `Build and test` chạy build/unit theo package, ESLint và quét bí mật trước khi chạy job tích hợp. Build TypeScript kiểm kiểu frontend và backend. Gitleaks quét cây Git của revision bằng image ghim digest, gắn cây chỉ đọc, tắt mạng và che giá trị phát hiện. Job tích hợp build hai image ứng dụng và chạy PostgreSQL/Nginx với Chromium đúng phiên bản Playwright trong lockfile. [Workflow](../../.github/workflows/ci.yml) · [Hướng dẫn Playwright](https://playwright.dev/docs/ci-intro) · [Gitleaks](https://github.com/gitleaks/gitleaks)

Sau khi build hai image phát hành, CI đối chiếu tag, image ID và nhãn với manifest, rồi quét gói hệ điều hành và thư viện trên bản xuất của từng image. Trivy ghim digest, cập nhật cơ sở dữ liệu CVE ở bước riêng và chạy quét với mạng tắt. Thiếu bằng chứng quét hoặc có kết quả Critical/High làm job thất bại. Artifact `release-image-security` giữ báo cáo rút gọn theo commit và image. [Script quét](scan-release-images.cjs) · [Trivy image](https://trivy.dev/docs/latest/references/configuration/cli/trivy_image/)

`run-integration.ps1` dựng project Docker mới, chạy smoke rồi lần lượt gọi các bộ parser, ledger, quyền runtime, phục hồi worker, hết hạn, giao email và trình duyệt/API. Stack dùng seed, provider MOCK và SMTP tắt. Các bài giao thư dựng SMTP loopback riêng. Sau thành công hoặc lỗi, script dọn stack và kiểm danh tính container ngoài project.

Bộ kiểm nháp trong CI có 18 ca với Chromium trên Nginx/PostgreSQL, gồm lưu chưa đủ dữ liệu, mở lại/sửa/gửi/hủy, xung đột hai tab và giữ tham số cũ khi sửa lý do. Các ca mất phản hồi sau commit bao phủ lưu nháp, gửi trực tiếp, gửi nháp và hủy. Bài kiểm đối chiếu trạng thái, audit, thông báo và số lần POST, xác nhận giao diện đọc lại dữ liệu qua GET và không tự gửi lặp. JavaScript được so hash giữa phản hồi HTTP và container frontend của stack. Báo cáo `draft-ui-chromium-*/results.json` nằm trong artifact `integration-results`. [Bộ kiểm nháp](../test-real-request-draft-ui.cjs)

Sau ca Chromium với PostgreSQL, CI chạy trọn bộ hồi quy điều hướng, trạng thái tải và trợ năng T30/T34 trên cùng bundle do Nginx phục vụ, với motion mặc định tắt. Bộ này dùng API mô phỏng trong từng phiên trình duyệt. Script từ chối bộ lọc để tránh bỏ qua ca kiểm và đối chiếu tên bundle với smoke. Báo cáo `spa-workspace/results-chromium.json` nằm trong `integration-results`. [Bộ kiểm trình duyệt](../test-spa-workspace.cjs)

Lượt diễn tập cục bộ ngày 09/11 đạt 193/193, gồm tám ca T34. Tên bundle khớp smoke và stack đã được dọn. [Kết quả Chromium](../test-artifacts/integration/crypta-t30-test-077b32d068ec/spa-workspace/results-chromium.json) · [Báo cáo stack](../test-artifacts/integration/crypta-t30-test-077b32d068ec/report.json)

Ngay sau smoke, CI diễn tập monitor trên stack đầu tiên để kiểm quyền đọc tín hiệu, cảnh báo khi PostgreSQL dừng và trạng thái khi PostgreSQL phục hồi. Runner tự cấp credential ngẫu nhiên cho stack này và xóa file credential sau lượt chạy. Workflow lưu `operations-monitor.json` cùng artifact `integration-results`. [Phạm vi diễn tập T44](../../T44_HEALTH_READINESS_2026-11-06.md)

CI dùng stack riêng với access TTL 20 giây và proxy HTTPS loopback để kiểm vòng đời phiên bằng Chromium và đồng hồ thật của máy chủ. Runner dùng OpenSSL để tạo chứng thư thử và ghim khóa công khai trong trình duyệt. Các ca kiểm cookie Secure/HttpOnly/SameSite, origin CORS, refresh sau khi access token hết hạn và đăng xuất. Một subdomain cùng site gửi được cookie nhưng nhận HTTP 403 khi Origin nằm ngoài danh sách cho phép. Bài kiểm đối chiếu rằng phiên cũ vẫn hoạt động và không phát sinh phiên mới trong PostgreSQL. Báo cáo nằm trong `integration-results`. [Phạm vi kiểm T06](../../T05_USER_ADMINISTRATION_2026-11-06.md)

Sau bộ trình duyệt, ca SIGTERM chặn một giao dịch ghi tài sản bằng advisory lock rồi dừng backend cách ly. Ca thử kiểm readiness và yêu cầu mới trả 503, liveness vẫn 200, giao dịch đã nhận ghi đúng một lần và yêu cầu thứ hai vẫn nằm trong hàng chờ. Khi backend đã dừng, CI chụp snapshot ổn định, kiểm từ chối dump bị cắt và phục hồi dump hợp lệ để đối chiếu dữ liệu, sequence và quyền `PUBLIC`. Cuối cùng CI thay backend bằng container có IP khác và kiểm Nginx phục hồi readiness qua cùng container frontend. [Diễn tập SIGTERM](../test-real-shutdown.ps1) · [Backup/restore](../test-backup-restore.ps1) · [Phục hồi proxy](../test-real-proxy-recovery.ps1)

Lượt 07/11/2026 trên Windows PowerShell 7 đạt 157/157 nhóm. Kết quả gồm 3 parser, 10 ledger, 48 runtime LOGIN, 27 worker, 19 hết hạn, 11 giao email, 38 Chromium và 1 SIGTERM. Script dọn stack và giữ danh tính chín container ngoài test. Nghiệm thu người dùng và dịch vụ ngoài tiếp tục theo kịch bản riêng. [Kết quả Windows](../test-artifacts/integration/crypta-t30-test-69d743ad832a/ci-verification.json) · [Chromium](../test-artifacts/integration/crypta-t30-test-69d743ad832a/real-chromium-1793987100487/results.json) · [SIGTERM](../test-artifacts/integration/crypta-t30-test-69d743ad832a/shutdown-b349e2b8eda6/results.json) · [Kịch bản UAT](../../docs/NGHIEM_THU_UAT.md)

Chạy lại trên máy có Docker, Node và PowerShell 7.

```powershell
npm ci --prefix tools/ci
npm --prefix tools/ci run lint
node tools/ci/node_modules/playwright/cli.js install chromium
pwsh -NoProfile -File tools/ci/run-integration.ps1
```

Trên Linux, cài thêm dependency trình duyệt bằng `install --with-deps chromium` theo workflow. Nếu đặt `PLAYWRIGHT_BROWSERS_PATH`, dùng cùng giá trị ở bước cài và chạy. Runner GitHub dùng thư mục riêng trong `runner.temp`.

`-ProveFailureGate` đưa mã thoát 23 từ một tiến trình Node vào callback kiểm thử. Lượt đầu lộ lỗi phạm vi PowerShell khiến callback đọc mã thoát cũ. Sau khi bỏ closure, lệnh trả exit 1, ghi `verificationPassed=false` và vẫn dọn stack. Ca này kiểm việc truyền lỗi và cleanup của phần điều phối. Lượt GitHub với thay đổi gây hỏng một bài thử còn cần kiểm trên commit được đẩy có chủ đích. [Kết quả lỗi cố ý](../test-artifacts/integration/crypta-t30-test-7df09d49ca70/ci-verification.json)

Lượt Chromium đầu của T20 có 37/38 nhóm đạt. Locator phân quyền tìm thấy hai phần tử có cùng nội dung. Workflow local trả exit 1, dọn stack và giữ chín container ngoài test. Locator đã được sửa để kiểm tiêu đề. Gitleaks cũng đã chạy với bộ quy tắc mặc định trên bản sao 372 file dự kiến đưa vào Git. Cây mã trả exit 0, còn mẫu token giả trả exit 1. [Chromium lỗi](../test-artifacts/integration/crypta-t30-test-91813cb1e51c/ci-verification.json) · [Quét Gitleaks](../test-artifacts/secret-scan-4331d554d099/verification.json)

Workflow chỉ tải artifact theo danh sách JSON kết quả và ảnh PNG. `.env`, dump, storage-state và toàn bộ thư mục artifact không thuộc danh sách tải. Báo cáo cục bộ nằm trong `tools/test-artifacts/integration/<project>/`, gồm `report.json`, `ci-verification.json` và kết quả của từng bộ.

Workflow trên GitHub Actions vẫn cần chạy trên commit ứng viên. Người quản lý repo cần chọn các check trong cấu hình bảo vệ nhánh. Các lượt local dưới đây ghi riêng theo hệ điều hành và phạm vi.

Đã cài sạch và chạy lint trên container Node 22.23.4 Linux. ESLint kiểm frontend, backend và các tệp test TypeScript với ngưỡng 0 warning. Mẫu `debugger` trả exit 1. Cấu hình cho phép khoảng trắng giữ kích thước skeleton trong JSX, regex lọc ký tự điều khiển ở đích điều hướng, và hai điểm thay lỗi gốc bằng mã an toàn. Bộ lint nằm trong package công cụ CI. Lockfile ghim `minimatch` 11.0.1 và audit công cụ ghi 0 advisory. [Hướng dẫn TypeScript ESLint](https://typescript-eslint.io/getting-started/) · [Cảnh báo minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) · [Kiểm Linux](../test-artifacts/ci-linux-baabe7ca1c8d/verification.json)
