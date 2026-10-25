# 02. 아키텍처 (Architecture)

- 작성일: 2026-10-25 / 상태: Phase 0 초안

## 1. 개요: 모듈형 모놀리스, 2개 프로세스

```
[Merchant server] --API key--> [Next.js app: /api/v1/*, /dashboard]
                                        |  (같은 코드베이스, 같은 PostgreSQL)
                                        v
                                 [PostgreSQL 16]
                                        ^
[Worker process: indexer | confirmer | expirer | webhook dispatcher]
        |  eth_getLogs / getTransactionReceipt / getBlock (viem)
        v
   [Base Sepolia RPC]  <---  [PaymentGateway.sol + Test ERC-20]
```

저장소 레이아웃(제안):
```
contracts/            Foundry (src, test, script) – 배포 스크립트는 로컬/테스트넷 전용
src/
  config/             env 파싱(Zod), 체인/토큰 정책, 메인넷 차단 가드
  modules/
    merchants/ api-keys/ orders/ payments/ webhooks/ audit/ idempotency/
  chain/              Blockchain Adapter (viem), indexer, reorg handler
  db/                 pg pool, 트랜잭션 헬퍼, migrations/*.sql (up/down)
  app/                Next.js App Router (api/v1, dashboard)
  worker/             worker 엔트리포인트
planning/  docs/  openapi/
```
모듈 경계: 모듈은 다른 모듈의 DB 테이블에 직접 접근하지 않고 서비스 인터페이스를 통한다(린트 규칙 `no-restricted-imports`로 강제 예정).

## 2. 컴포넌트

### A. Merchant API
- 경로: `/api/v1/orders`, `/orders/:id`, `/orders/:id/events`, `/webhooks/test`, `/health`, `/ready`
- 인증: `Authorization: Bearer pk_test_<prefix>_<secret>`. 32바이트 CSPRNG → base64url. DB에는 **SHA-256 해시**(고엔트로피이므로 느린 KDF 불필요)와 조회용 prefix만 저장, 비교는 `timingSafeEqual`. 생성 시 1회만 노출, 회전(새 키 발급 후 구키 유예기간)·폐기(`revoked_at`).
- 모든 쿼리에 `merchant_id` 조건 필수(리포지토리 함수 시그니처가 merchantId를 요구). 타 판매자 리소스는 **404**로 응답(존재 여부 비노출).
- 주문 ID 외부 노출은 UUIDv4(추측 불가). 온체인 `invoiceId`는 별도 32바이트 랜덤.
- 멱등성: `Idempotency-Key` 헤더, `(merchant_id, key)` 유니크 + 요청 본문 정규화 해시 저장. 동일 키+다른 본문 → `409 idempotency_conflict`. 처리 중 중복 → 락 후 동일 응답 재생.
- 요청 크기 제한(예: 32KB), 레이트 리밋(MVP: 프로세스 내 토큰버킷 + 키/IP 단위; 다중 인스턴스 시 PG 기반으로 교체), 페이지네이션 커서 방식 `limit ≤ 100`.
- 오류 응답: `{error:{code,message,requestId}}` 고정 형식, 스택/RPC URL/SQL 비노출.
- 입력 검증: Zod. 금액은 `"10.50"` 문자열 → 토큰 decimals 기준 정수 변환(소수 자릿수 초과 시 거부).

### B. Payment Service
- 상태 머신(아래 §4), 정책 검증, 멱등 이벤트 반영, 컨펌 정책.
- 모든 상태 변경: `BEGIN; SELECT … FOR UPDATE (order); 검증; UPDATE; INSERT audit_log; INSERT webhook_outbox; COMMIT;`

### C. Blockchain Adapter
- viem `publicClient`. 기동 시 `eth_chainId` == 설정 chainId 검증 (불일치 시 기동 거부), 주기적 재검증.
- 설정 화이트리스트: (chainId, gatewayAddress, tokenAddress[]) 코드/설정에 고정. 그 외 주소 이벤트는 `chain_events`에 `rejected` 사유와 함께 기록만 하고 주문에 반영 안 함.
- **로그를 신뢰하지 않는 검증**: 로그 감지 후 `getTransactionReceipt`로 `status==success`, 로그의 `address==gateway`, 해당 블록 해시가 canonical인지 재조회, 컨트랙트 view(`invoices(invoiceId)`) 호출로 payer/token/amount/recipient를 **블록 지정(blockNumber)** 상태로 교차 확인.
- 선택(권장 옵션): 서로 다른 2개 RPC에서 교차검증(설정 시).
- 일시적 RPC 오류: 지수 백오프+지터, 오류는 재시도 대상일 뿐 주문 상태를 `failed`로 만들지 않음.

### D. Database (요약; 스키마 상세는 Phase 1 마이그레이션)
테이블: merchants, api_keys, orders, payment_transactions, chain_events, webhook_endpoints, webhook_deliveries(+outbox 역할), idempotency_keys, audit_logs, indexer_checkpoints (+ dashboard_users, sessions, tokens_allowlist/settings는 Phase 1에서 결정).

핵심 제약:
- `orders`: `UNIQUE(invoice_id)` 전역, `UNIQUE(merchant_id, merchant_order_id)`, `amount_atomic NUMERIC(78,0) CHECK(>0)`, `status` CHECK(9개), `chain_id/token_address/recipient/gateway` 주문 생성 시점 스냅샷 저장.
- `chain_events`: `UNIQUE(chain_id, tx_hash, log_index)`, `block_number`, `block_hash`, `status(observed|confirmed|orphaned|rejected)`, `removed_at`.
- `payment_transactions`: order_id FK, 주문당 유효 거래 1개를 부분 유니크 인덱스로 보장(orphan 제외).
- `audit_logs`: append-only(앱 롤에 UPDATE/DELETE 권한 미부여), actor_type/actor_id/action/target/ip/request_id/diff(비밀 제거).
- `indexer_checkpoints`: `(chain_id, contract)` PK, `last_processed_block`, `last_block_hash`(재조직 감지용 최근 N개 블록 해시 별도 테이블 또는 JSONB).
- 앱 DB 롤은 최소 권한(DDL 불가), 마이그레이션 롤 분리. 연결 문자열은 환경변수만, 로그 마스킹.

### E. Dashboard
Overview / Orders / Order detail / Webhooks / API keys / Settings / Audit log. 서버 컴포넌트에서 세션 검증 + 모든 서버 액션/라우트에서 재검증(UI 숨김에 의존 금지). 전역 TESTNET 배지, 문구에 "실제 자금" 암시 금지. CSP 헤더, 출력 이스케이프(React 기본) + `dangerouslySetInnerHTML` 금지 린트. 상태 변경 요청은 CSRF 토큰/SameSite=Strict.
인증(제안): 운영자 계정 argon2id + DB 세션(서버측 폐기 가능), 로그인 시도 제한. 2FA(TOTP)는 MVP 이후 후보.

## 3. 결제 컨트랙트 설계 (Phase 2 사전 설계)

`PaymentGateway` (Solidity 0.8.x 고정, OpenZeppelin 고정 태그, `Ownable2Step`, `ReentrancyGuard`, `SafeERC20`)

- 상태: `mapping(address token => bool) allowedToken`, `mapping(bytes32 merchantId => address recipient) recipientOf`, `mapping(bytes32 invoiceId => Payment) payments`.
- `pay(bytes32 invoiceId, bytes32 merchantId, address token, uint256 amount)`:
  1. 검증: `amount>0`, `token!=0`, `allowedToken[token]`, `recipient=recipientOf[merchantId]!=0`, `payments[invoiceId].paidAt==0` (아니면 revert)
  2. **Effects 먼저**: `payments[invoiceId] = {payer, merchantId, token, recipient, amount, paidAt}` 기록
  3. **Interaction**: `token.safeTransferFrom(msg.sender, recipient, amount)` (고객 → 수취 지갑 직접 이체, 컨트랙트가 토큰을 보유하지 않음 = 컨트랙트 내 자금 탈취 표면 제거)
  4. 수취 지갑 잔액 증감 검증으로 **fee-on-transfer/리베이스 토큰 거부**(전/후 balance delta == amount)
  5. `emit PaymentReceived(invoiceId, merchantId, payer, recipient, token, amount)` (invoiceId indexed)
- 관리: owner(테스트 EOA, 추후 멀티시그 권장)만 `setAllowedToken`, `setRecipient`(2단계: propose→수취 주소 변경은 timelock 또는 이벤트로 감사 가능하게). **owner는 사용자 자금 이동 권한 없음**. pause 기능은 신규 결제만 차단(자금 접근 불가).
- 수취 주소 변경이 진행 중 주문에 영향을 주지 않도록, 서버는 주문 생성 시 recipient를 스냅샷하고 이벤트의 recipient와 일치하는지 검증(불일치 → `manual_review`).
- 재진입 분석: 외부 호출은 `safeTransferFrom` 한 곳. 악의적 토큰은 allowlist로 차단, 그래도 CEI + nonReentrant 적용. 허용 토큰이 훅(ERC-777류)을 가지면 재진입 가능하므로 allowlist 등록 기준 문서화.
- 만료: **온체인에서 강제하지 않음**(옵션 A). 서버가 `expires_at` 이후 감지/블록 타임스탬프 기준으로 판정. 블록 타임스탬프 > expires_at 인 결제 = 늦은 결제 → `manual_review` (자동 성공 금지). 온체인 만료가 필요하면 옵션 B(EIP-712 quote with deadline).
- **알려진 한계(griefing)**: invoiceId를 아는 제3자가 소액으로 먼저 결제해 invoiceId를 소진시킬 수 있다(자금은 판매자에게 감 → 손실 아님, 주문은 `underpaid`/`manual_review`). 옵션 B로 완화 가능. 승인 시 선택.
- 배포 키: 환경변수/저장소에 두지 않음. Foundry 암호화 키스토어(`cast wallet`) 또는 배포 시 수동 주입, 테스트 전용 신규 지갑, 실자산 지갑 금지. 배포 스크립트는 chainId ∈ {31337, 84532} 아니면 revert/exit.

## 4. 주문 상태 머신

| from \ to | detected | confirming | confirmed | expired | underpaid | overpaid | failed | manual_review |
|---|---|---|---|---|---|---|---|---|
| pending | ✔ | – | – | ✔(시간) | – | – | – | ✔(만료 후 입금 등) |
| detected | – | ✔ | – | – | – | – | ✔(트랜잭션 revert/소멸 확정) | ✔ |
| confirming | – | – | ✔ | – | ✔ | ✔ | ✔ | ✔(재조직/불일치) |
| confirmed | – | – | – | – | – | – | – | ✔(재조직으로 소멸 시에만) |
| expired | – | – | – | – | – | – | – | ✔(늦은 입금 감지) |
| underpaid / overpaid | – | – | – | – | – | – | – | ✔ |
| failed / manual_review | 운영자 수동 해소만(감사 로그 필수) |

- 금액 판정은 `confirming → (confirmed|underpaid|overpaid)` 시점에 정수 비교 (`paid == amount` / `<` / `>`).
- 전이 함수 하나(`transition(order, from, to, reason, evidence)`)가 허용표를 검사, `UPDATE … WHERE id=$1 AND status=$from`(낙관적 조건) + 행 락. 허용되지 않으면 예외+감사 로그.
- `confirmed`는 `pending`으로 되돌리지 않음. 재조직으로 증거가 사라지면 `manual_review` + 웹훅 `payment.reorged` + 감사 로그.
- 웹훅 발송 이벤트는 전이와 **같은 DB 트랜잭션**에서 outbox 행으로 기록(아웃박스 패턴).

## 5. 인덱서

- 루프: `latest = getBlockNumber()` → 안전 헤드 `= latest - confirmations` 까지 확정 처리, 그 이상은 `observed`(미확정) 처리. 범위는 `MAX_BLOCK_RANGE`(설정, 예 2000)로 분할, 공급자 제한에 맞춰 호출 간 대기.
- 체크포인트: 각 범위 처리를 **한 DB 트랜잭션**으로 이벤트 upsert + checkpoint 갱신. 재시작 시 `checkpoint - REORG_DEPTH`부터 재스캔(중복은 유니크 제약으로 무시 = 멱등).
- 재조직 감지: 저장된 최근 N개 `(blockNumber, blockHash)`와 현재 canonical 해시 비교 → 불일치 시 해당 높이 이후 `chain_events`를 `orphaned` 처리, 연관 주문 재평가(§4 규칙), 체크포인트 되돌림.
- 확정 판정: `confirmations ≥ N` 또는 (옵션) 블록 태그 `safe/finalized` 이상. **Base(OP Stack L2)에서 태그 의미와 L1 확정 지연은 Phase 8 실측 필요 – 미검증**.
- 관측성: 구조화 로그(pino 후보), `/ready`에 인덱서 지연(lag)·마지막 성공 시각, 메트릭(Prometheus 텍스트 엔드포인트, 내부용).

## 6. 웹훅

- 서명: 헤더 `X-Webhook-Signature: t=<unix秒>,v1=<hex(HMAC_SHA256(secret, "<t>." + rawBody))>`, `X-Webhook-Event-Id`, `X-Webhook-Timestamp`. 수신자는 raw body로 검증, 허용 오차(예: 5분) 밖 거부, event_id 중복 제거.
- 시크릿: 엔드포인트별 랜덤 32바이트, 저장 시 앱 레벨 암호화(키는 환경변수 `WEBHOOK_SECRET_ENC_KEY`), 회전 시 이전+신규 동시 유효 기간(서명 2개 `v1,v1`).
- 디스패처: `SELECT … FOR UPDATE SKIP LOCKED`로 due 행 선택 → 전송 → 결과 기록. 백오프 `base * 2^n + jitter`, `WEBHOOK_MAX_ATTEMPTS` 설정, 소진 시 `dead` + 대시보드 수동 재전송.
- 성공 판정: 2xx만. 타임아웃(예 10s), 응답 본문은 저장 시 잘라냄(예 2KB, 비밀 마스킹).
- **SSRF**: https만(개발 플래그 제외), 포트 443(설정 허용 목록), DNS 해석 후 모든 A/AAAA가 공인 주소인지 검사(루프백, 사설, 링크로컬 169.254.0.0/16 포함 메타데이터, CGNAT, ULA, 멀티캐스트, IPv4-mapped IPv6 등 차단), **검증한 IP로 직접 연결**(DNS 리바인딩 방지, SNI/Host 유지), 리다이렉트 비추종, 응답 크기 상한. 등록 시점+전송 시점 모두 검사.

## 7. 설정/환경 분리

- `APP_ENV ∈ {local, testnet}` 만 허용. `production`/메인넷 chainId 설정 시 기동 거부(`MAINNET_ENABLED` 개념 자체를 만들지 않고 코드 상수로 차단).
- Zod로 env 파싱, 비밀값은 `.env`(미커밋), `.env.example`만 커밋. 로그 리댁션 목록(authorization, api key, secret, private key, DATABASE_URL, RPC URL).

## 8. 의존성 후보 (설치 전 – 검토 기록)

2026-10-25 `npm view` 조회(설치 안 함). 라이선스/버전은 조회값, 유지보수·취약점은 **Phase 1 설치 직전 `npm audit`/릴리스 이력으로 재확인**.

| 패키지 | 조회 버전 | 라이선스 | 용도 / 메모 |
|---|---|---|---|
| next | 16.4.3 | MIT | 앱 프레임워크. 메이저 버전이 높아 호환 문서 확인 |
| zod | 4.6.7 | MIT | 검증 |
| viem | 2.57.11 | MIT | 체인 클라이언트 |
| pg | 8.23.1 | MIT | PG 드라이버 |
| vitest | 5.0.5 | MIT | 테스트 |
| typescript | 7.0.2 | Apache-2.0 | 메이저 변경 → 툴체인 호환 검증 후 고정 |
| pino | 10.4.0 | MIT | 로깅(+redact) |
| @node-rs/argon2 또는 argon2 | 미조회 | – | 비밀번호 해시(네이티브 빌드 여부 검토) |
| OpenZeppelin Contracts, forge-std | 미조회 | MIT | git 태그/커밋 해시 고정 |
| drizzle-orm 0.45.4 / postgres 3.4.9 | – | – | **채택 안 함**(순수 SQL 방침) |

모든 버전은 lockfile + 정확한 버전 고정, CI에서 `npm audit` 및 라이선스 점검.

## 9. 대안과 트레이드오프

| 주제 | 선택 | 대안 | 비고 |
|---|---|---|---|
| 워커 | 별도 프로세스 | Next 인스턴스 내 백그라운드 | 후자는 재시작/스케일에 취약 |
| 큐 | PG 아웃박스 + SKIP LOCKED | Redis/BullMQ | 인프라 추가 없이 시작 |
| 컨트랙트 | 직접 이체형(보유 없음) | 에스크로형 | 직접 이체가 공격 표면 작음 |
| 만료 | 서버 판정 | EIP-712 quote | 02 §3 |

## 10. 검증 기준

- 모든 모듈 경계/불변식은 테스트로 표현 가능해야 함(04 문서의 단계별 완료 조건).
- 설계 변경은 이 문서에 반영하고 변경 이력을 남긴다.
