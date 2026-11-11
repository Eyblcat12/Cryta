# T24 — Mẫu thư và liên kết hành động

Email nghiệp vụ nay có HTML và plain text cùng nội dung, liên kết tới chi tiết yêu cầu/tài sản, tên người nhận và thời gian kèm múi giờ cấu hình. `APP_URL` là origin frontend, bắt buộc khi bật SMTP; chỉ HTTPS hoặc HTTP loopback cho test. Không nhận user/password, path, query hoặc fragment. `APP_TIME_ZONE` mặc định `Asia/Ho_Chi_Minh`, được kiểm trước khi bật SMTP. [Hướng dẫn cấu hình](EMAIL_OPERATIONS.md).

Tám loại đang được nối gồm REQUEST_SUBMITTED, REQUEST_APPROVED, REQUEST_REJECTED, REQUEST_COMPLETED, REQUEST_RECONCILIATION_REQUIRED, ASSET_EXPIRING, ASSET_EXPIRED và ASSET_REVOKED. Thư phê duyệt nói rõ đang chờ xử lý; thư cần đối soát không hướng dẫn gửi lại khi chưa kiểm tra kết quả. Chỉ dùng tên, mã tham chiếu và thời gian, không lấy lý do yêu cầu hoặc dữ liệu provider vào thư. HTML escape dữ liệu người dùng. Bản thiếu ID hợp lệ mở trung tâm thông báo, thiếu thời gian thì bỏ dòng thời gian.

Migration `010_execution_notifications` mở rộng constraint loại thông báo; SQL/checksum001–009 giữ nguyên. Worker enqueue kết quả cùng transaction hoàn tất/audit hoặc chuyển đối soát. Dedup theo loại kết quả, yêu cầu và kênh. Khi enqueue hoàn tất lỗi sau provider, kết quả/asset rollback, receipt vẫn được giữ và yêu cầu chuyển đối soát. Không tự gọi provider lần nữa. Thu hồi tạo hai sự kiện riêng: ASSET_REVOKED và REQUEST_COMPLETED. UI thông báo có nhãn cho hai loại mới.

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| Unit/build | Backend233/233, frontend133/133, build backend và frontend ON/OFF đạt. | [Backend](tools/test-artifacts/email-templates-20261106/backend-final.json), [Frontend](tools/test-artifacts/email-templates-20261106/frontend.json) |
| Worker/DB và SMTP loopback | 10/10. Ba loại yêu cầu hoàn tất, đối soát không replay, lỗi enqueue rollback, hai worker claim khác dòng, tám loại thư tới SMTP nội bộ, cấu hình sai không gửi và Message-ID trong MIME. | [Email](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/email-delivery-after-b7c71241d1ca/results.json) |
| Preview | 20/20: mười mẫu ×800/320 px, không tràn ngang, hai link đúng cùng đích, CTA tối thiểu44 px, Tab tới link, không request mạng hoặc script. Đã xem ảnh mobile đối soát và desktop cảnh báo hết hạn. | [Preview](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/email-delivery-after-b7c71241d1ca/preview-msedge-1793943741276/results.json) |
| Link với UI/API/DB thật | 3/3. Request do API tạo, Approver duyệt và worker polling MOCK hoàn tất. Link từ HTML yêu cầu login rồi mở đúng request; notification center có nhãn/kết quả thật; tài khoản khác nhận404 và không thấy lý do. | [Link](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/email-links-msedge-1793943903432/results.json) |
| Hồi quy worker | 23/23 trên DB riêng; giữ các guard, receipt và không tự replay. | [Worker](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/worker-recovery-after-6ab5d02dd307/results.json) |
| Quyền/migration | Runtime LOGIN23/23, CLI/ledger10/10 với mười migration. Database/role con đã dọn. | [Runtime](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/runtime-privileges-ae0d69c898be/results.json), [Ledger](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/runtime-ledger-66f513a111c8/results.json) |
| Hồi quy Edge | 26/26 trên bundle mới DM9eNE0S, CSS DnaRrvye; OFF DoDyDc6W. Không chạy lại full fixture ba engine trong pha này. | [Integration](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/real-msedge-1793943544919/results.json) |

Trong lượt T24 ban đầu, hai mẫu tài khoản INVITATION/PASSWORD_RESET dùng mã giả và hạn dùng riêng để kiểm bản xem trước. Kết quả tích hợp gửi thư và tiêu thụ mã được ghi riêng trong lượt T07.

Giữ riêng [unit đầu223/233](tools/test-artifacts/email-templates-20261106/backend-initial.json): mười lỗi do phép so sánh giả định thứ tự ngày/giờ khác định dạng vi-VN thực tế. Đã kiểm giá trị giờ và múi giờ mà không áp thứ tự sai. Hai lượt email đầu giữ report lỗi setup, [lượt1](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/email-delivery-after-caa350600fa9/results.json), [lượt2](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/email-delivery-after-be2ef4e2f8ca/results.json): phép kiểm Message-ID chưa xử lý MIME folding. Lượt cuối nhận đủ10 SMTP DATA và header hợp lệ. Test link đầu chọn class không tồn tại; sau đổi selector sang main, lượt3/3 đạt. Các sửa này nằm ở test, không thay hành vi sản phẩm để làm test đạt.

[Bản chụp](tools/test-artifacts/frontend-artifacts/email-templates-20261106-final/source-manifest.json) gồm225 file, SHA256 `3e208880c1be10e8a992dd00fa5521887c207707ad9c148975cdeaa1ee63d130`. [Provenance](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/email-templates-provenance.json) đối chiếu13 source, năm compiled và sáu frontend asset. Hai archive build được giải nén/đối chiếu byte.

Các phép kiểm dùng SMTP loopback và bản xem trước HTML. Nghiệm thu T24 còn kiểm nội dung, tần suất và hiển thị ở ứng dụng email. T25 còn chọn dịch vụ, DNS/TLS và hộp thư thật.

Sau khi dừng riêng backend thử, [backup/restore](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/backup-restore-ab28cfc6a650/results.json) đạt11/11, dữ liệu17 bảng và sequence khớp. [Cleanup](tools/test-artifacts/integration/crypta-t30-test-1c5890caaad3/cleanup-report.json) xác nhận0 container/volume/network thử và giữ nguyên tám container khác. [Verifier](tools/test-artifacts/frontend-artifacts/email-templates-20261106-final/evidence-verification.json) đối chiếu source, compiled, build, report, ảnh, backup và liên kết local.

## Đối chiếu với T07 ngày 08/11/2026

Worker đã nối hai mẫu với API cấp và tiêu thụ mã. Lượt T07 đạt 6/6 ca trên Edge desktop sáng và Chrome mobile tối qua SMTP loopback, từ thư mời đến kích hoạt và từ thư reset đến đặt lại mật khẩu. Ca kiểm cũng xác nhận từ chối dùng lại link và thu hồi phiên. Thư báo đổi mật khẩu đã được đưa vào hàng đợi. [Bằng chứng T07](T07_ACCOUNT_ACTIONS_2026-11-06.md)
