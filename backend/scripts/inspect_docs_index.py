"""Interactive browser for the PARETO docs FTS5 index.

Run this in Spyder (F5 or %run) with an interpreter that has pandas installed
(e.g. the pareto-ui pyenv). Everything below runs top-level so the variables
and functions land in your variable explorer:

    chunks_df              all indexed chunks (one row per chunk)
    meta                   build metadata of the index
    search("query")        full-text search, ranked results as a DataFrame
    show(rowid)            print the full body of one chunk
    doc("strategic")       all chunks of one doc

Examples:
    search("pipeline capacity")
    search("trucking cost")
    search("Removal efficiency")
    show(12)
    doc("water_treatment")
"""
import sqlite3
from pathlib import Path

import pandas as pd

INDEX_PATH = Path(__file__).resolve().parents[1] / "app" / "internal" / "ai" / "pareto_docs_index.sqlite"

con = sqlite3.connect(f"file:{INDEX_PATH}?mode=ro", uri=True)

meta = dict(con.execute("SELECT key, value FROM metadata"))

chunks_df = pd.read_sql_query(
    "SELECT rowid, doc, title, length(body) AS chars, body FROM chunks ORDER BY doc, rowid",
    con,
)


def _tokenize(query):
    """Split a query into searchable tokens: whitespace plus camelCase boundaries."""
    import re

    tokens = []
    for word in str(query).split():
        tokens.extend(part for part in re.findall(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])", word) if part)
    return tokens or [str(query)]


def search(query, limit=10, mode="or"):
    """Full-text search over the indexed docs.

    mode="or" (default) ranks chunks matching any query word (best for natural
    language and error messages); mode="and" requires every word (exact-ish).
    Returns a DataFrame: doc, title, chars, match_score, snippet, body.
    """
    if mode == "and":
        match = " AND ".join(f'"{token}"' for token in _tokenize(query))
    else:
        match = " OR ".join(f'"{token}"' for token in _tokenize(query))
    sql = """
        SELECT doc, title, length(body) AS chars,
               bm25(chunks) AS match_score,
               snippet(chunks, 2, '>', '<', ' ... ', 14) AS snippet,
               body
        FROM chunks
        WHERE chunks MATCH ?
        ORDER BY bm25(chunks)
        LIMIT ?
    """
    result = pd.read_sql_query(sql, con, params=(match, limit))
    if result.empty:
        print(f"No matches for {query!r} (match expression: {match!r})")
    return result


def show(rowid):
    """Print the full body of one chunk."""
    row = con.execute("SELECT doc, title, body FROM chunks WHERE rowid = ?", (rowid,)).fetchone()
    if row is None:
        print(f"No chunk with rowid {rowid}")
        return
    doc, title, body = row
    print(f"=== [{doc}] {title} (rowid {rowid}, {len(body)} chars) ===")
    print(body)


def doc(name):
    """All chunks of one doc, e.g. doc('strategic'), doc('hydraulics')."""
    return chunks_df[chunks_df["doc"].str.contains(str(name), case=False)].reset_index(drop=True)


print(f"Index:   {INDEX_PATH}")
print(f"Built:   {meta.get('built_at')} from {meta.get('docs_dir')}")
print(f"Chunks:  {meta.get('chunk_count')} ({meta.get('chunks_per_doc')})")
print("Try:  search('pipeline capacity')   show(0)   doc('strategic')")
