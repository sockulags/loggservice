---
layout: home

hero:
  name: clomp
  text: A tamper-evident audit trail for security work
  tagline: Prove — not just claim — that your security activities happen. Built for SOC 2 and NIS2 evidence. Self-hosted, open source, no paywalls.
  image:
    src: /logo.svg
    alt: clomp
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What is clomp?
      link: /guide/what-is-clomp
    - theme: alt
      text: GitHub
      link: https://github.com/sockulags/clomp

features:
  - icon: ⛓️
    title: Append-only, hash-chained
    details: Every event embeds the SHA-256 of its predecessor, and a database trigger rejects UPDATE/DELETE for every role. History can be extended, never edited.
  - icon: ✍️
    title: Signed checkpoints
    details: The chain tip is signed nightly with Ed25519. Anchor checkpoints externally — email the auditor, POST a webhook — and even root cannot rewrite history undetected.
  - icon: 🔍
    title: Verifiable offline
    details: The JSONL export carries the full chain and signatures. Auditors verify it on their own laptop with a single script — no access to your installation needed.
  - icon: 📅
    title: Scheduled controls
    details: Declare how often an activity must be logged — “access review quarterly” — and clomp surfaces what is overdue, in the UI and in the PDF report.
  - icon: 📄
    title: Audit-ready reports
    details: One-click PDF mapped to SOC 2 criteria and NIS2 articles, with a chain-integrity statement, evidence hashes and scheduled-control status.
  - icon: 🔓
    title: MIT, no open-core
    details: Everything is free — reports, reminders, exports. Self-hosted with Docker Compose and PostgreSQL. Built for organizations that cannot ship data to a SaaS.
---
