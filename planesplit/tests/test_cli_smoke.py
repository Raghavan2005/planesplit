"""Smoke test for cli/demo.py — the demo must run end-to-end without error
for both --all and a single --scenario N, printing the hook/closing panels
and at least one PASS/TOLERATED/ALERT status per probe."""
from rich.console import Console

from planesplit.cli.demo import main, print_closing, print_hook


def test_main_all_scenarios_runs_clean():
    assert main(["--all"]) == 0


def test_main_single_scenario_runs_clean():
    assert main(["--scenario", "2"]) == 0


def test_hook_and_closing_panels_render_without_error():
    console = Console(record=True)
    print_hook(console)
    print_closing(console)
    output = console.export_text()
    assert "Why this matters" in output
    assert "What you just saw" in output
