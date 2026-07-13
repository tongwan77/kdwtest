# 급식소 식자재 재고관리 시스템

영양사가 식자재 입고/출고/재고를 관리하고, 최고관리자가 계정·기준정보·공통코드를 관리하는 반응형 웹 애플리케이션입니다.

## 실행 방법

Node.js 20 이상이 필요합니다. (Node 내장 `node:sqlite` 모듈만 사용하며, 별도 패키지 설치가 필요 없습니다.)

```bash
node server.js
```

브라우저에서 `http://localhost:8787` 접속

최초 실행 시 아래 계정이 자동 생성됩니다.

- **최고관리자**: `admin` / `Admin!2024`
- 로그인 후 반드시 비밀번호 재발급 절차(관리자 → 영양사 관리에서 본인 계정에 준하는 처리, 또는 DB 직접 수정)를 통해 초기 비밀번호를 변경하는 것을 권장합니다.

데이터는 `data/app.db` (SQLite 파일)에 저장됩니다. 초기화하려면 서버를 끄고 이 파일을 삭제한 뒤 다시 실행하세요.

## 기술 구성

- **런타임**: Node.js 내장 모듈만 사용 (외부 패키지 미사용)
  - HTTP 서버: `node:http` (직접 라우팅)
  - DB: `node:sqlite` (SQLite, 파일 기반)
  - 비밀번호 해시: `node:crypto`의 `scrypt` (OWASP 권장, salt+timing-safe 비교)
- **프론트엔드**: Vanilla JS SPA (빌드 도구 없이 브라우저에서 바로 동작), Pretendard 폰트, 반응형 CSS
- **QR 스캔**: `html5-qrcode` (CDN)

실제 운영 환경에서는 Express/PostgreSQL 등으로 교체 가능하도록 계층이 분리되어 있습니다 (`db.js`=데이터, `api.js`=API 라우트, `auth.js`=인증, `public/`=프론트엔드).

## 요구사항 반영 내역

| # | 요구사항 | 구현 위치 |
|---|---|---|
| 1 | 최고관리자 1명만 존재 | `db.js` seed(), 최초 1회만 생성 |
| 2 | 최고관리자가 영양사 계정 발급 + 담당매장(복수) 지정 | `POST/PUT /api/admin/nutritionists` |
| 3 | 품목 마스터, 외부 API 연동 확장 (품명/품명코드/대중소분류/규격/구매단위) | `POST /api/integration/items` (upsert, source=API 표시) |
| 4 | 거래처 마스터, 외부 API 연동 확장 (거래처명/거래처코드) | `POST /api/integration/vendors` |
| 5 | 기초재고 기본값 0, 관리자가 등록 | `initial_stock` 테이블, 미등록시 0 |
| 6 | 입고 등록 시 거래처 selectbox | 입고 등록 모달 |
| 7 | 출고 시 현재 재고 초과 방지 | `computeStock()` 검증 (등록/수정 모두 적용) |
| 8 | 입출고 등록/수정/삭제 로그 (구분/작업내용) | `io_logs` 테이블, `admin-io-logs` 화면 |
| 9 | 공급가 입력 시 부가세 자동계산(10%), 수정 가능 | 프론트 자동계산 + 서버 기본값 계산 |
| 10 | 품질상태 드롭다운(양호/불량/누락/파손/기타), 관리자가 공통코드로 관리 | `common_codes` 테이블 (`admin-codes` 화면) |
| 11 | 조회조건 기반 입고/출고/재고 리포트 | 각 메뉴 필터(매장/기간/거래처/품질상태/키워드) |
| 12 | 비밀번호 개인 초기화 불가, 관리자에게 요청 | 영양사: 요청만 가능 / 관리자: 재발급 전용 API |
| 13 | 매장별 조회 selectbox, 매장은 관리자가 공통코드로 관리 | 상단 매장 선택 + `admin-stores` 화면 |
| 14 | 비밀번호 암호화(scrypt) + 로그인/로그아웃 로그 | `auth.js`, `auth_logs` 테이블 |
| 15 | 품목 QR코드 스캔 입력 (확장 대비) | 입고/출고 등록 모달의 "QR스캔" 버튼 |

## 폴더 구조

```
server.js       HTTP 서버 진입점 (정적 파일 + API 라우팅)
api.js          전체 REST API 라우트
auth.js         세션 인증 (로그인/로그아웃/토큰)
db.js           SQLite 스키마 및 초기 시드 데이터
util.js         공통 유틸(JSON 응답, 라우터, 바디 파싱)
public/
  index.html    SPA 진입 HTML
  css/style.css 반응형 스타일
  js/app.js     SPA 로직 (화면 전체)
data/app.db     SQLite 데이터 파일 (최초 실행 시 자동 생성)
```

## 알려진 제한사항 / 향후 보완 권장

- 현재는 단일 서버 프로세스 + 파일 기반 SQLite로, 소규모~중규모 운영에 적합합니다. 다중 서버/고가용성이 필요하면 PostgreSQL 등으로 전환을 권장합니다.
- 외부 연동 API(`/api/integration/*`)는 시연을 위해 인증 없이 열려 있습니다. 운영 환경에서는 API Key/IP 화이트리스트 등 별도 인증을 추가해야 합니다.
- QR 스캔은 카메라 권한이 있는 브라우저(HTTPS 또는 localhost)에서 정상 동작합니다.
- 엑셀 다운로드, 유통기한 임박 알림 등은 향후 확장 포인트로 남겨두었습니다.
