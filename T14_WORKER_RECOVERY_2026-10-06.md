# T14 — Phục hồi worker, 06/10/2026

Đã sửa lỗi thao tác còn trẻ khi worker khởi động bị giữ ở `PROCESSING` sau khi quá 15 phút. Source kiểm tra stale ở đầu mỗi poll, bên trong guard `running` và trước vòng claim. PostgreSQL 17 thật cho đối chứng **BEFORE 2/3 → AFTER 12/12** trên hai image riêng. Đây là nghiệm chứng lát cắt phục hồi; **chưa đóng toàn bộ T13–T15 hoặc T48**.

## Baseline trên backend cũ

[Report BEFORE](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/worker-recovery-before-569c8600299d/results.json) có **2/3**, exit **1** vì tiêu chí phục hồi còn thất bại. Stack `crypta-t30-test-84612a8a6a2d` dùng backend image `sha256:40cef52c79ee27a6d95de56fc50b8cec8c29f1c1f05d05d1fe80f4aaede7ea62`, provider `MOCK`, SMTP tắt. Runner tạo riêng database `crypta_worker_test_569c8600299d`; đây không phải database nguồn `crypta_t30_test`.

| Kiểm tra | Bằng chứng BEFORE |
| --- | --- |
| Claim một Approved cũ không bị coi là stale ngay | Đạt: `updated_at` đổi từ 11:30 UTC thành 12:00 UTC qua trigger gốc |
| Startup sweep giữ thao tác còn trẻ | Đạt: request `PROCESSING`, ledger `PROVIDER_SUCCEEDED`, attempt 1, reference đã lưu |
| Poll sau 16 phút đưa cùng thao tác sang đối soát | **Không đạt:** request vẫn `PROCESSING`, version 2, không có audit đối soát |

Reference `mock-key-3751d672-23cf-4f75-96ed-c26a90502c7b` và attempt 1 được giữ, số lần gọi MOCK vẫn 1, chưa có asset. Lỗi được xác định ở việc thiếu sweep định kỳ; không có bằng chứng provider bị gọi lại trong baseline này.

`trg_requests_updated` được giữ và xác nhận đang bật. Trigger gọi `set_updated_at()` để cập nhật timestamp khi claim, nên không kết luận SQL claim thiếu `updated_at=NOW()` là lỗi trên schema hiện tại. Product change giữ nguyên SQL claim và trigger này.

Database cấp riêng đã được dọn: `testDatabaseRemaining=0`, `cleanupCompleted=true`, failure trigger còn 0. Inventory toàn bộ container trước/sau gồm 11 container; 8 ngoài project test giữ cùng full ID/name/project, 3 container test giữ nguyên. Đây là bằng chứng cleanup database con của runner; stack Compose được giữ trong các phase kiểm thử, không phải bằng chứng đã dọn toàn stack.

## Source và unit test

[AssetProcessingService](backend/src/jobs/asset-processing.service.ts) gọi `markStaleForReconciliation()` ở mỗi `run()` sau khi bật guard và trước claim. Request stale chỉ chuyển sang `RECONCILIATION_REQUIRED`; thao tác không được tự đưa về `APPROVED` hoặc phát lại provider call. Sweep, ledger và audit tiếp tục dùng cùng transaction đã có.

[Focused unit report](tools/test-artifacts/unit/worker-recovery-20261006/results-focused.json) đạt **6/6**, exit 0: hai test cũ và bốn test mới cho young→stale qua các poll, poll chồng nhau, lỗi lấy connection và lỗi audit rồi phục hồi. Unit dùng Pool mock; chứng minh SQL/transaction thật lấy từ các lượt DB riêng. [Source state](tools/test-artifacts/unit/worker-recovery-20261006/source-state.json) giữ snapshot source/tests/harness trước khi chạy AFTER, nên cờ `afterNotYetExecuted` trong file đó thuộc thời điểm chụp.

[Bộ backend cuối](tools/test-artifacts/unit/backend-policy-worker-20261006-final/results.json) đạt **119/119**, không có test thất bại; build backend đạt trước khi recreate backend test. Bộ cuối bao gồm cả các thay đổi policy được kiểm chứng riêng.

Hash compiled worker BEFORE là `d42a34094ac4487866cb109a6623be7dc79495be48ad4d90767d3c3021a388c9`. Report tách hash source đang đọc, hash compiled file thực sự được load trong container và image ID. Host harness đã thêm tổng hợp `success` theo cả cleanup/preservation sau baseline; hash host BEFORE và source state hiện tại có phạm vi riêng, không gán chúng thành cùng revision.

## AFTER trên image mới — 12/12

[Report AFTER](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/worker-recovery-after-af5e76e6c5d8/results.json) đạt **12/12**, `mode=after`, `success=true`, trên backend image `sha256:73fdb9c366a15ef047c5aac9b4e85ddf3f2cc2ad8efb5ecc66a668bdbeffb395`. [Host runner](tools/test-real-worker-recovery.cjs) và [runner trong container](tools/testing/worker-recovery-runner.cjs) chạy đúng 12 nhóm sau, tất cả đạt:

1. Claim giữ freshness nhờ timestamp trigger gốc.
2. Startup sweep giữ boundary còn trẻ.
3. Poll sau 15 phút đối soát cùng boundary, giữ reference/attempt và không replay.
4. Boundary `CLAIMED` được đối soát, attempt vẫn 0.
5. Boundary `SENT` được đối soát, attempt vẫn 1.
6. Hai worker sweep đồng thời chỉ tăng version và ghi audit một lần.
7. Audit failure rollback request/ledger cùng nhau; poll sau phục hồi.
8. Connection failure giải phóng guard; poll sau phục hồi.
9. Cùng instance bỏ qua poll chồng khi connection đầu còn chờ.
10. Approved bình thường vẫn tạo đúng một asset và hoàn tất đúng một lần.
11. Provider result đến muộn không commit asset sau khi worker khác đã đối soát request.
12. Lỗi transaction cuối rollback asset, giữ provider reference và chuyển đối soát; poll sau không replay.

Boundary còn trẻ có request `PROCESSING` version 2 và ledger `PROVIDER_SUCCEEDED`. Khi clock test tới 12:16 UTC, poll đưa request/ledger sang `RECONCILIATION_REQUIRED`, version 3, đúng một audit `REQUEST_RECONCILIATION_REQUIRED`; reference và attempt 1 giữ nguyên, số lần gọi MOCK vẫn 1, không có asset mới. Hai sweep đồng thời cũng chỉ có một audit/version increment. Audit failure giữ nguyên request/ledger khi rollback rồi poll sau phục hồi. Provider result đến muộn và lỗi transaction cuối đều giữ reference, không commit asset và không replay.

Database riêng `crypta_worker_test_af5e76e6c5d8` đã dọn: `testDatabaseRemaining=0`, `cleanupCompleted=true`, failure trigger còn 0. Inventory **11→11**, ngoài project test **8→8**, `comparisonHasSubjects=true`; cả `otherContainerIdsPreserved` và `isolatedContainerIdsPreserved` đều true. Timestamp trigger gốc vẫn có và đang bật.

Cả **7 hash source** trong report khớp file hiện tại. Cả **4 hash compiled service** đọc trong container khớp byte của `backend/dist` từ build cuối:

| Compiled service | SHA-256 |
| --- | --- |
| `jobs/asset-processing.service.js` | `8837542c5f4d8a6f1b9faf80fb22708c9d926666571536f33b18912ff9cb2ad3` |
| `jobs/crypto-provider.service.js` | `43e4ca9194a59f730c71d286077786ec645a5a5890f2698f42c284773f5e17ae` |
| `notifications/notifications.service.js` | `73dd6b752f30c971a827db86acc29f941fdd42c4680d878661140b306d0c5a7d` |
| `database/migration.service.js` | `a7c944ff2b245db31f24fc4e7f5ab8b6f380552150a9329444f0bff738cc9ca5` |

Compiled worker AFTER khác hash BEFORE. Image mới cũng chứa thay đổi policy; report source/schema/migration và image ID phân biệt hai phase, không gán image mới cho báo cáo cũ.

Để chạy lại, cần stack test còn giữ hoặc một stack mới sau khi source đã freeze và backend test đã build/recreate. Không dùng namespace đã dọn:

```powershell
node tools/test-real-worker-recovery.cjs <report.json-cua-stack-test> after
```

Lượt chạy lại phải đủ 12/12, `mode=after`, `success=true`, database cấp riêng đã dọn, failure trigger 0, cả inventory ngoài project và inventory test trước/sau khớp. Đối chiếu hash compiled worker/migration với build/image của chính lượt đó; hash source đơn lẻ không chứng minh container đã dùng mã mới.

## Phạm vi và giới hạn chứng cứ

Runner load `AssetProcessingService`, `CryptoProviderService`, `NotificationsService` và `MigrationService` compiled thật. Nó gọi các bước claim/sweep/poll có kiểm soát, không khởi động toàn app hoặc timer. Clock là `now()` trong schema của database mới, với UTC/search_path/GUC trên các connection test; đồng hồ máy và clock database nguồn không đổi.

Boundary được tạo bằng claim/ledger/provider MOCK thật rồi giữ trước transaction hoàn tất. Đây là **mô phỏng trạng thái đã lưu tại ranh giới crash**, không phải diễn tập kill/restart tiến trình hệ điều hành hoặc độ bền scheduler production. MOCK có reference ổn định; không thay hợp đồng idempotency/lookup hay kết quả trả về của provider thật.

Pool trong runner xác nhận URL ban đầu thuộc backend test rồi đổi pathname sang database cấp riêng; mỗi connection xác nhận `current_database()`. Bootstrap/reset/fault injection chỉ chạy trong database đó. Host dùng database nguồn để đọc metadata và tạo/dọn database con. Harness hiện **không chụp row count/hash của các bảng nguồn trước/sau**, nên không dùng report này để khẳng định dữ liệu nguồn bất biến bằng checksum. Container identity preservation cũng không chứng minh trạng thái dữ liệu hoặc sức khỏe service.

Heartbeat/fencing đầy đủ, mất phản hồi provider thật, OS crash, manual reconciliation có phân quyền/audit, toàn ma trận CREATE/RENEW/REVOKE và hợp đồng provider thật còn cần bằng chứng riêng. Bộ verifier ngày 04/10 cố định các report/image/source count cũ; không dùng nó để xác nhận source hoặc AFTER của lượt này. Hai harness worker mới đã được thêm vào allowlist archive hiện tại; report BEFORE được giữ nguyên.
