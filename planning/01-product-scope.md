# 01. 제품 범위 (Product Scope)

- 작성일: 2026-10-25 / 상태: **Phase 0 초안 – 사용자 승인 대기**
- 프로젝트 임시명: `6to9 Crypto Payment Gateway` (설정값 `PRODUCT_NAME`으로 분리, 코드/문서에 하드코딩 금지)

## 1. 저장소 조사 결과 (사실)

| 항목 | 확인 결과 |
|---|---|
| 작업 디렉터리 | `/home/user/Pg`, 브랜치 `claude/crypto-payment-gateway-mvp-8sabdc` |
| Git | 커밋 0개, 워킹 트리 비어 있음 (`.git`만 존재) |
| package.json / 프레임워크 / DB / 인증 / 테스트 / 린트 | **없음** (그린필드) |
| 로컬 런타임 | Node v22.22.0, npm 10.9.4, pnpm 있음, psql 16.15, docker 29.9.2 |
| PostgreSQL 서버 | 설치돼 있으나 **현재 미기동** (`pg_isready` 응답 없음) |
| Foundry (forge/anvil/cast) | **미설치** – 설치 가능 여부(네트워크 허용)는 아직 미검증 |
| 브라우저 | Chromium + Playwright 사전 설치 (E2E에 사용 가능) |

→ 재사용할 기존 스택이 없으므로 요청서의 기본 후보(Next.js App Router, TS strict, PostgreSQL, Zod, viem, Foundry, Vitest)를 평가해 채택한다.

## 2. 목표 (MVP)

판매자가 API로 주문 생성 → 고객이 테스트 지갑으로 **자체 배포한 테스트 ERC-20**을 결제 컨트랙트에 결제 → 서버가 온체인 상태를 검증/컨펌 → 서명된 웹훅 발송. 대상 네트워크는 Base Sepolia(chainId 84532, 공식 문서 확인: https://docs.base.org/get-started/connect-to-base), 개발은 로컬 Anvil(chainId 31337).

## 3. 범위 구분

### 범위 안 (MVP)
- 모듈형 모놀리스: Merchant API / Payment Service / Blockchain Adapter / DB / Dashboard
- 단일 Solidity 결제 컨트랙트 + 테스트 전용 ERC-20 (`가치 없음` 명시)
- 주문 상태 머신 9개 상태, 멱등성, 감사 로그
- 인덱서(체크포인트, 재조직 처리), 웹훅 아웃박스(HMAC, 재시도, SSRF 방어)
- 대시보드 7개 화면 (TESTNET 배지 상시)
- OpenAPI 문서, README, 테스트(단위/통합/컨트랙트/E2E)

### 범위 밖 (명시적 제외)
- 카드/법정화폐/거래소/환전/수탁/출금 기능
- 메인넷 배포 기능 및 메인넷 체인 설정 (코드 경로에서 **chainId 화이트리스트로 차단**, 기본 비활성)
- 실제 USDT/USDC 주소 하드코딩, 실제 자금/개인키 사용
- 다중 체인, 다중 판매자 셀프 가입, 정산/수수료 청구, 환불 자동화, KYC/AML 실행
- 운영 인프라(HA, 멀티 리전), 유료 서비스 가입

## 4. 결정 사항 (제안 – 승인 필요)

| # | 결정 | 근거 |
|---|---|---|
| D1 | Next.js(App Router) + TypeScript strict 단일 리포, API Route Handlers + 대시보드 | 요청서 기본 후보, 단일 배포 단위 |
| D2 | **워커 프로세스 분리**(같은 리포의 별도 엔트리): 인덱서, 웹훅 디스패처, 만료 처리 | Next 서버리스/요청 수명과 장기 실행 루프는 부적합. 마이크로서비스는 아님 |
| D3 | PostgreSQL 16, `pg` 드라이버 + **순수 SQL 마이그레이션**(up/down) | ORM 의존성/추상화 최소화, 제약조건·`FOR UPDATE SKIP LOCKED` 직접 제어 |
| D4 | 금액: DB `NUMERIC(78,0)`(토큰 최소 단위), 코드 `bigint`, API는 **문자열** | JS number 정밀도 문제 회피, 부동소수점 금지 |
| D5 | 컨트랙트: Foundry, Solidity 0.8.x 고정, OpenZeppelin 고정 버전 | 요청서 |
| D6 | 테스트 토큰: 자체 배포 `Test6USD`(이름에 TEST 명시, decimals 6 기본 + 18 decimals 테스트 토큰도 별도 배포해 decimal 검증) | USDT 사칭 방지, decimal 버그 조기 발견 |
| D7 | 대시보드 인증: 운영자 계정(argon2id 비밀번호 + DB 세션 쿠키 HttpOnly/SameSite) – 상세는 02 문서 | 외부 IdP 비용/의존성 회피 |

## 5. 미확정 사항 (사용자 결정 필요)

1. **컨트랙트 모델**: (A) 단순 `pay(invoiceId, merchantId, token, amount)` 후 서버가 온체인 상태 검증 vs (B) 서버 EIP-712 서명 견적(quote) 기반(온체인 만료·금액 구속 가능, 단 테스트 서명키 필요). 권장: **A로 시작, B는 Phase 2 컨트랙트 설계 시 재검토**. (02 문서 §5 참조)
2. **초과 입금(overpaid)을 성공으로 볼지**: 권장 = `overpaid`는 별도 상태+웹훅(`payment.overpaid`), 자동 환불 없음, 판매자/운영자 판단.
3. **부족 입금(underpaid)**: 컨트랙트가 invoiceId 1회 사용이므로 추가 납부 불가 → 종료 상태, 판매자 새 주문 생성. 괜찮은지?
4. **대시보드 사용자 모델**: MVP는 단일 운영자 + 판매자 선택(권장) vs 판매자별 로그인.
5. **RPC 제공자**: 로컬 Anvil + 공용 `sepolia.base.org`(속도 제한 있음) vs 무료 티어 제공자 계정(유료 아님, 가입 필요 → 사전 승인 요청 예정).
6. **컨펌 수 기본값**: 제안 12블록(테스트넷, 설정값). 상세 정책은 Phase 4에서 실측 후 확정.
7. **TypeScript 버전**: npm 최신이 7.x로 확인됨(메이저 변경). 툴체인(Next/Vitest/ESLint) 호환 여부를 Phase 1에서 검증하고 안 맞으면 5.x/6.x 고정.
8. 이름(`6to9`) 최종 확정 시점.

## 6. 위험 (요약; 상세는 03)

- 그린필드라 초기 스캐폴딩/버전 호환 이슈 가능
- Foundry 설치 불가 시 컨트랙트 툴체인 대안(Hardhat) 필요
- 법적 성격 미검토 상태에서 메인넷/실자금 금지 필수 (05 문서)

## 7. 대안

- Fastify/Express 백엔드 + 별도 React 대시보드: 유연하지만 배포 단위/인증 이중화 → 보류
- Drizzle/Prisma ORM: 생산성↑, 의존성/추상화↑ → 보류(필요 시 Phase 1에서 재논의)
- Hardhat: 툴체인 대안(JS 중심), Foundry 불가 시 사용

## 8. 검증 기준 (Phase 0 완료)

- [x] 저장소 상태 사실 기록
- [x] 범위 안/밖 분리
- [ ] 사용자가 §5 미확정 사항에 응답하고 Phase 1 승인
