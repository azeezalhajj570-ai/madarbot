"""
RAG Embedding Pipeline
======================
Queries n8n_rag views → OpenAI embeddings → pgvector → semantic search.

Usage:
  # Embed all sources for a group
  python rag_pipeline.py embed --group-id -1001499967735

  # Embed threads only
  python rag_pipeline.py embed --group-id -1001499967735 --source threads

  # Ask a question
  python rag_pipeline.py ask --group-id -1001499967735 "ما هي متطلبات القبول في جامعة البترول؟"

  # Ask without limiting to a group
  python rag_pipeline.py ask "what are the admission requirements?"
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime
from typing import Any

import psycopg2
import psycopg2.extras
from psycopg2.extensions import AsIs
import requests

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/combot",
)


def get_db():
    return psycopg2.connect(DATABASE_URL)


EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "openai").lower()


def get_embedding(text: str) -> list[float]:
    if EMBEDDING_PROVIDER == "gemini":
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            print("ERROR: Set GEMINI_API_KEY environment variable")
            sys.exit(1)
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={"model": "models/text-embedding-004", "content": {"parts": [{"text": text}]}},
        )
        resp.raise_for_status()
        return resp.json()["embedding"]["values"]
    else:
        resp = requests.post(
            "https://api.openai.com/v1/embeddings",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"model": "text-embedding-3-small", "input": text},
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]


# Embedding is handled by n8n's PGVector Store node.
# Use `python rag_pipeline.py ask "question"` to search.


def ask(question: str, *, group_id: int | None = None, top_k: int = 5):
    if not question:
        print("Provide a question.")
        return

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Embed the question
    print(f"Embedding question: {question}")
    query_embedding = get_embedding(question)

    # Search via pgvector cosine similarity (n8n's schema: id, text, metadata, embedding)
    clauses = []
    params: dict[str, Any] = {"top_k": top_k}
    if group_id is not None:
        clauses.append("e.metadata->>'tg_group_id' = %(group_id)s")
        params["group_id"] = str(group_id)
    where = " AND ".join(clauses) if clauses else "TRUE"

    query_vec_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
    cur.execute(
        f"""
        SELECT
            e.id,
            e.text,
            e.metadata->>'tg_group_id' AS tg_group_id,
            e.metadata->>'source_id' AS source_id,
            1 - (e.embedding <=> %s) AS similarity
        FROM n8n_rag_embeddings e
        WHERE {where}
        ORDER BY e.embedding <=> %s
        LIMIT %(top_k)s
        """,
        (AsIs(query_vec_str), AsIs(query_vec_str), params),
    )
    results = cur.fetchall()
    cur.close()
    conn.close()

    if not results:
        print("No results found.")
        return

    print(f"\nTop {len(results)} results:\n")
    for r in results:
        sim = r["similarity"]
        txt = r["text"] or "(no text)"
        print(f"[{sim:.2%}] {txt[:300]}")
        print()


def main():
    parser = argparse.ArgumentParser(description="RAG search — query n8n's vector store")
    sub = parser.add_subparsers(dest="command", required=True)

    ask_p = sub.add_parser("ask", help="Ask a question")
    ask_p.add_argument("question", nargs="+", help="Question text")
    ask_p.add_argument("--group-id", type=int, help="Filter by group")
    ask_p.add_argument("--top-k", type=int, default=5)

    args = parser.parse_args()

    if args.command == "ask":
        provider = os.environ.get("EMBEDDING_PROVIDER", "openai").lower()
        if provider == "openai" and not OPENAI_API_KEY:
            print("ERROR: Set OPENAI_API_KEY environment variable")
            sys.exit(1)
        ask(" ".join(args.question), group_id=args.group_id, top_k=args.top_k)


if __name__ == "__main__":
    main()
