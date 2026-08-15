[한국어](README.ko.md)

# trace-flow

> Trace TypeScript code execution flow and print it as a tree.

## Installation

No installation needed — run directly with npx:

```bash
npx @choisy/trace-flow <symbol>
```

Or install globally:

```bash
npm install -g @choisy/trace-flow
```

## Usage

```bash
trace-flow <symbol> [options]
```

| Option | Default | Description |
|---|---|---|
| `-p, --project <path>` | current dir | Project root to analyze |
| `-d, --depth <number>` | `10` | Maximum trace depth |
| `--calls-only` | — | Show only what the symbol calls (no callers) |

## Examples

### Full trace (default)

Shows the full call chain — top-most caller down through everything the symbol calls:

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

### Calls only

```bash
npx @choisy/trace-flow AuthController.login --calls-only
```