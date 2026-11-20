# Security policy

## Reporting a vulnerability

Email **support@braynesmartsolutions.com** with details: the file and line,
how to reproduce it, and what an attacker could gain. Please do not open a
public GitHub issue for a security problem.

We aim to acknowledge reports within two business days and to ship a fix in
the next plugin release. If a fix needs more time, we will say so and keep
you updated.

## Scope

This policy covers the code in this repository: the plugin server module
(`src/`), the front-end widget (`public/`), and the admin app (`admin/`).

What the plugin stores is worth stating plainly: aggregate interaction
counters only — no IP addresses, no phone numbers, no visitor identifiers, no
cookies. The analytics beacon is a bodyless `POST` with a single `?event=`
parameter and `credentials: "omit"`, rate-limited and refused cross-origin.

## Out of scope

- The JustFlows platform itself (report platform issues upstream).
- WhatsApp's own apps and servers — chats happen there after a visitor taps
  through, outside this plugin's reach.
