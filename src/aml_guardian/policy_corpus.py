"""Original educational summaries, not quotations or an approved bank policy."""

CORPUS_VERSION = "2026-10-24"

PASSAGES = [
    {
        "id": "GUIDE-STRUCTURING", "title": "Split deposits and intent",
        "topics": "structuring split deposits smurfing cash threshold branches",
        "url": "https://bsaaml.ffiec.gov/manual/Appendices/07",
        "kind": "public_guidance_summary",
        "text": "Repeated cash deposits below a reporting threshold can warrant investigation, "
                "but amounts alone do not establish an intent to evade reporting. Review the "
                "customer's activity, purpose and available supporting information. This demo "
                "flags transfers between $9,000 and $9,999 without knowing whether they are cash; "
                "that numerical indicator is not a legal finding of structuring.",
    },
    {
        "id": "GUIDE-CTR", "title": "Cash reporting is not a wire-transfer threshold",
        "topics": "ctr currency cash reporting 10000 10,000 wire threshold aggregation",
        "url": "https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/05",
        "kind": "public_guidance_summary",
        "text": "Currency transaction reporting concerns cash, not every wire or electronic "
                "transfer above $10,000. Applicable cash transactions must be assessed with "
                "aggregation rules and any applicable exemptions. Do not infer a CTR obligation "
                "from this demo's transfer amounts: it does not establish cash status, banking-day "
                "aggregation or exemptions.",
    },
    {
        "id": "GUIDE-SAR", "title": "An alert is not a SAR filing decision",
        "topics": "sar report reporting filing suspicious escalation narrative human review",
        "url": "https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/04",
        "kind": "public_guidance_summary",
        "text": "A suspicious-activity alert is a starting point for evaluation, not proof of a "
                "crime or an automatic instruction to file a SAR. Filing requirements depend on "
                "the applicable rules and facts; there is no universal demo-score filing threshold. "
                "Document the investigation and use the institution's authorized decision process. "
                "This application only recommends report consideration and never files a report.",
    },
    {
        "id": "GUIDE-SCREENING", "title": "Resolve a potential screening match",
        "topics": "sanctions screening ofac match hold name identity blocked pep",
        "url": "https://ofac.treasury.gov/faqs/5",
        "kind": "public_guidance_summary",
        "text": "A potential sanctions-name match needs resolution using the relevant list, "
                "available identifying information and the organization's sanctions procedures. "
                "A similar name alone is not a confirmed identity match. This application's "
                "two-name substring check is illustrative, not live OFAC or PEP coverage. Its "
                "internal HOLD is not a legal determination to block or reject a transaction.",
    },
    {
        "id": "GUIDE-FLOWS", "title": "Many senders, rapid outflow and returning funds",
        "topics": "fan-in fanin funnel layering circular cycle return money senders sources outflow round transfers",
        "url": "https://bsaaml.ffiec.gov/manual/Appendices/07",
        "kind": "public_guidance_summary",
        "text": "Unusual patterns of incoming and outgoing funds can warrant additional inquiry, "
                "especially when inconsistent with the customer's expected activity. Many senders, "
                "rapid outflow, returning funds or round amounts are leads, not proof of laundering. "
                "Check business purpose, counterparties and supporting records before drawing "
                "conclusions. The demo's graph indicators cannot establish those explanations.",
    },
    {
        "id": "DEMO-SCORE", "title": "How the demo risk score is calculated and routed",
        "topics": "score risk rules points clear review hold recommendation decision explain",
        "url": None, "kind": "demo_rule_note",
        "text": "The demo risk score is calculated by adding application-rule points, not "
                "regulatory thresholds: sub-threshold deposit "
                "indicators add 25 points each (cap 50), fan-in adds 5 per source (cap 20), cycles "
                "add 25 each (cap 50), distinct sources add 10 each (cap 30), and large round "
                "transfers add 10 each (cap 20). The total is capped at 100. Below 40 routes to "
                "CLEAR, 40 through 69 to REVIEW, and 70 or more to report consideration. An "
                "illustrative screening hit overrides the score to 100 and routes to HOLD. "
                "No route files or approves anything.",
    },
    {
        "id": "DEMO-LIMITS", "title": "What a routine result cannot establish",
        "topics": "routine clear legitimate safe innocent blind spots limitations evidence confidence",
        "url": None, "kind": "demo_rule_note",
        "text": "CLEAR means no escalation under this limited illustrative scorecard, not that "
                "the customer is legitimate or all risks have been excluded. The demo lacks "
                "verified identity, customer purpose, a complete account history and live "
                "screening. Its risk score is not a probability or AI confidence level. "
                "Every case is synthetic and any real investigation needs authorized human review.",
    },
]
