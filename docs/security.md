# KuchuPuchu — Security Policy

## Threat model
Protect against:
- account takeover
- unauthorized API access
- fake coin credits
- payment replay
- referral abuse
- inventory duplication
- spam
- harassment
- scraping
- privilege escalation
- secret leakage

## Rules
- Server-authoritative permissions.
- Strong authentication.
- Least privilege.
- Validate every input.
- Rate-limit sensitive endpoints.
- Use secure cookies/tokens according to the selected stack.
- Keep secrets in CI/repository secret managers.
- Never commit .env files.
- Scan dependencies.
- Scan repository secrets.
- Audit admin actions.

## Financial security
No client-side balance mutation.
No client-side payment verification.
All financial operations idempotent and transactional.

## Incident response
1. Detect.
2. Contain.
3. Preserve relevant audit evidence.
4. Correct.
5. Reconcile financial state.
6. Deploy fix.
7. Review root cause.
8. Update tests and controls.
