# T27/T48 — Expiry scan trên PostgreSQL thật, 06/10/2026

[Lượt đầu thực 13/13, EXIT 0](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/expiry-scan-4b94b9549473/results.json) đạt trong phạm vi dưới đây, trên backend 40cef trước migration 008. **T27/T48 chưa nghiệm thu toàn bộ.** Không thay expiry/notifications product source; harness gọi service đã compile của image backend thật, kiểm state/version/audit/notification trong PostgreSQL và dọn DB test riêng. Lượt sau trên backend 73fdb được ghi riêng bên dưới.

Run từ **00:34:28 đến 00:34:44 ngày 06/10, Asia/Bangkok** (`createdUtc`/`finishedUtc`: `2026-10-05T17:34:28Z`/`17:34:44Z`). Project runner tạo `crypta-t30-test-84612a8a6a2d`, provider **MOCK**, **SMTP=false**, không đọc môi trường vận hành. DB nguồn `crypta_t30_test`; harness cấp phát mới `crypta_expiry_test_4b94b9549473`, xác nhận DB rỗng trước bootstrap/migrations, các kiểm tra chỉ ghi vào DB mới.

## Phạm vi đã kiểm chứng

| Nhóm thực chạy | Kết quả được kiểm tra trong SQL |
| --- | --- |
| UTC/clock | Đồng hồ cố định 2032-01-01T12:00:00Z ở session DB test, timezone UTC; khác `pg_catalog.now()`. SQL service giữ nguyên. |
| Đúng policy version | Asset gắn version với `[30,7,1]` dùng đúng mốc đó dù version mới có `[14,2]`; asset gắn version mới chưa tới 14 ngày không bị mốc 30 cố định chi phối. |
| Ba mốc 30/7/1 | Mỗi boundary đúng tới 1 ms: trước mốc chưa nhắc, đúng mốc thêm hai notification theo channel; status/version chỉ đổi lần đầu ACTIVE→EXPIRING_SOON, audit transition đúng một lần. |
| Hết hạn | Trước expiry 1 ms còn EXPIRING_SOON; đúng expiry thành EXPIRED, version tăng một, SYSTEM audit đúng entity/outcome. Quét lặp hoặc instance khác không tăng lần nữa. |
| Loại trạng thái | REVOKED/SUPERSEDED, cả quá hạn và chưa hết hạn, không bị cảnh báo/đổi state/audit. |
| Catch-up | Còn 4 ngày chọn 7-days, còn12 giờ chọn 1-days; asset quá hạn chỉ nhận expired. Không gửi tất cả mốc đã bỏ lỡ. |
| Cấu hình biên đã nêu | Thiếu warning_days dùng fallback 30; mảng rỗng/nonpositive không nhắc; mảng có mốc lặp chọn nearest threshold và không nhân notification. |
| Hai scanner/overlap | Hai **ExpiryScanService instance thật** tranh advisory transaction lock PostgreSQL, kết quả `[true,false]`; cùng instance đang running không mở client thứ ba. Chạy lại giữ hai rows notification/một audit. |
| Fault/rollback/recovery | Sau **INSERT enqueue thật**, harness gây lỗi trước commit: state/version, notification và audit của asset hết hạn/cảnh báo đều rollback. Cùng scanner gỡ running flag và chạy lại thành công, không nhân kết quả. |
| Loại asset | KEY đang ACTIVE và CERTIFICATE đang EXPIRING_SOON tại expiry đều đổi EXPIRED/version đúng một lần. |
| Recipient/channel hiện có | Owner nhận IN_APP/SENT có sent_at và EMAIL/PENDING chưa gửi; Approver/Admin cùng department không nhận. Chỉ ghi nhận hợp đồng owner-only hiện tại, chưa chốt yêu cầu recipient. |

Các mốc 7 và 1 ngày là hai nhóm riêng, nên bảng gộp 11 dòng mô tả **13 nhóm trong report**. Assertions đọc SQL xác nhận kết quả; `run()` của service tự catch lỗi không được dùng làm dấu hiệu pass.

## Source, runtime và bảo toàn dữ liệu

[Host wrapper](tools/test-real-expiry-scan.cjs) SHA-256 `8fc1cd70c22a66c2d80d6d4f26f4054e282f53529f97be848ab2eee4609d0be7`, mtime UTC17:33:46; [container runner](tools/testing/expiry-scan-runner.cjs) SHA-256 `1e47a67a8a6f613340defa7f824fa4380958c21927481a8ec3628ac1d0665d4b`, mtime UTC17:30:38. Hai file và bốn schema/product source đã khớp sáu `sourceHashes` **tại lúc kiểm chứng lượt đầu**, trước sửa migration 008; hai mtime trước `createdUtc` của run. Hiện hai harness và source expiry/notifications vẫn khớp lượt đầu; schema và MigrationService đã đổi nên giữ đúng snapshot 40cef lịch sử. Đây là bản harness **sau sửa inventory**, không gán kết quả cho bản dùng negative-label filter cũ.

Actual instances: **ExpiryScanService, NotificationsService, MigrationService** từ `/app/dist`; report có hash ba compiled service. Backend image `sha256:40cef52c79ee27a6d95de56fc50b8cec8c29f1c1f05d05d1fe80f4aaede7ea62`, PostgreSQL `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`. Không instantiate ứng dụng HTTP, SMTP worker hoặc timer `onModuleInit` của expiry scan.

Inventory dùng **toàn bộ container chạy và dừng, ID đầy đủ**, rồi loại đúng project trong JavaScript. Report có 11 container trước/sau, **8 đối tượng ngoài test** trước/sau giống hệt ID/name/project, `comparisonHasSubjects:true`, `otherContainerIdsPreserved:true`; ba container stack test cũng giữ nguyên. Trong 8 đối tượng có bốn container `crypta` với IDs 5fdb507d3421/ddfd56729f19/e153aa5325e1/a0d5c2d08df7. Đây là proof có đối tượng so sánh, không suy ra từ danh sách rỗng.

`cleanupCompleted:true`, **DB expiry mới còn 0**; schema clock/fault data cùng DB được dọn. Cleanup này chỉ áp dụng DB `crypta_expiry_test_4b94b9549473`; [stack nguồn](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/report.json) là lifecycle riêng và phải được dọn/xác minh khi kết thúc các lượt test còn lại. Harness không reset/drop DB nguồn hoặc container vận hành.

## Lượt sau nâng cấp backend và migration 008

[Lượt mới 13/13, EXIT 0](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/expiry-scan-ff56a7c36539/results.json) chạy **11:43:29–11:43:45 ngày 06/10, Asia/Bangkok** (`2026-10-06T04:43:29Z`–`04:43:45Z`) trên backend image `sha256:73fdb9c366a15ef047c5aac9b4e85ddf3f2cc2ad8efb5ecc66a668bdbeffb395`, sau worker recovery fix và [migration 008](T19_POLICY_VERSION_2026-10-06.md). Cùng 13 nhóm và fixed session clock; không gán runtime 73fdb cho lượt 40cef trước đó.

Sáu sourceHashes của report mới khớp source hiện tại khi đối chiếu. Ba compiled file của container khớp `backend/dist`: expiry-scan SHA `7b0ddc8fa3ff80e2af6afbe7e303c6da49c608c2c9d1083fdd8112a9c3bf79c6`, notifications SHA `73dd6b752f30c971a827db86acc29f941fdd42c4680d878661140b306d0c5a7d`, MigrationService SHA `a7c944ff2b245db31f24fc4e7f5ab8b6f380552150a9329444f0bff738cc9ca5`. Hai service expiry/notifications giữ nguyên hash; migration đã đổi đúng phase 008.

DB mới `crypta_expiry_test_ff56a7c36539` được xác nhận rỗng trước bootstrap và đã dọn, remaining 0/cleanupCompleted true. Inventory 11 trước/sau khớp; **8 đối tượng ngoài test** giữ nguyên, comparisonHasSubjects true, ba container stack test không đổi trong lượt này. Ledger DB nguồn [7→8](tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/phase-after-backend-upgrade.json) giữ nguyên 7 checksum/PostgreSQL identity; [backend 119/119](tools/test-artifacts/unit/backend-policy-worker-20261006-final/results.json) và build EXIT 0 là scope source/image mới. Đồng hồ scheduler, mail thật, recipient policy và malformed legacy config vẫn giữ giới hạn dưới đây.

## Chạy lại và giới hạn còn mở

Từ thư mục dự án, dùng report của một stack **mới/đang giữ**, `started:true`, `keptStack:true`, `cleanupCompleted:false`, MOCK/SMTP=false và ba service đang chạy. Ví dụ report của lượt trên:

```powershell
node tools/test-real-expiry-scan.cjs tools/test-artifacts/integration/crypta-t30-test-84612a8a6a2d/report.json
```

Mỗi lượt cấp phát tên DB/output mới và dọn chính DB đó. Report đã cleanup, binding vận hành 8080, ownership/volume/runtime env không khớp đều bị từ chối; không tái dùng report lịch sử đã dọn. Docker/DB test phải sẵn sàng; không chạy đồng thời với lượt đo performance cần máy yên.

Clock test là function `now()` trong schema **chỉ ở DB mới**, với search_path/current_setting riêng mỗi session. Đây là kiểm tra logic SQL tại thời điểm xác định; chưa chứng minh timer mỗi giờ, chạy qua nhiều process/restart, scheduler downtime thật, lease/monitoring hoặc wall-clock delivery. Hai scanner là hai instance trong một Node process dùng connection PostgreSQL riêng.

Còn chốt **owner/Approver/Admin recipients**, kiểm SMTP gửi thật/retry/delivery và đối chiếu UC11–UC12 end-to-end/UI. Các trường hợp warning_days **JSON null, không phải mảng, phần tử không phải số nguyên hoặc vượt miền int** chưa nằm trong 13 nhóm expiry; [policy pipe 18 unit và harness 8 nhóm mới](T19_POLICY_VERSION_2026-10-06.md) bổ sung publication validation proof, chưa là HTTP/JWT end-to-end. Khả năng xử lý **legacy/import/raw INSERT sai** mà không làm toàn scan kẹt vẫn mở; immutable version guard không tự sửa hình dạng JSON. Fallback/empty/nonpositive/duplicate trong DB test không đồng nghĩa phê duyệt nhập policy đó qua API. T48 còn các worker/sự cố khác ngoài 13 nhóm expiry; evidence Sending/Processing/recovery giữ ở review riêng, không cấp nghiệm thu toàn task từ 13/13.
