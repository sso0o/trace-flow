[English](README.md)

# trace-flow

> TypeScript 코드의 실행 흐름을 추적해서 트리로 출력합니다.

## 설치

별도 설치 없이 npx로 바로 실행할 수 있어요:

```bash
npx @choisy/trace-flow <심볼>
```

전역 설치:

```bash
npm install -g @choisy/trace-flow
```

## 사용법

```bash
trace-flow <심볼> [옵션]
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `-p, --project <경로>` | 현재 디렉터리 | 분석할 프로젝트 루트 |
| `-d, --depth <숫자>` | `10` | 최대 추적 깊이 |
| `--calls-only` | — | 호출하는 쪽 없이, 이 심볼이 호출하는 것만 표시 |

## 예시

### 전체 추적 (기본)

최상위 호출자부터 심볼이 호출하는 모든 것까지 전체 체인을 보여줍니다:

```bash
npx @choisy/trace-flow AuthController.login
```

```
handleLoginRequest (src/router.ts:3)
  -> AuthController.login (src/authController.ts:4)
    -> AuthService.login (src/authService.ts:5)
      -> findUserByEmail (src/userRepository.ts:1)
      -> issueToken (src/tokenService.ts:1)
```

### 호출만 보기

```bash
npx @choisy/trace-flow AuthController.login --calls-only
```