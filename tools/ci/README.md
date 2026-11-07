# Kiểm thử tích hợp trong CI

Lượt mới sau chỉnh schema cài mới và validator đạt 158/158 nhóm. Ledger có thêm ca từ chối nạp lại schema và giữ dữ liệu cùng lịch sử migration. Backend 419/419, lint và OpenAPI đạt. Stack đã được dọn và danh tính chín container ngoài test khớp. [Kết quả](../test-artifacts/integration/crypta-t30-test-f1f20ec87e12/ci-verification.json)

Workflow `Build and test` chạy build/unit theo package, ESLint và quét bí mật trước khi chạy job tích hợp. Build TypeScript kiểm kiểu frontend và backend. Gitleaks quét cây Git của revision bằng image ghim digest, gắn cây chỉ đọc, tắt mạng và che giá trị phát hiện. Job tích hợp build hai image ứng dụng và chạy PostgreSQL/Nginx với Chromium đúng phiên bản Playwright trong lockfile. [Workflow](../../.github/workflows/ci.yml) · [Hướng dẫn Playwright](https://playwright.dev/docs/ci-intro) · [Gitleaks](https://github.com/gitleaks/gitleaks)

`run-integration.ps1` dựng project Docker mới, chạy smoke rồi lần lượt gọi các bộ parser, ledger, quyền runtime, phục hồi worker, hết hạn, giao email và trình duyệt/API. Stack dùng seed, provider MOCK và SMTP tắt. Các bài giao thư dựng SMTP loopback riêng. Sau thành công hoặc lỗi, script dọn stack và kiểm danh tính container ngoài project.

Ca cuối chặn một giao dịch ghi tài sản bằng advisory lock trong database test rồi gửi SIGTERM cho backend cách ly. Ca thử kiểm readiness và yêu cầu mới trả 503, liveness vẫn 200, giao dịch đã nhận ghi đúng một lần và yêu cầu thứ hai vẫn nằm trong hàng chờ. Runner dừng backend test nên đặt ca này sau bộ trình duyệt. [Script diễn tập](../test-real-shutdown.ps1)

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
