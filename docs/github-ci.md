# KuchuPuchu — GitHub CI/CD

## Pull request checks
- dependency installation
- formatting check
- lint
- type check
- unit tests
- integration tests
- build
- dependency vulnerability scan
- secret scan

## Branch protection
Main/release branches should require:
- passing CI
- pull request review
- no unresolved required checks

## Secrets
Never store:
- SPV API secrets
- OAuth secrets
- database service credentials
- signing keys
- deployment tokens

Use GitHub Actions Secrets/Variables or the chosen deployment secret manager.

## Build discipline
An agent must:
1. inspect repository before editing.
2. understand existing architecture.
3. make minimal coherent changes.
4. run local checks.
5. commit logically.
6. push only after checks pass.
7. inspect CI logs.
8. fix failures.
9. rerun until required checks pass.

No shortcut implementation is acceptable.

## Deployment
CI builds the exact artifact that is deployed. Production deployment should run smoke checks and support rollback.
