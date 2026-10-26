"""PARETO reference documentation for AI prompt grounding.

Grounding comes from the prebuilt SQLite FTS5 index shipped at
app/internal/ai/pareto_docs_index.sqlite (override the location with the
PARETO_DOCS_INDEX environment variable). The prompt builders retrieve only the
chunks relevant to the request (user prompt or failure message) plus a small
always-on terminology block. To regenerate the index, update the index file
from a pareto_docs snapshot using the build tooling kept outside this
repository (chunked FTS5 rows in a `chunks` table plus a `metadata` table with
at least pareto_version and built_at).

Without the index the helpers return empty strings, so AI features keep
working ungrounded rather than failing.
"""
import os
import re
import sqlite3
from pathlib import Path


def _render(header, blocks):
    """Join (title, body) blocks under one header line; empty string if all empty."""
    rendered = []
    for title, text in blocks:
        if text:
            rendered.append(f"--- {title} ---\n{text}")
    if not rendered:
        return ""
    body = "\n\n".join(rendered)
    return f"{header}:\n\n{body}" if header else body


# ---------------------------------------------------------------------------
# FTS5 index retrieval
# ---------------------------------------------------------------------------

_INDEX_FILENAME = "pareto_docs_index.sqlite"

# Character budgets for retrieved content per request type; terminology is on
# top of these. Chunks are ~4000-6000 chars each, so these allow roughly 4-6
# (autofill) and 6-8 (diagnosis) chunks.
_AUTOFILL_RETRIEVAL_BUDGET = 22000
_DIAGNOSIS_RETRIEVAL_BUDGET = 32000

_STOPWORDS = {
    "the", "and", "for", "with", "are", "was", "were", "not", "can", "has",
    "have", "had", "this", "that", "then", "than", "from", "into", "onto",
    "when", "what", "how", "why", "who", "its", "you", "your", "their",
    "there", "here", "all", "any", "but", "out", "per", "via", "she", "him",
    "her", "his", "our", "ours", "will", "would", "could", "should", "may",
    "might", "must", "shall", "does", "did", "done", "being", "been", "have",
}

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*")
_CAMEL_RE = re.compile(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])")


def _index_path():
    configured = os.environ.get("PARETO_DOCS_INDEX")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parent / _INDEX_FILENAME


# One read-only connection per index path, opened lazily and reused for the
# process lifetime (FastAPI may call from different worker threads, hence
# check_same_thread=False; the index file never changes at runtime).
_index_connections = {}


def _index_connection():
    """Open (once) a read-only connection to the FTS5 index; None if unavailable."""
    path = _index_path()
    if not path.is_file():
        return None
    key = str(path)
    if key not in _index_connections:
        try:
            # check_same_thread=False: connections may be created and used on
            # different FastAPI worker threads; read-only access is safe.
            connection = sqlite3.connect(f"file:{key}?mode=ro", uri=True, check_same_thread=False)
            connection.execute("SELECT 1 FROM chunks LIMIT 1")
        except (sqlite3.Error, OSError):
            return None
        _index_connections[key] = connection
    return _index_connections[key]


def query_tokens(text, limit=40):
    """Reduce free text to a bounded list of lowercase FTS terms.

    Splits camelCase identifiers (TruckingHourlyCost -> trucking hourly cost)
    and drops stopwords so error messages and prose queries work as OR searches.
    """
    tokens = []
    for word in _WORD_RE.findall(text or ""):
        for part in (_CAMEL_RE.findall(word) or [word]):
            part = part.lower()
            if len(part) >= 2 and part not in _STOPWORDS and part not in tokens:
                tokens.append(part)
    return tokens[:limit]


def _retrieve(query, budget_chars, max_chunks, exclude=(), extra_tokens=()):
    """Return [(doc, title, body)] chunks ranked by bm25 within a char budget."""
    connection = _index_connection()
    if connection is None:
        return []
    tokens = query_tokens(query)
    for term in extra_tokens:
        for token in query_tokens(term):
            if token and token not in tokens:
                tokens.append(token)
    tokens = tokens[:60]
    if not tokens:
        return []
    match = " OR ".join(f'"{token}"' for token in tokens)
    try:
        rows = connection.execute(
            "SELECT doc, title, body FROM chunks WHERE chunks MATCH ? "
            "ORDER BY bm25(chunks) LIMIT ?",
            (match, max_chunks * 3),
        ).fetchall()
    except sqlite3.Error:
        return []
    excluded = {(doc, title.split(" (part ")[0]) for doc, title in exclude}
    # Greedy packing: keep the best-ranked chunks until the character budget
    # is exhausted, skipping anything that would not fit whole.
    selected, used = [], 0
    for doc, title, body in rows:
        key = (doc, title.split(" (part ")[0])
        if key in excluded or not body:
            continue
        if used + len(body) > budget_chars:
            continue
        selected.append((doc, title, body))
        used += len(body)
        if len(selected) >= max_chunks:
            break
    return selected


def _terminology_block():
    """The small strategic-model terminology section, from the FTS5 index."""
    connection = _index_connection()
    if connection is None:
        return ""
    try:
        row = connection.execute(
            "SELECT body FROM chunks WHERE doc = 'strategic' AND title = 'Terminology' LIMIT 1"
        ).fetchone()
    except sqlite3.Error:
        return ""
    return row[0] if row else ""


def _metadata_value(connection, key):
    """One metadata table value from the index, or None when absent."""
    try:
        row = connection.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
    except sqlite3.Error:
        return None
    return row[0] if row else None


def _installed_pareto_version():
    """The installed project-pareto package version, or None when unknown."""
    try:
        from importlib.metadata import version
        return version("project-pareto")
    except Exception:
        return None


def index_provenance():
    """(pareto_version, built_at) recorded in the index, or (None, None)."""
    connection = _index_connection()
    if connection is None:
        return None, None
    return _metadata_value(connection, "pareto_version"), _metadata_value(connection, "built_at")


def _reference_header():
    """Header line naming the docs version, with a mismatch warning when the
    index was built for a different PARETO version than the installed one."""
    base = "Reference documentation for the PARETO strategic model"
    pareto_version, built_at = index_provenance()
    installed = _installed_pareto_version()
    parts = []
    if pareto_version:
        parts.append(f"grounded in PARETO {pareto_version}")
        if installed and installed != pareto_version:
            parts.append(f"WARNING: this documentation was built for PARETO {pareto_version} but the "
                         f"installed version is {installed}; treat version-specific details as potentially outdated")
    elif installed:
        parts.append(f"grounded in PARETO {installed} (the docs index does not record which version it was built from)")
    if built_at:
        parts.append(f"docs built {built_at[:10]}")
    # Conditional expression: render "base (detail; detail)" when any
    # provenance detail exists, otherwise the bare header.
    return f"{base} (" + "; ".join(parts) + ")" if parts else base


def _settings_query_terms(optimization_settings):
    """Extra retrieval tokens for model features the user enabled, so chunks
    for those features surface even when the prompt/failure text omits them."""
    if not isinstance(optimization_settings, dict):
        return []

    def enabled(name):
        value = optimization_settings.get(name, "false")
        return str(value).lower() not in ("false", "0", "", "none")

    terms = []
    if enabled("waterQuality"):
        terms.append("water quality components removal efficiency")
    if enabled("hydraulics"):
        terms.append("pipeline hydraulics pump head pressure")
    if enabled("desalination_model"):
        terms.append("desalination treatment technologies")
    if enabled("subsurface_risk"):
        terms.append("subsurface risk")
    if enabled("infrastructure_timing"):
        terms.append("infrastructure expansion timing lead time")
    return terms


def prompt_reference_docs(optimization_settings=None, query=None):
    """Reference docs for AI input filling: always-on terminology plus the
    chunks the user's prompt and enabled model features make relevant. Empty
    string without the index.
    """
    if _index_connection() is None:
        return ""
    blocks = []
    terminology = _terminology_block()
    if terminology:
        blocks.append(("Terminology", terminology))
    retrieved = _retrieve(
        query, _AUTOFILL_RETRIEVAL_BUDGET, max_chunks=8,
        exclude={("strategic", "Terminology")},
        extra_tokens=_settings_query_terms(optimization_settings),
    )
    blocks.extend((f"[{doc}] {title}", body) for doc, title, body in retrieved)
    return _render(_reference_header(), blocks)


def diagnosis_reference_docs(optimization_settings=None, query=None):
    """Reference docs for optimization diagnosis: always-on terminology plus
    chunks retrieved against the failure message and enabled model features.
    Empty string without the index.
    """
    if _index_connection() is None:
        return ""
    blocks = []
    terminology = _terminology_block()
    if terminology:
        blocks.append(("Terminology", terminology))
    retrieved = _retrieve(
        query, _DIAGNOSIS_RETRIEVAL_BUDGET, max_chunks=12,
        exclude={("strategic", "Terminology")},
        extra_tokens=_settings_query_terms(optimization_settings),
    )
    blocks.extend((f"[{doc}] {title}", body) for doc, title, body in retrieved)
    return _render(_reference_header(), blocks)
