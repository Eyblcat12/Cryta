# X03 — Đăng nhập SSO với Keycloak

Chủ dự án chọn Keycloak cách ly để kiểm thử. Image test ghim Keycloak 26.8.2 và digest từ Quay. `tools/testing/keycloak-realm.cjs` tạo realm với hai chủ thể thử và thông tin xác thực ngẫu nhiên. Overlay `compose.oidc-test.yml` chỉ bind cổng về loopback. Bản mẫu dùng HTTP trong stack thử. Môi trường thật cần issuer và callback HTTPS. [Keycloak 26.8.2](https://www.keycloak.org/2026/11/keycloak-2682-released) · [Tài liệu container](https://www.keycloak.org/server/containers)

Chủ dự án đã duyệt [mẫu giao diện X03](../tools/design-previews/oidc/index.html). Mẫu gồm đăng nhập, xác thực hai bước cho vai trò nhạy cảm, đường vào bằng tài khoản cục bộ được phép và cách xử lý khi IdP gián đoạn hoặc tài khoản không còn quyền. Chromium đạt 24/24 ca prototype ở desktop/mobile, sáng/tối.

1. Dùng Authorization Code với PKCE S256, state ngẫu nhiên, nonce, callback đã đăng ký và challenge dùng một lần. Kiểm chữ ký, issuer, audience và thời hạn token. Giữ thông tin phiên và token phía máy chủ. [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html) · [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)
2. Liên kết bằng cặp issuer và subject đã được người vận hành xác minh. Vai trò, đơn vị và phạm vi lấy từ Crypta. Trùng email không tạo liên kết và không cấp quyền. Tài khoản cục bộ khẩn cấp dùng MFA X01.
3. Thu hồi phiên khi liên kết hoặc quyền tại Crypta đổi. Kiểm logout token của Keycloak qua back-channel và từ chối tiếp tục phiên nếu IdP báo token không còn hoạt động. Cần đo thời gian thu hồi sau vô hiệu hóa và thử sự cố kết nối. [OIDC Back-Channel Logout](https://openid.net/specs/openid-connect-backchannel-1_0.html) · [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers)

Migration `021_auth_oidc` tách liên kết định danh, challenge, phiên SSO và dấu thu hồi. Challenge hết hạn sau 5 phút. Handoff hết hạn sau 2 phút. Cả hai được gắn với cookie HttpOnly ngẫu nhiên và chỉ dùng được một lần. Access token Crypta cho SSO có hạn 60 giây. Refresh kiểm trạng thái upstream và gia hạn thông tin xác thực Keycloak khi cần. Phiên SSO bị giới hạn ở 12 giờ hoặc thời hạn ngắn hơn do Keycloak đặt. Logout ở Crypta thu hồi phiên ngay và mở luồng đăng xuất Keycloak. Back-channel xác minh chữ ký và kết thúc các phiên Crypta gắn với cùng Keycloak session. Quản trị MFA trên tài khoản SSO yêu cầu phiên Keycloak được xác thực trong 5 phút gần nhất và mã TOTP hiện tại.

## Cấu hình môi trường đích

1. Áp dụng migration 021 và cấp lại quyền runtime theo [hướng dẫn DB](../DATABASE_MIGRATIONS.md). Tạo ít nhất một tài khoản Admin cục bộ khẩn cấp có MFA, kiểm đường đăng nhập cục bộ và lưu mã khôi phục theo quy trình nội bộ.
2. Tạo client OpenID Connect confidential tại Keycloak. Bật Standard Flow, tắt Implicit Flow và Direct Access Grants, bắt buộc PKCE S256 và dùng RS256. Thêm mapper Audience cho chính client Crypta trong access token để Keycloak cho phép client kiểm trạng thái token. Đăng ký các URL sau trên origin HTTPS của ứng dụng. [Quy tắc introspection của Keycloak 26.8.2](https://github.com/keycloak/keycloak/blob/26.8.2/services/src/main/java/org/keycloak/protocol/oidc/AccessTokenIntrospectionProvider.java#L295)

   | Thiết lập Keycloak | Giá trị theo origin Crypta |
   | --- | --- |
   | Valid redirect URI | `/api/v1/auth/oidc/callback` |
   | Valid post logout redirect URI | `/login` |
   | Backchannel logout URL | `/api/v1/auth/oidc/backchannel` |
   | Backchannel logout session required | Bật |

3. Dùng `deploy/compose.oidc.yml` cùng `docker-compose.production.yml` và `deploy/compose.mfa.yml`. Điền issuer và client ID trong tệp env triển khai. Lưu client secret và khóa lưu trữ 32 byte dạng hex ở hai tệp riêng theo `deploy/production.env.example`.
4. Xác minh `iss` và `sub` từ dữ liệu quản trị Keycloak đáng tin cậy. Dùng role DB vận hành để tạo hoặc thu hồi liên kết bằng script dưới đây. Tài khoản phải sẵn sàng hoạt động và có quyền Crypta đúng phạm vi trước khi liên kết. Script ghi audit và thu hồi phiên, yêu cầu đặt lại mật khẩu và challenge MFA cũ. Thu hồi liên kết tiếp tục khóa đường vào bằng mật khẩu Crypta cho tài khoản đó. Giữ ít nhất một Admin cục bộ đã thiết lập MFA khi liên kết Admin.

   ```bash
   psql --set=oidc_action=link --set=oidc_user_id=UUID_CRYPTA \
     --set=oidc_issuer=https://id.example.org/realms/crypta --set=oidc_subject=SUBJECT_DA_XAC_MINH \
     --set="oidc_reason=Yêu cầu cấp quyền đã duyệt" --file=deploy/oidc-account-link.sql
   ```

   Đổi `oidc_action` thành `revoke` để thu hồi chính liên kết trên. Runtime chỉ đọc bảng liên kết. Mật khẩu tài khoản SSO được quản lý ở hệ thống danh tính.

## Kiểm thử cách ly

Lượt `crypta-t30-test-8d61643986a3` ngày 07/11/2026 đạt 6/6 nhóm với PostgreSQL, Nginx, Keycloak 26.8.2 và Chromium. Các ca gồm callback gắn với trình duyệt, từ chối email trùng, TOTP và quyền Approver đúng đơn vị, gia hạn phiên và logout back-channel, vô hiệu hóa tài khoản tại Keycloak và Admin cục bộ hoàn tất MFA khi Keycloak dừng. Stack, volume và thông tin xác thực thử đã được dọn. Bộ unit đạt 489/489 ở backend và 148/148 ở frontend. Cần lặp kiểm với origin HTTPS và danh tính thật khi có môi trường đích.

GitHub Actions xác nhận đủ 5 job, gồm 6/6 nhóm Keycloak, 50/50 nhóm quyền runtime và dọn cả ba stack. [Báo cáo CI](CI_REMOTE_2026-11-07.md#lượt-tích-hợp-keycloak-x03)

Lệnh dưới đây dùng Keycloak, PostgreSQL, Nginx và Chromium trong một project Compose riêng. Chromium ánh xạ hai hostname thử về loopback. Realm và thông tin xác thực thử được xóa sau khi dọn stack. Báo cáo chỉ lưu kết quả kiểm.

```powershell
./tools/test-isolated-stack.ps1 -Port 18181 -OidcPort 18182 -RequireMfa -VerifyStack {
  param([string]$ReportPath)
  node ./tools/test-real-oidc.cjs $ReportPath ./tools/ci/node_modules
  if ($LASTEXITCODE -ne 0) { throw 'Keycloak OIDC integration failed.' }
}
```
