import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.internal.ai import docs


def _build_index(path, rows):
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute(
            "CREATE VIRTUAL TABLE chunks USING fts5(doc UNINDEXED, title UNINDEXED, body)"
        )
        connection.executemany(
            "INSERT INTO chunks (doc, title, body) VALUES (?, ?, ?)", rows
        )
        connection.commit()
    finally:
        connection.close()


class DocsRetrievalTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.index_path = Path(self._tmp.name) / "index.sqlite"
        _build_index(self.index_path, [
            ("strategic", "Terminology", "A wellpad is a site where completions water is generated."),
            ("strategic", "Mathematical Program Formulation (part 3)",
             "Pipeline capacity constraints limit flow between nodes; the initial pipeline capacity "
             "may be expanded with 1 if pipeline expansion is enabled."),
            ("water_treatment", "Treatment Component Removal Efficiency",
             "Removal efficiency describes the fraction of a water quality component removed by a treatment site."),
            ("strategic", "Strategic Model Mathematical Notation (part 5)",
             "The hourly trucking cost applies to each trucked route per period."),
        ])
        self._previous = os.environ.get("PARETO_DOCS_INDEX")
        os.environ["PARETO_DOCS_INDEX"] = str(self.index_path)

    def tearDown(self):
        if self._previous is None:
            os.environ.pop("PARETO_DOCS_INDEX", None)
        else:
            os.environ["PARETO_DOCS_INDEX"] = self._previous
        self._tmp.cleanup()

    def test_query_tokens_split_camelcase_and_drop_stopwords(self):
        tokens = docs.query_tokens("Why is TruckingHourlyCost exceeded on the Pipeline for X1?")
        self.assertIn("trucking", tokens)
        self.assertIn("hourly", tokens)
        self.assertIn("cost", tokens)
        self.assertIn("pipeline", tokens)
        self.assertNotIn("the", tokens)
        self.assertNotIn("why", tokens)

    def test_retrieval_includes_relevant_chunk(self):
        result = docs.diagnosis_reference_docs({}, "pipeline capacity exceeded, model infeasible")
        self.assertIn("Pipeline capacity constraints", result)
        self.assertIn("[strategic]", result)

    def test_camel_case_query_matches_worded_doc(self):
        result = docs.prompt_reference_docs({}, "adjust TruckingHourlyCost for all routes")
        self.assertIn("hourly trucking cost", result)

    def test_terminology_always_included_even_without_matches(self):
        result = docs.prompt_reference_docs({}, "zzzqqq unrelated gibberish")
        self.assertIn("Terminology", result)
        self.assertIn("wellpad", result)
        self.assertNotIn("Pipeline capacity constraints", result)

    def test_diagnostics_budget_limits_total_size(self):
        os.remove(self.index_path)
        big_body = "pipeline capacity " + ("filler sentence about capacity. " * 400)
        _build_index(self.index_path, [
            ("strategic", f"Big section (part {part})", big_body) for part in range(1, 21)
        ] + [("strategic", "Terminology", "terminology body")])
        result = docs.diagnosis_reference_docs({}, "pipeline capacity")
        self.assertLessEqual(len(result), 1000 + 32000 + 2000)

    def test_missing_index_returns_empty_without_failing(self):
        os.environ["PARETO_DOCS_INDEX"] = str(Path(self._tmp.name) / "missing.sqlite")
        self.assertEqual(docs.prompt_reference_docs({}, "anything"), "")
        self.assertEqual(docs.diagnosis_reference_docs({}, "anything"), "")


if __name__ == "__main__":
    unittest.main()
