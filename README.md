# trace-flow

Trace TypeScript code execution flow and print it as a tree.

```bash
npx @choisy/trace-flow AuthController.login
```

```txt
AuthController.login
  -> AuthService.login
    -> findUserByEmail
    -> issueToken
```

`trace-flow` is intentionally small in v0.1. It focuses on TypeScript projects, direct function calls, and a single tree output format.
