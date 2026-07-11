# Security Policy — Hot Potato

## Reporting a vulnerability

If you find a security issue, **please do not open a public GitHub issue.** Email the maintainer privately:

**Jakkarin Promsee — jakkarin.promsee@gmail.com**

Include: what you found, how to reproduce it, and the potential impact. This is a solo, free-tier educational project — expect a best-effort, human (not 24/7) response. Please give a reasonable window to fix before any public disclosure.

## Scope

This policy covers the Hot Potato **server** (this repo) and, by extension, its data handling. The web client is a separate repo (`hot-potato-client`). Third-party services (MongoDB Atlas, Google Gemini, Cloudinary, Vercel, Render) have their own security channels — report issues in *their* platforms to *them*.

## What we care about most

- **Student data & privacy.** No student messages or auth tokens are logged by default (`AI_DEBUG_PROMPTS` is a dev-only switch, never enabled in production). The public status page exposes route + code + error *name* only — never messages, bodies, or stacks.
- **Auth integrity.** JWTs are pinned to HS256; passwords are bcrypt-hashed (cost 12) and never returned; Google ID tokens are verified server-side (signature + audience).
- **The two Golden Rules as invariants.** Anonymous users must keep full read + AI access (`optionalAuth`, never `protect` on those paths); there are no per-student quotas. A change that breaks these is treated as a defect.

The intentional threat model, known-open items, and defenses are documented in [`../docs/security-model.md`](../docs/security-model.md). Notably tracked and **not yet fixed**: user input flows into a Mongo `$regex` in lesson search (ReDoS/injection risk) — see [`../notes.md`](../notes.md).

## Good-faith research

Testing against your **own local instance** is welcome. Do not test against the production deployment, other users' data, or attempt denial-of-service. No bug bounty is offered (free-tier project), but credit is happily given.
