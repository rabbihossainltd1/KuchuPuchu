# KuchuPuchu — Deployment

## Environments
- development
- staging
- production

## Configuration
Environment-specific configuration must be injected securely.

## Deployment requirements
- reproducible build
- migrations applied safely
- health check
- smoke tests
- monitoring
- rollback procedure

## Database changes
Prefer backward-compatible migrations.
Never delete/rename production fields without a migration strategy.

## Release checklist
- CI green
- security checks green
- database migration reviewed
- environment variables verified
- payment integration verified in appropriate environment
- smoke tests passed
- rollback available
