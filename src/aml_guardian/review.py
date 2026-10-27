"""Human review policy. Code, not the UI or a model, decides which dispositions
a reviewer may record at each level, and enforces four-eyes on escalation."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Action = Literal["APPROVE_SAR", "DISMISS", "ESCALATE"]
MAX_LEVEL = 2

LABELS = {
    "APPROVE_SAR": "Approve SAR filing",
    "DISMISS": "Close with no further action",
    "ESCALATE": "Escalate to a senior reviewer",
}
CONSEQUENCES = {
    "APPROVE_SAR": "Records your approval of the draft for SAR filing and closes the case. "
                   "Simulated only: nothing is filed with any regulator.",
    "DISMISS": "Records that the activity is explained or not suspicious and closes the case.",
    "ESCALATE": "Pauses the case again for a second, different reviewer (four-eyes). "
                "You cannot approve your own escalation.",
}
CHECKLIST = [
    "Overview: I read the score explanation and the signals worth a closer look.",
    "Evidence: I opened the findings and their linked sources.",
    "Case draft: I read the narrative and know it is a draft, not a filed report.",
]


class ReviewCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Action
    reviewer: str = Field(min_length=2, max_length=60)
    rationale: str = Field(min_length=20, max_length=1000)
    evidence_reviewed: bool

    @field_validator("reviewer", "rationale", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        return " ".join(value.split()) if isinstance(value, str) else value


class ReviewRecord(BaseModel):
    level: int
    action: Action
    label: str
    reviewer: str
    rationale: str
    recorded_at: str


class ReviewOption(BaseModel):
    action: Action
    label: str
    consequence: str
    allowed: bool
    blocked_reason: Optional[str] = None


class PendingReview(BaseModel):
    level: int
    role: str
    question: str
    options: List[ReviewOption]
    checklist: List[str]
    previous: Optional[ReviewRecord] = None


def _blocked(action: str, recommendation: Optional[str], level: int) -> Optional[str]:
    if level >= MAX_LEVEL and action == "ESCALATE":
        return "Senior review is the final level in this workflow."
    if recommendation == "HOLD" and level == 1 and action != "ESCALATE":
        return "A screening HOLD must be resolved by a senior reviewer. Escalate it."
    return None


def pending_review(recommendation: Optional[str], reviews: List[dict]) -> PendingReview:
    level = len(reviews) + 1
    previous = ReviewRecord.model_validate(reviews[-1]) if reviews else None
    if level == 1:
        role = "Level 1 · Analyst review"
        question = ("The agents have stopped and handed this case to you. Decide whether to "
                    "approve SAR filing, close it, or escalate it to a senior reviewer.")
    else:
        role = "Level 2 · Senior four-eyes review"
        question = (f"{previous.reviewer if previous else 'An analyst'} escalated this case. "
                    "Make the final decision as a different person from the analyst.")
    options = []
    for action in ("APPROVE_SAR", "DISMISS", "ESCALATE"):
        reason = _blocked(action, recommendation, level)
        options.append(ReviewOption(action=action, label=LABELS[action],
                                    consequence=CONSEQUENCES[action],
                                    allowed=reason is None, blocked_reason=reason))
    return PendingReview(level=level, role=role, question=question, options=options,
                         checklist=CHECKLIST, previous=previous)


def validate(command: ReviewCommand, recommendation: Optional[str], reviews: List[dict]) -> None:
    """Raise ValueError with a reviewer-readable message when the command is not allowed."""
    level = len(reviews) + 1
    if level > MAX_LEVEL:
        raise ValueError("This case has already received its final review.")
    if not command.evidence_reviewed:
        raise ValueError("Confirm that you reviewed the evidence and the draft before deciding.")
    reason = _blocked(command.action, recommendation, level)
    if reason:
        raise ValueError(reason)
    if reviews and reviews[-1]["reviewer"].casefold() == command.reviewer.casefold():
        raise ValueError("Four-eyes rule: the senior reviewer must be a different person "
                         "from the analyst who escalated.")


def record(command: dict, recommendation: Optional[str], reviews: List[dict]) -> dict:
    parsed = ReviewCommand.model_validate(command)
    validate(parsed, recommendation, reviews)
    return ReviewRecord(
        level=len(reviews) + 1, action=parsed.action, label=LABELS[parsed.action],
        reviewer=parsed.reviewer, rationale=parsed.rationale,
        recorded_at=datetime.now(timezone.utc).isoformat()).model_dump()


def disposition(recommendation: Optional[str], reviews: List[dict],
                legacy: Optional[str] = None) -> str:
    if recommendation == "CLEAR":
        return "Closed automatically: no escalation recommended; no human approval recorded."
    if not reviews:
        return f"Closed with legacy analyst input: {legacy or 'n/a'}."
    last = reviews[-1]
    if last["action"] == "APPROVE_SAR":
        return (f"SAR filing approved by {last['reviewer']} (level {last['level']}). "
                "Simulated only: nothing was filed.")
    return f"Closed with no further action by {last['reviewer']} (level {last['level']})."
