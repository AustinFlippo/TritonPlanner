"""Shared pytest setup for the FastAPI app tests."""
import os

# Planner loop metrics append to a local JSONL in production; keep unit tests
# from touching disk (assertions still see the in-response agent_loop payload).
os.environ.setdefault("PLANNER_METRICS_DISABLED", "1")
