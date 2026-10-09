# YANTRI Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅ Yes    |
| < 1.0   | ❌ No     |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly:

### How to Report

**Email:** security@yantri.ai

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any proof-of-concept code (if applicable)
- Your contact information

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial Assessment:** Within 5 business days
- **Fix Timeline:** Depends on severity (Critical: 7 days, High: 14 days, Medium: 30 days, Low: 60 days)
- **Public Disclosure:** After fix is deployed, typically 30 days after fix

### What to Expect

1. We'll acknowledge receipt within 48 hours
2. We'll validate and assess the vulnerability
3. We'll develop and test a fix
4. We'll coordinate disclosure timing with you
5. We'll credit you in the security advisory (if desired)

---

## Security Architecture

### Authentication & Authorization

- **WebSocket Authentication:** Token-based via `GEMINI_API_KEY`
- **Agent Authentication:** Shared secret (`AGENT_SHARED_SECRET`) between Node and Python
- **Google OAuth:** PKCE flow with secure token storage
- **CORS:** Restricted to configured origins only

### Data Protection

- **API Keys:** Stored in `secrets.json` with 600 permissions
- **OAuth Tokens:** Encrypted at rest in `google_tokens.json`
- **User Data:** Stored locally in `userdata.json`, `memories.json`
- **S3 Sync:** Optional encryption at rest via S3 SSE

### Network Security

- **HTTPS Only:** Enforced in production (Render/Cloudflare/Nginx)
- **Helmet.js:** CSP, HSTS, X-Frame-Options, XSS protection
- **Rate Limiting:** 100 req/15min on `/api/` endpoints
- **Request Size:** 10MB limit on API requests
- **WebSocket:** Origin validation on upgrade

### Input Validation

- **Zod Schemas:** All tool inputs validated via Zod schemas
- **SQL Injection:** Not applicable (JSON file storage)
- **XSS Prevention:** HTML escaping in transcript display
- **Path Traversal:** Restricted to safe directories

---

## Threat Model

### Assets
1. **User API Keys** (Gemini, Tavily, Google OAuth)
2. **User Data** (memories, reminders, personal records)
3. **Conversation History** (voice transcripts)
4. **System Access** (desktop agent capabilities)

### Threat Actors
1. **External Attackers** (network-based)
2. **Malicious Users** (authenticated)
3. **Compromised Dependencies** (supply chain)
4. **Insider Threats** (development team)

### Attack Vectors & Mitigations

| Vector | Mitigation |
|--------|------------|
| API Key Theft | Short-lived tokens, rotation, encrypted storage |
| XSS in Transcript | HTML entity escaping, CSP headers |
| CSRF | SameSite cookies, Origin validation |
| SSRF | Outbound request validation, private IP blocking |
| RCE via Tools | Sandboxed execution, command allowlist |
| Supply Chain | Dependabot, npm audit, pinned versions |
| Data Exfiltration | Rate limiting, audit logging |

---

## Security Headers

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss: https:; font-src 'self' data:; object-src 'none'; media-src 'self' https:; frame-src 'none';
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: microphone=(), camera=(), geolocation=()
```

---

## Secure Development Practices

### Code Review Requirements
- All PRs require 2 approvals
- Security-focused review for auth/authz changes
- Dependency changes require security review

### Dependency Management
```bash
# Monthly
npm audit
pip-audit -r agent/requirements.txt

# Automated
Dependabot alerts enabled
Weekly dependency updates (auto-merged for patch)
```

### Secrets Management
- **Never commit** `.env`, `secrets.json`, `google_tokens.json`
- Use Render/Cloud secrets for production
- Rotate secrets quarterly
- Audit access quarterly

### Incident Response Plan

1. **Detect** - Monitoring alerts (Prometheus/Grafana)
2. **Assess** - Determine scope and severity
3. **Contain** - Revoke tokens, block IPs, disable endpoints
4. **Eradicate** - Patch vulnerability, rotate secrets
5. **Recover** - Deploy fix, verify, monitor
6. **Postmortem** - Document, improve, share learnings

---

## Compliance

### Data Privacy
- **GDPR:** Right to deletion via `/api/memories/:id` DELETE
- **CCPA:** Data export via `/api/userdata` GET
- **Data Minimization:** Only store necessary data
- **Retention:** User-configurable, default 1 year

### Standards Alignment
- **OWASP ASVS Level 2** (target)
- **NIST CSF** (aligned)
- **ISO 27001** (principles followed)

---

## Vulnerability Disclosure

### Hall of Fame
Thanks to security researchers who've helped improve YANTRI:

<!-- Add researchers here as they report vulnerabilities -->

---

## Contact

**Security Team:** security@yantri.ai  
**PGP Key:** [Available on request]  
**Response Time:** 48 hours (business days)

---

*Last Updated: 2026-10-07*  
*Version: 1.0*