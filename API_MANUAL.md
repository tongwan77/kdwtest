# API 사용 매뉴얼

급식소 식자재 재고관리 시스템의 REST API 문서입니다. (기준: 현재 코드 `api.js`)

## 공통 사항

- **Base URL**: `http://localhost:8787` (배포 환경에 맞게 변경)
- **인증 방식**: 쿠키 기반 세션. `POST /api/auth/login` 성공 시 `session` 쿠키(HttpOnly, 8시간 만료)가 발급되며, 이후 모든 요청에 이 쿠키가 자동 포함되어야 합니다. (브라우저는 자동 전송, curl은 `-b/-c` 옵션 사용)
- **요청 형식**: JSON (`Content-Type: application/json`)
- **응답 형식**: JSON. 성공 시 `{ ... }` 또는 `{ items: [...] }`, 실패 시 `{ "error": "메시지" }`
- **날짜 형식**: `YYYY-MM-DD`
- **권한 구분**
  - 🔓 인증 불필요
  - 🔑 로그인 필요 (최고관리자·영양사 공통)
  - 👑 최고관리자 전용
- 매장이 필요한 조회/등록 요청은 **본인이 담당하는 매장인지 서버가 항상 재검증**하며, 담당 매장이 아니면 `403`을 반환합니다. 최고관리자는 모든 매장에 접근 가능합니다.

## 오류 응답 공통 형식

```json
{ "error": "사람이 읽을 수 있는 오류 메시지" }
```

| 상태코드 | 의미 |
|---|---|
| 400 | 잘못된 요청(필수값 누락, 유효성 위반 등) |
| 401 | 로그인 필요 |
| 403 | 권한 없음 (최고관리자 전용 API, 또는 담당 매장 아님) |
| 404 | 대상 없음 |

---

## 1. 인증 (Auth)

### 🔓 `POST /api/auth/login` — 로그인
```json
// Request
{ "username": "admin", "password": "Admin!2024" }
```
```json
// Response 200
{ "user": { "id": 1, "username": "admin", "name": "최고관리자", "role": "SUPER_ADMIN", "must_reset": 0 } }
```
실패 시 `401 { "error": "아이디 또는 비밀번호가 올바르지 않습니다." }`. 로그인 성공/실패 모두 `auth_logs`에 기록됩니다.

### 🔑 `POST /api/auth/logout` — 로그아웃
요청 본문 없음. 세션을 무효화하고 `auth_logs`에 로그아웃 이벤트를 기록합니다.
```json
// Response 200
{ "ok": true }
```

### 🔑 `GET /api/auth/me` — 현재 로그인 사용자 정보
```json
// Response 200
{ "user": { "id": 2, "username": "nutri1", "name": "김영양", "role": "NUTRITIONIST", "is_active": 1 } }
```
로그인하지 않은 경우 `401`.

### 🔑 `POST /api/password-reset-requests` — 비밀번호 재발급 요청 (본인)
영양사/관리자 본인이 비밀번호를 잊었을 때 요청을 등록합니다. **본인이 직접 비밀번호를 바꿀 수는 없으며**, 관리자가 처리해야 합니다. 요청 본문 없음.
```json
// Response 200
{ "ok": true }
```

---

## 2. 관리자 — 영양사 계정 관리 (👑 전체)

### `GET /api/admin/nutritionists` — 영양사 목록
```json
// Response 200
{ "items": [
  { "id": 2, "username": "nutri1", "name": "김영양", "is_active": 1, "created_at": "...",
    "stores": [ { "id": 1, "store_code": "ST001", "store_name": "본원 급식소" } ] }
]}
```

### `POST /api/admin/nutritionists` — 영양사 계정 발급
```json
// Request
{ "username": "nutri1", "name": "김영양", "password": "초기비밀번호(6자+)", "store_ids": [1, 2] }
```
`store_ids`는 담당 매장(복수 가능) id 배열. 아이디 중복 시 `400`.
```json
// Response 201
{ "id": 2 }
```

### `PUT /api/admin/nutritionists/:id` — 영양사 정보 수정 (이름/상태/담당매장)
```json
// Request (모두 선택적)
{ "name": "김영양2", "is_active": true, "store_ids": [1] }
```
`store_ids`를 보내면 기존 담당 매장을 전부 교체합니다.
```json
// Response 200
{ "ok": true }
```

### `DELETE /api/admin/nutritionists/:id` — 영양사 계정 삭제
```json
// Response 200
{ "ok": true }
```

### `POST /api/admin/nutritionists/:id/reset-password` — 비밀번호 재발급(관리자가 처리)
```json
// Request
{ "new_password": "새비밀번호(6자+)" }
```
해당 계정의 대기중(`PENDING`) 재발급 요청이 있다면 자동으로 `DONE` 처리됩니다.
```json
// Response 200
{ "ok": true }
```

### `GET /api/admin/password-reset-requests` — 비밀번호 재발급 요청함 조회
```json
// Response 200
{ "items": [
  { "id": 1, "status": "PENDING", "requested_at": "...", "resolved_at": null, "user_id": 2, "username": "nutri1", "name": "김영양" }
]}
```

---

## 3. 관리자 — 매장 관리 (👑, 공통코드 성격)

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/admin/stores` | 전체 매장 목록 (비활성 포함) |
| POST | `/api/admin/stores` | 매장 등록 `{ "store_code": "ST003", "store_name": "제3매장" }` |
| PUT | `/api/admin/stores/:id` | 매장 수정 `{ "store_code"?, "store_name"?, "is_active"? }` |
| DELETE | `/api/admin/stores/:id` | 매장 비활성화(논리 삭제) |

---

## 4. 관리자 — 공통코드 관리 (👑)

품질상태(`QUALITY_STATUS`), 포장상태(`PACKAGE_STATUS`) 등 드롭다운 값을 관리합니다.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/admin/common-codes?group=QUALITY_STATUS` | 코드 목록 (group 생략 시 전체) |
| POST | `/api/admin/common-codes` | `{ "group_code": "QUALITY_STATUS", "code": "GOOD", "label": "양호", "sort_order": 1 }` |
| PUT | `/api/admin/common-codes/:id` | `{ "label"?, "sort_order"?, "is_active"? }` |
| DELETE | `/api/admin/common-codes/:id` | 비활성화 |

기본 시드값: `QUALITY_STATUS` = 양호/불량/누락/파손/기타, `PACKAGE_STATUS` = 정상/파손/개봉됨/기타

---

## 5. 품목 마스터 (매장별 등록)

품목은 **매장(store_id)에 종속**됩니다. 유니크 키는 `(store_id, item_code, item_name)`이며, **동일한 품명코드는 어느 매장에서 등록하든 항상 같은 품명을 가져야 합니다.**

### 👑 `GET /api/admin/items?store_id=1` — 품목 목록 (store_id 생략 시 전체 매장)
```json
{ "items": [
  { "id": 1, "store_id": 1, "store_name": "본원 급식소", "store_code": "ST001",
    "item_code": "IT001", "item_name": "양파", "large_category": null, "mid_category": null,
    "small_category": null, "spec": null, "purchase_unit": "kg", "source": "MANUAL", "is_active": 1 }
]}
```

### 👑 `GET /api/admin/items/lookup?item_code=IT001` — 품명코드로 기존 품명 조회
다른 매장에 이미 등록된 코드인지 확인할 때 사용(화면에서 품명 자동고정에 사용).
```json
{ "item_name": "양파" }   // 없으면 { "item_name": null }
```

### 👑 `POST /api/admin/items` — 품목 등록
```json
{ "store_id": 1, "item_code": "IT001", "item_name": "양파",
  "large_category": "채소", "mid_category": null, "small_category": null,
  "spec": null, "purchase_unit": "kg" }
```
검증 규칙:
- 같은 매장에 동일 `item_code`가 이미 있으면 `400` (해당 매장에 이미 존재)
- 다른 매장에 동일 `item_code`가 있는데 `item_name`이 다르면 `400` (품명 불일치)

### 👑 `PUT /api/admin/items/:id` — 품목 수정
```json
{ "item_name"?, "large_category"?, "mid_category"?, "small_category"?, "spec"?, "purchase_unit"?, "is_active"? }
```
`item_name`을 변경하면 **동일 품명코드를 쓰는 다른 매장의 품목명도 자동으로 함께 동기화**됩니다.
```json
// Response 200
{ "ok": true, "syncedStores": 2 }   // 함께 동기화된 다른 매장 품목 수
```

### 👑 `DELETE /api/admin/items/:id` — 품목 비활성화

### 🔓 `POST /api/integration/items` — 외부 시스템 연동(품목 일괄 등록/갱신)
매장코드(`store_code`)로 대상 매장을 식별합니다. 단건 또는 배열(`items`) 모두 지원.
```json
// Request
{ "items": [
  { "store_code": "ST001", "item_code": "IT002", "item_name": "감자",
    "large_category": "채소", "mid_category": "구근류", "small_category": null,
    "spec": "20kg 박스", "purchase_unit": "kg" },
  { "store_code": "ST002", "item_code": "IT002", "item_name": "감자" }
]}
```
```json
// Response 200
{ "ok": true, "processed": 2, "skipped": [
  { "item_code": "IT099", "reason": "매장코드(NOPE)를 찾을 수 없음" }
]}
```
`skipped` 사유: 필수값 누락 / 매장코드 없음 / 이미 등록된 품명코드와 품명 불일치.

> ⚠️ 시연용으로 별도 인증 없이 열려 있습니다. 운영 환경에서는 API Key 등 인증을 추가하세요.

---

## 6. 거래처 마스터

### 👑 관리자 CRUD

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/admin/vendors` | 거래처 목록 |
| POST | `/api/admin/vendors` | `{ "vendor_code": "V001", "vendor_name": "신선식품(주)" }` |
| PUT | `/api/admin/vendors/:id` | `{ "vendor_name"?, "is_active"? }` |
| DELETE | `/api/admin/vendors/:id` | 비활성화 |

### 🔓 `POST /api/integration/vendors` — 외부 연동(거래처 일괄 upsert)
```json
{ "vendors": [ { "vendor_code": "V002", "vendor_name": "청과마트" } ] }
```
```json
{ "ok": true, "processed": 1 }
```

---

## 7. 기초재고 (👑 전용)

시스템 도입 시점 재고. 기본값 0이며, 이후 재고 = 기초재고 + 입고누계 − 출고누계로 자동 계산됩니다.

### `GET /api/admin/initial-stock?store_id=1`
```json
{ "items": [
  { "id": 1, "store_id": 1, "store_name": "본원 급식소", "item_id": 1,
    "item_code": "IT001", "item_name": "양파", "quantity": 50, "set_at": "..." }
]}
```

### `POST /api/admin/initial-stock` — 등록/수정(upsert)
```json
{ "store_id": 1, "item_id": 1, "quantity": 50 }
```
`item_id`가 `store_id`에 등록된 품목이 아니면 `400`.

---

## 8. 공통 드롭다운 조회 (🔑 로그인한 모든 사용자)

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/stores` | 내가 접근 가능한 매장 목록 (영양사는 담당 매장만, 관리자는 전체) |
| GET | `/api/items?store_id=1` | **특정 매장**의 활성 품목 목록 (store_id 필수) |
| GET | `/api/vendors` | 활성 거래처 목록 (전체 공통) |
| GET | `/api/common-codes?group=QUALITY_STATUS` | 활성 공통코드 목록 |

---

## 9. 입고관리

### 🔑 `GET /api/inbound` — 입고 내역 조회
쿼리 파라미터(모두 선택): `store_id`, `item_id`, `vendor_id`, `quality_status`, `date_from`, `date_to`, `keyword`(품명/품명코드 검색)
```
GET /api/inbound?store_id=1&date_from=2026-07-01&date_to=2026-07-31&quality_status=GOOD
```
```json
{ "items": [
  { "id": 10, "store_id": 1, "store_name": "본원 급식소", "item_id": 1, "item_code": "IT001", "item_name": "양파",
    "vendor_id": 1, "vendor_name": "신선식품(주)", "inbound_date": "2026-07-13", "quantity": 30,
    "supply_price": 9000, "vat": 900, "expiry_date": "2026-08-01", "inbound_temp": "5",
    "package_status": "NORMAL", "quality_status": "GOOD", "memo": null, "created_at": "...", "updated_at": "..." }
]}
```

### 🔑 `POST /api/inbound` — 입고 등록
```json
{
  "store_id": 1, "item_id": 1, "vendor_id": 1, "inbound_date": "2026-07-13",
  "quantity": 30, "supply_price": 9000, "vat": 900,
  "expiry_date": "2026-08-01", "inbound_temp": "5",
  "package_status": "NORMAL", "quality_status": "GOOD", "memo": "정기입고"
}
```
- `vat`을 생략하면 `supply_price`의 10%로 자동 계산됩니다.
- 담당 매장이 아니면 `403`, 선택한 품목이 해당 매장 소속이 아니면 `400`.
- 등록/수정/삭제 시 `io_logs`에 `io_type=INBOUND` 로그가 자동 기록됩니다.
```json
// Response 201
{ "id": 10 }
```

### 🔑 `PUT /api/inbound/:id` — 입고 수정
등록과 동일한 필드를 선택적으로 전달(매장/품목 변경 불가). 수정 후 재고가 음수가 되면(이미 출고된 수량보다 적게 줄이는 경우) `400`으로 거부됩니다.

### 🔑 `DELETE /api/inbound/:id` — 입고 삭제(논리삭제)
삭제로 인해 재고가 음수가 되면 `400`으로 거부됩니다.

---

## 10. 출고관리

### 🔑 `GET /api/outbound` — 출고 내역 조회
쿼리 파라미터: `store_id`, `item_id`, `date_from`, `date_to`, `keyword`

### 🔑 `POST /api/outbound` — 출고 등록
```json
{ "store_id": 1, "item_id": 1, "outbound_date": "2026-07-13", "quantity": 70, "supply_price": 30000, "vat": 3000, "memo": null }
```
- **현재 재고를 초과하는 수량은 등록할 수 없습니다.** 초과 시:
```json
{ "error": "현재 재고(50)를 초과하여 출고할 수 없습니다." }
```
- `vat` 생략 시 `supply_price`의 10% 자동 계산.

### 🔑 `PUT /api/outbound/:id` / `DELETE /api/outbound/:id`
수정 시에도 재고 초과 여부를 다시 검증합니다.

---

## 11. 재고관리 (조회 전용)

### 🔑 `GET /api/inventory`
쿼리 파라미터: `store_id`(생략 시 접근 가능한 전체 매장), `item_id`, `keyword`, `hide_zero=1`(입출고 이력이 전혀 없는 0재고 품목 숨김)
```json
{ "items": [
  { "store_id": 1, "store_name": "본원 급식소", "item_id": 1, "item_code": "IT001", "item_name": "양파",
    "purchase_unit": "kg", "initial_quantity": 50, "inbound_total": 30, "outbound_total": 70, "current_stock": 10 }
]}
```
`current_stock = initial_quantity + inbound_total - outbound_total`

---

## 12. 로그 조회 (👑 전용)

### `GET /api/admin/io-logs` — 입출고 작업 로그
쿼리: `io_type`(`INBOUND`/`OUTBOUND`), `action`(`CREATE`/`UPDATE`/`DELETE`), `store_id`, `date_from`, `date_to`
```json
{ "items": [
  { "id": 1, "io_type": "INBOUND", "action": "CREATE", "target_id": 10, "store_id": 1, "item_id": 1,
    "detail": "{\"after\":{...}}", "user_id": 2, "created_at": "...",
    "store_name": "본원 급식소", "item_name": "양파", "item_code": "IT001", "user_name": "김영양", "username": "nutri1" }
]}
```
최근 500건까지 조회됩니다.

### `GET /api/admin/auth-logs` — 로그인/로그아웃 로그
```json
{ "items": [
  { "id": 1, "user_id": 1, "username": "admin", "action": "LOGIN_SUCCESS", "ip": "127.0.0.1", "created_at": "..." }
]}
```

---

## curl 빠른 시작 예시

```bash
# 1) 로그인 (쿠키 저장)
curl -c cookie.txt -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin!2024"}'

# 2) 매장 등록
curl -b cookie.txt -X POST http://localhost:8787/api/admin/stores \
  -H 'Content-Type: application/json' \
  -d '{"store_code":"ST003","store_name":"제3매장"}'

# 3) 품목 등록 (매장 1)
curl -b cookie.txt -X POST http://localhost:8787/api/admin/items \
  -H 'Content-Type: application/json' \
  -d '{"store_id":1,"item_code":"IT001","item_name":"양파","purchase_unit":"kg"}'

# 4) 입고 등록
curl -b cookie.txt -X POST http://localhost:8787/api/inbound \
  -H 'Content-Type: application/json' \
  -d '{"store_id":1,"item_id":1,"vendor_id":1,"inbound_date":"2026-07-13","quantity":30,"supply_price":9000}'

# 5) 재고 조회
curl -b cookie.txt "http://localhost:8787/api/inventory?store_id=1"
```

## 엔드포인트 요약표

| 그룹 | Method | Path | 권한 |
|---|---|---|---|
| 인증 | POST | /api/auth/login | 🔓 |
| 인증 | POST | /api/auth/logout | 🔑 |
| 인증 | GET | /api/auth/me | 🔑 |
| 인증 | POST | /api/password-reset-requests | 🔑 |
| 영양사관리 | GET/POST | /api/admin/nutritionists | 👑 |
| 영양사관리 | PUT/DELETE | /api/admin/nutritionists/:id | 👑 |
| 영양사관리 | POST | /api/admin/nutritionists/:id/reset-password | 👑 |
| 영양사관리 | GET | /api/admin/password-reset-requests | 👑 |
| 매장관리 | GET/POST | /api/admin/stores | 👑 |
| 매장관리 | PUT/DELETE | /api/admin/stores/:id | 👑 |
| 공통코드 | GET/POST | /api/admin/common-codes | 👑 |
| 공통코드 | PUT/DELETE | /api/admin/common-codes/:id | 👑 |
| 품목 | GET/POST | /api/admin/items | 👑 |
| 품목 | GET | /api/admin/items/lookup | 👑 |
| 품목 | PUT/DELETE | /api/admin/items/:id | 👑 |
| 품목연동 | POST | /api/integration/items | 🔓 |
| 거래처 | GET/POST | /api/admin/vendors | 👑 |
| 거래처 | PUT/DELETE | /api/admin/vendors/:id | 👑 |
| 거래처연동 | POST | /api/integration/vendors | 🔓 |
| 기초재고 | GET/POST | /api/admin/initial-stock | 👑 |
| 공통조회 | GET | /api/stores, /api/items, /api/vendors, /api/common-codes | 🔑 |
| 입고 | GET/POST | /api/inbound | 🔑 |
| 입고 | PUT/DELETE | /api/inbound/:id | 🔑 |
| 출고 | GET/POST | /api/outbound | 🔑 |
| 출고 | PUT/DELETE | /api/outbound/:id | 🔑 |
| 재고 | GET | /api/inventory | 🔑 |
| 로그 | GET | /api/admin/io-logs | 👑 |
| 로그 | GET | /api/admin/auth-logs | 👑 |
