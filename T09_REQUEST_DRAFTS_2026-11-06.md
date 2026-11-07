# T09 — Nháp, gửi duyệt và hủy yêu cầu

Migration `009_request_drafts` bổ sung trạng thái DRAFT và lý do hủy. Nháp chưa chọn policy, tài sản hoặc chưa nhập lý do vẫn lưu được. `submittedAt` là null cho đến khi gửi duyệt. Nháp và bản đã hủy trước khi gửi chỉ xuất hiện với người tạo. Hàng duyệt, worker và lịch sử tài sản dùng các trạng thái đã gửi phù hợp.

| API | Hành vi |
| --- | --- |
| `PUT /api/v1/requests/drafts/:id` | Client chọn UUID cho lần lưu đầu. Gửi lại cùng nội dung trả cùng bản ghi. Khi sửa, gửi `version` hiện tại. |
| `POST /api/v1/requests/:id/submit` | Gửi `{ version }`. Server kiểm lại policy, quyền và trạng thái tài sản, nội dung bắt buộc và yêu cầu đang mở. Trạng thái, audit và thông báo được ghi cùng transaction. |
| `POST /api/v1/requests/:id/cancel` | Người tạo hủy DRAFT hoặc PENDING. Body có thể chứa `version` và `reason` tối đa 500 ký tự. Client cũ gửi body rỗng vẫn hoạt động. |
| `POST /api/v1/requests` | Tiếp tục gửi thẳng vào PENDING cho client hiện có, qua cùng logic validation lúc gửi. |

Lý do hủy hiển thị trong chi tiết theo quyền đọc yêu cầu. Audit ghi trạng thái trước khi hủy và có hay không có lý do. Khi lỗi xảy ra giữa cập nhật trạng thái, audit và ghi thông báo, giao dịch rollback để người tạo có thể gửi lại.

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| Mã nguồn và build | Backend 187/187, frontend 131/131 và build backend, frontend ON/OFF đạt. | [Backend](tools/test-artifacts/request-drafts-20261106/backend.json), [Frontend](tools/test-artifacts/request-drafts-20261106/frontend-final.json) |
| API với PostgreSQL runtime LOGIN | 23/23 nhóm. Bốn nhóm mới kiểm nháp riêng tư qua một vòng poll thật, tranh chấp sửa/gửi, rollback khi ghi thông báo lỗi, hai nháp gia hạn cùng tài sản và tranh chấp hủy/quyết định. Hai lần gửi cùng nháp trả 201 với cùng phiên bản, một audit và một lô thông báo. | [Runtime](tools/test-artifacts/integration/crypta-t30-test-8bd78a68c4b5/runtime-privileges-0bade297a3fa/results.json) |
| Migration và hồi quy | CLI/ledger 10/10 với chín migration. Edge/API/PostgreSQL 26/26 trên frontend cuối. | [Ledger](tools/test-artifacts/integration/crypta-t30-test-8bd78a68c4b5/runtime-ledger-18f96745f2c7/results.json), [Edge integration](tools/test-artifacts/integration/crypta-t30-test-8bd78a68c4b5/real-msedge-1793938906367/results.json) |
| Chi tiết trên Edge và Nginx | 2/2. Nháp hiện “Bản nháp” và “Chưa gửi”. Bản đã hủy hiện lý do sau reload. Cả hai hiển thị đúng trạng thái trước duyệt. | [Edge](tools/test-artifacts/request-drafts-20261106/detail-browser.json) |
| Backup và dọn stack | Phục hồi 11/11, dữ liệu 17 bảng và sequence khớp. Stack thử còn 0 container, volume, network. | [Backup](tools/test-artifacts/integration/crypta-t30-test-8bd78a68c4b5/backup-restore-592c9710d41d/results.json), [Cleanup](tools/test-artifacts/integration/crypta-t30-test-8bd78a68c4b5/cleanup-report.json) |

Bản chụp gồm 217 file nguồn và hai build. Bảy file JS backend khớp image, asset JS Edge khớp build local và ledger có đủ chín checksum. [Manifest](tools/test-artifacts/frontend-artifacts/request-drafts-20261106-final/source-manifest.json), [đối chiếu image](tools/test-artifacts/integration/crypta-t30-test-8bd78a68c4b5/request-drafts-provenance.json).

Lượt backend ban đầu kiểm API và cách hiển thị trạng thái. Phần giao diện được bổ sung ở lượt tiếp theo bên dưới. Khi rollout role hạn chế, chạy migration 009 trước khi áp lại grant. [Runbook migration](DATABASE_MIGRATIONS.md).

## Giao diện lưu, sửa, gửi và hủy

Biểu mẫu tạo yêu cầu có thêm “Lưu bản nháp”. Có thể lưu trước khi nhập đủ lý do hoặc chọn tài sản. Từ chi tiết, người tạo mở “Sửa bản nháp”, sửa nội dung rồi lưu hoặc gửi duyệt. Luồng gửi trực tiếp của biểu mẫu mới tiếp tục dùng API hiện có. Khi gửi bản đã lưu, giao diện lưu các thay đổi trước, rồi gửi cùng ID và phiên bản đã được máy chủ xác nhận.

Chi tiết nháp hoặc PENDING của người tạo có nút “Hủy yêu cầu”. Hộp xác nhận cho nhập lý do, quản lý focus và hỗ trợ Escape. Lỗi hoặc kết quả chưa rõ giữ lại nội dung. Khi hai tab sửa cùng một phiên bản, tab cũ hiển thị xung đột và giữ phần đang nhập. Rời trang vẫn yêu cầu xác nhận bỏ thay đổi.

Khi mất phản hồi sau khi lưu, người dùng kiểm tra bằng mã nháp đang theo dõi. Lưu lại dùng cùng ID. Nếu máy chủ đã lưu cùng nội dung, giao diện đọc bản hiện tại và dùng lại phiên bản đó. Nhật ký thao tác trong bộ nhớ chỉ giữ ID, phiên bản và trạng thái. Quy trình đối chiếu hiển thị rõ trước khi người dùng gửi lại.

| Kiểm tra UI qua API và PostgreSQL thật | Kết quả | Bằng chứng |
| --- | --- | --- |
| Edge desktop sáng và mobile tối | 10/10 nhóm. Lưu chưa đủ, reload, sửa, gửi, hủy; mất phản hồi sau commit; hai tab cạnh tranh; nháp gia hạn và thu hồi trước khi chọn tài sản. | [Edge](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/draft-ui-msedge-1793940416210/results.json) |
| Chrome desktop sáng và mobile tối | 10/10 nhóm, cùng ma trận. Mỗi nháp chỉ có một audit gửi và một audit hủy phù hợp. | [Chrome](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/draft-ui-chrome-1793940486480/results.json) |
| Unit frontend | 133/133, thêm kiểm ID/phiên bản trả về và giới hạn gửi lại khi phản hồi bất thường. | [Unit](tools/test-artifacts/request-drafts-ui-20261106/frontend-final.json) |
| Ảnh và bàn phím | Đã xem bốn ảnh ổn định của form và xác nhận hủy ở 1440 sáng, 390 tối. Kiểm Tab/Shift+Tab và Escape trong dialog hủy ở hai browser. | [Ảnh](tools/test-artifacts/request-drafts-ui-20261106/visual.json) |

Lượt Edge đầu có 2/4 nhóm đạt do test chọn ô lý do hủy bằng tên đầy đủ sai với nhãn kèm hướng dẫn. Đã sửa bộ chọn và giữ report lỗi. Các lượt 4/4 và 6/6 trung gian được giữ riêng. Ma trận 10/10 cuối dùng bundle BKI7P23P và CSS DnaRrvye. T09 còn rà đầy đủ mọi vai trò, dữ liệu cũ, tình huống mất phản hồi ở các bước còn lại và nghiệm thu nghiệp vụ theo phạm vi release.
## Giữ dữ liệu đã lưu và chốt bằng chứng UI

Ca nháp do client khác tạo cho thấy khi chỉ sửa lý do, form cấp mới làm mất cờ khẩn cấp đã lưu. Payload nay giữ giá trị hiện tại. Tham số cấp phát sẵn có cũng được giữ nguyên khi chưa đổi loại yêu cầu hoặc tài sản. Form mới vẫn khởi tạo mức khẩn cấp theo lựa chọn của người dùng.

Lượt cuối đạt **24/24 nhóm**: [Edge 12/12](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/draft-ui-msedge-1793941642931/results.json), [Chrome 12/12](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/draft-ui-chrome-1793941712439/results.json). Mỗi browser chạy lại 10 nhóm ở pha trên và thêm hai ca giữ cờ/tham số, ở desktop sáng và mobile tối. Dữ liệu cũ của hai ca mới được chuẩn bị bằng SQL trên đúng nháp vừa tạo qua UI trong DB thử; việc sửa và lưu dùng UI/API thật. [Frontend cuối 133/133](tools/test-artifacts/request-drafts-ui-20261106/frontend-priority-final.json), build ON `B7eilN4r`, OFF `CaHvouXH`, CSS `DnaRrvye`.

Hồi quy rộng trên bundle `BKI7P23P` trước sửa payload đạt [Edge 180/180](tools/test-artifacts/spa/request-drafts-ui-20261106/full-msedge/results.json), [Chrome 180/180](tools/test-artifacts/spa/request-drafts-ui-20261106/full-chrome/results-chrome.json), [Firefox 180/180](tools/test-artifacts/spa/request-drafts-ui-20261106/full-firefox-final/results-firefox.json) và [Edge/API/DB 26/26](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/real-msedge-1793940650727/results.json). Các kết quả 540 fixture, 26 integration và bốn ảnh ở pha này thuộc bundle trước sửa một dòng payload, không được gán cho bundle cuối. Chênh lệch source ứng dụng được đối chiếu đúng dòng giữ cờ; 24 nhóm cuối kiểm lại toàn bộ ma trận UI nháp.

Lượt Firefox đầu giữ nguyên [179/180 và trace lỗi](tools/test-artifacts/spa/request-drafts-ui-20261106/full-firefox/results-firefox.json). Test motion cũ ghi mốc trước khi animation điều hướng thứ hai bắt đầu qua requestAnimationFrame. Test đã chờ hai frame và yêu cầu rõ mốc 2 trước khi đổi query, rồi vẫn là 2 sau đổi query. Hồi quy tập trung đạt trên [Edge](tools/test-artifacts/spa/request-drafts-ui-20261106/motion-final-msedge/results-filtered.json), [Chrome](tools/test-artifacts/spa/request-drafts-ui-20261106/motion-final-chrome/results-filtered.json), [Firefox](tools/test-artifacts/spa/request-drafts-ui-20261106/motion-final-firefox/results-filtered.json); sau đó Firefox chạy lại đầy đủ 180/180. Không sửa mã motion sản phẩm.

[Đối chiếu image](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/request-drafts-ui-priority-provenance.json) ghi 11 source, ba file compiled backend và sáu asset. [Bản chụp cuối](tools/test-artifacts/frontend-artifacts/request-drafts-ui-20261106-final-state/source-manifest.json) gồm 218 file, SHA256 `da51214a58bb64e8f1bd96ec649be18235b12f6b8dcf3e922c4430aab1450094`; hai build được giải nén và đối chiếu byte.

Sau khi dừng riêng backend thử, [backup/restore](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/backup-restore-7e9eb89057be/results.json) kiểm 11/11, dữ liệu 17 bảng và sequence khớp. [Cleanup](tools/test-artifacts/integration/crypta-t30-test-5f2e3ee06f3e/cleanup-report.json) xác nhận còn 0 container, volume, network của stack thử và giữ nguyên danh tính tám container ngoài stack. [Kiểm tra bằng chứng](tools/test-artifacts/frontend-artifacts/request-drafts-ui-20261106-final-state/evidence-verification.json) đối chiếu source/build/report và các liên kết local. T09 vẫn chưa đủ nghiệm thu toàn bộ phạm vi release nêu ở trên.
