# SƠ ĐỒ HỆ THỐNG TỔNG QUÁT

## Hệ thống quản lý khóa mã hóa và chứng thư số

> Tài liệu mô tả kiến trúc tổng quát, các thành phần, luồng dữ liệu và cách triển khai của hệ thống.

---

## 1. Bối cảnh hệ thống

Hệ thống là nền tảng trung tâm kết nối người dùng nghiệp vụ với dịch vụ quản lý khóa/chứng thư. Frontend không trực tiếp truy cập database hoặc Crypto Provider. Mọi thao tác đều đi qua backend để kiểm tra authentication, authorization, policy và ghi Audit Log.

### Sơ đồ ngữ cảnh

```mermaid
flowchart LR
    U["User / Employee"] -->|"Yêu cầu cấp mới, gia hạn, thu hồi"| S["Hệ thống quản lý khóa và chứng thư"]
    S -->|"Tài sản, trạng thái, thông báo"| U

    A["Approver / Manager"] -->|"Phê duyệt hoặc từ chối"| S
    S -->|"Hàng đợi yêu cầu"| A

    AD["Security Admin"] -->|"Policy, RBAC, cấu hình"| S
    S -->|"Dashboard, tài sản, Audit Log"| AD

    S -->|"Lệnh provision/renew/revoke"| CP["Crypto Provider / Vault / KMS"]
    CP -->|"Metadata và kết quả"| S

    S -->|"Thông báo"| ES["Email Service / MailHog"]
```

---

## 2. Kiến trúc logic tổng quát

```mermaid
flowchart TB
    B["Trình duyệt người dùng"] -->|"HTTPS"| FE["React Frontend"]
    FE -->|"REST/JSON + Access Token"| API["Node.js Backend API"]

    subgraph APP["Application Layer"]
        AUTH["Authentication & Session"]
        IAM["RBAC, Scope & SoD"]
        REQ["Request Workflow"]
        APR["Approval Service"]
        ASSET["Asset Lifecycle"]
        POLICY["Policy Engine"]
        AUDIT["Audit Service"]
        NOTI["Notification Service"]
        JOB["Scheduler & Worker"]
        ADAPTER["Crypto Provider Adapter"]
    end

    API --> AUTH
    API --> IAM
    API --> REQ
    API --> APR
    API --> ASSET
    API --> POLICY
    API --> AUDIT
    API --> NOTI

    AUTH --> DB[("PostgreSQL")]
    IAM --> DB
    REQ --> DB
    APR --> DB
    ASSET --> DB
    POLICY --> DB
    AUDIT --> DB
    NOTI --> DB

    API --> QUEUE[("Redis / Job Queue")]
    JOB --> QUEUE
    JOB --> DB
    JOB --> ADAPTER
    ADAPTER --> PROVIDER["Mock Provider / Vault / KMS / CA"]
    NOTI --> MAIL["SMTP / MailHog"]
```

---

## 3. Chức năng của từng lớp

### 3.1. Presentation Layer — React Frontend

- Hiển thị giao diện theo vai trò.
- Thu thập và kiểm tra dữ liệu nhập cơ bản.
- Gọi REST API của backend.
- Hiển thị dashboard, danh sách, form, timeline và thông báo.
- Không chứa quy tắc bảo mật mang tính quyết định.
- Không truy cập trực tiếp database hoặc private key.

### 3.2. Application Layer — Node.js Backend

- Xác thực người dùng và quản lý phiên.
- Kiểm tra role, permission và phạm vi dữ liệu.
- Thực thi quy tắc SoD.
- Điều phối workflow cấp mới, gia hạn và thu hồi.
- Kiểm tra yêu cầu với policy hiện hành.
- Ghi Audit Log và tạo notification.
- Cung cấp API cho frontend.

### 3.3. Data Layer — PostgreSQL

- Lưu tài khoản, vai trò và phòng ban.
- Lưu metadata của khóa/chứng thư.
- Lưu request, quyết định và lịch sử trạng thái.
- Lưu phiên bản policy.
- Lưu notification và Audit Log.
- Không lưu private key dưới dạng rõ.

### 3.4. Processing Layer — Scheduler, Queue và Worker

- Xử lý cấp phát sau khi request được duyệt.
- Retry các tác vụ provider/email bị lỗi.
- Quét tài sản sắp hết hạn.
- Chuyển trạng thái tài sản sang `EXPIRED`.
- Gửi cảnh báo theo policy.
- Tách xử lý dài khỏi request/response của API.

### 3.5. Integration Layer — Crypto Provider Adapter

- Cung cấp giao diện thống nhất cho `provision`, `renew`, `revoke` và `getStatus`.
- MVP dùng Mock Provider để demo offline.
- Có thể thay adapter bằng Vault, KMS hoặc CA thật trong tương lai.
- Backend chỉ lưu `provider_reference` và metadata an toàn.

---

## 4. Sơ đồ module backend

```mermaid
flowchart LR
    API["API Controllers"] --> AUTH["Auth"]
    API --> USERS["Users"]
    API --> REQUESTS["Requests"]
    API --> APPROVALS["Approvals"]
    API --> ASSETS["Assets"]
    API --> POLICIES["Policies"]
    API --> AUDIT["Audit"]
    API --> NOTIFICATIONS["Notifications"]

    AUTH --> IAM["IAM Guards"]
    USERS --> IAM
    REQUESTS --> IAM
    APPROVALS --> IAM
    ASSETS --> IAM
    POLICIES --> IAM

    REQUESTS --> POLICIES
    APPROVALS --> REQUESTS
    APPROVALS --> OUTBOX["Outbox / Queue"]
    OUTBOX --> WORKER["Provisioning Worker"]
    WORKER --> PROVIDER["Crypto Provider Adapter"]
    WORKER --> ASSETS

    AUTH --> AUDIT
    USERS --> AUDIT
    REQUESTS --> AUDIT
    APPROVALS --> AUDIT
    ASSETS --> AUDIT
    POLICIES --> AUDIT
```

### Trách nhiệm module

| Module | Trách nhiệm chính |
|---|---|
| Auth | Login, refresh token, logout và session |
| IAM | RBAC, object scope và SoD guard |
| Users | Hồ sơ, trạng thái tài khoản, vai trò, phòng ban |
| Requests | Tạo, submit, cancel và truy vấn request |
| Approvals | Approve/reject nguyên tử và chống duyệt đồng thời |
| Assets | Quản lý metadata và vòng đời tài sản |
| Policies | Versioning và kiểm tra thuật toán/thời hạn |
| Audit | Ghi sự kiện append-only và che dữ liệu nhạy cảm |
| Notifications | Thông báo trong ứng dụng và email |
| Jobs | Expiry scan, reminder, provisioning và retry |
| Crypto Provider | Kết nối mock/Vault/KMS/CA |

---

## 5. Kiến trúc dữ liệu tổng quát

```mermaid
erDiagram
    DEPARTMENTS ||--o{ USERS : contains
    USERS ||--o{ USER_ROLES : assigned
    ROLES ||--o{ USER_ROLES : includes
    USERS ||--o{ APPROVER_SCOPES : has
    DEPARTMENTS ||--o{ APPROVER_SCOPES : scopes

    USERS ||--o{ CRYPTO_ASSETS : owns
    DEPARTMENTS ||--o{ CRYPTO_ASSETS : groups
    CRYPTO_ASSETS ||--o| CRYPTOGRAPHIC_KEYS : key_detail
    CRYPTO_ASSETS ||--o| CERTIFICATES : certificate_detail
    CRYPTO_ASSETS o|--o{ CRYPTO_ASSETS : replaces

    USERS ||--o{ REQUESTS : creates
    CRYPTO_ASSETS o|--o{ REQUESTS : targets
    REQUESTS ||--o{ REQUEST_DECISIONS : receives
    USERS ||--o{ REQUEST_DECISIONS : decides

    POLICIES ||--o{ POLICY_VERSIONS : versions
    USERS o|--o{ AUDIT_LOGS : acts
    USERS ||--o{ NOTIFICATIONS : receives
    CRYPTO_ASSETS o|--o{ NOTIFICATIONS : concerns
```

### Nhóm bảng chính

| Nhóm | Bảng tiêu biểu | Mục đích |
|---|---|---|
| Danh tính | `users`, `roles`, `user_roles`, `departments` | Tài khoản và phân quyền |
| Tài sản | `crypto_assets`, `cryptographic_keys`, `certificates` | Metadata khóa/chứng thư |
| Workflow | `requests`, `request_decisions` | Yêu cầu và quyết định |
| Chính sách | `policies`, `policy_versions` | Quy tắc có phiên bản |
| Hệ thống | `audit_logs`, `notifications`, `sessions` | Kiểm toán, thông báo và phiên |

---

## 6. Luồng dữ liệu chính

```mermaid
flowchart TD
    INPUT["Dữ liệu đầu vào<br/>User, request, policy"] --> VALIDATE["Xác thực và kiểm tra quyền"]
    VALIDATE --> PROCESS["Xử lý workflow và quyết định"]
    PROCESS --> PROVIDER["Thực thi qua Crypto Provider"]
    PROVIDER --> STORE["Lưu metadata và trạng thái"]
    STORE --> OUTPUT["Dashboard, thông báo, báo cáo"]
    VALIDATE --> AUDIT["Audit Log"]
    PROCESS --> AUDIT
    PROVIDER --> AUDIT
    STORE --> AUDIT
```

Luồng này thể hiện đặc trưng của một Hệ thống thông tin: dữ liệu đầu vào được kiểm tra, xử lý thành thông tin trạng thái, sau đó hỗ trợ phê duyệt, quản trị và kiểm toán.

---

## 7. Ranh giới tin cậy và bảo mật

```mermaid
flowchart LR
    subgraph Z1["Vùng không tin cậy"]
        B["Browser và dữ liệu nhập"]
    end

    subgraph Z2["Vùng ứng dụng"]
        FE["React Frontend"]
        API["Node.js API"]
        W["Background Worker"]
    end

    subgraph Z3["Vùng dữ liệu"]
        DB[("PostgreSQL")]
        R[("Redis")]
    end

    subgraph Z4["Vùng bí mật/mật mã"]
        KMS["Vault / KMS / HSM"]
    end

    B -->|"Validate input"| FE
    FE -->|"TLS + access token"| API
    API -->|"Least-privilege account"| DB
    API --> R
    W --> DB
    W --> R
    W -->|"Service identity"| KMS
```

Các kiểm soát chính:

- HTTPS giữa client và server.
- Mật khẩu được hash mạnh.
- Access token ngắn hạn và refresh token rotation.
- Backend kiểm tra RBAC, scope và SoD.
- Database account theo nguyên tắc quyền tối thiểu.
- Private key nằm trong provider, không nằm rõ trong PostgreSQL.
- Audit Log append-only.
- Secret không được commit vào Git.

---

## 8. Sơ đồ triển khai đề xuất

```mermaid
flowchart LR
    USER["Trình duyệt"] --> RP["Reverse Proxy"]
    RP --> WEB["React Static App"]
    RP --> API["Node.js API Container"]

    API --> PG[("PostgreSQL Container")]
    API --> REDIS[("Redis Container")]

    WORKER["Node.js Worker Container"] --> PG
    WORKER --> REDIS
    WORKER --> MAIL["MailHog Container"]
    WORKER --> MOCK["Mock Crypto Provider"]
```

### Các container trong môi trường demo

| Container | Chức năng |
|---|---|
| Reverse Proxy | Phân phối frontend và chuyển `/api` về backend |
| Web | Chứa React production build |
| API | Phục vụ REST API và authentication |
| Worker | Chạy provisioning, notification và expiry job |
| PostgreSQL | Database chính |
| Redis | Queue, lock và job state |
| MailHog | Hộp thư local để trình diễn email |
| Mock Provider | Mô phỏng cấp phát/gia hạn/thu hồi |

---

## 9. Công nghệ đề xuất

| Thành phần | Công nghệ |
|---|---|
| Frontend | React, TypeScript, Vite, React Router, TanStack Query |
| Backend | Node.js, TypeScript, NestJS hoặc Express có module rõ ràng |
| Database | PostgreSQL |
| ORM | Prisma hoặc TypeORM |
| Authentication | JWT access token + refresh session |
| Background Job | BullMQ + Redis; MVP đơn giản có thể dùng node-cron |
| API Documentation | OpenAPI/Swagger |
| Email demo | MailHog |
| Key/Certificate demo | Mock Crypto Provider |
| Đóng gói | Docker Compose |

---

## 10. Nguyên tắc kiến trúc cần giữ

1. Frontend không phải lớp bảo mật cuối cùng.
2. Không cho phép CRUD trạng thái tài sản tùy ý.
3. Mọi state transition đi qua service nghiệp vụ.
4. Approval dùng transaction để tránh xung đột.
5. Mọi thao tác nhạy cảm tạo Audit Log.
6. Job phải idempotent và có cơ chế retry.
7. Private key không xuất hiện trong database, source code hoặc log.
8. Provider được trừu tượng hóa để MVP dùng mock nhưng vẫn mở rộng được.

---

## 11. Tóm tắt kiến trúc

Hệ thống sử dụng kiến trúc web nhiều lớp:

```text
Người dùng
    ↓
React Frontend
    ↓
Node.js Backend
    ↓
Nghiệp vụ + RBAC + Policy + Audit
    ↓
PostgreSQL / Redis / Worker
    ↓
Crypto Provider và Email Service
```

Cách chia lớp này giúp hệ thống dễ phát triển, kiểm thử, trình diễn và mở rộng mà vẫn duy trì được kiểm soát bảo mật.

