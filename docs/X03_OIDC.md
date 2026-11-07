# X03 — Đăng nhập SSO với Keycloak

Chủ dự án chọn Keycloak cách ly để kiểm thử. Image test ghim Keycloak 26.8.2 và digest từ Quay. `tools/testing/keycloak-realm.cjs` tạo realm với hai chủ thể thử và thông tin xác thực ngẫu nhiên. Overlay `compose.oidc-test.yml` chỉ bind cổng về loopback. Bản mẫu dùng HTTP trong stack thử. Môi trường thật cần issuer và callback HTTPS. [Keycloak 26.8.2](https://www.keycloak.org/2026/11/keycloak-2682-released) · [Tài liệu container](https://www.keycloak.org/server/containers)

Chủ dự án đã duyệt [mẫu giao diện X03](../tools/design-previews/oidc/index.html). Mẫu gồm đăng nhập, xác thực hai bước cho vai trò nhạy cảm, đường vào bằng tài khoản cục bộ được phép và cách xử lý khi IdP gián đoạn hoặc tài khoản không còn quyền. Chromium đạt 24/24 ca prototype ở desktop/mobile, sáng/tối.

1. Dùng Authorization Code với PKCE S256, state ngẫu nhiên, nonce, callback đã đăng ký và challenge dùng một lần. Kiểm chữ ký, issuer, audience và thời hạn token. Giữ thông tin phiên và token phía máy chủ. [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html) · [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)
2. Liên kết bằng cặp issuer và subject đã được người vận hành xác minh. Vai trò, đơn vị và phạm vi lấy từ Crypta. Trùng email không tạo liên kết và không cấp quyền. Tài khoản cục bộ khẩn cấp dùng MFA X01.
3. Thu hồi phiên khi liên kết hoặc quyền tại Crypta đổi. Kiểm logout token của Keycloak qua back-channel và từ chối tiếp tục phiên nếu IdP báo token không còn hoạt động. Cần đo thời gian thu hồi sau vô hiệu hóa và thử sự cố kết nối. [OIDC Back-Channel Logout](https://openid.net/specs/openid-connect-backchannel-1_0.html) · [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers)

Đã kiểm trình tạo realm, cấu hình callback chính xác và khóa direct grant. Còn chạy Keycloak, nối API và kiểm callback, phân quyền, MFA và thu hồi phiên trên stack cách ly.
