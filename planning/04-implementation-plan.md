# 04. 구현 계획 (Implementation Plan)

- 작성일: 2026-10-25 / 상태: Phase 0 초안. **각 Phase 완료 시 보고하고 승인 후 다음 단계 진행.**
- 공통 규칙: 작은 커밋, Phase마다 테스트/린트/타입체크 통과, 의존성은 설치 전 필요성·라이선스·비용 보고, 비밀값 미커밋.

## 사전 필요 사항 / 승인 요청 후보

| 항목 | 내용 | 비용 |
|---|---|---|
| Foundry 설치 | `foundryup` 필요(네트워크 허용 여부 미검증). 불가 시 Hardhat 대안 | 무료 |
| PostgreSQL | 로컬 설치된 16.15 기동 또는 docker. 컨테이너 가능 여부 Phase 1에서 확인 | 무료 |
| Base Sepolia RPC | 공용 `sepolia.base.org`(제한 있음) 또는 무료 티어 제공자 가입 | 무료 티어 우선; **가입은 사전 승인 요청** |
| 테스트넷 ETH | faucet, 테스트 전용 신규 지갑 | 무료 |

## Phase 1 – 프로젝트 구성, DB, 설정
- 작업: Next.js+TS strict, ESLint, Prettier, Vitest, 환경변수 Zod 검증(메인넷 차단 가드), pino 로깅/리댁션, SQL 마이그레이션 러너(up/down), 초기 스키마(10개 테이블+세션/운영자), `.env.example`, `.gitignore`, secret scan 설정, CI(GitHub Actions: lint/typecheck/test).
- 완료 기준: `pnpm lint/typecheck/test` 통과, 빈 DB에 migrate up → down → up 성공, 유니크/체크 제약 테스트, 잘못된 env로 기동 거부 테스트, `/health` `/ready` 동작.
- 위험: TS 7 / Next 16 / Vitest 5 호환 → 안 맞으면 버전 고정 하향.
- 롤백: 마이그레이션 down 스크립트, Phase 단위 git revert.

## Phase 2 – 컨트랙트
- 작업: `PaymentGateway`, `Test6USD`(6 dec), `Test18`(18 dec), 악성 토큰 목 컨트랙트(재진입/미이체/수수료), 로컬 Anvil 배포 스크립트(chainId 가드), Foundry 테스트.
- 완료 기준: 정상 결제·비허용 토큰·중복 invoiceId·0 금액·0 주소·잔액/allowance 부족·재진입·권한·이벤트 필드 테스트 통과, 퍼즈/인바리언트 테스트(invoice 1회 소진), `forge coverage` 보고, 슬리더 등 정적 분석은 가능하면 실행(미실행 시 명시).
- 승인 필요: 컨트랙트 모델 A/B(01 §5-1).

## Phase 3 – 주문 API, 상태 머신
- 작업: API 키 발급/해시/회전/폐기, 인증 미들웨어, 주문 생성/조회/events, 멱등성, 레이트 리밋, 상태 머신 `transition()`+감사 로그, 만료 잡, 에러 포맷, OpenAPI 초안, curl 예시.
- 완료 기준: 단위(상태 전이 전수표, decimal, 멱등, 만료), 통합(실 PG: 동시성, 판매자 격리 IDOR), 오류 응답 비밀 비노출 테스트.

## Phase 4 – 인덱서
- 작업: viem 어댑터, chainId 검증, 범위 분할 조회, 백오프+지터, 체크포인트, 이벤트 검증·교차검증, 컨펌 처리, 재조직 처리, 메트릭/ready.
- 완료 기준: 모킹 RPC 테스트(중복, 오류, 재시작, 재조직, 잘못된 토큰/컨트랙트/체인), **로컬 Anvil 통합 테스트**(snapshot/revert로 재조직 시뮬레이션). 실제 Base Sepolia 테스트는 Phase 8에서 별도 표기.

## Phase 5 – 웹훅
- 작업: 엔드포인트 등록(SSRF 검사), 시크릿 생성/암호화/회전, 아웃박스 디스패처(SKIP LOCKED), HMAC 서명, 재시도, 수동 재전송, 수신자 검증 샘플 코드(Node), 서명 문서.
- 완료 기준: 서명 벡터 테스트, 재시도 스케줄 테스트(가짜 타이머), 수신 서버 장애/타임아웃/3xx, SSRF 차단 전수 케이스, DB 커밋 전 발송 없음 테스트.

## Phase 6 – 대시보드
- 작업: 로그인/세션, 7개 화면, TESTNET 배지, 서버측 인가 래퍼, CSP.
- 완료 기준: 무인증 접근 라우트 열거 테스트, XSS 렌더 테스트, Playwright 스모크.

## Phase 7 – 통합/E2E/보안/문서
- 작업: E2E 9단계 시나리오(로컬 Anvil), 위협 모델 체크리스트 점검, `npm audit`, 문서(README, 환경변수, 마이그레이션, 로컬 테스트, API 사용법, 알려진 위험/미완료 기능, 백업·복구 절차).
- 완료 기준: 요청서 §14 완료 기준 1~14 항목별 증거(테스트 이름/명령 출력) 표.

## Phase 8 – 테스트넷 검증 (별도 승인)
- 작업: 테스트 전용 지갑으로 Base Sepolia에 컨트랙트 배포(키는 서버/저장소에 두지 않고 수동 주입), 실 RPC로 컨펌/태그/재조직 동작 실측.
- 완료 기준: 실제 실행 로그. **실행하지 않았다면 실행했다고 주장하지 않음.**
- 메인넷: 범위 밖. 법률·보안 검토+별도 승인 없이 불가.

## 마이그레이션 / 롤백 / 백업 계획
- 마이그레이션: `NNNN_name.up.sql` / `.down.sql`, 적용 이력 테이블, 트랜잭션 단위 적용, 파괴적 변경은 expand→migrate→contract 2단계.
- 롤백: down 스크립트 + 적용 전 `pg_dump`. down이 불가능한 변경(컬럼 삭제 등)은 문서에 표기.
- 백업/복구(문서화 항목): `pg_dump -Fc` 일일, 복구 리허설 절차, 감사 로그 보관 정책, 복구 후 인덱서 체크포인트 재스캔으로 정합성 복원(체인이 진실 원천).
- 운영 데이터 삭제는 명시적 승인 없이 수행하지 않음(개발 DB 리셋은 별도 DB 이름/가드 사용).

## 테스트 전략 매핑
단위: Vitest / 통합: 실 PG + RPC 모킹 / 컨트랙트: Foundry / E2E: Anvil + Playwright / 테스트넷: 별도 스위트 `test:testnet`(기본 CI 제외, 명시적 실행).

## 미확정 / 위험
- 도구 설치 가능 여부(Foundry, PG 기동), 무료 RPC 제한, 버전 호환.
- 일정 추정은 하지 않음(불확실).

## 검증 기준 (Phase 0)
- [x] Phase별 작업·완료 기준·승인 지점 정의
- [ ] 사용자 승인

## Phase 1 결과 메모 (2026-10-26)

- 패키지 매니저는 pnpm이 아니라 **npm**(`package-lock.json`)을 사용한다. TypeScript는 npm에서 6.0.3으로 해석되어 사용(7.x는 미채택).
- `eslint-config-next`는 ESLint 10 peer 미지원으로 제외, `typescript-eslint` strict 구성 사용.
- 마이그레이션 CLI는 `scripts/migrate.mts`, 롤백은 `--confirm` 필수.
- 스키마에 `operators`, `operator_sessions`, `login_attempts`(Phase 6용)가 추가되었다.
- 자세한 현황과 알려진 위험은 루트 `README.md` 참고.
