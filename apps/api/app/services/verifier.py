"""Verification pipeline – CoVe (Chain-of-Verification) + Critic.

After report synthesis, this module:
1. Extracts structured claims from the report
2. Verifies each claim against cited evidence (CoVe)
3. Runs a critic evaluation for structure/completeness
4. Triggers refinement if thresholds aren't met

All results are persisted for traceability.
"""

import json
import logging
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class VerificationService:
    """CoVe + Critic verification pipeline.

    CoVe (Chain-of-Verification):
    - Extract structured claims from the report
    - Validate each claim against cited chunks
    - Label: VERIFIED / WEAK / UNSUPPORTED
    - Store supporting snippet
    - Generate evidence_needed suggestions

    Critic:
    - Evaluate report structure
    - Evaluate completeness vs plan
    - Evaluate contradiction handling
    - Produce revision suggestions

    Persistence:
    - Claims table stores each claim + verification status
    - VerificationResult stores run-level metrics
    - Revision history tracked via run events
    """

    # ------------------------------------------------------------------ #
    # Step 1: Extract Claims
    # ------------------------------------------------------------------ #

    async def extract_claims(
        self,
        report_md: str,
        llm: Any,
    ) -> list[dict[str, Any]]:
        """Extract structured claims from the report.

        Returns
        -------
        List of claim dicts:
        {claim_id, section, text, citations: [chunk_id], confidence}
        """
        prompt = f"""You are a fact-checker. Extract all key factual claims from the research report below.

For each claim, provide:
- section: which section it appears in
- text: the exact claim text
- citations: list of citation numbers referenced (as strings)
- confidence: how confident the claim seems (0.0-1.0)

## Report
{report_md[:8000]}

---

Return ONLY valid JSON array:
[
  {{
    "section": "Introduction",
    "text": "The global AI market is expected to reach $190 billion by 2025",
    "citations": ["1", "3"],
    "confidence": 0.8
  }},
  ...
]

Extract up to 20 key claims. Focus on factual assertions, not opinions."""

        try:
            result = await llm.complete_json(prompt, task_type="smart", max_tokens=2000)
            if isinstance(result, list):
                claims = []
                for i, item in enumerate(result):
                    if isinstance(item, dict) and item.get("text"):
                        claims.append({
                            "claim_id": str(uuid4()),
                            "section": item.get("section", ""),
                            "text": item["text"],
                            "citations": item.get("citations", []),
                            "confidence": float(item.get("confidence", 0.5)),
                        })
                return claims
            return []
        except Exception:
            logger.warning("Claim extraction failed", exc_info=True)
            return []

    # ------------------------------------------------------------------ #
    # Step 2: CoVe – Verify Claims
    # ------------------------------------------------------------------ #

    async def verify_claims(
        self,
        claims: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
        llm: Any,
    ) -> list[dict[str, Any]]:
        """Verify each claim against the cited evidence chunks.

        Labels each claim as:
        - VERIFIED: claim is clearly supported by evidence
        - WEAK: partial support or ambiguous
        - UNSUPPORTED: no supporting evidence found

        Returns enriched claim dicts with verification results.
        """
        # Build evidence lookup
        evidence_text = self._build_evidence_context(evidence)

        verified_claims: list[dict[str, Any]] = []

        # Process claims in small batches to respect token limits
        batch_size = 5
        for i in range(0, len(claims), batch_size):
            batch = claims[i:i + batch_size]
            batch_results = await self._verify_batch(batch, evidence_text, llm)
            verified_claims.extend(batch_results)

        return verified_claims

    async def _verify_batch(
        self,
        claims: list[dict[str, Any]],
        evidence_text: str,
        llm: Any,
    ) -> list[dict[str, Any]]:
        """Verify a batch of claims against evidence."""
        claims_text = "\n".join(
            f"{i+1}. [{c.get('section', '?')}] {c['text']}"
            for i, c in enumerate(claims)
        )

        prompt = f"""You are a rigorous fact verification system. Verify each claim against the evidence.

## Evidence
{evidence_text[:6000]}

## Claims to Verify
{claims_text}

---

For each claim, determine:
- status: VERIFIED (clearly supported), WEAK (partial/ambiguous), or UNSUPPORTED (no evidence)
- supporting_snippet: the key evidence text that supports/refutes the claim
- evidence_needed: what additional evidence would strengthen the claim (empty if VERIFIED)

Return ONLY valid JSON array:
[
  {{
    "claim_index": 1,
    "status": "VERIFIED",
    "supporting_snippet": "relevant evidence quote...",
    "evidence_needed": ""
  }},
  ...
]"""

        try:
            result = await llm.complete_json(prompt, task_type="smart", max_tokens=1500)
            if not isinstance(result, list):
                result = []

            verified = []
            for i, claim in enumerate(claims):
                # Find matching verification result
                verification = next(
                    (r for r in result if isinstance(r, dict) and r.get("claim_index") == i + 1),
                    None,
                )

                enriched = {**claim}
                if verification:
                    enriched["verification_status"] = verification.get("status", "WEAK")
                    enriched["verification_snippet"] = verification.get("supporting_snippet", "")
                    enriched["evidence_needed"] = verification.get("evidence_needed", "")
                else:
                    enriched["verification_status"] = "WEAK"
                    enriched["verification_snippet"] = ""
                    enriched["evidence_needed"] = "Verification result missing"

                verified.append(enriched)

            return verified

        except Exception:
            logger.warning("Claim verification batch failed", exc_info=True)
            return [
                {**c, "verification_status": "WEAK", "verification_snippet": "", "evidence_needed": "Verification error"}
                for c in claims
            ]

    # ------------------------------------------------------------------ #
    # Step 3: Critic Evaluation
    # ------------------------------------------------------------------ #

    async def critic_evaluate(
        self,
        report_md: str,
        plan: dict[str, Any],
        verified_claims: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
        llm: Any,
    ) -> dict[str, Any]:
        """Run the Critic evaluation on the report.

        Evaluates:
        - Structure: logical flow, headings, organization
        - Completeness: all sub-questions addressed
        - Contradiction handling: conflicting evidence acknowledged

        Returns
        -------
        Dict with scores and revision suggestions.
        """
        sub_questions = plan.get("sub_questions", [])

        # Compute verification stats
        total_claims = len(verified_claims)
        verified_count = sum(1 for c in verified_claims if c.get("verification_status") == "VERIFIED")
        weak_count = sum(1 for c in verified_claims if c.get("verification_status") == "WEAK")
        unsupported_count = sum(1 for c in verified_claims if c.get("verification_status") == "UNSUPPORTED")

        citation_coverage = verified_count / total_claims if total_claims > 0 else 0
        groundedness = (verified_count + 0.5 * weak_count) / total_claims if total_claims > 0 else 0

        prompt = f"""You are a research report critic. Evaluate the report quality.

## Sub-Questions (from plan)
{chr(10).join(f"- {sq}" for sq in sub_questions)}

## Verification Summary
- Total claims: {total_claims}
- Verified: {verified_count}
- Weak: {weak_count}
- Unsupported: {unsupported_count}

## Report (first 5000 chars)
{report_md[:5000]}

---

Evaluate on three dimensions (each 0.0 to 1.0):

1. **structure_score**: Is the report well-organized with clear headings, logical flow, and proper sections?
2. **completeness_score**: Are all sub-questions adequately addressed?
3. **contradiction_handling**: Are conflicting evidence sources acknowledged and discussed?

Also provide:
- revision_suggestions: list of specific improvements needed
- missing_topics: which sub-questions are not adequately covered

Return ONLY valid JSON:
{{
  "structure_score": 0.85,
  "completeness_score": 0.9,
  "contradiction_handling": 0.7,
  "revision_suggestions": ["Add more citations to section 3", "..."],
  "missing_topics": ["Topic A"]
}}"""

        try:
            result = await llm.complete_json(prompt, task_type="smart", max_tokens=1000)

            structure = float(result.get("structure_score", 0.5))
            completeness = float(result.get("completeness_score", 0.5))
            contradiction = float(result.get("contradiction_handling", 0.5))

        except Exception:
            logger.warning("Critic evaluation failed", exc_info=True)
            result = {}
            structure = 0.5
            completeness = 0.5
            contradiction = 0.5

        # Compute source diversity
        domains = set()
        for entry in evidence:
            for ev in entry.get("evidence", []):
                d = ev.get("domain", "")
                if d:
                    domains.add(d)
        diversity = min(1.0, len(domains) / 5) if domains else 0.0

        # Overall pass/fail
        scores = {
            "citation_coverage": _clamp(citation_coverage),
            "groundedness_score": _clamp(groundedness),
            "coverage_score": _clamp(completeness),
            "contradiction_count": unsupported_count,
            "source_diversity_score": _clamp(diversity),
            "structure_score": _clamp(structure),
            "completeness_score": _clamp(completeness),
        }

        all_above_min = all(
            v > 0.5 for k, v in scores.items()
            if k != "contradiction_count"
        )
        overall_passed = all_above_min and groundedness > 0.6

        return {
            "scores": scores,
            "overall_passed": overall_passed,
            "verified_claims": verified_claims,
            "revision_suggestions": result.get("revision_suggestions", []),
            "missing_topics": result.get("missing_topics", []),
            "feedback": result.get("feedback", ""),
        }

    # ------------------------------------------------------------------ #
    # Full Pipeline
    # ------------------------------------------------------------------ #

    async def run_verification(
        self,
        report_md: str,
        plan: dict[str, Any],
        evidence: list[dict[str, Any]],
        llm: Any,
        db: AsyncSession | None = None,
        run_id: UUID | None = None,
        iteration: int = 0,
    ) -> dict[str, Any]:
        """Run the full verification pipeline.

        1. Extract claims
        2. Verify claims (CoVe)
        3. Critic evaluation
        4. Persist results
        5. Return pass/fail + metrics

        Returns
        -------
        Dict with all verification results and pass/fail decision.
        """
        # Step 1: Extract claims
        claims = await self.extract_claims(report_md, llm)
        logger.info("Extracted %d claims from report", len(claims))

        # Step 2: Verify claims
        verified_claims = await self.verify_claims(claims, evidence, llm)
        logger.info(
            "Verified claims: %d VERIFIED, %d WEAK, %d UNSUPPORTED",
            sum(1 for c in verified_claims if c.get("verification_status") == "VERIFIED"),
            sum(1 for c in verified_claims if c.get("verification_status") == "WEAK"),
            sum(1 for c in verified_claims if c.get("verification_status") == "UNSUPPORTED"),
        )

        # Step 3: Critic evaluation
        critic_result = await self.critic_evaluate(
            report_md=report_md,
            plan=plan,
            verified_claims=verified_claims,
            evidence=evidence,
            llm=llm,
        )

        # Step 4: Persist (if DB available)
        if db and run_id:
            await self._persist_results(
                db=db,
                run_id=run_id,
                verified_claims=verified_claims,
                critic_result=critic_result,
                iteration=iteration,
            )

        return critic_result

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #

    async def _persist_results(
        self,
        db: AsyncSession,
        run_id: UUID,
        verified_claims: list[dict[str, Any]],
        critic_result: dict[str, Any],
        iteration: int,
    ) -> None:
        """Persist claims and verification results to the database."""
        from app.db.models import Claim, VerificationResult

        try:
            # Persist claims
            for claim_data in verified_claims:
                claim = Claim(
                    id=uuid4(),
                    run_id=run_id,
                    section=claim_data.get("section"),
                    text=claim_data["text"],
                    citation_chunk_ids=claim_data.get("citations"),
                    confidence=claim_data.get("confidence", 0.5),
                    verification_status=claim_data.get("verification_status"),
                    verification_snippet=claim_data.get("verification_snippet"),
                    evidence_needed=claim_data.get("evidence_needed"),
                )
                db.add(claim)

            # Persist verification result
            scores = critic_result.get("scores", {})
            vr = VerificationResult(
                id=uuid4(),
                run_id=run_id,
                iteration=iteration,
                citation_coverage=scores.get("citation_coverage", 0),
                groundedness_score=scores.get("groundedness_score", 0),
                coverage_score=scores.get("coverage_score", 0),
                contradiction_count=scores.get("contradiction_count", 0),
                source_diversity_score=scores.get("source_diversity_score", 0),
                structure_score=scores.get("structure_score", 0),
                completeness_score=scores.get("completeness_score", 0),
                overall_passed=critic_result.get("overall_passed", False),
                feedback_json={
                    "revision_suggestions": critic_result.get("revision_suggestions", []),
                    "missing_topics": critic_result.get("missing_topics", []),
                },
            )
            db.add(vr)
            await db.flush()

            logger.info(
                "Persisted %d claims and verification result for run %s",
                len(verified_claims), run_id,
            )

        except Exception:
            logger.exception("Failed to persist verification results")

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _build_evidence_context(evidence: list[dict[str, Any]]) -> str:
        """Build a text context from evidence for verification."""
        parts: list[str] = []
        for entry in evidence:
            sq = entry.get("sub_question", "")
            parts.append(f"### {sq}")
            for ev in entry.get("evidence", [])[:5]:
                text = ev.get("chunk_text", ev.get("text", ""))
                domain = ev.get("domain", "unknown")
                parts.append(f"[{domain}] {text[:500]}")
            parts.append("")
        return "\n".join(parts)


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Clamp value to [lo, hi]."""
    return max(lo, min(hi, value))
