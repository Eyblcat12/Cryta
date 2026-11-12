# Review nhánh ngoc — 28/09/2026

## Kết luận và phạm vi đã tích hợp

- Repository: `Eyblcat12/Cryta`; nhánh được đọc: `ngoc` tại `7303064565717a81777749295a43333f9d3f11c8`, so với main nền `ff1478c523a40a4291b102c2fcd03ef87a5dff08`.
- **Không gộp nguyên nhánh.** Chọn riêng commit sửa idle PostgreSQL pool error `7303064`, cherry-pick có giữ tác giả và nguồn thành `42a99ad`, bổ sung log an toàn và 4 unit test ở `105d104`.
- Đã push fast-forward, không force, lên GitHub `main`: **`105d104c41b0804410b12782434b89d522c341d6`**, xác nhận lại bằng `git ls-remote`.
- Tổng diff được đưa vào remote main chỉ gồm `backend/src/database/database.module.ts` và `backend/test/database-pool.spec.ts`. Không đưa mật khẩu, script E2E nguy hiểm, thay đổi auth, UI hoặc nghiệp vụ khác từ ngoc vào main.
- Workspace chính đã có cùng bản sửa pool/test, giữ nguyên các thay đổi T30/backend/tài liệu chưa commit. Không push toàn bộ workspace; kế hoạch motion và báo cáo này hiện là tài liệu local. Local HEAD main vẫn ở nền cũ để không đụng dirty tree; không tự pull/rebase/reset các thay đổi dở.
- Không build lại container, không sửa dữ liệu, không gửi email, không gọi provider hoặc database ngoài. Bản đang chạy không tự đổi theo GitHub main.

## Phát hiện chặn gộp nguyên nhánh

Các số dòng dưới đây thuộc **revision ngoc `7303064`**, không phải file hiện tại sau chọn lọc. Không sao chép giá trị credential vào báo cáo.

### NG-01 · P1 — Credential database viết thẳng trong test đã lên Git

- Vị trí: `backend/test_full_suite.mjs:6`, `backend/test_workflow_usecases.mjs:4`.
- Hai file chứa connection string dịch vụ database bên ngoài gồm user/password. Các test dùng kết nối này để sửa/xóa/chèn dữ liệu, trong khi API lại trỏ localhost; có nguy cơ test trên hai môi trường khác nhau.
- Không kiểm tra hiệu lực hoặc kết nối bằng credential tìm thấy. Cần chủ dịch vụ **thu hồi/rotate nếu còn hiệu lực**, kiểm tra truy cập và quyền tài khoản; xóa chuỗi khỏi mã mới không làm credential hết lộ trong lịch sử Git.
- Điều kiện nhận lại: dùng biến môi trường dành riêng DB test, từ chối chạy khi chưa xác nhận môi trường cách ly, không fallback về production; cleanup fixture trong finally; secret scanning và kiểm tra lịch sử. Không tự rewrite lịch sử nhánh của người khác.

### NG-02 · P1 — Giảm bảo vệ mật khẩu và làm bộ đếm đăng nhập mất tính atomic

- Vị trí: `backend/src/auth/auth.dto.ts:8–17`, `backend/src/users/users.dto.ts:2`, `backend/src/auth/auth.service.ts:19–30`.
- Mật khẩu mới/tạm từ tối thiểu 12 xuống 6; ngưỡng khóa từ 5 lên 10 lần sai, không có yêu cầu nghiệp vụ cho việc nới này.
- Bộ đếm đổi từ tăng ngay trong SQL thành đọc giá trị, cộng trong JS rồi ghi tuyệt đối; các lần đăng nhập sai đồng thời có thể ghi đè nhau, giảm hiệu lực lockout. Ý tưởng reset số lần sai sau hết hạn khóa hợp lý nhưng cần transaction/atomic SQL và test đồng thời.
- Điều kiện nhận lại: giữ chính sách hiện hành, không nới auth để test dễ chạy; sửa reset expired lock một cách atomic, có test ngưỡng/thời gian/race.

### NG-03 · P1 — Tạo metadata khóa giả cả khi dùng provider HTTP

- Vị trí: `backend/src/jobs/asset-processing.service.ts:7`.
- Khi cấp CERTIFICATE chưa có publicKeyAssetId, worker tự chèn KEY ACTIVE với provider reference `mock-key-...` và fingerprint ngẫu nhiên dự phòng, không giới hạn nhánh này vào MOCK. Provider HTTP không được gọi để xác nhận khóa tương ứng; DB có thể biểu diễn khóa đang hoạt động không có thật ở provider.
- Điều kiện nhận lại: hợp đồng provider trả key reference/metadata thật và liên kết chứng thư được xác minh; chỉ mô phỏng trong MOCK, có test HTTP thiếu key/reference, scope và retry/reconciliation.

### NG-04 · P1 — Emergency revoke thiếu xử lý kết quả provider không chắc chắn

- Vị trí: `backend/src/assets/assets.service.ts:29–70`, đặc biệt call provider trước audit/notification/COMMIT.
- Nếu provider đã revoke nhưng enqueue/audit/commit lỗi, transaction DB rollback về tài sản còn ACTIVE; thao tác ngoài hệ thống không rollback cùng DB. Retry có thể gọi lại provider; endpoint mới không có operation ledger/idempotency/reconciliation.
- Lý do còn được nhận qua `@Body('reason')` không có DTO kiểm tra type/độ dài, có thể lỗi `.trim()` sau khi provider đã thành công.
- Điều kiện nhận lại: validation trước side effect, ledger/idempotency và trạng thái đối soát; test provider success + DB fail, timeout không rõ kết quả và hai admin đồng thời. Không cho phép luồng mới bỏ qua các cổng P0 của T13/T16.

### NG-05 · P2 — Test runner có thể báo thành công cho CI khi có ca fail

- Vị trí: cuối `backend/test_full_suite.mjs:898–908` và `backend/test_workflow_usecases.mjs:716–726`.
- Assertion chỉ tăng bộ đếm và in FAILED; cuối run không đặt exitCode theo số thất bại. `.catch` chỉ bắt lỗi thoát ra ngoài, trong khi từng ca đã catch và ghi failed.
- Các script còn sửa mật khẩu tài khoản, tạo/chấp thuận/thu hồi tài sản và gọi SQL trực tiếp. `test_notification_bell.mjs` là API test, không phải browser test thao tác chuông/popover.
- Điều kiện nhận lại: exit code !=0 khi bất kỳ assertion fail, fixture/test DB cách ly, env bắt buộc, cleanup/retry/timeouts rõ, provider MOCK và email không phát ra ngoài; có browser test thật cho popover. **Chưa chạy các script này.**

### NG-06 · P2 — Frontend mới vẫn phụ thuộc anchor, không đáp ứng T30 hiện tại

- Vị trí: `frontend/src/App.tsx:177`, `frontend/src/App.tsx:372–384`; `components/NotificationPopover.tsx`.
- Nhánh tách component có ích cho bảo trì, nhưng chọn thông báo vẫn scroll đến section theo role thay vì mở request/asset bằng ID. Copy App.tsx của nhánh sẽ thay thế router/query/blocker đang có ở workspace.
- Popover cần bổ sung focus khi mở/đóng, điều khiển bàn phím, xử lý lỗi/pending của mark-all và đường đến danh sách đầy đủ; hiện chỉ slice 15 mục. Không coi API test là bằng chứng UI đạt.
- Điều kiện nhận lại: port từng component lên AppShell/Outlet hiện hành, giữ route/permissions/query/dirty forms và bổ sung component/browser regression. Không merge toàn bộ App/styles.

### NG-07 · P2 — API policy mới thiếu validation cấu hình và optimistic concurrency

- Vị trí: `backend/src/policies/policies.controller.ts:55–60`, `:103–141`.
- Body dùng TypeScript type thuần thay cho DTO validation, nhận configuration tùy ý hoặc `{}`; createVersion không yêu cầu expectedVersion. Khóa hàng giúp cấp số version không trùng nhưng không chặn admin phát hành từ một bản đã stale.
- Điều kiện nhận lại: schema/domain validation, giới hạn trường/giá trị, version conflict và test API/DB; đối chiếu PolicyManager và API hiện đã được triển khai local để tránh mất chức năng.

## Đánh giá từng commit

| Commit ngoc | Nội dung | Quyết định |
| --- | --- | --- |
| `4659bc9` | Modular frontend, auth, policy, emergency revoke, certificate linkage, bỏ Redis | Không nhận nguyên commit vì NG-02/03/04/06/07. Tách component đáng giữ nhưng phải port có test; bỏ Redis cần đối chiếu tài liệu/script/deployment riêng |
| `c7a9bdf` | Full-suite API test | Chặn bởi NG-01/05; không chạy trên hệ thống hiện tại |
| `4a81078` | Workflow/use-case tests | Chặn bởi NG-01/05; chưa là bằng chứng nghiệp vụ đạt |
| `99477ab` | NotificationPopover và API tests | Chưa nhận; port sang route/detail và kiểm thử UI theo NG-06 |
| `7303064` | Bắt pool idle error | Đã chọn lọc, bổ sung logging/test trước push main |

## Bằng chứng kiểm thử

Môi trường: Windows, Node `v25.9.0`, dependency cài bằng lockfile với `npm ci --ignore-scripts --no-audit --no-fund`; không dùng credential test trong repo. Kết quả không thay thế nghiệm thu Node LTS/Docker, DB hay provider thật.

| Phạm vi | Lệnh/kiểm tra | Kết quả |
| --- | --- | --- |
| ngoc nguyên bản `7303064` | Backend `npm run build`, `npm test` | Build đạt, 3 file / 18 unit test đạt |
| ngoc nguyên bản `7303064` | Frontend `npm run build` | Đạt, Vite 6.4.3; chưa browser review nhánh |
| main + pool fix + log/test | Backend build + `npm test` | Đạt, 4 file / 22 test |
| Workspace hiện tại + cùng pool fix/test | Backend `npm test`, `npm run build` | Đạt, 19 file / 65 test; build đạt |
| Diff tích hợp | `git diff --check`, staged diff check | Đạt |
| Remote sau push | `git ls-remote --heads origin main` | `105d104c41b0804410b12782434b89d522c341d6` |

4 test mới xác minh factory giữ cấu hình; error event không làm throw và không lộ error thô; health vẫn 503 khi query lỗi; health trở lại ok khi lần probe sau thành công. Đây là unit test với event/query giả lập, **chưa chứng minh reconnect qua sự cố mạng PostgreSQL thật**.

## Việc tiếp theo

1. Chủ database xử lý credential NG-01 trước khi chạy lại test nhánh.
2. T30 tiếp tục ưu tiên: hoàn thiện shell/data/session/blocker rồi N1–N6 theo kế hoạch mới; motion hiện mới là kế hoạch.
3. Port chọn lọc decomposition/popover sau khi đáp ứng routing và trợ năng; không cherry-pick nguyên frontend cũ.
4. Sửa lỗi P1 trước khi cân nhắc lại emergency revoke/certificate linkage; chạy E2E trong môi trường riêng.

Nguồn đối chiếu pool behavior: [node-postgres pooling](https://node-postgres.com/features/pooling). Listener idle error không thay xử lý lỗi query/transaction hoặc health check.
