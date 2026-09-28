# BỘ KHOA HỌC VÀ CÔNG NGHỆ
# HỌC VIỆN CÔNG NGHỆ BƯU CHÍNH VIỄN THÔNG
### KHOA CÔNG NGHỆ THÔNG TIN
---

<br/>

# BÁO CÁO ĐỒ ÁN MÔN HỌC
## MÔN HỌC: THIẾT KẾ HỆ THỐNG THÔNG TIN

<br/>

### ĐỀ TÀI:
# HỆ THỐNG QUẢN LÝ VÒNG ĐỜI KHÓA MÃ HÓA VÀ CHỨNG CHỈ SỐ DOANH NGHIỆP (CRYTA)

<br/>

**Giảng viên hướng dẫn:** ThS. [Điền tên Giảng viên hướng dẫn]  
**Nhóm sinh viên thực hiện:** Nhóm [Điền số nhóm]  

| STT | Họ và tên sinh viên | Mã số sinh viên (MSSV) | Lớp sinh viên | Vai trò trong nhóm |
| :-: | :--- | :-: | :-: | :-: |
| 1 | [Họ và tên thành viên 01] | [MSSV 01] | [Lớp 01] | Trưởng nhóm |
| 2 | [Họ và tên thành viên 02] | [MSSV 02] | [Lớp 02] | Thành viên |
| 3 | [Họ và tên thành viên 03] | [MSSV 03] | [Lớp 03] | Thành viên |

<br/>

*TP. Hồ Chí Minh, Học kỳ I — Năm học 2026*

---

<div style="page-break-after: always;"></div>

# MỤC LỤC

- [DANH SÁCH HÌNH, BẢNG](#danh-sách-hình-bảng)
- [DANH MỤC TỪ VIẾT TẮT](#danh-mục-từ-viết-tắt)
- [CHƯƠNG I. TỔNG QUAN](#chương-i-tổng-quan)
  - [I. Giới thiệu đề tài](#i-giới-thiệu-đề-tài)
    - [1. Lý do chọn đề tài và Tính cấp thiết](#1-lý-do-chọn-đề-tài-và-tính-cấp-thiết)
    - [2. Mục tiêu của đề tài](#2-mục-tiêu-của-đề-tài)
    - [3. Phạm vi áp dụng](#3-phạm-vi-áp-dụng)
    - [4. Nền tảng kỹ thuật lựa chọn](#4-nền-tảng-kỹ-thuật-lựa-chọn)
  - [II. Cơ sở lý thuyết](#ii-cơ-sở-lý-thuyết)
    - [1. Vòng đời Khóa mật mã theo chuẩn NIST SP 800-57](#1-vòng-đời-khóa-mật-mã-theo-chuẩn-nist-sp-800-57)
    - [2. Hạ tầng khóa công khai PKI và Chứng thư số X.509](#2-hạ-tầng-khóa-công-khai-pki-và-chứng-thư-số-x509)
    - [3. Nguyên tắc Phân tách Trách nhiệm (Separation of Duties - SoD)](#3-nguyên-tắc-phân-tách-trách-nhiệm-separation-of-duties---sod)
    - [4. Cơ chế Nhật ký kiểm toán Bất biến (Audit Log Immutability)](#4-cơ-chế-nhật-ký-kiểm-toán-bất-biến-audit-log-immutability)
- [CHƯƠNG II. PHÂN TÍCH NỘI DUNG, YÊU CẦU](#chương-ii-phân-tích-nội-dung-yêu-cầu)
  - [I. Giới thiệu Quy trình 1: Đăng ký & Cấp phát tài sản mật mã mới](#i-giới-thiệu-quy-trình-1-đăng-ký--cấp-phát-tài-sản-mật-mã-mới)
  - [II. Giới thiệu Quy trình 2: Phê duyệt & Kiểm soát Phân tách Trách nhiệm (SoD)](#ii-giới-thiệu-quy-trình-2-phê-duyệt--kiểm-soát-phân-tách-trách-nhiệm-sod)
  - [III. Giới thiệu Quy trình 3: Ứng phó sự cố & Thu hồi Khẩn cấp (Emergency Revocation)](#iii-giới-thiệu-quy-trình-3-ứng-phó-sự-cố--thu-hồi-khẩn-cấp-emergency-revocation)
  - [IV. Yêu cầu chức năng nghiệp vụ](#iv-yêu-cầu-chức-năng-nghiệp-vụ)
    - [1. Chức năng của đối tượng Requester (Nhân viên nghiệp vụ)](#1-chức-năng-của-đối-tượng-requester-nhân-viên-nghiệp-vụ)
    - [2. Chức năng của đối tượng Approver (Quản lý / Người phê duyệt)](#2-chức-năng-của-đối-tượng-approver-quản-lý--người-phê-duyệt)
    - [3. Chức năng của đối tượng CISO / Security Admin (Giám đốc Bảo mật)](#3-chức-năng-của-đối-tượng-ciso--security-admin-giám-đốc-bảo-mật)
    - [4. Chức năng của đối tượng System Admin (Quản trị viên hệ thống)](#4-chức-năng-của-đối-tượng-system-admin-quản-trị-viên-hệ-thống)
  - [V. Yêu cầu chức năng hệ thống và Yêu cầu chất lượng](#v-yêu-cầu-chức-năng-hệ-thống-và-yêu-cầu-chất-lượng)
- [CHƯƠNG III. PHÂN TÍCH THIẾT KẾ HỆ THỐNG](#chương-iii-phân-tích-thiết-kế-hệ-thống)
  - [I. Sơ đồ Use Case](#i-sơ-đồ-use-case)
  - [II. Sơ đồ trạng thái (State Diagram)](#ii-sơ-đồ-trạng-thái-state-diagram)
  - [III. Sơ đồ tuần tự (Sequence Diagram)](#iii-sơ-đồ-tuần-tự-sequence-diagram)
  - [IV. Sơ đồ hoạt động (Activity Diagram)](#iv-sơ-đồ-hoạt-động-activity-diagram)
  - [V. Sơ đồ lớp (Class Diagram)](#v-sơ-đồ-lớp-class-diagram)
  - [VI. Thiết kế Cơ sở Dữ liệu](#vi-thiết-kế-cơ-sở-dữ-liệu)
  - [VII. Thiết kế giao diện](#vii-thiết-kế-giao-diện)
  - [VIII. Thiết kế xử lý & Thuật toán bảo mật](#viii-thiết-kế-xử-lý--thuật-toán-bảo-mật)
- [CHƯƠNG IV. PHÁT TRIỂN / THỰC THI](#chương-iv-phát-triển--thực-thi)
  - [I. Màn hình Đăng nhập & Đổi mật khẩu bắt buộc](#i-màn-hình-đăng-nhập--đổi-mật-khẩu-bắt-buộc)
  - [II. Màn hình Không gian làm việc cá nhân (User Dashboard)](#ii-màn-hình-không-gian-làm-việc-cá-nhân-user-dashboard)
  - [III. Màn hình Hàng đợi duyệt phòng ban (Approval Queue) & Quyết định](#iii-màn-hình-hàng-đợi-duyệt-phòng-ban-approval-queue--quyết-định)
  - [IV. Màn hình Bảng thông báo nổi (Notification Popover)](#iv-màn-hình-bảng-thông-báo-nổi-notification-popover)
  - [V. Màn hình Quản trị Chính sách & Thu hồi khẩn cấp](#v-màn-hình-quản-trị-chính-sách--thu-hồi-khẩn-cấp)
  - [VI. Màn hình Nhật ký kiểm toán bất biến (Audit Logs)](#vi-màn-hình-nhật-ký-kiểm-toán-bất-biến-audit-logs)
- [CHƯƠNG V. TRIỂN KHAI](#chương-v-triển-khai)
  - [I. Cài đặt](#i-cài-đặt)
  - [II. Thử nghiệm](#ii-thử-nghiệm)
- [CHƯƠNG VI. KẾT LUẬN](#chương-vi-kết-luận)
  - [I. Kết quả đã thực hiện](#i-kết-quả-đã-thực-hiện)
  - [II. Ưu khuyết điểm](#ii-ưu-khuyết-điểm)
  - [III. Hướng mở rộng trong tương lai](#iii-hướng-mở-rộng-trong-tương-lai)
- [TÀI LIỆU THAM KHẢO](#tài-liệu-tham-khảo)

---

<div style="page-break-after: always;"></div>

# DANH SÁCH HÌNH, BẢNG

### Danh sách Hình vẽ
- **Hình 3.1:** Sơ đồ Use Case tổng quát của hệ thống Cryta (15 Use Cases phân theo 4 nhóm Actor).
- **Hình 3.2:** Sơ đồ Máy trạng thái Yêu cầu (Request State Machine).
- **Hình 3.3:** Sơ đồ Máy trạng thái Tài sản Mật mã (Asset State Machine).
- **Hình 3.4:** Sơ đồ Tuần tự luồng Xác thực & Đổi mật khẩu bắt buộc (UC-01).
- **Hình 3.5:** Sơ đồ Tuần tự luồng Tạo yêu cầu cấp mới Khóa/Chứng chỉ (UC-02).
- **Hình 3.6:** Sơ đồ Tuần tự luồng Phê duyệt & Kiểm soát Phân tách Trách nhiệm SoD (UC-07).
- **Hình 3.7:** Sơ đồ Tuần tự luồng Thu hồi Tài sản Khẩn cấp (UC-10).
- **Hình 3.8:** Sơ đồ Tuần tự luồng Bảng thông báo nổi Notification Popover (UC-12 & UC-UI-01).
- **Hình 3.9:** Sơ đồ Hoạt động luồng xử lý đơn cấp phát và phê duyệt.
- **Hình 3.10:** Sơ đồ Lớp miền nghiệp vụ (Domain Class Diagram).
- **Hình 3.11:** Sơ đồ Thực thể Liên kết (ERD) 15 bảng cơ sở dữ liệu.
- **Hình 4.1:** Giao diện Đăng nhập và Hộp thoại Đổi mật khẩu bắt buộc.
- **Hình 4.2:** Giao diện Dashboard cá nhân của Requester và Bảng tài sản mật mã.
- **Hình 4.3:** Giao diện Hàng đợi duyệt của Approver và Thanh quyết định duyệt đơn.
- **Hình 4.4:** Giao diện Bảng thông báo nổi Notification Popover trên thanh Header.
- **Hình 4.5:** Giao diện Quản trị Chính sách (Policy Versioning) và Nút Thu hồi khẩn cấp của CISO.
- **Hình 4.6:** Giao diện Tra cứu Nhật ký kiểm toán bất biến (Audit Logs Console).

### Danh sách Bảng biểu
- **Bảng 1.1:** So sánh các giải pháp quản lý khóa truyền thống và hệ thống Cryta.
- **Bảng 2.1:** Bảng yêu cầu chức năng nghiệp vụ của đối tượng Requester (Nhân viên).
- **Bảng 2.2:** Bảng yêu cầu chức năng nghiệp vụ của đối tượng Approver (Quản lý).
- **Bảng 2.3:** Bảng yêu cầu chức năng nghiệp vụ của đối tượng CISO (Giám đốc Bảo mật).
- **Bảng 2.4:** Bảng yêu cầu chức năng nghiệp vụ của đối tượng System Admin (Quản trị viên).
- **Bảng 3.1:** Bảng cấu trúc CSDL `users` (Thông tin tài khoản).
- **Bảng 3.2:** Bảng cấu trúc CSDL `crypto_assets` (Siêu dữ liệu tài sản mật mã).
- **Bảng 3.3:** Bảng cấu trúc CSDL `requests` (Đơn yêu cầu nghiệp vụ).
- **Bảng 3.4:** Bảng cấu trúc CSDL `audit_logs` (Nhật ký kiểm toán bất biến).
- **Bảng 3.5:** Bảng cấu trúc CSDL `notifications` (Thông báo ứng dụng).
- **Bảng 5.1:** Bảng tình trạng cài đặt các chức năng và mức độ hoàn thành.
- **Bảng 5.2:** Danh sách tài khoản thử nghiệm theo từng đối tượng.
- **Bảng 5.3:** Tổng hợp kết quả kiểm thử tự động (Automation Test Results).

---

# DANH MỤC TỪ VIẾT TẮT

| Từ viết tắt | Tên tiếng Anh đầy đủ | Ý nghĩa / Giải thích trong hệ thống |
| :--- | :--- | :--- |
| **KMS** | Key Management Service | Hệ thống quản lý vòng đời khóa mật mã |
| **PKI** | Public Key Infrastructure | Hạ tầng khóa công khai quản lý chứng thư số |
| **SoD** | Separation of Duties | Nguyên tắc phân tách trách nhiệm (người tạo không được tự duyệt) |
| **RBAC** | Role-Based Access Control | Cơ chế kiểm soát truy cập dựa trên vai trò |
| **CISO** | Chief Information Security Officer | Giám đốc an toàn thông tin của tổ chức |
| **JWT** | JSON Web Token | Tiêu chuẩn mã hóa phiên xác thực người dùng |
| **CA** | Certificate Authority | Tổ chức chứng thực chữ ký số |
| **CSR** | Certificate Signing Request | Tệp yêu cầu cấp chứng thư số gửi lên CA |
| **AES** | Advanced Encryption Standard | Chuẩn mã hóa đối xứng khối an toàn (AES-256-GCM) |
| **RSA** | Rivest–Shamir–Adleman | Thuật toán mật mã bất đối xứng phổ biến (RSA-2048/4096) |
| **ECDSA** | Elliptic Curve Digital Signature Algorithm | Thuật toán chữ ký số trên đường cong Elliptic (P-256) |
| **ERD** | Entity Relationship Diagram | Sơ đồ biểu diễn thực thể và mối quan hệ CSDL |
| **API** | Application Programming Interface | Giao diện lập trình ứng dụng RESTful |
| **UI/UX** | User Interface / User Experience | Giao diện và trải nghiệm người dùng |

---

<div style="page-break-after: always;"></div>

# CHƯƠNG I. TỔNG QUAN

## I. Giới thiệu đề tài

### 1. Lý do chọn đề tài và Tính cấp thiết
Trong môi trường công nghệ hiện nay, việc ứng dụng mã hóa dữ liệu và chữ ký số là nền tảng cốt lõi trong các doanh nghiệp để đảm bảo tính bí mật, toàn vẹn và chống chối bỏ. Các tổ chức thường xuyên phải phát hành và quản lý hàng trăm cặp khóa SSH, khóa mã hóa cơ sở dữ liệu (AES), chứng chỉ SSL/TLS cho máy chủ web và chứng thư số ký hóa đơn điện tử.

Tuy nhiên, tại nhiều doanh nghiệp, công tác quản lý tài sản mật mã vẫn đang gặp phải các vấn đề nghiêm trọng sau:
1. **Quản lý phân tán và thủ công:** Khóa và chứng chỉ được lưu trữ rải rác trên máy tính cá nhân, chia sẻ qua tin nhắn nội bộ hoặc ghi chép vào file Excel. Điều này dẫn đến nguy cơ rò rỉ khóa bí mật (Private Key) mà người quản lý không hay biết.
2. **Sự cố gián đoạn do hết hạn chứng chỉ:** Chứng chỉ SSL/TLS hoặc chứng thư số hết hạn đột ngột mà không có cảnh báo trước, khiến website bị trình duyệt cảnh báo không an toàn, dịch vụ thanh toán bị đình trệ.
3. **Thiếu cơ chế kiểm soát quyền hạn (SoD):** Lập trình viên có thể tự do tạo khóa và đưa vào môi trường production mà không qua sự xem xét, đánh giá rủi ro từ Trưởng phòng.
4. **Không có quy trình ứng phó rò rỉ khẩn cấp:** Khi phát hiện máy chủ bị tấn công hoặc khóa bí mật bị đẩy nhầm lên kho mã nguồn công khai (GitHub), người quản trị bảo mật (CISO) không có công cụ thu hồi tài sản mật mã tức thời trên toàn hệ thống.

Xuất phát từ những bài toán thực tế đó, nhóm chúng em đã lựa chọn đề tài: **"Xây dựng Hệ thống Quản lý Vòng đời Khóa Mã hóa và Chứng chỉ số Doanh nghiệp (Cryta)"** cho đồ án môn học Thiết kế Hệ thống Thông tin nhằm cung cấp một giải pháp quản trị tập trung, an toàn, minh bạch và tự động hóa cao.

### 2. Mục tiêu của đề tài
- **Chuẩn hóa quy trình nghiệp vụ:** Xây dựng quy trình nghiệp vụ khép kín từ lúc nộp đơn xin cấp phát, quản lý phân luồng phê duyệt theo phòng ban, tự động sinh khóa/chứng chỉ, gia hạn tài sản, cho đến thu hồi khi hết nhu cầu.
- **Thực thi nguyên tắc Phân tách Trách nhiệm (SoD):** Ngăn chặn tuyệt đối hành vi người tạo đơn tự phê duyệt đơn của mình; quản lý chỉ được duyệt trong phạm vi phòng ban mình phụ trách; quản trị viên không can thiệp phê duyệt đơn nghiệp vụ.
- **Cung cấp cơ chế Thu hồi Khẩn cấp (Emergency Revocation):** Trao quyền cho CISO thu hồi tức thời tài sản bị rò rỉ mà không cần thông qua bước lập đơn và chờ duyệt thông thường.
- **Lưu vết kiểm toán bất biến (Audit Log Immutability):** Ghi nhận đầy đủ vết thao tác người dùng, đảm bảo dữ liệu nhật ký không thể bị sửa hoặc xóa kể cả từ người quản trị.
- **Tự động hóa cảnh báo:** Tự động quét và phát thông báo In-app cùng email cảnh báo trước 30 ngày đối với các tài sản sắp hết hiệu lực.

### 3. Phạm vi áp dụng
- **Phạm vi tổ chức:** Phù hợp áp dụng cho các cơ quan, doanh nghiệp có nhiều bộ phận phòng ban (như Phòng Công nghệ Thông tin, Phòng Kế toán - Tài chính, Khối Vận hành hệ thống).
- **Phạm vi tài sản quản lý:**
  - *Khóa đối xứng (Symmetric Key):* AES-128, AES-256 (phục vụ mã hóa dữ liệu cơ sở dữ liệu, sao lưu).
  - *Cặp khóa bất đối xứng (Asymmetric Key Pair):* RSA-2048, RSA-4096, ECDSA P-256 (phục vụ ký số, xác thực SSH, phân quyền máy chủ).
  - *Chứng chỉ số (Digital Certificate):* Chứng chỉ X.509 SSL/TLS cho dịch vụ web, chứng thư ký số nội bộ.
- **Giới hạn phạm vi (MVP):** Hệ thống quản lý tập trung siêu dữ liệu (metadata), thuật toán, thời hạn và trạng thái; lưu trữ khóa công khai để người dùng tải về; khóa bí mật được quản lý mô phỏng thông qua nhà cung cấp mật mã nội bộ an toàn (Mock Crypto Provider).

### 4. Nền tảng kỹ thuật lựa chọn
- **Phía Máy chủ (Backend):** Sử dụng **NestJS (Node.js/TypeScript)** theo mô hình kiến trúc phân tầng (Controller - Service - Module), thiết kế chuẩn RESTful API, tài liệu hóa tự động bằng OpenAPI/Swagger UI (`/docs`).
- **Phía Giao diện (Frontend):** Ứng dụng Single Page Application (SPA) xây dựng bằng **React 19, TypeScript và Vite**, thiết kế giao diện theo phong cách Dashboard hiện đại, tích hợp Bảng thông báo nổi (`NotificationPopover`).
- **Cơ sở Dữ liệu (Database):** Hệ quản trị **PostgreSQL 15** (lưu trữ đám mây Supabase), tận dụng các ràng buộc CHECK, Foreign Key và Database Trigger để thực thi logic SoD và tính bất biến của nhật ký kiểm toán ở tầng vật lý.

---

## II. Cơ sở lý thuyết

### 1. Vòng đời Khóa mật mã theo chuẩn NIST SP 800-57
Theo hướng dẫn của Viện Tiêu chuẩn và Kỹ thuật Quốc gia Hoa Kỳ (NIST Special Publication 800-57 Part 1), vòng đời của một tài sản mật mã gồm các trạng thái chuẩn:
- *Pre-activation (Chờ kích hoạt):* Tài sản đã được tạo nhưng chưa đưa vào sử dụng thực tế.
- *Active (Đang hoạt động):* Khóa hoặc chứng chỉ đang được sử dụng hợp pháp để mã hóa, giải mã hoặc ký số.
- *Expiring Soon (Sắp hết hạn):* Tài sản bước vào giai đoạn chuyển tiếp (thường là 30 ngày trước ngày hết hạn) để phát cảnh báo cho chủ sở hữu gia hạn.
- *Expired (Đã hết hạn):* Quá thời hạn hiệu lực, tài sản không được phép dùng để sinh chữ ký mới.
- *Revoked (Bị thu hồi):* Tài sản bị hủy bỏ hiệu lực trước hạn do nghi ngờ lộ khóa bí mật hoặc thay đổi nhân sự.
- *Superseded (Đã thay thế):* Tài sản cũ được thay thế bởi một tài sản kế nhiệm sau quy trình gia hạn.

### 2. Hạ tầng khóa công khai PKI và Chứng thư số X.509
PKI là tập hợp các phần mềm, phần cứng, con người và quy trình cần thiết để phát hành, quản lý và thu hồi chứng chỉ số. Chứng thư số X.509 liên kết danh tính của một thực thể (tên máy chủ, email, cá nhân) với một khóa công khai (Public Key), được ký xác thực bởi một Tổ chức Chứng thực (CA). Khi cấp chứng chỉ, hệ thống luôn phải tạo và liên kết kèm theo một cặp khóa (Key Pair).

### 3. Nguyên tắc Phân tách Trách nhiệm (Separation of Duties - SoD)
SoD là nguyên tắc căn bản trong thiết kế hệ thống thông tin nhằm giảm thiểu rủi ro gian lận nội bộ bằng cách chia nhỏ các tác vụ nhạy cảm cho nhiều người cùng tham gia:
- *Quy tắc 1:* Người tạo đơn yêu cầu tuyệt đối không được tự phê duyệt đơn của mình (`creator_id != approver_id`).
- *Quy tắc 2:* Quản lý phòng ban chỉ được duyệt các đơn thuộc phạm vi đơn vị mình quản lý (`department_scope`).
- *Quy tắc 3:* Quản trị viên hệ thống (Admin) và CISO có quyền cấu hình chính sách nhưng không được quyền duyệt đơn xin cấp phát tài sản nghiệp vụ.

### 4. Cơ chế Nhật ký kiểm toán Bất biến (Audit Log Immutability)
Để phục vụ việc điều tra sự cố an toàn thông tin và chống chối bỏ trách nhiệm, bảng `audit_logs` phải được thiết kế theo cơ chế **Chỉ ghi thêm (Append-only)**:
- Mọi hành vi xác thực, tạo đơn, duyệt đơn, thu hồi khẩn cấp đều được ghi lại với dấu thời gian chính xác (`created_at = NOW()`), địa chỉ IP và mã định danh người thực hiện (`actor_id`).
- Trigger CSDL `trg_audit_log_immutable` sẽ chặn đứng bất kỳ câu lệnh `UPDATE` hoặc `DELETE` nào tác động lên bảng nhật ký, ngăn ngừa việc xóa dấu vết sau khi tấn công.

---

<div style="page-break-after: always;"></div>

# CHƯƠNG II. PHÂN TÍCH NỘI DUNG, YÊU CẦU

## I. Giới thiệu Quy trình 1: Đăng ký & Cấp phát tài sản mật mã mới
Quy trình cấp phát tài sản mật mã là luồng nghiệp vụ cơ bản diễn ra giữa Nhân viên nghiệp vụ (Requester) và Trưởng phòng ban (Approver):
1. **Nộp đơn:** Nhân viên (ví dụ lập trình viên cần khóa RSA ký commit) truy cập hệ thống, chọn loại tài sản cần xin cấp, chọn chính sách mật mã áp dụng (Policy Version), nhập mục đích sử dụng và thời hạn mong muốn.
2. **Kiểm tra sơ bộ:** Hệ thống tự động kiểm tra tính hợp lệ của tham số đầu vào. Nếu thời hạn vượt quá mức tối đa mà chính sách cho phép, hệ thống từ chối ngay tại chỗ (`422 POLICY_VIOLATION`). Nếu hợp lệ, đơn được lưu ở trạng thái `PENDING`.
3. **Phát thông báo:** Hệ thống tự động tạo một thông báo `REQUEST_SUBMITTED` gửi đến quả chuông của các Trưởng phòng có phạm vi phụ trách phòng ban của nhân viên đó.
4. **Phê duyệt:** Trưởng phòng xem xét chi tiết lý do và bấm "Phê duyệt".
5. **Cấp phát ngầm:** Tiến trình nền (Worker) nhận tín hiệu đơn đã duyệt, tự động sinh khóa mật mã trong CSDL, cập nhật tài sản thành `ACTIVE`, hoàn tất đơn (`COMPLETED`) và bắn thông báo `REQUEST_APPROVED` về cho người tạo đơn.
6. **Sử dụng:** Nhân viên tải tệp Public Key dạng PEM về máy tính để tích hợp vào ứng dụng.

## II. Giới thiệu Quy trình 2: Phê duyệt & Kiểm soát Phân tách Trách nhiệm (SoD)
Quy trình phê duyệt đòi hỏi sự chặt chẽ về thẩm quyền và ranh giới trách nhiệm:
1. **Phân định phạm vi (Approver Scopes):** Trưởng phòng IT (`it.manager`) chỉ nhìn thấy các đơn xin cấp khóa của nhân viên thuộc phòng IT; Kế toán trưởng (`fin.manager`) chỉ nhìn thấy các đơn chứng chỉ của nhân viên phòng Kế toán.
2. **Ngăn chặn xung đột lợi ích:** Trong trường hợp Trưởng phòng IT có nhu cầu sử dụng khóa và nộp đơn xin cấp, hệ thống tự động khóa quyền duyệt của Trưởng phòng đối với chính đơn đó. Nếu người này cố tình gửi lệnh duyệt qua API, cả tầng logic Backend lẫn Trigger CSDL `trg_check_sod_rule` sẽ lập tức chặn lại và ném lỗi vi phạm SoD (`SOD_VIOLATION`).
3. **Ghi nhận quyết định:** Mọi thao tác duyệt hoặc từ chối đều bắt buộc ghi nhận vào bảng `request_decisions` kèm lời phê hoặc lý do từ chối cụ thể để lưu vết kiểm toán.

## III. Giới thiệu Quy trình 3: Ứng phó sự cố & Thu hồi Khẩn cấp (Emergency Revocation)
Khi xảy ra sự cố bảo mật (nhân viên bị mất máy tính, hoặc lộ khóa bí mật ra ngoài Internet), quy trình nộp đơn thu hồi và chờ trưởng phòng duyệt thông thường sẽ mất nhiều thời gian, tạo điều kiện cho kẻ xấu lợi dụng khóa để giải mã hoặc giả mạo dữ liệu.
1. **Kích hoạt khẩn cấp:** CISO hoặc Quản trị viên truy cập bảng điều khiển an toàn, chọn tài sản bị rò rỉ và nhấn nút "Thu hồi khẩn cấp" (`POST /api/v1/assets/:id/revoke`).
2. **Xác thực quyền hạn:** Hệ thống kiểm tra quyền `ADMIN`. Người dùng thường và Quản lý phòng ban bị chặn ngay lập tức (`403 ADMIN_REQUIRED`).
3. **Vô hiệu hóa tức thời:** Hệ thống cập nhật trạng thái tài sản thành `REVOKED` ngay lập tức trong cơ sở dữ liệu mà không cần thông qua bước lập đơn hay chờ duyệt.
4. **Cảnh báo và Lưu vết:** Hệ thống phát thông báo cảnh báo đỏ (`ASSET_REVOKED`) đến chủ sở hữu tài sản và ghi một bản ghi Audit Log đặc biệt với cờ `emergency = true`.

---

## IV. Yêu cầu chức năng nghiệp vụ

Dưới đây là bảng chuẩn hóa các yêu cầu chức năng nghiệp vụ của hệ thống Cryta được phân loại theo 4 nhóm đối tượng sử dụng:

### 1. Chức năng của đối tượng Requester (Nhân viên nghiệp vụ)

| STT | Công việc | Loại công việc | Quy định / Công thức liên quan | Biểu mẫu liên quan | Ghi chú |
| :-: | :--- | :---: | :--- | :--- | :--- |
| **1** | Đăng nhập hệ thống | Tra cứu | - Email đúng định dạng và tài khoản ở trạng thái `ACTIVE`<br/>- Mật khẩu so khớp Bcrypt salt 10<br/>- Khóa tạm thời 15 phút nếu thử sai quá 10 lần liên tiếp | Form Đăng nhập | UC-01 |
| **2** | Đổi mật khẩu bắt buộc | Lưu trữ | - Kích hoạt khi cờ `must_change_password = true`<br/>- Mật khẩu mới tối thiểu 6 ký tự<br/>- Tăng `token_version` để thu hồi toàn bộ phiên đăng nhập cũ | Dialog Đổi mật khẩu | UC-01 |
| **3** | Tạo yêu cầu cấp mới Khóa/Cert | Lưu trữ | - Chọn loại tài sản: `KEY_PAIR`, `SYMMETRIC_KEY`, `CERTIFICATE`<br/>- Thuật toán và thời hạn phải phù hợp với Policy được chọn<br/>- `validity_days <= max_validity_days` | Modal Tạo yêu cầu | UC-02 |
| **4** | Yêu cầu Gia hạn tài sản | Lưu trữ | - Chỉ gia hạn tài sản do mình sở hữu (`owner_id = current_user.id`)<br/>- Tài sản ở trạng thái `ACTIVE`, `EXPIRING_SOON` hoặc `EXPIRED` | Form Gia hạn tài sản | UC-03 |
| **5** | Yêu cầu Thu hồi thông thường | Lưu trữ | - Bắt buộc cung cấp lý do: `KEY_COMPROMISE`, `DEVICE_LOST`, `CESSATION_OF_OPERATION`, `OTHER`<br/>- Tài sản mục tiêu chưa bị thu hồi trước đó | Dialog Thu hồi | UC-03 |
| **6** | Theo dõi trạng thái đơn | Tra cứu | - Chỉ tra cứu các đơn do chính mình tạo ra<br/>- Hiển thị đầy đủ tiến độ: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` | Bảng Yêu cầu gần đây | UC-04 |
| **7** | Hủy yêu cầu chờ duyệt | Lưu trữ | - Chỉ hủy được đơn của mình khi đang ở trạng thái `PENDING`<br/>- Đơn sau khi hủy chuyển sang `CANCELLED` và tự gỡ khỏi hàng đợi duyệt | Nút Hủy trên hàng đơn | UC-04 |
| **8** | Xem danh sách tài sản cá nhân | Trích xuất | - Chỉ hiển thị tài sản do mình sở hữu (`owner_id = user.id`)<br/>- Hỗ trợ bộ lọc theo trạng thái và thanh tìm kiếm nhanh | Bảng Tài sản của tôi | UC-05 |
| **9** | Tải Public Key / Chứng chỉ | Trích xuất | - Xuất tệp khóa công khai hoặc chứng chỉ định dạng PEM<br/>- Tuyệt đối không bao giờ xuất khóa bí mật (Private Key) | Nút Tải xuống tài sản | UC-05 |
| **10** | Xem Bảng thông báo nổi | Tra cứu | - Quả chuông trên Header hiển thị chấm đỏ khi có tin chưa đọc<br/>- Click chuông mở Notification Popover hiển thị 15 thông báo mới nhất | Notification Popover | UC-12 |
| **11** | Đánh dấu đã đọc thông báo | Lưu trữ | - Bấm nút "Đánh dấu đã đọc" trên Popover để cập nhật `read_at = NOW()`<br/>- Chấm đỏ cảnh báo trên quả chuông tắt ngay lập tức | Nút Đánh dấu đã đọc | UC-12 |

### 2. Chức năng của đối tượng Approver (Quản lý / Người phê duyệt)

| STT | Công việc | Loại công việc | Quy định / Công thức liên quan | Biểu mẫu liên quan | Ghi chú |
| :-: | :--- | :---: | :--- | :--- | :--- |
| **1** | Xem hàng đợi chờ duyệt | Tra cứu | - Chỉ hiển thị các đơn `PENDING` thuộc các phòng ban mà Approver được phân công quản lý (`approver_scopes`) | Hàng đợi duyệt đơn | UC-06 |
| **2** | Phê duyệt đơn yêu cầu | Xử lý | - Bắt buộc thỏa mãn SoD: người duyệt khác người nộp đơn (`approver_id != creator_id`)<br/>- Đơn chuyển `APPROVED`, kích hoạt worker sinh khóa ngầm | Thanh quyết định đơn | UC-07 |
| **3** | Từ chối đơn yêu cầu | Xử lý | - Bắt buộc nhập lời phê từ chối (Comment)<br/>- Đơn chuyển trạng thái `REJECTED`, gửi thông báo về cho Requester | Hộp thoại Từ chối | UC-07 |
| **4** | Báo cáo tài sản phòng ban | Trích xuất | - Thống kê tổng số tài sản phòng ban, số đơn tồn đọng, thời gian chờ duyệt trung bình của nhân viên | Approver Dashboard | UC-08 |
| **5** | Xem lịch sử xử lý đơn | Trích xuất | - Tra cứu danh sách các đơn đã được duyệt hoặc từ chối gần đây trong phạm vi phòng ban của mình | Bảng Lịch sử xử lý | UC-08 |

### 3. Chức năng của đối tượng CISO / Security Admin (Giám đốc Bảo mật)

| STT | Công việc | Loại công việc | Quy định / Công thức liên quan | Biểu mẫu liên quan | Ghi chú |
| :-: | :--- | :---: | :--- | :--- | :--- |
| **1** | Ban hành Chính sách mới | Lưu trữ | - Định nghĩa thuật toán cho phép (RSA, AES, ECDSA), độ dài khóa tối thiểu, thời hạn tối đa, số ngày cảnh báo trước | Modal Chính sách mới | UC-09 |
| **2** | Nâng cấp phiên bản Policy | Lưu trữ | - Tạo version mới (v2, v3) cho chính sách hiện hành<br/>- Đánh dấu version mới là `ACTIVE`, version cũ chuyển lưu trữ | Modal Cập nhật Policy | UC-09 |
| **3** | Thu hồi Tài sản Khẩn cấp | Xử lý | - Quyền hạn tối cao vô hiệu hóa tức thời bất kỳ tài sản nào trên toàn hệ thống thành `REVOKED` không qua phê duyệt | Dialog Thu hồi khẩn | UC-10 |
| **4** | Tra cứu Nhật ký kiểm toán | Tra cứu | - Tra cứu dòng thời gian toàn bộ các sự kiện kiểm toán<br/>- Hỗ trợ lọc theo hành động, tác nhân, kết quả và ngày tạo | Bảng Audit Log | UC-11 |
| **5** | Giám sát Dashboard an toàn | Trích xuất | - Theo dõi biểu đồ tỷ lệ loại tài sản toàn công ty, tài sản sắp hết hạn, trạng thái kết nối các dịch vụ nền | Admin Dashboard | UC-12 |

### 4. Chức năng của đối tượng System Admin (Quản trị viên hệ thống)

| STT | Công việc | Loại công việc | Quy định / Công thức liên quan | Biểu mẫu liên quan | Ghi chú |
| :-: | :--- | :---: | :--- | :--- | :--- |
| **1** | Quản lý danh mục Phòng ban | Lưu trữ | - Xem danh mục, thêm phòng ban mới, quản lý mã định danh phòng ban phục vụ cho việc phân luồng duyệt | Danh mục phòng ban | UC-13 |
| **2** | Tạo tài khoản người dùng | Lưu trữ | - Nhập email, họ tên, gán phòng ban, cấp mật khẩu khởi tạo<br/>- Mặc định bật cờ `must_change_password = true` | Modal Thêm User | UC-14 |
| **3** | Khóa / Kích hoạt tài khoản | Lưu trữ | - Chuyển trạng thái người dùng thành `INACTIVE`<br/>- Vô hiệu hóa ngay lập tức mọi phiên đăng nhập và token hiện có | Nút Khóa/Mở tài khoản | UC-14 |
| **4** | Phân vai trò người dùng | Lưu trữ | - Gán các vai trò `USER`, `APPROVER`, `ADMIN`<br/>- Hệ thống ngăn chặn việc gỡ vai trò Admin cuối cùng | Modal Phân quyền | UC-15 |
| **5** | Phân luồng Scopes duyệt | Lưu trữ | - Gán danh sách các phòng ban mà một Approver được quyền xem và phê duyệt yêu cầu | Modal Gán Scopes | UC-15 |

---

## V. Yêu cầu chức năng hệ thống và Yêu cầu chất lượng

### 1. Yêu cầu chức năng hệ thống
- **Quản lý phiên làm việc tập trung:** Phiên đăng nhập được duy trì thông qua cặp token JWT: Access Token (thời hạn 15 phút) và Refresh Token được lưu trữ trong HttpOnly Cookie có cờ `Secure`, chống tấn công XSS.
- **Tiến trình chạy ngầm (Background Worker):** Định kỳ mỗi giờ quét kiểm tra toàn bộ bảng `crypto_assets`:
  - Nếu `expires_at <= NOW() + 30 days` và trạng thái đang là `ACTIVE` $\rightarrow$ Chuyển sang `EXPIRING_SOON` và gửi thông báo cảnh báo.
  - Nếu `expires_at <= NOW()` và chưa được gia hạn $\rightarrow$ Tự động chuyển vĩnh viễn sang `EXPIRED`.
- **Ghép nối khóa tự động:** Khi phê duyệt một đơn cấp chứng chỉ số, hệ thống tự động sinh ngầm một cặp khóa bất đối xứng và lưu vào trường `certificates.public_key_asset_id`.

### 2. Yêu cầu chất lượng (Phi chức năng)
- **Hiệu năng và Tốc độ đáp ứng:** Thời gian phản hồi của các API truy vấn danh sách dưới 500ms; hỗ trợ phân trang dữ liệu ở mức CSDL (`LIMIT...OFFSET`) để đảm bảo không bị suy giảm hiệu năng khi số lượng bản ghi tăng cao.
- **Tính toàn vẹn và Bất biến:** Mọi thao tác thay đổi trạng thái đều được bọc trong Database Transaction. Bảng `audit_logs` có Trigger bảo vệ tính bất biến, không thể bị xóa hay chỉnh sửa nội dung.
- **Tính khả dụng và Trải nghiệm người dùng:** Giao diện thiết kế theo chuẩn Responsive Web Design, tương thích từ màn hình điện thoại di động (chiều rộng 375px) đến màn hình máy tính để bàn; hỗ trợ chế độ Dark Mode bảo vệ mắt.

---

<div style="page-break-after: always;"></div>

# CHƯƠNG III. PHÂN TÍCH THIẾT KẾ HỆ THỐNG

## I. Sơ đồ Use Case

Sơ đồ Use Case tổng quát của hệ thống Cryta được phân rã thành 15 Ca sử dụng cốt lõi theo 4 nhóm tác nhân chính:

```mermaid
flowchart LR
    REQ["Requester (User)"]
    APP["Approver (Manager)"]
    CISO["CISO (Security Admin)"]
    ADMIN["System Admin"]
    SYS["System Background Job"]

    subgraph Cryta["Hệ thống Quản lý Vòng đời Khóa & Chứng chỉ số"]
        UC01["UC-01 Đăng nhập & Đổi mật khẩu"]
        UC02["UC-02 Tạo yêu cầu cấp mới"]
        UC03["UC-03 Yêu cầu gia hạn / thu hồi"]
        UC04["UC-04 Theo dõi & Hủy đơn PENDING"]
        UC05["UC-05 Xem tài sản cá nhân & Tải Khóa"]
        
        UC06["UC-06 Xem hàng đợi duyệt theo Scope"]
        UC07["UC-07 Phê duyệt / Từ chối kèm nhận xét"]
        UC08["UC-08 Báo cáo tài sản & Dashboard duyệt"]
        
        UC09["UC-09 Ban hành & Versioning Policy"]
        UC10["UC-10 Thu hồi Tài sản Khẩn cấp"]
        UC11["UC-11 Tra cứu Audit Log Bất biến"]
        UC12["UC-12 Giám sát Dashboard toàn cục"]
        
        UC13["UC-13 Quản lý Phòng ban & Danh mục"]
        UC14["UC-14 Quản trị Người dùng & Trạng thái"]
        UC15["UC-15 Cấp quyền Role & Phân luồng Scopes"]
        
        UCNOTI["Hệ thống Chuông & Popover Thông báo"]
        UCSYS1["Quét & Cảnh báo Sắp Hết Hạn"]
        UCSYS2["Tự động Chuyển trạng thái EXPIRED"]
    end

    REQ --> UC01
    REQ --> UC02
    REQ --> UC03
    REQ --> UC04
    REQ --> UC05
    REQ -.-> UCNOTI

    APP --> UC01
    APP --> UC06
    APP --> UC07
    APP --> UC08
    APP -.-> UCNOTI

    CISO --> UC01
    CISO --> UC09
    CISO --> UC10
    CISO --> UC11
    CISO --> UC12
    CISO -.-> UCNOTI

    ADMIN --> UC01
    ADMIN --> UC11
    ADMIN --> UC13
    ADMIN --> UC14
    ADMIN --> UC15

    SYS --> UCSYS1
    SYS --> UCSYS2
```
*Hình 3.1: Sơ đồ Use Case tổng quát hệ thống Cryta*

---

## II. Sơ đồ trạng thái (State Diagram)

### 1. Máy trạng thái Đơn yêu cầu (Request State Machine)
Đơn yêu cầu tuân thủ chu trình chuyển đổi trạng thái một chiều nghiêm ngặt:

```mermaid
stateDiagram-v2
    [*] --> PENDING: User nộp đơn (CREATE/RENEW/REVOKE)
    
    PENDING --> CANCELLED: User chủ động hủy đơn
    PENDING --> REJECTED: Approver từ chối kèm lý do
    PENDING --> APPROVED: Approver phê duyệt đơn
    
    APPROVED --> PROCESSING: Worker nhận đơn xử lý
    PROCESSING --> COMPLETED: Sinh tài sản thành công
    PROCESSING --> FAILED: Lỗi hệ thống mật mã
    
    CANCELLED --> [*]
    REJECTED --> [*]
    COMPLETED --> [*]
    FAILED --> [*]
```
*Hình 3.2: Sơ đồ Máy trạng thái Đơn yêu cầu (Request State Machine)*

### 2. Máy trạng thái Tài sản Mật mã (Asset State Machine)
Tài sản mật mã sau khi sinh ra sẽ chuyển trạng thái tự động theo thời gian hoặc theo quyết định quản trị:

```mermaid
stateDiagram-v2
    [*] --> ACTIVE: Sinh khóa / cấp chứng chỉ thành công
    
    ACTIVE --> EXPIRING_SOON: Còn dưới 30 ngày trước hạn
    EXPIRING_SOON --> EXPIRED: Quá ngày hết hạn hiệu lực
    
    EXPIRING_SOON --> SUPERSEDED: Gia hạn thành công (thay thế bởi khóa mới)
    ACTIVE --> SUPERSEDED: Gia hạn trước hạn thành công
    
    ACTIVE --> REVOKED: Thu hồi thường hoặc Thu hồi Khẩn cấp
    EXPIRING_SOON --> REVOKED: Thu hồi do lộ khóa
    
    REVOKED --> [*]
    EXPIRED --> [*]
    SUPERSEDED --> [*]
```
*Hình 3.3: Sơ đồ Máy trạng thái Tài sản Mật mã (Asset State Machine)*

---

## III. Sơ đồ tuần tự (Sequence Diagram)

### 1. Sơ đồ Tuần tự luồng Xác thực & Đổi mật khẩu bắt buộc (UC-01)

```mermaid
sequenceDiagram
    autonumber
    actor U as Người dùng (User / Approver / Admin)
    participant UI as React Frontend
    participant API as Backend (Auth Module)
    participant DB as PostgreSQL (Supabase)

    U->>UI: 1. Nhập email & mật khẩu (Password@123)
    UI->>API: 2. POST /api/v1/auth/login
    API->>DB: 3. Kiểm tra số lần thử sai (< 10) & Lấy password hash
    API->>API: 4. So khớp mật khẩu với bcrypt
    API->>DB: 5. Reset failed_login_attempts = 0
    API-->>UI: 6. 200 OK + JWT Access Token + HttpOnly Refresh Cookie
    
    alt Nếu cờ must_change_password == true
        UI->>U: 7. Bật hộp thoại "Đổi mật khẩu lần đầu" (Bắt buộc)
        U->>UI: 8. Nhập mật khẩu mới
        UI->>API: 9. POST /api/v1/auth/change-password
        API->>DB: 10. Update password hash, must_change_password = false, token_version++
        API->>DB: 11. Ghi log AUTH_CHANGE_PASSWORD
        API-->>UI: 12. 200 OK (Cập nhật phiên mới)
    end
    UI->>U: 13. Điều hướng vào Dashboard tương ứng theo Role
```
*Hình 3.4: Sơ đồ Tuần tự luồng Đăng nhập & Đổi mật khẩu bắt buộc*

### 2. Sơ đồ Tuần tự luồng Phê duyệt & Kiểm soát Phân tách Trách nhiệm SoD (UC-07)

```mermaid
sequenceDiagram
    autonumber
    actor U as Requester (User)
    participant API as Backend API
    participant DB as PostgreSQL
    actor A as Approver (Manager)
    participant W as Provisioning Worker
    participant KP as Crypto Provider

    U->>API: 1. POST /requests (Tạo yêu cầu cấp mới)
    API->>DB: 2. Validate policy + Lưu đơn PENDING
    API->>DB: 3. Ghi log REQUEST_CREATED + Bắn NOTIFICATIONS cho Approver
    API-->>U: 4. 201 Created

    A->>API: 5. POST /requests/{id}/decision (Phê duyệt / Từ chối)
    API->>DB: 6. Kiểm tra quyền, Scope phòng ban, SoD (creator != approver)
    API->>DB: 7. Atomic update PENDING -> APPROVED / REJECTED
    API->>DB: 8. Insert request_decisions + Audit Log DECISION_*
    API-->>A: 9. 200 OK

    opt Nếu đơn APPROVED
        W->>DB: 10. Polling đơn APPROVED (FOR UPDATE SKIP LOCKED)
        W->>KP: 11. Tự động sinh Khóa / Cặp Khóa / Chứng chỉ
        W->>DB: 12. Insert crypto_assets (ACTIVE) + Liên kết Public Key
        W->>DB: 13. Update request -> COMPLETED + Bắn thông báo cho Requester
    end
```
*Hình 3.6: Sơ đồ Tuần tự luồng Phê duyệt và Cấp phát SoD*

### 3. Sơ đồ Tuần tự luồng Thu hồi Tài sản Khẩn cấp (UC-10)

```mermaid
sequenceDiagram
    autonumber
    actor C as CISO (ciso@congty.com)
    participant UI as React Frontend
    participant API as Backend API
    participant DB as PostgreSQL (Supabase)
    actor Owner as Chủ sở hữu tài sản

    C->>UI: 1. Phát hiện sự cố lộ khóa bí mật trên máy chủ
    C->>UI: 2. Chọn tài sản -> Bấm "Thu hồi khẩn cấp" (Emergency Revoke)
    C->>UI: 3. Nhập lý do: "Nghi ngờ rò rỉ Private Key trên GitHub"
    UI->>API: 4. POST /api/v1/assets/:id/revoke
    API->>DB: 5. Kiểm tra quyền ADMIN (Chặn ngay lập tức nếu không phải Admin)
    API->>DB: 6. Cập nhật TRỰC TIẾP crypto_assets.status = 'REVOKED' (Không qua tạo đơn duyệt)
    API->>DB: 7. INSERT notifications (type: 'ASSET_REVOKED') gửi cho Owner
    API->>DB: 8. Ghi Audit Log EMERGENCY_REVOKE (emergency: true)
    Note over DB: Trigger trg_audit_log_immutable bảo vệ bản ghi log vĩnh viễn
    API-->>UI: 9. 200 OK -> Tài sản bị vô hiệu hóa toàn mạng
    DB-->>Owner: 10. Chủ sở hữu nhận cảnh báo đỏ thu hồi tài sản trên Popover
```
*Hình 3.7: Sơ đồ Tuần tự luồng Thu hồi Khẩn cấp trực tiếp*

### 4. Sơ đồ Tuần tự luồng Bảng thông báo nổi Notification Popover (UC-12 & UC-UI-01)

```mermaid
sequenceDiagram
    autonumber
    actor A as Người dùng (User / Approver / Admin)
    participant UI as React Frontend (Header)
    participant Pop as NotificationPopover Component
    participant API as Backend API
    participant DB as PostgreSQL (Supabase)

    DB-->>UI: 1. Có thông báo mới (read_at IS NULL)
    UI->>UI: 2. Quả chuông trên Header bật chấm đỏ (.has-alert)
    A->>UI: 3. Click vào quả chuông
    UI->>Pop: 4. Xổ bảng NotificationPopover (Hiển thị 15 tin mới, badge unread)
    
    alt Người dùng đánh dấu đã đọc
        A->>Pop: 5a. Bấm nút "Đánh dấu đã đọc"
        Pop->>API: 6a. PATCH /api/v1/notifications/read-all
        API->>DB: 7a. UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL
        API-->>Pop: 8a. 200 OK ({ updated: N })
        Pop->>UI: 9a. Tắt chấm đỏ trên chuông, unreadCount = 0
    else Người dùng click vào một thông báo cụ thể
        A->>Pop: 5b. Click dòng thông báo
        Pop->>UI: 6b. Đóng Popover & Tự động cuộn đến bảng dữ liệu (Deep-link)
    else Người dùng click ra ngoài hoặc bấm Escape
        A->>UI: 5c. Click vùng ngoài hoặc bấm phím Escape
        UI->>Pop: 6c. Tự động đóng Popover
    end
```
*Hình 3.8: Sơ đồ Tuần tự luồng tương tác Bảng thông báo nổi*

---

## IV. Sơ đồ hoạt động (Activity Diagram)

```mermaid
flowchart TD
    Start([Bắt đầu]) --> Login[Đăng nhập hệ thống]
    Login --> CheckRole{Vai trò người dùng?}
    
    CheckRole -->|Requester| CreateReq[Điền form xin cấp Khóa/Cert]
    CreateReq --> ValPolicy{Tham số hợp lệ với Policy?}
    ValPolicy -->|Không| ShowErr[Báo lỗi vi phạm chính sách]
    ShowErr --> CreateReq
    ValPolicy -->|Hợp lệ| SaveReq[Lưu đơn PENDING]
    SaveReq --> PushNoti[Gửi thông báo tới Approver phòng ban]
    
    CheckRole -->|Approver| ViewQueue[Xem Hàng đợi duyệt phòng ban]
    PushNoti --> ViewQueue
    ViewQueue --> OpenDetail[Mở chi tiết đơn yêu cầu]
    OpenDetail --> CheckSoD{Người duyệt trùng người tạo?}
    CheckSoD -->|Trùng SoD| BlockApprove[Vô hiệu hóa nút duyệt - Báo lỗi SoD]
    CheckSoD -->|Khác người tạo| Decision{Quyết định duyệt?}
    
    Decision -->|Từ chối| RejectReq[Nhập lời phê từ chối -> REJECTED]
    RejectReq --> NotiReject[Gửi thông báo từ chối cho Requester]
    NotiReject --> End([Kết thúc])
    
    Decision -->|Đồng ý| ApproveReq[Cập nhật APPROVED]
    ApproveReq --> WorkerGen[Worker sinh Khóa ngầm]
    WorkerGen --> SaveAsset[Lưu crypto_assets trạng thái ACTIVE]
    SaveAsset --> CompleteReq[Cập nhật đơn COMPLETED]
    CompleteReq --> NotiSuccess[Gửi thông báo thành công cho Requester]
    NotiSuccess --> DownloadKey[Requester tải Public Key PEM]
    DownloadKey --> End
```
*Hình 3.9: Sơ đồ Hoạt động luồng xử lý đơn cấp phát và phê duyệt*

---

## V. Sơ đồ lớp (Class Diagram)

```mermaid
classDiagram
    class User {
        +UUID id
        +string email
        +string displayName
        +string status
        +boolean mustChangePassword
        +login(password)
        +changePassword(newPass)
    }

    class Department {
        +UUID id
        +string code
        +string name
    }

    class Role {
        +string name
        +string description
    }

    class ApproverScope {
        +UUID id
        +UUID userId
        +UUID departmentId
    }

    class CryptoAsset {
        +UUID id
        +string assetCode
        +string type
        +string status
        +string algorithm
        +DateTime expiresAt
        +downloadPublicKey()
    }

    class Request {
        +UUID id
        +string type
        +string status
        +string reason
        +JSON parameters
        +boolean emergency
        +cancel()
    }

    class RequestDecision {
        +UUID id
        +string decision
        +string comment
        +DateTime decidedAt
    }

    class PolicyVersion {
        +UUID id
        +int version
        +string algorithm
        +int maxValidityDays
        +boolean isActive
    }

    class AuditLog {
        +UUID id
        +string action
        +string status
        +JSON details
        +DateTime createdAt
    }

    class Notification {
        +UUID id
        +string type
        +string channel
        +DateTime readAt
        +markAsRead()
    }

    User "1" --> "*" CryptoAsset : owns
    User "*" --> "1" Department : belongs to
    User "*" --> "*" Role : has
    User "1" --> "*" ApproverScope : manages
    Department "1" <-- "*" ApproverScope : scoped in
    User "1" --> "*" Request : creates
    Request "1" --> "0..1" RequestDecision : evaluated by
    ApproverScope ..> Request : filters queue
    PolicyVersion "1" <-- "*" CryptoAsset : governed by
    CryptoAsset "1" <-- "*" Notification : notifies about
    User "1" --> "*" AuditLog : acts in
```
*Hình 3.10: Sơ đồ Lớp miền nghiệp vụ (Domain Class Diagram)*

---

## VI. Thiết kế Cơ sở Dữ liệu

### 1. Mô hình Thực thể Liên kết (ERD)

```mermaid
erDiagram
    DEPARTMENTS ||--o{ USERS : "thuộc về"
    USERS ||--o{ USER_ROLES : "gán vai trò"
    ROLES ||--o{ USER_ROLES : "định nghĩa"
    USERS ||--o{ APPROVER_SCOPES : "quản lý duyệt"
    DEPARTMENTS ||--o{ APPROVER_SCOPES : "phạm vi duyệt"
    
    USERS ||--o{ CRYPTO_ASSETS : "sở hữu"
    DEPARTMENTS ||--o{ CRYPTO_ASSETS : "quản lý tài sản"
    POLICY_VERSIONS ||--o{ CRYPTO_ASSETS : "áp dụng chính sách"
    CRYPTO_ASSETS ||--o| CRYPTOGRAPHIC_KEYS : "chi tiết khóa"
    CRYPTO_ASSETS ||--o| CERTIFICATES : "chi tiết chứng chỉ"
    CRYPTO_ASSETS ||--o| CERTIFICATES : "public_key_asset_id"
    CRYPTO_ASSETS ||--o| CRYPTO_ASSETS : "replaces_asset_id"
    
    USERS ||--o{ REQUESTS : "tạo đơn"
    DEPARTMENTS ||--o{ REQUESTS : "thuộc phòng ban"
    CRYPTO_ASSETS ||--o{ REQUESTS : "tài sản mục tiêu"
    REQUESTS ||--o| REQUEST_DECISIONS : "kết quả duyệt"
    USERS ||--o{ REQUEST_DECISIONS : "người phê duyệt"
    
    USERS ||--o{ AUDIT_LOGS : "thực hiện"
    USERS ||--o{ NOTIFICATIONS : "nhận thông báo"
```
*Hình 3.11: Sơ đồ Thực thể Liên kết CSDL (ERD)*

### 2. Cấu trúc chi tiết các bảng cơ sở dữ liệu quan trọng

#### Bảng `users` (Quản lý tài khoản)
- `id` (UUID, PK): Mã người dùng duy nhất.
- `email` (VARCHAR(255), UNIQUE, NOT NULL): Tên đăng nhập email.
- `password_hash` (VARCHAR(255), NOT NULL): Mật khẩu băm Bcrypt.
- `display_name` (VARCHAR(120), NOT NULL): Họ và tên hiển thị.
- `department_id` (UUID, FK `departments.id`): Phòng ban trực thuộc.
- `status` (VARCHAR(20), CHECK `ACTIVE`, `INACTIVE`): Trạng thái hoạt động.
- `must_change_password` (BOOLEAN, DEFAULT TRUE): Cờ ép đổi mật khẩu lần đầu.
- `failed_login_attempts` (INT, DEFAULT 0): Số lần thử sai liên tiếp.
- `lockout_until` (TIMESTAMPTZ, NULL): Hạn khóa tài khoản nếu vượt ngưỡng 10 lần.
- `token_version` (INT, DEFAULT 1): Số hiệu phiên dùng để thu hồi token hàng loạt.

#### Bảng `crypto_assets` (Siêu dữ liệu tài sản mật mã)
- `id` (UUID, PK): Mã tài sản duy nhất.
- `asset_code` (VARCHAR(64), UNIQUE, NOT NULL): Mã tài sản định dạng chuẩn (ví dụ: `KEY-2026-001`).
- `name` (VARCHAR(150), NOT NULL): Tên mô tả tài sản.
- `type` (VARCHAR(30), CHECK `KEY_PAIR`, `SYMMETRIC_KEY`, `CERTIFICATE`): Loại tài sản.
- `status` (VARCHAR(30), CHECK `ACTIVE`, `EXPIRING_SOON`, `EXPIRED`, `REVOKED`, `SUPERSEDED`): Trạng thái tài sản.
- `algorithm` (VARCHAR(40), NOT NULL): Thuật toán mật mã (ví dụ: `RSA_4096`, `AES_256_GCM`).
- `owner_id` (UUID, FK `users.id`): Chủ sở hữu tài sản.
- `department_id` (UUID, FK `departments.id`): Phòng ban sở hữu.
- `policy_version_id` (UUID, FK `policy_versions.id`): Phiên bản chính sách áp dụng.
- `replaces_asset_id` (UUID, FK `crypto_assets.id`): Khóa cũ được thay thế (nếu gia hạn).
- `created_at, expires_at` (TIMESTAMPTZ, NOT NULL): Ngày cấp và ngày hết hạn.

#### Bảng `requests` (Đơn yêu cầu nghiệp vụ)
- `id` (UUID, PK): Mã đơn yêu cầu.
- `type` (VARCHAR(30), CHECK `CREATE`, `RENEW`, `REVOKE`): Loại đơn.
- `status` (VARCHAR(30), CHECK `PENDING`, `APPROVED`, `REJECTED`, `PROCESSING`, `COMPLETED`, `CANCELLED`): Trạng thái đơn.
- `creator_id` (UUID, FK `users.id`): Người nộp đơn.
- `department_id` (UUID, FK `departments.id`): Phòng ban nộp đơn.
- `target_asset_id` (UUID, FK `crypto_assets.id`): Tài sản cần gia hạn hoặc thu hồi.
- `reason` (TEXT, NOT NULL): Lý do nghiệp vụ.
- `parameters` (JSONB, NOT NULL): Tham số kỹ thuật (thuật toán, độ dài khóa, thời hạn).
- `emergency` (BOOLEAN, DEFAULT FALSE): Đánh dấu đơn khẩn cấp.

#### Bảng `audit_logs` (Nhật ký kiểm toán bất biến)
- `id` (UUID, PK): Mã bản ghi kiểm toán.
- `action` (VARCHAR(64), NOT NULL): Tên hành động (`AUTH_LOGIN`, `REQUEST_CREATED`, `EMERGENCY_REVOKE`,...).
- `actor_id` (UUID, FK `users.id`): Người thực hiện hành động.
- `resource_type` (VARCHAR(40), NOT NULL): Loại tài nguyên chịu tác động (`REQUEST`, `ASSET`, `POLICY`, `USER`).
- `resource_id` (VARCHAR(64), NULL): ID của tài nguyên.
- `status` (VARCHAR(20), CHECK `SUCCESS`, `FAILED`): Kết quả thực hiện.
- `details` (JSONB, NULL): Chi tiết thông số hoặc dữ liệu trước/sau.
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()): Dấu thời gian bất biến.

#### Bảng `notifications` (Thông báo ứng dụng In-app)
- `id` (UUID, PK): Mã thông báo.
- `recipient_id` (UUID, FK `users.id`): Người nhận.
- `type` (VARCHAR(40), CHECK): Loại thông báo (`REQUEST_SUBMITTED`, `REQUEST_APPROVED`, `REQUEST_REJECTED`, `ASSET_EXPIRING`, `ASSET_REVOKED`).
- `channel` (VARCHAR(20), CHECK `IN_APP`, `EMAIL`): Kênh truyền tải.
- `read_at` (TIMESTAMPTZ, NULL): Thời điểm đã đọc (NULL nếu chưa đọc).

### 3. Ràng buộc toàn vẹn & Triggers tầng CSDL
- **Trigger `trg_check_sod_rule`:** Kích hoạt trước khi ghi nhận vào `request_decisions`. Nếu `approver_id = requests.creator_id`, trigger sẽ chủ động ném ngoại lệ `RAISE EXCEPTION 'SOD_VIOLATION: Approver cannot approve own request'` để rollback toàn bộ transaction.
- **Trigger `trg_audit_log_immutable`:** Kích hoạt trước câu lệnh `UPDATE` hoặc `DELETE` trên bảng `audit_logs`. Trigger trả về ngoại lệ `AUDIT_LOG_IMMUTABLE`, cấm tuyệt đối mọi hành vi sửa xóa lịch sử kiểm toán.

---

<div style="page-break-after: always;"></div>

# CHƯƠNG IV. PHÁT TRIỂN / THỰC THI

Dưới đây là hình ảnh và đặc tả chi tiết các màn hình chức năng chính đã được nhóm chúng em xây dựng hoàn chỉnh và đang vận hành thực tế:

## I. Màn hình Đăng nhập & Đổi mật khẩu bắt buộc
- **Mô tả chức năng:** Cho phép người dùng đăng nhập bằng tài khoản email công ty. Hệ thống hiển thị sẵn danh sách tài khoản mẫu theo từng vai trò để thuận tiện kiểm thử. Khi đăng nhập bằng tài khoản được tạo mới hoặc reset mật khẩu, cờ `must_change_password = true` sẽ kích hoạt hộp thoại `PasswordChangeDialog` bắt buộc người dùng nhập mật khẩu mới trước khi truy cập ứng dụng.
- **Minh chứng giao diện:** *(Hình 4.1)*

## II. Màn hình Không gian làm việc cá nhân (User Dashboard)
- **Mô tả chức năng:** Dành cho nhân viên nghiệp vụ (vai trò USER như `dev.nguyen`). Cung cấp bảng thống kê số lượng tài sản sở hữu, thẻ cảnh báo nếu có chứng chỉ sắp hết hạn trong 30 ngày, bảng quản lý tài sản có bộ lọc trạng thái và nút "Tải xuống" để xuất Public Key dạng PEM. Phía dưới là danh sách các yêu cầu cấp phát gần đây kèm nút "Hủy đơn" đối với các yêu cầu đang ở trạng thái `PENDING`.
- **Minh chứng giao diện:** *(Hình 4.2)*

## III. Màn hình Hàng đợi duyệt phòng ban (Approval Queue) & Quyết định
- **Mô tả chức năng:** Dành cho Quản lý phòng ban (vai trò APPROVER như `it.manager`). Hệ thống tự động lọc và hiển thị danh sách các đơn chờ duyệt trong phạm vi phụ trách (`approver_scopes`). Màn hình hiển thị chi tiết thông tin người gửi, thuật toán, mục đích sử dụng. Phía dưới là thanh quyết định với 2 lựa chọn: "Từ chối" (mở modal nhập lý do) và "Phê duyệt yêu cầu" (tự động kích hoạt worker sinh khóa).
- **Minh chứng giao diện:** *(Hình 4.3)*

## IV. Màn hình Bảng thông báo nổi (Notification Popover)
- **Mô tả chức năng:** Được tích hợp trực tiếp vào biểu tượng quả chuông trên thanh Header. Khi có thông báo mới (yêu cầu được duyệt, đơn mới cần duyệt, tài sản sắp hết hạn), chuông hiển thị chấm đỏ cảnh báo (`.has-alert`). Khi bấm vào chuông, bảng `NotificationPopover` xổ xuống mượt mà hiển thị 15 tin mới nhất với icon phân loại màu sắc (Xanh: Duyệt; Đỏ: Từ chối/Thu hồi; Vàng: Sắp hết hạn). Có nút "Đánh dấu đã đọc" để xóa chấm đỏ tức thì.
- **Minh chứng giao diện:** *(Hình 4.4)*

## V. Màn hình Quản trị Chính sách & Thu hồi khẩn cấp
- **Mô tả chức năng:** Dành cho Giám đốc An toàn Thông tin (CISO) và Quản trị viên (`ciso@congty.com`). Cho phép tạo mới chính sách mật mã hoặc nâng cấp phiên bản (Policy Versioning v1/v2) siết chặt thời hạn sử dụng. Đặc biệt, CISO có thể chọn bất kỳ tài sản nào bị nghi ngờ rò rỉ khóa và nhấn nút "Thu hồi khẩn cấp" để lập tức chuyển trạng thái tài sản sang `REVOKED` mà không cần qua quy trình duyệt đơn.
- **Minh chứng giao diện:** *(Hình 4.5)*

## VI. Màn hình Nhật ký kiểm toán bất biến (Audit Logs)
- **Mô tả chức năng:** Cho phép Quản trị viên tra cứu toàn bộ vết thao tác trên hệ thống. Dữ liệu được sắp xếp theo dòng thời gian giảm dần, hiển thị rõ thời điểm, tác nhân, hành động (`AUTH_LOGIN`, `REQUEST_CREATED`, `EMERGENCY_REVOKE`), địa chỉ IP và kết quả thực thi (`SUCCESS`/`FAILED`). Có bộ lọc nhanh theo loại hành vi và kết quả.
- **Minh chứng giao diện:** *(Hình 4.6)*

---

<div style="page-break-after: always;"></div>

# CHƯƠNG V. TRIỂN KHAI

## I. Cài đặt

Bảng tổng hợp tình trạng cài đặt và mức độ hoàn thành các chức năng của hệ thống Cryta:

| STT | Chức năng hệ thống | Mức độ hoàn thành | Ghi chú kỹ thuật |
| :-: | :--- | :---: | :--- |
| **1** | Xác thực tài khoản (JWT, HttpOnly Refresh Cookie, Khóa sau 10 lần sai) | 100% | Bcrypt salt 10, HttpOnly Cookie, auto-reset thử sai |
| **2** | Đổi mật khẩu bắt buộc lần đầu (`must_change_password`) | 100% | Thu hồi phiên cũ qua tăng `token_version` |
| **3** | Tạo yêu cầu cấp mới Khóa/Chứng chỉ số (`CREATE`) | 100% | Tự động kiểm tra ràng buộc Policy Version ở backend |
| **4** | Yêu cầu Gia hạn tài sản (`RENEW`) | 100% | Tạo tài sản mới thay thế, liên kết `replaces_asset_id` |
| **5** | Yêu cầu Thu hồi tài sản thường (`REVOKE`) | 100% | Bắt buộc nhập lý do, chuyển trạng thái `REVOKED` |
| **6** | Hủy yêu cầu khi đang chờ duyệt (`CANCEL`) | 100% | Người tạo đơn có quyền hủy đơn `PENDING` |
| **7** | Xem tài sản cá nhân & Tải tệp Public Key/Cert PEM | 100% | Chỉ xem tài sản của mình, bảo vệ an toàn Private Key |
| **8** | Hàng đợi phê duyệt theo phòng ban (Approval Queue) | 100% | Lọc đơn chính xác theo `approver_scopes` |
| **9** | Phê duyệt / Từ chối yêu cầu kèm nhận xét | 100% | Lưu vết quyết định vào bảng `request_decisions` |
| **10** | Cơ chế kiểm soát Phân tách Trách nhiệm (SoD) | 100% | Ép buộc ở cả Backend Logic và Database Trigger |
| **11** | Worker ngầm sinh khóa và ghép nối Public Key Cert | 100% | Tự động sinh cặp khóa khi duyệt chứng chỉ số |
| **12** | Quản trị & Nâng cấp phiên bản Chính sách (Policy v1/v2) | 100% | Hỗ trợ tạo mới và versioning chính sách linh hoạt |
| **13** | Thu hồi Khẩn cấp tài sản trực tiếp (Emergency Revocation) | 100% | Dành riêng cho CISO/Admin, vô hiệu hóa tài sản tức thời |
| **14** | Bảng thông báo nổi (`NotificationPopover`) & Quả chuông | 100% | Hiển thị 15 tin mới, chấm đỏ cảnh báo, đánh dấu đã đọc |
| **15** | Nhật ký kiểm toán Bất biến (Audit Log Immutability) | 100% | Trigger CSDL cấm câu lệnh `UPDATE`/`DELETE` tuyệt đối |
| **16** | Quản lý Người dùng, Phòng ban & Phân luồng Scopes | 100% | Tạo user, khóa tài khoản `INACTIVE`, gán phạm vi duyệt |
| **17** | Job quét tự động tài sản sắp hết hạn & Tự động hết hạn | 100% | Cảnh báo trước 30 ngày, tự động chuyển `EXPIRED` |

---

## II. Thử nghiệm

### 1. Dữ liệu tài khoản thử nghiệm các chức năng
Mật khẩu chung cho tất cả các tài khoản demo: `Password@123`

| Tên đối tượng | Tài khoản (Email) | Vai trò (Role) | Phòng ban | Chức năng kiểm thử chính |
| :--- | :--- | :---: | :--- | :--- |
| **Requester (User 1)** | `dev.nguyen@congty.com` | `USER` | Phòng CNTT | Nộp đơn xin cấp khóa RSA, tải Public Key, xin gia hạn, hủy đơn `PENDING`. |
| **Requester (User 2)** | `kt.tran@congty.com` | `USER` | Phòng Tài chính | Nộp đơn xin cấp chứng chỉ số ký hóa đơn điện tử. |
| **Approver (Manager 1)**| `it.manager@congty.com` | `APPROVER` | Phòng CNTT | Duyệt đơn của phòng CNTT; Kiểm thử SoD không cho tự duyệt đơn của mình. |
| **Approver (Manager 2)**| `fin.manager@congty.com` | `APPROVER` | Phòng Tài chính | Duyệt đơn chứng chỉ của nhân viên phòng Kế toán. |
| **CISO / Security Admin**| `ciso@congty.com` | `ADMIN` | An toàn thông tin | Thu hồi khẩn cấp tài sản lộ khóa, ban hành Policy v2, soi Audit Log. |
| **System Admin** | `admin@congty.com` | `ADMIN` | Quản trị hệ thống | Tạo tài khoản mới, khóa user, gán Scopes duyệt phòng ban. |

### 2. Kết quả kiểm thử tự động thực chứng (Automated Testing Results)
Để đảm bảo chất lượng phần mềm khách quan và loại bỏ hoàn toàn lỗi logic, nhóm chúng em đã lập trình và thực thi 3 bộ kịch bản kiểm thử tự động toàn diện:

1. **Bộ kiểm thử API E2E toàn diện (`npm run test:e2e`):**
   - Kiểm thử tự động 8 phân hệ API lớn (Auth, Policies, Requests, SoD, Notifications, Audit, Quota, Lifecycle).
   - **Kết quả: 58/58 test cases PASSED (100%).**
2. **Bộ kiểm thử 15 Use Cases & 6 Quy trình nghiệp vụ (`npm run test:workflows`):**
   - Mô phỏng hành trình nghiệp vụ liên phòng ban: Gửi đơn $\rightarrow$ Duyệt SoD $\rightarrow$ Tự động sinh khóa ngầm $\rightarrow$ Thu hồi khẩn cấp $\rightarrow$ Quét hết hạn.
   - **Kết quả: 21/21 test cases PASSED (100%).**
3. **Bộ kiểm thử Chuông thông báo & Popover (`npm run test:notifications`):**
   - Kiểm thử vòng đời thông báo: Sinh tin khi tạo đơn, hiển thị chấm đỏ trên chuông, mở popover, đánh dấu đã đọc và xóa chấm đỏ.
   - **Kết quả: 20/20 test cases PASSED (100%).**

---

<div style="page-break-after: always;"></div>

# CHƯƠNG VI. KẾT LUẬN

## I. Kết quả đã thực hiện
Sau thời gian nghiêm túc nghiên cứu, phân tích và triển khai, nhóm chúng em đã hoàn thành toàn diện đề tài **"Hệ thống Quản lý Vòng đời Khóa Mã hóa và Chứng chỉ số Doanh nghiệp (Cryta)"**. Các kết quả chính đạt được bao gồm:
1. **Phân tích thiết kế hoàn chỉnh:** Xây dựng đầy đủ tài liệu phân tích hệ thống gồm 15 Use Cases, mô hình ERD chuẩn hóa, các sơ đồ tuần tự và sơ đồ máy trạng thái.
2. **Thực thi triệt để nguyên tắc SoD:** Đảm bảo tính minh bạch trong phê duyệt, ngăn chặn triệt để hành vi tự duyệt đơn ở cả 3 tầng (UI, Backend, Database Trigger).
3. **Hiện thực hóa tính năng Thu hồi Khẩn cấp:** Cung cấp công cụ hữu hiệu cho CISO vô hiệu hóa ngay lập tức các tài sản bị rò rỉ khóa mà không bị cản trở bởi thủ tục duyệt đơn.
4. **Nâng cao trải nghiệm người dùng với Bảng thông báo nổi:** Quả chuông trên Header cảnh báo tức thời tin chưa đọc, hỗ trợ thao tác đọc nhanh và điều hướng tiện lợi.
5. **Đảm bảo chất lượng bằng kiểm thử tự động:** Toàn bộ 15 Use Cases và 6 quy trình nghiệp vụ đều vượt qua các kịch bản kiểm thử tự động với tỷ lệ thành công 100%.

## II. Ưu khuyết điểm

### 1. Ưu điểm
- **Tính thực tiễn cao:** Đáp ứng chính xác nhu cầu quản trị tài sản mật mã đang rất cấp thiết tại các tổ chức, doanh nghiệp.
- **Kiến trúc phân tầng sạch sẽ:** Backend NestJS dạng modular, dễ bảo trì và mở rộng; Frontend React thiết kế component hóa rõ ràng.
- **Bảo mật đa lớp:** Mật khẩu mã hóa Bcrypt, phiên làm việc an toàn với JWT và HttpOnly Cookie, bảo vệ toàn vẹn bằng Database Triggers.

### 2. Khuyết điểm / Điểm hạn chế
- **Mô phỏng vật liệu khóa:** Hiện tại hệ thống đang quản lý vật liệu khóa thông qua bộ điều hợp mô phỏng (Mock Crypto Provider), chưa tích hợp thiết bị phần cứng bảo mật chuyên dụng ngoài đời thực.
- **Xác thực đa yếu tố:** Chưa tích hợp xác thực 2 bước (MFA/OTP qua điện thoại) đối với các thao tác đặc biệt nhạy cảm như thu hồi khẩn cấp.

## III. Hướng mở rộng trong tương lai
- **Kết nối Thiết bị Bảo mật Phần cứng (HSM):** Tích hợp với các thiết bị HSM vật lý hoặc dịch vụ quản lý khóa đám mây (AWS KMS, HashiCorp Vault) đạt chuẩn FIPS 140-2 Level 3 để bảo vệ Private Key an toàn tuyệt đối.
- **Hỗ trợ Giao thức ACME (Automatic Certificate Management Environment):** Tự động phát hành và gia hạn chứng chỉ SSL cho các máy chủ web (Nginx/Apache) tương tự cơ chế của Let's Encrypt.
- **Ứng dụng Blockchain / Hash-chain:** Xâu chuỗi các bản ghi nhật ký kiểm toán bằng hàm băm mật mã (Hash-chain) để hỗ trợ kiểm toán độc lập từ bên thứ ba.

---

# TÀI LIỆU THAM KHẢO

1. **Barker, E. (2020).** *Recommendation for Key Management: Part 1 – General* (NIST Special Publication 800-57 Part 1 Rev. 5). National Institute of Standards and Technology.
2. **Cooper, D., Santesson, S., Farrell, S., Boeyen, S., Housley, R., & Polk, W. (2008).** *Internet X.509 Public Key Infrastructure Certificate and Certificate Revocation List (CRL) Profile* (RFC 5280). Internet Engineering Task Force (IETF).
3. **International Organization for Standardization. (2022).** *Information security, cybersecurity and privacy protection — Information security management systems — Requirements* (ISO/IEC 27001:2022).
4. **NestJS Framework Documentation. (2026).** *Architecture, Dependency Injection, Modules & Guards*. Truy cập từ: https://docs.nestjs.com/
5. **PostgreSQL Global Development Group. (2026).** *PostgreSQL 16 Documentation: Triggers, Constraints & Transaction Isolation*. Truy cập từ: https://www.postgresql.org/docs/
6. **React Documentation. (2026).** *React 19 Components, State & Hooks*. Truy cập từ: https://react.dev/
