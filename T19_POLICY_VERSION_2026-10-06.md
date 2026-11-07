# T19 — Published policy version bất biến, 06/10/2026

Version đã được asset/request tham chiếu trước đây vẫn cho phép UPDATE cấu hình trực tiếp, nên giữ cùng ID nhưng có thể đổi quy tắc đang được áp dụng. Bootstrap và **migration 008** nay chặn UPDATE/DELETE mọi row `policy_versions` bằng `POLICY_VERSION_IMMUTABLE`/SQLSTATE 23514. Thay đổi policy tiếp tục được publish bằng INSERT version mới. **T19 chưa nghiệm thu toàn bộ.**

## Bằng chứng trước và sau

| Lượt chạy PostgreSQL thật | Kết quả quan sát |
| --- | --- |
| [BEFORE 6/8, EXIT 1 dự kiến](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/policy-version-32f543d5fb8a/results.json), backend 40cef | Hai invariant fail: UPDATE warning_days `[30,7,1]`→`[5]` thành công, asset/request vẫn tham chiếu cùng ID nhưng đọc configuration đã đổi; DELETE published version chưa được tham chiếu thành công, còn 0 row. Sáu nhóm validation/append/concurrency/stale/audit rollback pass. |
| [AFTER 8/8, EXIT 0](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/policy-version-3906f22f64cb/results.json), backend 73fdb | UPDATE và DELETE đều bị 23514; warning_days cũ giữ `[30,7,1]`, asset/request giữ đúng ID/configuration, published row chưa có reference vẫn còn 1. INSERT version mới và audit vẫn thành công. |

AFTER chạy **11:43:20–11:43:26 ngày 06/10, Asia/Bangkok** (`2026-10-06T04:43:20Z`–`04:43:26Z`). Actual instances **PoliciesController, ValidationPipe, MigrationService** từ image đã build, kết nối PostgreSQL 17 thật. Gọi controller/pipe trực tiếp với actor test; không dùng HTTP server/JWT guard trong harness này. MOCK/SMTP=false; không chạy provider hoặc gửi email.

Tám nhóm kiểm tra: 13 dạng warningDays sai bị 400 qua cấu hình ValidationPipe giống ứng dụng; warning>validity bị 409 trước `pool.connect`; UPDATE/DELETE bất biến; append mới giữ binding cũ và thêm đúng một audit; hai controller cùng expectedVersion chỉ một thành công/một VERSION_CONFLICT; stale version không thêm row/audit; lỗi INSERT audit thật rollback cả version vừa thêm. Mảng rỗng và các bound hợp lệ vẫn được phép; chưa đặt thêm quy tắc phải có ít nhất một mốc cảnh báo.

## Nâng cấp additive và đối chiếu source

[Ledger trước nâng cấp](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/phase-before-backend-upgrade.json) có 7 migration; [ledger sau](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/phase-after-backend-upgrade.json) có 8. Cả **7 version/checksum cũ khớp nguyên vẹn**, chỉ thêm `008_policy_versions_immutable` SHA-256 `247caefebea40b495377915e71d5212e3c7b348055390152a5951ad6a504efcb`. SQL 001–007 không đổi; 008 không thêm DROP hoặc reset/seed dữ liệu. Guard được tạo nếu chưa có, nên bootstrap có trigger sẵn vẫn chạy migration được.

PostgreSQL test giữ full ID `5590002acfc7c11ebd05ee2cfb1b99db3d321224f73116e798f7c0ba61868d80` qua nâng cấp; chỉ backend test được recreate. **8 container ngoài test** có ID/name/project được đối chiếu không đổi. AFTER harness có full inventory 11 trước/sau giống nhau, `comparisonHasSubjects:true`; DB cấp phát mới `crypta_policy_test_3906f22f64cb` đã dọn, `cleanupCompleted:true`, remaining 0. DB BEFORE riêng cũng đã dọn; cleanup này không thay lifecycle stack 846 nguồn.

Backend AFTER image **`sha256:73fdb9c366a15ef047c5aac9b4e85ddf3f2cc2ad8efb5ecc66a668bdbeffb395`**, PostgreSQL image `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`. Sáu sourceHashes của AFTER report khớp source hiện tại khi đối chiếu. Hai compiled file trong container khớp `backend/dist`:

| Compiled file | SHA-256 |
| --- | --- |
| policies/policies.controller.js | `2abc615b60c140544cfe5ce4255346aa4e899b45c9f40f49a8d79927b2852915` |
| database/migration.service.js | `a7c944ff2b245db31f24fc4e7f5ab8b6f380552150a9329444f0bff738cc9ca5` |

[Backend 119/119 và tất cả suite pass](tools/test-artifacts/unit/backend-policy-worker-20261006-final/results.json), backend build EXIT 0. Trong đó [policy validation 18 test](backend/test/policy-validation.spec.ts), [publish transaction 4](backend/test/policy-version.spec.ts), [migration 5](backend/test/migration-service.spec.ts) gồm hash 001–007 được pin, chỉ thêm 008 trên ledger cũ và từ chối checksum 008 sai. Tên test transaction cũ đã đổi thành “appends and audits”; không gọi unit mock là chứng minh immutability DB. Kết quả unit/build không thay 8 nhóm PostgreSQL thật.

## Chạy lại và giới hạn

[Host](tools/test-real-policy-version.cjs) chỉ nhận report runner tạo của stack test đang giữ, MOCK/SMTP=false, ownership/volume/binding loopback đúng; mỗi lượt tạo DB rỗng mới, bootstrap+migrations, kiểm SQL rồi dọn chính DB đó. [Runner](tools/testing/policy-version-runner.cjs) kiểm phase khớp ledger thực trong compiled image.

```powershell
node tools/test-real-policy-version.cjs tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/report.json after
```

Report nguồn đã cleanup sẽ bị từ chối; cần stack test mới/đang giữ với image có 008. `before` chỉ dùng image/schema trước sửa để tái hiện hai invariant fail, không chạy trên image 008. Không rebuild hoặc chạm DB vận hành chỉ để chạy lại bằng chứng lịch sử.

Guard bảo vệ ordinary UPDATE/DELETE; **TRUNCATE, disable/drop trigger và quyền DB owner/superuser** cần cổng least-privilege/migration riêng, chưa được chứng minh chống tamper ở đây. FK `changed_by` SET NULL hoặc policy DELETE CASCADE có thể bị guard chặn; API hiện tại publish bằng INSERT và không có đường xóa actor/policy, nhưng quy trình maintenance/remediation tương lai cần thiết kế rõ. Chưa gọi mọi version lifecycle/effective-date/algorithm/curve/purpose đã hoàn tất.

API warning-day shapes đã có pipe/unit proof, nhưng **DB CHECK chỉ yêu cầu configuration là JSON object**. Legacy/import/raw INSERT có thể tạo warning_days null/non-array/noninteger/out-of-range; immutable guard không sửa hoặc lọc dữ liệu đó. Chưa có fail-isolation/remediation cho policy legacy làm rollback toàn expiry scan; không tự chuyển malformed cấu hình sang fallback. Role/JWT/HTTP end-to-end, quyền DB tối thiểu, policy hết hiệu lực và worker/provider sử dụng snapshot đầy đủ vẫn thuộc các mục còn mở của T03/T19/T27/T48.
