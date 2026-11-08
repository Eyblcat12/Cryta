# T14 — Guard thực thi worker, 05/11/2026

Worker nay kiểm tra lại request, policy và tài sản trước khi gọi provider và trước khi ghi kết quả. Gia hạn/thu hồi không tiếp tục trên target sai owner, trạng thái không còn cho phép, policy không khớp hoặc thiếu provider reference. Nếu dữ liệu đổi trong lúc chờ provider, transaction cuối không ghi đè target; receipt đã nhận được giữ để đối soát. Đây là một phần T03/T10/T13–T15/T48, chưa nghiệm thu toàn bộ các task này.

## Thay đổi được kiểm chứng

[AssetProcessingService](backend/src/jobs/asset-processing.service.ts) nhận đúng row `PROCESSING` và version sau claim qua `UPDATE ... RETURNING *`. Một transaction ngắn khóa theo thứ tự request → policy → asset → key metadata → operation, kiểm request còn PROCESSING, version/input/result chưa đổi, policy active/đã effective và target hợp lệ. Nó đánh dấu ledger `SENT` cùng attempt trong transaction đó, commit và nhả connection trước khi gọi provider. Không giữ row lock suốt thời gian gọi bên ngoài.

Target dùng cùng [guard owner/trạng thái và bộ giải tham số](backend/src/requests/request-policy.ts) của hợp đồng hiện có: chỉ owner được đổi asset ACTIVE/EXPIRING_SOON; policy version phải khớp target. Worker dùng `resolveProvisionParameters` cho loại tài sản, algorithm, key size, usage và validity, thay các default RSA/2048/SIGNING riêng. Queued request giữ version policy đã được duyệt; việc publish version mới không tự thay version của request đang chờ.

Receipt provider được lưu trước transaction hoàn tất. Transaction cuối khóa lại theo cùng thứ tự, so request input/version, policy configuration và target snapshot gồm owner, department, state, version, policy, type, reference, algorithm/key size/usage. Drift hoặc lỗi audit làm rollback các thay đổi asset/request/ledger hoàn tất rồi chuyển request sang `RECONCILIATION_REQUIRED`, giữ receipt và attempt. Không đưa lại APPROVED hoặc tự gọi provider lần nữa.

## Kết quả thực tế

[Report worker PostgreSQL thật](tools/test-artifacts/integration/crypta-t30-test-dfb502e8f8f6/worker-recovery-after-3ff558a99fdf/results.json) đạt **23/23**, `plannedTotal=23`, `mode=after`, `success=true`, exit 0. Lượt này chạy **22:12:24–22:12:35 ngày 05/11/2026, Asia/Bangkok** (`15:12:24Z`–`15:12:35Z`), trên stack test `crypta-t30-test-dfb502e8f8f6`, provider MOCK, SMTP=false. Runner load compiled AssetProcessingService, CryptoProviderService, NotificationsService và MigrationService, kết nối PostgreSQL 17 thật trong database mới `crypta_worker_test_3ff558a99fdf`.

| Nhóm | Quan sát đạt |
| --- | --- |
| 12 nhóm phục hồi trước đây | Timestamp trigger gốc; startup young→stale qua poll; CLAIMED/SENT boundaries; hai sweep một audit/version; audit/connection failure hồi phục; guard cùng instance; CREATE một lần; late provider và final-transaction rollback giữ receipt |
| Guard RENEW và REVOKE trước provider | Mỗi loại kiểm owner khác, bốn trạng thái REGISTERED/EXPIRED/REVOKED/SUPERSEDED, policy khác và reference rỗng: **0 provider call, attempt 0**, target nguyên vẹn, một audit đối soát; poll tiếp không replay |
| Request đã claim bị đổi | Version hoặc reason đổi sau claim đều bị chặn trước SENT; không gọi provider |
| Policy chưa dùng được | CREATE/RENEW/REVOKE với policy inactive hoặc version future đều bị chặn trước provider, attempt 0 |
| Tham số dùng chung | AES/ED25519/ECDSA nhận key size 256; AES dùng ENCRYPTION, hai loại còn lại SIGNING. Input provider thực và metadata key đã lưu khớp |
| Gia hạn bình thường | Dùng version policy cũ gắn target dù có version mới; đúng replaces reference/lineage, target cũ SUPERSEDED, tài sản mới ACTIVE, một call/audit; poll tiếp không lặp |
| Thu hồi bình thường | Đúng reference/operation ID, một revoke call/audit, asset REVOKED, hai notification row owner EMAIL/IN_APP; không chứng minh delivery SMTP |
| Drift target khi provider đang chờ | Mỗi RENEW/REVOKE kiểm bảy trường: owner, state, version, reference, department, type và key inputs. Receipt/attempt 1 giữ nguyên, target đã đổi không bị ghi đè, không có asset mới hoặc completion notification; poll tiếp không replay |
| Drift policy/request khi provider đang chờ | Deactivate policy hoặc đổi request input/version: giữ receipt, không commit asset, chuyển đối soát và không replay |

23 là số nhóm harness, không phải số task hoặc số biến thể đơn lẻ. Clock/schema/fault injection chỉ đặt trong database mới của lượt test; không chỉnh đồng hồ hệ điều hành hoặc clock của DB nguồn. Hai instance kiểm race trong cùng một Node process với các connection PostgreSQL thật. Source tạo ca kiểm thử ở [host runner](tools/test-real-worker-recovery.cjs) và [container runner](tools/testing/worker-recovery-runner.cjs).

[Focused report](tools/test-artifacts/unit/worker-guard-20261105/results-focused.json) có **32/32** unit worker. [Full backend report](tools/test-artifacts/unit/resume-20261105-backend/results.json) có **145/145**, gồm toàn bộ 32 unit worker trên source cuối. `npm.cmd run build` đạt exit 0 sau sửa narrowing TypeScript dùng `target.id` đã xác minh; compiled hashes bên dưới khớp bản được load trong image. Unit dùng Pool mock; SQL transaction/lock và receipt preservation lấy bằng chứng từ lượt DB thật.

## Provenance và cleanup database con

Backend image thực của lượt worker là **`sha256:c8bf18936f88acba9f2790bd8d180fad0842a06aa70a320e9c7154ba0a319ea4`**; PostgreSQL image `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`. Không gán image ngày 06/10 cho các guard mới. Cả **8 source hashes** của report khớp file hiện tại khi đối chiếu; source worker SHA-256 là `b7ce7420058dd3f26556eba5cb6798b71e1f04df9c102066f91ccf46785e687a`.

Cả **5 compiled hashes** đọc từ container khớp byte của `backend/dist`:

| Compiled file | SHA-256 |
| --- | --- |
| `jobs/asset-processing.service.js` | `a6cdc1c7937bc30a806de2a5e3927a10d0cf02f0dcec9b749fd273d7cd4bd034` |
| `jobs/crypto-provider.service.js` | `43e4ca9194a59f730c71d286077786ec645a5a5890f2698f42c284773f5e17ae` |
| `notifications/notifications.service.js` | `73dd6b752f30c971a827db86acc29f941fdd42c4680d878661140b306d0c5a7d` |
| `database/migration.service.js` | `a7c944ff2b245db31f24fc4e7f5ab8b6f380552150a9329444f0bff738cc9ca5` |
| `requests/request-policy.js` | `26439be74f71afe6c30e8a33fa8b4981015e1769c793256e0647a8da0a2637a0` |

Database con đã dọn, `cleanupCompleted=true`, `testDatabaseRemaining=0`, temporary failure trigger còn 0. Inventory đầy đủ **11→11**, trong đó **8→8 container ngoài test**, `comparisonHasSubjects=true`; full ID/name/project của cả ngoài test và ba container test khớp. Đây là cleanup database con của harness; lifecycle cleanup toàn stack, backup và hồi quy browser có báo cáo riêng. Không suy container healthy hoặc dữ liệu nguồn bất biến từ việc ID giữ nguyên; harness này không chụp row hash của DB nguồn.

## Hồi quy phase 2 — dependency và parser đã cập nhật

[Worker phase 2](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/worker-recovery-after-d8ca0bea013f/results.json) đạt **23/23**, `success=true`, trên stack mới `crypta-t30-test-d375cbb5e29e`, lúc **22:41:50–22:42:01 ngày 05/11/2026, Asia/Bangkok**. Backend image **`sha256:a2ce8053e25c95d441eefc06f4488338bf4b2837ed316be0cf1aa81c119776e1`** chứa dependency và [parser filter](T03_PARSER_ERRORS_2026-11-05.md) sau cập nhật; PostgreSQL image vẫn `18cfe3ef…`. Phase `c8bf18936…` ở trên giữ nguyên phạm vi của image trước các cập nhật đó.

Đã đối chiếu lại cả **8 source hashes** và **5 compiled hashes** trong report phase 2 với source/`backend/dist` hiện tại, đều khớp. Worker source và năm compiled service giữ cùng hash đã liệt kê ở trên; dependency/filter đổi nên image mới khác, không dùng kết quả phase 1 để thay hồi quy phase 2. [Full backend cuối](tools/test-artifacts/unit/security-parser-final-20261105-backend/results.json) nay **161/161**, gồm 32 ca worker và 16 ca parser; [lệnh build/unit](tools/test-artifacts/unit/security-parser-final-20261105-backend/commands.json) đều exit 0.

Cùng stack phase 2, [policy](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/policy-version-fe1e0b353cfc/results.json) đạt **8/8** và [expiry](tools/test-artifacts/integration/crypta-t30-test-d375cbb5e29e/expiry-scan-f68ae2575340/results.json) đạt **13/13**. Những kết quả này là các harness compiled-service/PostgreSQL có kiểm soát riêng; chúng không tự chứng minh browser/provider/SMTP end-to-end.

Database con worker phase 2 `crypta_worker_test_d8ca0bea013f` đã dọn, remaining 0, failure trigger 0. Inventory ngoài test **8→8**, có subjects và full ID/name/project giữ nguyên; ba container test cũng giữ nguyên. Đây chưa phải tuyên bố cleanup toàn stack hoặc hoàn tất hồi quy browser; các bước đó được ghi bằng report riêng sau khi chạy xong. Giới hạn checkpoint, external effect, scheduler và provider thật bên dưới tiếp tục áp dụng.

## Giới hạn và tái lập

Check trước provider là một checkpoint. Sau khi commit/nhả khóa, target hoặc policy vẫn có thể đổi trước hoặc trong external call; final guard ngăn ghi kết quả nội bộ sai nhưng **không tự hoàn tác tác động đã xảy ra ở provider**. Receipt chuyển vào đối soát để xử lý trường hợp đó. Đây chưa phải fencing/lease/heartbeat đầy đủ, provider lookup/idempotency contract thật hoặc quy trình manual reconciliation có phân quyền/audit.

MOCK không nghiệm thu provider thật, SMTP inbox delivery, OS process kill/restart, scheduler/timer durability, nhiều process/máy hoặc toàn ma trận vòng đời. Các quy tắc EXPIRED, chuyển đơn vị, khẩn cấp và reset/nháp còn được giữ theo [ma trận T02](T02_STATE_MATRIX_2026-10-06.md), không tự mở rộng quyền hoặc thay nghiệp vụ ở lượt sửa guard này.

[T14 ngày 06/10](T14_WORKER_RECOVERY_2026-10-06.md) giữ nguyên BEFORE 2/3 → AFTER 12/12 của lỗi stale poll trên hai image cũ. Guard mới chưa có lượt BEFORE 23 nhóm đối chứng runtime; không diễn giải các số cũ thành BEFORE của toàn bộ guard mới. Snapshot/verifier ngày 06/10 cũng chỉ thuộc phase cũ.

Muốn chạy lại cần tạo stack test mới hoặc dùng đúng report retained chưa cleanup, build backend từ source đang kiểm tra rồi chạy:

```powershell
node tools/test-real-worker-recovery.cjs <report.json-cua-stack-test> after
```

Lượt 05/11 ở trên kiểm 23 nhóm. Runner hiện kiểm thêm các nhóm được liệt kê ở phần dưới. Báo cáo từng lượt ghi hash source, image, số nhóm dự kiến và trạng thái dọn DB con.

## Gia hạn claim và quét nhiều worker ngày 08/11/2026

Khi đang xử lý, worker gia hạn mốc `requests.updated_at` mỗi 30 giây nếu yêu cầu còn `PROCESSING`, phiên bản vẫn khớp và chưa hết lease 15 phút. Cả bước trước khi đánh dấu gửi và bước ghi kết quả cuối đều kiểm lease trong giao dịch. Heartbeat chỉ cập nhật thời gian, giữ nguyên phiên bản claim và dừng khi tác vụ hoàn tất. Kết quả đến muộn có thể bổ sung receipt vào đúng lần gửi để đối soát.

Lượt quét lấy tối đa 25 yêu cầu hết lease mỗi lần và bỏ qua hàng đang bị khóa, để worker còn có thể nhận việc khác. Ca đối chứng trên image cũ thấy yêu cầu độc lập vẫn `APPROVED` sau khi poll. Tác vụ đã đánh dấu `SENT` mà mất phản hồi chuyển sang đối soát với kết quả chưa xác định. [Ca đối chứng](tools/test-artifacts/integration/crypta-t30-test-62e07d6b7730/worker-recovery-after-bb33bc98bb8f/results.json) · [Khóa hàng PostgreSQL](https://www.postgresql.org/docs/14/sql-select.html#SQL-FOR-UPDATE-SHARE)

Image mới đạt 30/30 nhóm worker/PostgreSQL. Yêu cầu độc lập hoàn tất khi hàng quá hạn còn khóa. Worker hết lease bị chặn trước khi gửi. Trong ca hai tiến trình, worker thứ hai thấy heartbeat thật và giữ nguyên yêu cầu đang gửi. Sau SIGKILL và khi đồng hồ thử vượt lease, hai lượt quét đồng thời chỉ ghi một lần đối soát và không gọi lại provider. Thời hạn 15 phút được mô phỏng bằng đồng hồ PostgreSQL của DB test. SIGKILL thật được kiểm ở ranh giới `SENT`. Các ranh giới `CLAIMED` và receipt đã lưu dùng fixture. Mất kết nối nhiều máy và hợp đồng tra cứu provider thật còn cần nghiệm thu. [Kết quả](tools/test-artifacts/integration/crypta-t30-test-21d9770e718b/worker-recovery-after-38fbdd6b7b10/results.json)
