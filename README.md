# 급식소 식자재 재고관리 시스템

영양사가 식자재 입고/출고/재고를 관리하고, 최고관리자가 계정·기준정보·공통코드를 관리하는 반응형 웹 애플리케이션입니다.

DB는 **PostgreSQL(Vercel Postgres / Neon)** 을 사용하며, **Vercel 서버리스 함수**로 배포하거나 **일반 Node.js 서버(예: 오라클 클라우드, 자체 PC)** 로도 동일한 코드로 실행할 수 있습니다.

## 배포 방법 A — Vercel (권장)

1. Vercel 프로젝트의 **Storage** 탭에서 Postgres(Neon) DB를 만들고, 이 프로젝트에 **Connect**합니다.
   → 연결하면 `POSTGRES_URL` 등 환경변수가 프로젝트에 자동으로 주입됩니다.
2. 이 프로젝트 폴더를 GitHub 리포지토리로 올리고 Vercel에서 Import하거나, Vercel CLI로 `vercel --prod` 배포합니다.
3. 배포가 끝나면 발급된 URL로 접속하면 됩니다. 첫 요청 시 자동으로 테이블 생성 + 초기 관리자 계정이 시드됩니다.

DB 연결에 필요한 npm 의존성(`pg`)은 `package.json`에 이미 포함되어 있어 Vercel이 빌드 시 자동으로 설치합니다.

## 배포 방법 B — 일반 Node.js 서버 (오라클 클라우드 등)

```bash
npm install
export POSTGRES_URL="postgres://사용자:비밀번호@호스트/디비이름?sslmode=require"
node server.js
```

`http://서버주소:8787` 접속. `POSTGRES_URL`은 Neon이든 자체 설치한 Postgres든 상관없이 접속 문자열만 맞으면 동작합니다.

## 최초 로그인

- **최고관리자**: `admin` / `Admin!2024`
- 최초 로그인 후 되도록 빠르게 비밀번호를 재발급(관리자가 직접 DB 접근 없이 바꾸는 절차는 앱 내에 없으므로, 필요시 DB에서 직접 `password_hash`/`password_salt`를 갱신하거나 개발자에게 요청)하는 것을 권장합니다.

## 기술 구성

- **DB**: PostgreSQL (Vercel Postgres / Neon). `pg` 패키지로 연결하며, `?` 플레이스홀더 SQL을 자동으로 `$1,$2...` 형식으로 변환하는 얇은 래퍼(`db.js`)를 사용합니다.
- **서버 로직**: `api.js`(라우트), `auth.js`(세션 인증), `util.js`(공통 유틸) — 두 배포 방식 모두에서 동일한 코드를 그대로 재사용합니다.
- **Vercel 배포**: `api/[...path].js` (catch-all 서버리스 함수)가 모든 `/api/*` 요청을 처리하고, `vercel.json`의 rewrites로 `public/` 폴더를 정적 사이트로 서빙합니다.
- **로컬/자체서버 배포**: `server.js` (Node 내장 `http` 모듈 기반 정적 파일 서빙 + API 라우팅)
- **비밀번호 해시**: `node:crypto`의 `scrypt` (OWASP 권장, salt + timing-safe 비교)
- **프론트엔드**: 빌드 도구 없는 Vanilla JS SPA (`public/`), Pretendard 폰트, 반응형 CSS
- **QR 스캔**: `html5-qrcode` (CDN)

## 환경변수

| 변수명 | 설명 |
|---|---|
| `POSTGRES_URL` (또는 `DATABASE_URL`) | Postgres 접속 문자열. Vercel에서 DB를 Connect하면 자동 주입됨 |
| `PORT` | (배포방법 B에서만) 로컬 서버 포트, 기본 8787 |

## 요구사항 반영 내역

| # | 요구사항 | 구현 위치 |
|---|---|---|
| 1 | 최고관리자 1명만 존재 | `db.js` seed(), 최초 1회만 생성 |
| 2 | 최고관리자가 영양사 계정 발급 + 담당매장(복수) 지정 | `POST/PUT /api/admin/nutritionists` |
| 3 | 품목 마스터, 매장별 등록/관리, 외부 API 연동 확장 (매장코드/품명/품명코드/대중소분류/규격/구매단위) | 품목은 `store_id`에 종속되며, 유니크 키는 `(store_id, item_code, item_name)`. 동일 품명코드는 어느 매장에서 등록하든 항상 같은 품명을 가져야 하며, 다르면 등록이 거부됨(품명 수정 시 다른 매장도 자동 동기화). `POST /api/integration/items` (매장코드로 대상 매장 식별, 품명 불일치 항목은 skipped 처리) |
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
db.js             Postgres 연결/스키마/시드 (Pool, ?→$1 자동 변환 래퍼)
auth.js           세션 인증 (로그인/로그아웃/토큰) - Vercel req.cookies 겸용
util.js           공통 유틸(JSON 응답, 라우터, 바디 파싱) - Vercel req.body 겸용
api.js            전체 REST API 라우트 (Postgres 비동기 호출)
server.js         로컬/자체서버용 진입점 (Node http)
api/[...path].js  Vercel 서버리스 함수 진입점 (catch-all)
vercel.json       Vercel 라우팅/함수 설정
public/
  index.html      SPA 진입 HTML
  css/style.css   반응형 스타일
  js/app.js       SPA 로직 (화면 전체)
deploy/
  nutri-inventory.service   (배포방법 B용 systemd 유닛)
```

## 배포 후 확인 체크리스트

이 코드는 이 작업 환경에서 실제 Neon DB에 연결해 테스트할 수 없었기 때문에(외부 네트워크 접근 불가), 배포 직후 아래를 순서대로 확인해주세요.

1. `GET /api/auth/me` → `401`이 정상 응답(로그인 전이므로)인지 — 500 에러가 뜨면 `POSTGRES_URL` 연결 문제입니다.
2. `admin / Admin!2024`로 로그인 → 성공하면 스키마 생성 + 시드가 정상 동작한 것입니다.
3. 매장 등록 → 품목 등록 → 입고 등록 → 재고 조회까지 한 사이클 테스트.
4. Vercel 배포라면 **Function Logs**(Vercel 대시보드)에서 `[seed] 최고관리자 계정 생성...` 로그가 한 번 찍히는지 확인 (여러 번 찍히면 안 됨 — 매 콜드스타트마다 중복 시드 시도하지만 `IF NOT EXISTS` 로직으로 안전하게 무시됩니다).

## 알려진 제한사항 / 향후 보완 권장

- 외부 연동 API(`/api/integration/*`)는 시연을 위해 인증 없이 열려 있습니다. 운영 환경에서는 API Key/IP 화이트리스트 등 별도 인증을 추가해야 합니다.
- QR 스캔은 카메라 권한이 있는 브라우저(HTTPS 또는 localhost)에서 정상 동작합니다. Vercel 배포는 기본적으로 HTTPS이므로 바로 사용 가능합니다.
- Neon 무료 플랜은 일정 시간 미사용 시 컴퓨트가 "sleep" 상태가 될 수 있어, 첫 요청이 평소보다 느릴 수 있습니다(콜드스타트).
- 서버리스 특성상 커넥션 풀을 작게(`max: 3`) 설정했습니다. 트래픽이 많아지면 Neon의 "Pooled connection"(PgBouncer) 문자열을 사용 중인지 확인하세요.
- 엑셀 다운로드, 유통기한 임박 알림 등은 향후 확장 포인트로 남겨두었습니다.
