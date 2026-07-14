# Action catalog

Actions are namespaced, lowercase, dot-separated strings. The catalog below
is seeded on every installation and tagged with the SOC 2 trust-services
criteria and NIS2 (article 21.2/23) items each activity type gives evidence
for. **Custom actions are accepted** — they are flagged in reports as
"not in catalog — review manually".

| Action | Title | SOC 2 | NIS2 |
|---|---|---|---|
| `access.review.completed` | Access review completed | CC6.1, CC6.2, CC6.3 | 21.2(i) |
| `access.granted` | Access granted | CC6.2 | 21.2(i) |
| `access.revoked` | Access revoked | CC6.3 | 21.2(i) |
| `patch.applied` | Patch applied | CC7.1 | 21.2(e) |
| `vulnerability.remediated` | Vulnerability remediated | CC7.1 | 21.2(e) |
| `incident.opened` | Incident opened | CC7.3, CC7.4 | 21.2(b), 23 |
| `incident.resolved` | Incident resolved | CC7.4, CC7.5 | 21.2(b), 23 |
| `incident.reported` | Incident reported to authority | CC7.4 | 23 |
| `backup.completed` | Backup completed | A1.2 | 21.2(c) |
| `backup.tested` | Backup restore tested | A1.3 | 21.2(c) |
| `training.completed` | Security training completed | CC1.4 | 21.2(g) |
| `risk.assessed` | Risk assessment performed | CC3.2 | 21.2(a) |
| `risk.decision` | Risk decision recorded | CC3.2, CC5.1 | 21.2(a) |
| `vendor.review` | Vendor/supplier review | CC9.2 | 21.2(d) |
| `policy.updated` | Policy updated | CC1.3, CC5.3 | 21.2(a) |
| `policy.approved` | Policy approved | CC1.3 | 21.2(a) |
| `crypto.key.rotated` | Cryptographic key rotated | CC6.1 | 21.2(h) |
| `pentest.completed` | Penetration test completed | CC4.1 | 21.2(f) |
| `audit.internal.completed` | Internal audit completed | CC4.1 | 21.2(f) |
| `continuity.tested` | Business continuity plan tested | A1.3 | 21.2(c) |
| `mfa.enforced` | MFA enforcement verified | CC6.1 | 21.2(j) |

## System-generated actions

clomp records changes to its own control plane on the chain:

| Action | Emitted when |
|---|---|
| `control.schedule.created` | A scheduled control is created |
| `control.schedule.updated` | A scheduled control is changed |
| `control.schedule.removed` | A scheduled control is removed |
| `retention.pruned` | Retention pruning ran (includes range, cutoff and archive SHA-256) |

## Naming custom actions

Use `<domain>.<object>.<verb-in-past-tense>` and keep identifiers stable —
reports aggregate by exact string:

```
firewall.rule.changed
dpo.request.fulfilled
recovery.drill.completed
```
