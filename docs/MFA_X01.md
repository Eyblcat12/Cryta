# X01 — TOTP và mã khôi phục

Chủ dự án chọn TOTP 6 số và mã khôi phục cho Admin/Approver, rồi duyệt [mẫu tương tác](../tools/design-previews/mfa/index.html). Frontend dùng bố cục đã duyệt cho đăng ký, đăng nhập, khôi phục và quản lý ứng dụng.

## Phần đã triển khai

- Backend có hàm tạo khóa TOTP ngẫu nhiên 160 bit, biểu diễn Base32 để nhập tay hoặc đưa vào URI đăng ký. Xác minh SHA-1, 6 số, chu kỳ 30 giây, lệch tối đa một bước mỗi chiều. Bộ kiểm dùng sáu vector SHA-1 công khai và thử mã sai định dạng, thời gian ngoài cửa sổ, bước đã dùng. [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html#appendix-B)
- Khóa TOTP có thể lưu dạng `v1` AES-256-GCM với nonce 96 bit và tag 128 bit. Dữ liệu xác thực bổ sung gắn bản mã với tài khoản và lần đăng ký. Bản mã sai phiên bản, sai key, bị sửa hoặc gán sang tài khoản/lần đăng ký khác đều bị từ chối. Khóa mã hóa 256 bit phải nằm ngoài PostgreSQL. [Node.js Crypto](https://nodejs.org/docs/latest-v22.x/api/crypto.html)
- Mỗi lần cấp sinh mười mã khôi phục ngẫu nhiên 100 bit. Backend có hàm băm SHA-256 theo tài khoản và lần cấp. Mã gốc chỉ dành cho phản hồi cấp mã; audit che trường MFA và URI đăng ký.

Migration `019_auth_mfa` lưu khóa đăng ký đã mã hóa, bước TOTP đã dùng, hash mã khôi phục và challenge có hạn. Xác thực mật khẩu chưa cấp phiên khi MFA là bắt buộc. Khi đăng ký, máy chủ xác minh TOTP, cấp 10 mã khôi phục rồi đợi người dùng xác nhận đã lưu trước khi kích hoạt yếu tố và cấp phiên. Các lần khôi phục và thay ứng dụng thu hồi phiên cũ. Người dùng phải nhập lại mật khẩu và TOTP hiện tại để tạo bộ mã mới hoặc đổi ứng dụng. Khi SMTP được cấu hình, hàng chờ email nhận thông báo thay đổi bảo mật trong cùng giao dịch.

Kiểm trên Windows đạt 55/55 ca credential, backend 478/478 và frontend 148/148. Chromium với API fixture đạt bốn tổ hợp desktop/mobile và sáng/tối, gồm tạo QR, sửa mã nhập sai, lưu mã và xác nhận lại trước khi cấp bộ mới. Bộ tích hợp `tools/test-real-mfa.cjs` kiểm trên stack PostgreSQL, Nginx và Chromium được bật MFA riêng. Workflow chạy bộ này sau stack hồi quy mặc định.

GitHub Actions trên `b4d4dc7` đạt 4/4 nhóm MFA và 160/160 nhóm hồi quy. Ca Chromium chạy đăng ký mobile, tải mã khôi phục, xác nhận lại và đổi ứng dụng từ trang bảo mật desktop. Kiểm SMTP và UAT trên môi trường đích vẫn cần thực hiện. [Workflow](https://github.com/Eyblcat12/Cryta/actions/runs/42345358091)

## Cấu hình và vận hành

1. Chạy migration 019 bằng credential migrator rồi áp lại `runtime-grants.sql`. Chạy kiểm thử ở môi trường thử trước khi bật MFA trên môi trường đích. Cấu hình hiện có tiếp tục dùng chính sách cũ cho tài khoản chưa đăng ký nếu chưa bật MFA bắt buộc. Tài khoản đã đăng ký tiếp tục cần TOTP.
2. Dùng một file riêng chứa khóa ngẫu nhiên 256 bit dạng 64 ký tự hex, khác khóa JWT và mã tài khoản. Đặt đường dẫn file vào `CRYPTA_MFA_ENCRYPTION_KEY_SECRET` và thêm `-f deploy/compose.mfa.yml` sau `-f docker-compose.production.yml`. Giữ cùng khóa giữa các replica và lưu bản sao an toàn tách khỏi dump DB. Khóa và đồng hồ ổn định là điều kiện phục hồi.
3. Dùng `-RequireMfa` với `tools/test-isolated-stack.ps1` khi kiểm local. Runner tạo khóa thử mới cho từng stack. Đăng nhập Admin/Approver bằng ứng dụng xác thực và giữ mã khôi phục ngoài trình duyệt. Trường hợp mất cả thiết bị lẫn mã cần quy trình xác minh danh tính của tổ chức trước khi phục hồi thủ công.

## Ràng buộc xác minh

1. Challenge dùng token ngẫu nhiên, chỉ lưu hash, gắn tài khoản, `token_version` và mục đích. Mật khẩu tạm của tài khoản chưa đăng ký chỉ đi qua quyền đổi mật khẩu hiện có. Đổi/đặt lại mật khẩu hoặc thay đổi quyền phải làm challenge cũ mất hiệu lực.
2. Khóa hàng `users` trước các hàng MFA và phiên, cùng thứ tự với đổi mật khẩu, refresh và thu hồi quyền. Dùng giới hạn sai theo tài khoản trong DB để challenge mới không đặt lại số lần thử. Lưu bước TOTP cao nhất đã nhận trong cùng giao dịch với việc dùng challenge và cấp phiên. Mã khôi phục phải được đánh dấu đã dùng trong cùng giao dịch với việc cấp challenge đăng ký lại.
3. Chỉ cấp phiên đầy đủ sau khi xác nhận TOTP. Phiên cũ khi bật MFA, sau thay khóa hoặc đổi quyền phải được kiểm lại ở refresh và guard. Mã khôi phục dẫn tới đăng ký lại, không mở workspace trực tiếp. Xác nhận mật khẩu và TOTP hiện tại trước khi cấp lại mã hoặc thay ứng dụng từ trang bảo mật. Giữ ứng dụng cũ cho đến khi ứng dụng mới được xác minh. Gửi thông báo khi yếu tố bị thay và không đưa credential vào email. [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html#changing-mfa-factors)
4. Kiểm đồng thời dùng cùng mã/challenge, refresh khi bật MFA, token cũ sau đổi quyền, reset mật khẩu, giới hạn sai qua nhiều challenge, khôi phục và thay ứng dụng. Kiểm migration/grant theo runtime role và quy trình giữ khóa mã hóa khi sao lưu, khôi phục.
