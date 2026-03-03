"""Knowledge Graph module – entity extraction, storage, and query.

Stores KG in the configured SQL store via SQLAlchemy (not Neo4j).
Uses spaCy for initial entity extraction and LLM for normalization + relation extraction.
"""

import logging
import re
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Entity types for the knowledge graph
ENTITY_TYPES = {"Person", "Org", "Location", "Concept", "Document", "Claim"}

# Relation types
RELATION_TYPES = {
    "MENTIONS", "SUPPORTS", "CONTRADICTS",
    "RELATED_TO", "CITES", "ABOUT",
}


class KnowledgeGraphService:
    """Knowledge Graph operations backed by Postgres.

    Pipeline:
    1. spaCy entity extraction on document text
    2. LLM normalization + relation extraction on top chunks
    3. Upsert nodes with dedupe
    4. Create edges after document ingestion and claim verification

    Uses:
    - Gap detection (missing entity coverage)
    - Contradiction detection
    - KG summary for final report
    """

    def __init__(self) -> None:
        self._nlp = None  # Lazy-loaded spaCy model

    def _get_nlp(self):
        """Lazy-load the spaCy model."""
        if self._nlp is None:
            try:
                import spacy
                try:
                    self._nlp = spacy.load("en_core_web_sm")
                except OSError:
                    logger.warning(
                        "spaCy model 'en_core_web_sm' not found. "
                        "Run: python -m spacy download en_core_web_sm"
                    )
                    # Create a minimal blank model
                    self._nlp = spacy.blank("en")
            except ImportError:
                logger.warning("spaCy not installed, using regex fallback for NER")
                self._nlp = None
        return self._nlp

    # ------------------------------------------------------------------ #
    # Entity Extraction (spaCy baseline)
    # ------------------------------------------------------------------ #

    def extract_entities(self, text: str) -> list[dict[str, str]]:
        """Extract entities from text using spaCy NER.

        Returns
        -------
        List of dicts: {text, type, label} where type is mapped to KG node types.
        """
        nlp = self._get_nlp()
        if nlp is None:
            return self._regex_entity_extraction(text)

        # Limit text length for performance
        max_chars = 50_000
        truncated = text[:max_chars] if len(text) > max_chars else text

        doc = nlp(truncated)
        entities: list[dict[str, str]] = []
        seen: set[str] = set()

        # spaCy label -> KG type mapping
        label_map = {
            "PERSON": "Person",
            "ORG": "Org",
            "GPE": "Location",
            "LOC": "Location",
            "FAC": "Location",
            "NORP": "Org",
            "EVENT": "Concept",
            "WORK_OF_ART": "Document",
            "LAW": "Concept",
            "PRODUCT": "Concept",
        }

        for ent in doc.ents:
            entity_text = ent.text.strip()
            if not entity_text or len(entity_text) < 2:
                continue

            norm_key = entity_text.lower()
            if norm_key in seen:
                continue
            seen.add(norm_key)

            kg_type = label_map.get(ent.label_, "Concept")
            entities.append({
                "text": entity_text,
                "type": kg_type,
                "label": ent.label_,
            })

        return entities

    @staticmethod
    def _regex_entity_extraction(text: str) -> list[dict[str, str]]:
        """Fallback entity extraction using regex (no spaCy)."""
        entities: list[dict[str, str]] = []
        seen: set[str] = set()

        # Find capitalized phrases (likely proper nouns)
        for match in re.finditer(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b", text[:20000]):
            entity_text = match.group(1).strip()
            norm_key = entity_text.lower()
            if norm_key not in seen and len(entity_text) > 2:
                seen.add(norm_key)
                entities.append({
                    "text": entity_text,
                    "type": "Concept",
                    "label": "PROPER_NOUN",
                })

        return entities[:50]  # Cap at 50 entities

    # ------------------------------------------------------------------ #
    # LLM-based Relation Extraction
    # ------------------------------------------------------------------ #

    async def extract_relations_llm(
        self,
        text: str,
        entities: list[dict[str, str]],
        llm: Any,
    ) -> list[dict[str, Any]]:
        """Use LLM to extract relations between entities.

        Only called on top-ranked chunks to control costs.

        Returns
        -------
        List of dicts: {from_entity, to_entity, relation_type, confidence}
        """
        if not entities or len(entities) < 2:
            return []

        # Limit entities to reduce prompt size
        top_entities = entities[:20]
        entity_list = "\n".join(
            f"- {e['text']} ({e['type']})" for e in top_entities
        )

        prompt = f"""Extract relationships between entities from the text below.

## Entities
{entity_list}

## Text
{text[:4000]}

---

For each relationship between two entities, provide:
- from_entity: the source entity text
- to_entity: the target entity text
- relation_type: one of MENTIONS, SUPPORTS, CONTRADICTS, RELATED_TO, CITES, ABOUT
- confidence: float 0-1

Return ONLY valid JSON array:
[
  {{"from_entity": "...", "to_entity": "...", "relation_type": "...", "confidence": 0.8}},
  ...
]

Maximum 10 relations. Only include clear, meaningful relationships."""

        try:
            result = await llm.complete_json(prompt, task_type="fast", max_tokens=800)
            if isinstance(result, list):
                return [
                    r for r in result
                    if isinstance(r, dict)
                    and r.get("from_entity")
                    and r.get("to_entity")
                    and r.get("relation_type") in RELATION_TYPES
                ]
            return []
        except Exception:
            logger.warning("LLM relation extraction failed", exc_info=True)
            return []

    # ------------------------------------------------------------------ #
    # Database Operations
    # ------------------------------------------------------------------ #

    async def upsert_node(
        self,
        db: AsyncSession,
        node_type: str,
        canonical_name: str,
        aliases: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> UUID:
        """Insert or update a KG node with dedup by (type, canonical_name).

        Returns the node UUID.
        """
        from app.db.models import KGNode

        stmt = select(KGNode).where(
            KGNode.type == node_type,
            KGNode.canonical_name == canonical_name,
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()

        if existing:
            # Merge aliases
            if aliases:
                current_aliases = existing.aliases or []
                merged = list(set(current_aliases + aliases))
                existing.aliases = merged
            if metadata:
                current_meta = existing.metadata_json or {}
                current_meta.update(metadata)
                existing.metadata_json = current_meta
            return existing.id

        node = KGNode(
            id=uuid4(),
            type=node_type,
            canonical_name=canonical_name,
            aliases=aliases or [],
            metadata_json=metadata or {},
        )
        db.add(node)
        await db.flush()
        return node.id

    async def create_edge(
        self,
        db: AsyncSession,
        from_node_id: UUID,
        to_node_id: UUID,
        relation_type: str,
        confidence: float = 0.5,
        evidence_chunk_id: UUID | None = None,
        run_id: UUID | None = None,
    ) -> UUID:
        """Create a KG edge between two nodes."""
        from app.db.models import KGEdge

        edge = KGEdge(
            id=uuid4(),
            from_node_id=from_node_id,
            to_node_id=to_node_id,
            relation_type=relation_type,
            confidence=confidence,
            evidence_chunk_id=evidence_chunk_id,
            run_id=run_id,
        )
        db.add(edge)
        await db.flush()
        return edge.id

    # ------------------------------------------------------------------ #
    # Full Pipeline
    # ------------------------------------------------------------------ #

    async def process_document(
        self,
        db: AsyncSession,
        document_text: str,
        document_title: str,
        run_id: UUID | None = None,
        llm: Any = None,
    ) -> dict[str, Any]:
        """Full KG extraction pipeline for a document.

        1. Extract entities with spaCy
        2. Upsert nodes
        3. Extract relations with LLM (if available)
        4. Create edges

        Returns summary of nodes and edges created.
        """
        # Step 1: Entity extraction
        entities = self.extract_entities(document_text)
        logger.info("Extracted %d entities from %r", len(entities), document_title[:60])

        if not entities:
            return {"nodes_created": 0, "edges_created": 0, "entities": []}

        # Step 2: Upsert nodes
        node_map: dict[str, UUID] = {}  # entity_text -> node_id
        for entity in entities:
            node_id = await self.upsert_node(
                db=db,
                node_type=entity["type"],
                canonical_name=entity["text"],
            )
            node_map[entity["text"]] = node_id

        # Also create a Document node for the source
        doc_node_id = await self.upsert_node(
            db=db,
            node_type="Document",
            canonical_name=document_title[:500],
        )

        # Create MENTIONS edges from document to each entity
        edges_created = 0
        for entity_text, entity_node_id in node_map.items():
            await self.create_edge(
                db=db,
                from_node_id=doc_node_id,
                to_node_id=entity_node_id,
                relation_type="MENTIONS",
                confidence=0.7,
                run_id=run_id,
            )
            edges_created += 1

        # Step 3 & 4: LLM relation extraction (if available)
        if llm and len(entities) >= 2:
            relations = await self.extract_relations_llm(
                text=document_text,
                entities=entities,
                llm=llm,
            )
            for rel in relations:
                from_id = node_map.get(rel["from_entity"])
                to_id = node_map.get(rel["to_entity"])
                if from_id and to_id:
                    await self.create_edge(
                        db=db,
                        from_node_id=from_id,
                        to_node_id=to_id,
                        relation_type=rel["relation_type"],
                        confidence=rel.get("confidence", 0.5),
                        run_id=run_id,
                    )
                    edges_created += 1

        return {
            "nodes_created": len(node_map) + 1,
            "edges_created": edges_created,
            "entities": [{"text": e["text"], "type": e["type"]} for e in entities[:20]],
        }

    # ------------------------------------------------------------------ #
    # Analysis
    # ------------------------------------------------------------------ #

    async def detect_gaps(
        self,
        db: AsyncSession,
        sub_questions: list[str],
        run_id: UUID | None = None,
    ) -> list[str]:
        """Detect gaps in entity coverage for the given sub-questions.

        Returns list of sub-questions with insufficient entity coverage.
        """
        # Simple heuristic: extract entities from sub-questions
        # and check if they exist in the KG
        gaps: list[str] = []
        from app.db.models import KGNode

        for sq in sub_questions:
            sq_entities = self.extract_entities(sq)
            if not sq_entities:
                continue

            covered = 0
            for entity in sq_entities:
                stmt = select(KGNode).where(
                    KGNode.canonical_name == entity["text"]
                )
                result = (await db.execute(stmt)).scalar_one_or_none()
                if result:
                    covered += 1

            coverage = covered / len(sq_entities) if sq_entities else 0
            if coverage < 0.5:
                gaps.append(sq)

        return gaps

    async def detect_contradictions(
        self,
        db: AsyncSession,
        run_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        """Find CONTRADICTS edges in the KG for the current run.

        Returns list of contradiction details.
        """
        from app.db.models import KGEdge, KGNode

        stmt = select(KGEdge).where(
            KGEdge.relation_type == "CONTRADICTS",
        )
        if run_id:
            stmt = stmt.where(KGEdge.run_id == run_id)

        edges = (await db.execute(stmt)).scalars().all()

        contradictions: list[dict[str, Any]] = []
        for edge in edges:
            from_stmt = select(KGNode).where(KGNode.id == edge.from_node_id)
            to_stmt = select(KGNode).where(KGNode.id == edge.to_node_id)

            from_node = (await db.execute(from_stmt)).scalar_one_or_none()
            to_node = (await db.execute(to_stmt)).scalar_one_or_none()

            if from_node and to_node:
                contradictions.append({
                    "entity_a": from_node.canonical_name,
                    "entity_b": to_node.canonical_name,
                    "confidence": edge.confidence,
                })

        return contradictions

    async def generate_summary(
        self,
        db: AsyncSession,
        run_id: UUID | None = None,
    ) -> str:
        """Generate a text summary of the KG for inclusion in the final report."""
        from app.db.models import KGNode, KGEdge

        # Count nodes by type
        node_stmt = select(KGNode)
        nodes = (await db.execute(node_stmt)).scalars().all()

        type_counts: dict[str, int] = {}
        for node in nodes:
            type_counts[node.type] = type_counts.get(node.type, 0) + 1

        # Count edges
        edge_stmt = select(KGEdge)
        if run_id:
            edge_stmt = edge_stmt.where(KGEdge.run_id == run_id)
        edges = (await db.execute(edge_stmt)).scalars().all()

        rel_counts: dict[str, int] = {}
        for edge in edges:
            rel_counts[edge.relation_type] = rel_counts.get(edge.relation_type, 0) + 1

        if not nodes:
            return "No knowledge graph data available."

        summary_parts = ["## Knowledge Graph Summary\n"]
        summary_parts.append(f"**Total entities:** {len(nodes)}\n")
        for t, c in sorted(type_counts.items()):
            summary_parts.append(f"- {t}: {c}")

        summary_parts.append(f"\n**Total relationships:** {len(edges)}")
        for r, c in sorted(rel_counts.items()):
            summary_parts.append(f"- {r}: {c}")

        # List top entities
        summary_parts.append("\n**Key entities:**")
        for node in nodes[:15]:
            summary_parts.append(f"- {node.canonical_name} ({node.type})")

        return "\n".join(summary_parts)
