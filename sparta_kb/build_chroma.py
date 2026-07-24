# -*- coding: utf-8 -*-
"""
build_chroma.py
===============
Role C - Systems/Simulation Lead | Day 2 Deliverable

Builds the SPARTA ChromaDB vector database from sparta_data.py.
This is the RAG (Retrieval Augmented Generation) knowledge base that the
SPARTA Analyst Agent will query when it needs to explain detected threats.

How RAG works here (simple explanation):
  1. We take all our SPARTA text descriptions
  2. Convert them to number vectors (embeddings) using a local model
  3. Store them in ChromaDB (a fast local vector database)
  4. When an agent asks "what is Command Flooding?", ChromaDB finds the
     most relevant SPARTA entries by comparing vector similarity
  5. The agent gets back real SPARTA context to include in its response

Usage:
  python sparta_kb/build_chroma.py           # Build the database
  python sparta_kb/build_chroma.py --query "command flooding attack"  # Test a query
"""

import sys
import os
import argparse

# Fix Windows encoding
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chromadb
from chromadb.utils import embedding_functions
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich import box

from sparta_kb.sparta_data import SPARTA_TACTICS, SPARTA_TECHNIQUES, CUCDID_TO_SPARTA

console = Console()

# ──────────────────────────────────────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────────────────────────────────────

CHROMA_DB_PATH = "sparta_kb/chroma_db"   # Local persistent storage
COLLECTION_NAME = "sparta_knowledge"

# Use ChromaDB's built-in sentence-transformer embeddings (100% free, runs locally)
# Model: all-MiniLM-L6-v2 (~22MB download on first run)
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


# ──────────────────────────────────────────────────────────────────────────────
# DOCUMENT BUILDER
# Converts our SPARTA data dicts into flat text chunks for ChromaDB
# ──────────────────────────────────────────────────────────────────────────────

def build_documents() -> list[dict]:
    """
    Convert all SPARTA data into a flat list of text documents.
    Each document gets: id, text (for embedding), metadata (for filtering).
    """
    documents = []

    # 1. Tactic-level documents (9 entries)
    for tactic in SPARTA_TACTICS:
        text = (
            f"SPARTA Tactic {tactic['id']}: {tactic['name']}\n\n"
            f"Description: {tactic['description']}\n\n"
            f"CubeSat Example: {tactic.get('cubesat_example', 'N/A')}"
        )
        documents.append({
            "id":   f"tactic_{tactic['id']}",
            "text": text,
            "metadata": {
                "type":       "tactic",
                "tactic_id":  tactic["id"],
                "tactic_name": tactic["name"],
                "cucdid_label": str(tactic.get("cucdid_label", -1)),
            },
        })

    # 2. Technique-level documents (key techniques)
    for tech in SPARTA_TECHNIQUES:
        indicators_text = "\n".join(f"- {i}" for i in tech.get("indicators", []))
        mitigations_text = "\n".join(f"- {m}" for m in tech.get("mitigations", []))
        attacks_text = ", ".join(tech.get("cucdid_attacks", []))

        text = (
            f"SPARTA Technique {tech['id']}: {tech['name']}\n"
            f"Tactic: {tech['tactic_id']} ({tech['tactic_name']})\n\n"
            f"Description: {tech['description']}\n\n"
            f"Applies to CuCD-ID attacks: {attacks_text}\n\n"
            f"Indicators in telemetry:\n{indicators_text}\n\n"
            f"Recommended mitigations:\n{mitigations_text}\n\n"
            f"Autonomous action: {tech.get('recommended_action', 'log_only')}\n"
            f"Risk level: {tech.get('risk_level', 'UNKNOWN')}"
        )
        documents.append({
            "id":   f"technique_{tech['id']}",
            "text": text,
            "metadata": {
                "type":              "technique",
                "technique_id":      tech["id"],
                "technique_name":    tech["name"],
                "tactic_id":         tech.get("tactic_id") or "NONE",
                "risk_level":        tech.get("risk_level", "UNKNOWN"),
                "recommended_action": tech.get("recommended_action", "log_only"),
                "cucdid_attacks":    ", ".join(tech.get("cucdid_attacks", [])),
            },
        })

    # 3. CuCD-ID attack summary documents (one per attack class)
    for label, info in CUCDID_TO_SPARTA.items():
        text = (
            f"CubeSat Cyber Attack: {info['attack_name']} (CuCD-ID Label {label})\n\n"
            f"SPARTA Tactic: {info['sparta_tactic']} — {info['sparta_tactic_name']}\n"
            f"SPARTA Technique: {info['sparta_technique']}\n"
            f"Risk Level: {info['risk_level']}\n"
            f"Recommended Autonomous Action: {info['recommended_action']}\n\n"
            f"Full Analysis: {info['summary']}"
        )
        documents.append({
            "id":   f"attack_label_{label}",
            "text": text,
            "metadata": {
                "type":              "attack_class",
                "cucdid_label":      str(label),
                "attack_name":       info["attack_name"],
                "sparta_tactic":     info["sparta_tactic"] or "NONE",
                "risk_level":        info["risk_level"],
                "recommended_action": info["recommended_action"],
            },
        })

    return documents


# ──────────────────────────────────────────────────────────────────────────────
# BUILD DATABASE
# ──────────────────────────────────────────────────────────────────────────────

def build_chroma_db(reset: bool = False) -> chromadb.Collection:
    """
    Build (or rebuild) the ChromaDB vector store with all SPARTA documents.

    Args:
        reset: If True, delete existing collection and rebuild from scratch.

    Returns:
        The ChromaDB collection object for immediate querying.
    """
    console.print(Panel.fit(
        "[bold cyan]Building SPARTA ChromaDB Knowledge Base[/]\n"
        "[dim]Role C | Day 2 — RAG Vector Store[/]",
        border_style="cyan",
    ))

    # Initialize ChromaDB with persistent local storage
    os.makedirs(CHROMA_DB_PATH, exist_ok=True)
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

    # Embedding function — runs locally, no API key needed
    console.print("[cyan]Loading embedding model[/] (all-MiniLM-L6-v2)...")
    console.print("[dim]First run: ~22MB download. Subsequent runs: instant.[/]")
    ef = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL
    )

    # Reset collection if requested
    if reset:
        try:
            client.delete_collection(COLLECTION_NAME)
            console.print("[yellow]Existing collection deleted (reset=True)[/]")
        except Exception:
            pass

    # Create or get collection
    try:
        collection = client.get_collection(
            name=COLLECTION_NAME,
            embedding_function=ef,
        )
        console.print(f"[green]Loaded existing collection[/] ({collection.count()} documents)")
        if not reset and collection.count() > 0:
            console.print("[dim]Use --reset flag to rebuild from scratch.[/]")
            return collection
    except Exception:
        pass

    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=ef,
        metadata={"description": "SPARTA space security knowledge base for CuCD-ID RAG agent"},
    )

    # Build documents
    console.print("\n[bold]Building documents...[/]")
    documents = build_documents()
    console.print(f"  Generated [cyan]{len(documents)}[/] documents")

    # Add to ChromaDB in batches
    console.print("[bold]Embedding and indexing...[/] ", end="")
    batch_size = 10
    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]
        collection.add(
            ids=[d["id"] for d in batch],
            documents=[d["text"] for d in batch],
            metadatas=[d["metadata"] for d in batch],
        )
        console.print(f"[green].[/]", end="")

    console.print(f"\n[green]Done![/] Indexed [cyan]{collection.count()}[/] documents.\n")

    # Summary table
    table = Table(title="Indexed Documents", box=box.ROUNDED, header_style="bold cyan")
    table.add_column("Type")
    table.add_column("Count")
    table.add_column("Examples")
    table.add_row("Tactics",       str(len(SPARTA_TACTICS)),     "ST0001–ST0009")
    table.add_row("Techniques",    str(len(SPARTA_TECHNIQUES)),  "SV-MA-1, DE-0001, ...")
    table.add_row("Attack Classes", str(len(CUCDID_TO_SPARTA)),  "Normal, Cmd Flood, ...")
    console.print(table)

    console.print(Panel(
        f"[bold green]SPARTA KB Ready![/]\n"
        f"  Location: [cyan]{CHROMA_DB_PATH}[/]\n"
        f"  Collection: [cyan]{COLLECTION_NAME}[/]\n"
        f"  Documents: [cyan]{collection.count()}[/]\n\n"
        f"Test it: [dim]python sparta_kb/build_chroma.py --query \"command flooding\"[/]",
        border_style="green",
    ))

    return collection


# ──────────────────────────────────────────────────────────────────────────────
# QUERY FUNCTION (used by the SPARTA Analyst Agent)
# ──────────────────────────────────────────────────────────────────────────────

def query_sparta(
    query_text: str,
    n_results: int = 3,
    filter_type: str = None,
) -> list[dict]:
    """
    Query the SPARTA knowledge base with a natural language question.
    Returns the top N most relevant documents.

    Args:
        query_text:  The natural language query (e.g. "command flooding attack indicators")
        n_results:   Number of results to return (default: 3)
        filter_type: Optional filter by document type: 'tactic', 'technique', 'attack_class'

    Returns:
        List of dicts with 'text', 'metadata', and 'distance' (similarity score).
    """
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    ef = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL
    )

    try:
        collection = client.get_collection(name=COLLECTION_NAME, embedding_function=ef)
    except Exception:
        raise RuntimeError(
            "SPARTA KB not found. Run: python sparta_kb/build_chroma.py"
        )

    # Build query params
    query_params = {
        "query_texts": [query_text],
        "n_results":   min(n_results, collection.count()),
    }
    if filter_type:
        query_params["where"] = {"type": filter_type}

    results = collection.query(**query_params)

    output = []
    if results["documents"]:
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            output.append({
                "text":     doc,
                "metadata": meta,
                "distance": dist,
            })

    return output


def query_by_label(label: int) -> list[dict]:
    """
    Direct lookup by CuCD-ID label (0-4).
    Returns the most relevant SPARTA documents for that attack class.
    Shortcut used by the SPARTA Analyst Agent when a label is known.
    """
    label_to_query = {
        0: "normal cubeSat operations no attack",
        1: "storage exhaustion memory attack impact",
        2: "command flooding denial of service impact",
        3: "data injection telemetry spoofing integrity",
        4: "defence impairment security evasion disable monitor",
    }
    query = label_to_query.get(label, "unknown attack")
    return query_sparta(query, n_results=3)


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build or query the SPARTA ChromaDB knowledge base"
    )
    parser.add_argument(
        "--reset", action="store_true",
        help="Delete existing collection and rebuild from scratch."
    )
    parser.add_argument(
        "--query", "-q", type=str, default=None,
        help="Test query to run against the built database."
    )
    parser.add_argument(
        "--label", "-l", type=int, default=None, choices=[0, 1, 2, 3, 4],
        help="Query by CuCD-ID label (0=Normal, 1=Storage, 2=CmdFlood, 3=DataInj, 4=DefImp)"
    )
    args = parser.parse_args()

    # Always build first
    collection = build_chroma_db(reset=args.reset)

    # Test query if provided
    if args.query:
        console.print(f"\n[bold]Query:[/] '{args.query}'\n")
        results = query_sparta(args.query, n_results=3)
        for i, r in enumerate(results, 1):
            console.print(Panel(
                f"[bold]Result {i}[/] (similarity distance: {r['distance']:.4f})\n\n"
                f"{r['text'][:500]}...\n\n"
                f"[dim]Metadata: {r['metadata']}[/]",
                border_style="cyan",
            ))

    if args.label is not None:
        console.print(f"\n[bold]Label query:[/] {args.label}\n")
        results = query_by_label(args.label)
        for i, r in enumerate(results, 1):
            console.print(Panel(
                f"[bold]Result {i}[/]\n\n{r['text'][:600]}...",
                border_style="yellow",
            ))
