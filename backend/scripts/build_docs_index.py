#!/usr/bin/env python
"""Build a SQLite FTS5 retrieval index from the local PARETO docs snapshot.

The output is a single .sqlite file that can ship with the app instead of the
full pareto_docs/ folder. At query time the AI prompt builders match the user
prompt or optimization failure message against this index and inject only the
relevant chunks into the prompt (see app.internal.ai.docs).

Usage:
    python backend/scripts/build_docs_index.py
    python backend/scripts/build_docs_index.py --docs-dir /path/to/pareto_docs \
        --output /path/to/pareto_docs_index.sqlite --max-chunk-chars 4000
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.internal.ai.docs import load_sections  # noqa: E402

DEFAULT_DOCS_DIR = REPO_ROOT / "pareto_docs"
DEFAULT_OUTPUT = REPO_ROOT / "backend" / "app" / "internal" / "ai" / "pareto_docs_index.sqlite"


def chunk_text(text, max_chars):
    """Split a section body into chunks of at most ~max_chars on paragraph boundaries."""
    if len(text) <= max_chars:
        return [text]
    chunks, current = [], ""
    for paragraph in text.split("\n\n"):
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if current and len(candidate) > max_chars:
            chunks.append(current)
            current = paragraph
        else:
            current = candidate
    if current:
        chunks.append(current)
    # Last resort: hard-split individual paragraphs that still exceed the budget.
    sized = []
    for chunk in chunks:
        while len(chunk) > max_chars * 1.5:
            cut = chunk.rfind("\n", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            sized.append(chunk[:cut].rstrip())
            chunk = chunk[cut:].strip()
        if chunk:
            sized.append(chunk)
    return sized


def _check_fts5(connection):
    try:
        connection.execute("CREATE VIRTUAL TABLE temp.fts5_check USING fts5(x)")
    except sqlite3.OperationalError as error:
        sys.exit(f"SQLite FTS5 is not available in this environment: {error}")


def build_index(docs_dir, output, max_chunk_chars):
    if not docs_dir.is_dir():
        sys.exit(f"Docs snapshot not found: {docs_dir}")

    sections_by_doc = load_sections(docs_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    connection = sqlite3.connect(output)
    try:
        _check_fts5(connection)
        connection.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute(
            "CREATE VIRTUAL TABLE chunks USING fts5(doc UNINDEXED, title UNINDEXED, body)"
        )

        total_chunks = 0
        chunks_per_doc = {}
        for doc, sections in sections_by_doc.items():
            count = 0
            for title, body in sections:
                if not body:
                    continue
                base_title = title or "(preamble)"
                for part, piece in enumerate(chunk_text(body, max_chunk_chars), start=1):
                    chunk_title = base_title if part == 1 else f"{base_title} (part {part})"
                    connection.execute(
                        "INSERT INTO chunks (doc, title, body) VALUES (?, ?, ?)",
                        (doc, chunk_title, piece),
                    )
                    count += 1
            chunks_per_doc[doc] = count
            total_chunks += count

        metadata = {
            "index_version": "1",
            "built_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "docs_dir": str(docs_dir),
            "max_chunk_chars": max_chunk_chars,
            "chunk_count": total_chunks,
            "chunks_per_doc": json.dumps(chunks_per_doc),
        }
        connection.executemany("INSERT INTO metadata (key, value) VALUES (?, ?)", metadata.items())
        connection.commit()
    finally:
        connection.close()

    print(f"Docs root:      {docs_dir}")
    for doc, count in chunks_per_doc.items():
        print(f"  {doc:<16} {count:>4} chunks")
    print(f"Total chunks:   {total_chunks}")
    print(f"Index written:  {output} ({output.stat().st_size / 1024:.0f} KB)")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--docs-dir", type=Path, default=DEFAULT_DOCS_DIR,
                        help="Path to the pareto_docs snapshot (default: %(default)s)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="Where to write the sqlite index (default: %(default)s)")
    parser.add_argument("--max-chunk-chars", type=int, default=4000,
                        help="Approximate maximum chunk size in characters (default: %(default)s)")
    args = parser.parse_args()
    build_index(args.docs_dir, args.output, args.max_chunk_chars)


if __name__ == "__main__":
    main()
