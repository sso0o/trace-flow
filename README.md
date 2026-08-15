# trace-flow

Trace TypeScript code execution flow and print it as a tree.

```bash
npx @choisy/trace-flow AuthController.login
```

```txt
handleLoginRequest (src/router.ts:3)
  -> AuthController.login (src/authController.ts:4)
    -> AuthService.login (src/authService.ts:5)
      -> findUserByEmail (src/userRepository.ts:1)
      -> issueToken (src/tokenService.ts:1)
```

By default the tree shows the full chain: who calls the matched symbol (top-most caller first) down through everything it calls. Pass `--calls-only` to see just what the symbol calls, without its callers.

`trace-flow` is intentionally small in v0.1. It focuses on TypeScript projects, direct function calls, and a single tree output format.
