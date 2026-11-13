# 0004: What redaction does and does not do

## Decision

For upstreams marked `redact: true` the gateway replaces e-mail addresses,
card numbers that pass the Luhn check and IBANs that pass the mod-97 check.
Checksums keep false positives low: order numbers, dates, versions and IP
addresses are left alone.

## Not in scope

Names, addresses, phone numbers, free-text secrets and anything in images or
tool-call arguments. Detecting those reliably needs an NER model or a DLP
service, and a gateway that pretends to catch them is worse than one that is
clear about catching only well-formed, checkable identifiers.

## Consequences

Redaction is a safety net against accidental pastes, not a compliance
control. Data that must not reach a third party should be routed to a
self-hosted upstream by model alias, which the key allow-lists enforce.
