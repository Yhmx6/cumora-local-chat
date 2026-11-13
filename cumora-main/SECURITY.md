# Security Policy

We take the security of Cumora seriously. Thank you for helping keep it and
its users safe.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Report privately through either channel:

1. **GitHub private vulnerability reporting** (preferred) — go to the
   [Security tab](https://github.com/yetone/cumora/security) of this
   repository and click **Report a vulnerability**. This opens a private
   advisory visible only to you and the maintainers.
2. **Email** — [privacy@cumora.ai](mailto:privacy@cumora.ai) with enough
   detail to reproduce.

Please include:

- The type of issue (e.g. auth bypass, injection, XSS, privilege escalation).
- The affected component and file(s) — server API, agent runtime, the BYOA
  daemon (`agent-cli`), the Electron desktop shell, the Cloudflare workers, or
  the web client.
- Step-by-step reproduction, and a proof-of-concept if you have one.
- The impact you believe it has (what an attacker gains).

You'll get an acknowledgement as soon as we've seen the report. We'll keep you
updated on our assessment and a fix timeline, and we're happy to credit you
when the fix ships (let us know if you'd prefer to stay anonymous).

## Scope

In scope — anything that lets someone:

- Access another user's or tenant's data (cross-tenant isolation breaks).
- Act as another user or agent (authentication / identity-pinning bypass).
- Execute code or inject content (SQLi, command injection, stored/reflected
  XSS, deserialization).
- Escalate privileges (non-admin reaching admin surfaces).
- Recover secrets from the server, the client, or in transit.

Out of scope:

- A production boot that was deliberately started with the public
  dev-default `AGENT_RUNTIME_SECRET` after the startup check was bypassed.
  That check runs only when `NODE_ENV === 'production'`
  (`server/src/env.ts`). `NODE_ENV` defaults to `development`, and in that
  mode the server does boot with the default. A report that the default
  works outside production is describing the code, not a bypass.
- Denial of service that is only volumetric flooding. An unauthenticated
  endpoint that leaks data, forges a session, or crosses a tenant is in
  scope under the bullets above. The server does not have a general HTTP
  rate limit; that absence is not itself a vulnerability report.
- Reports from automated scanners without a demonstrated, exploitable impact.
- Social engineering, physical access, or attacks requiring a
  compromised operator machine.

## Trust boundaries

The **server is the authorization boundary** for the web app, the Electron
shell, the mobile shell, and the BYOA daemon. Those clients are untrusted.
Agent identity on every `/runtime/*` call is pinned from a signed JWT, never
from the request body. Tenants are isolated in SQL, not in the client.

On a **BYOA host**, a second boundary protects the operator's machine:
secure-default model tools are OS-sandboxed and receive neither the runtime
JWT nor the daemon's environment or network authority.

The **cloud agent Pod is a weak boundary, on purpose**. Mounting FUSE on
GKE's container-optimized OS needs `CAP_SYS_ADMIN` during bootstrap and
leaves AppArmor unconfined for that phase. The long-running process is then
dropped to uid 65532. Conversation content reaches a shell inside that Pod
by design. What we want reported is a path from one tenant's agent to
another tenant's Pod, data, or credentials, or a path from code in the Pod
to the node or the control plane. The granted capabilities and the
compensating controls are written down in
[`server/k8s/gke.md`](server/k8s/gke.md) under "Agent policy and runtime
security prerequisites".

**Inbound email is authenticated before it can wear an internal identity.**
`workers/email-gate` accepts mail whose recipient domain is listed. It
reports Cloudflare's `Authentication-Results` (`mx.cloudflare.net` only) as
`authVerdict`, plus the SMTP envelope sender. The server maps the `From:`
header onto an agent or a human in the recipient's workspace only when that
verdict is `aligned` and the envelope mailbox is the same address.
Otherwise the author is `external:<addr>`. The HMAC on
`/webhooks/email/inbound` authenticates the worker to the server. Details
are in [`docs/email.md`](docs/email.md).

A bypass of any of these boundaries is a vulnerability we want to hear about.

## Deploying Cumora securely

If you self-host, at minimum:

- Set a high-entropy `AGENT_RUNTIME_SECRET` (`openssl rand -hex 32`). The
  server will refuse to start in production otherwise.
- Serve user-uploaded attachments from a **separate origin** (configure the
  `R2_*` variables) rather than the local-disk fallback, so a hostile upload
  can never run on the app's origin.
- Keep every other secret (OAuth client secrets, `RESEND_API_KEY`,
  `EMAIL_INBOUND_HMAC_SECRET`, `R2_URL_SIGNING_SECRET`, APNs/FCM credentials)
  out of the repo and in your deployment's secret store.

`server/src/env.ts` is the authoritative list of every variable the server
reads, including the ones above. [`.env.example`](.env.example) annotates a
commonly-edited subset and does **not** cover `AGENT_RUNTIME_SECRET` or the
APNs/FCM credentials.
