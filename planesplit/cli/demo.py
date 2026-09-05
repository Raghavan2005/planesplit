"""One-command demo entry point: `python -m planesplit.cli.demo [--all|--scenario N]`.

Runs the shared scenario definitions (scenarios/definitions.py — the same
functions the repeatability test exercises) and prints each probe's status
using rich for color-coded PASS/TOLERATED/ALERT output, per
docs/ARCHITECTURE.md §4 (CLI-first demo decision).
"""
import argparse
import sys

from rich.console import Console
from rich.table import Table

from planesplit.scenarios.definitions import ALL_SCENARIOS, SCENARIO_BY_NUMBER, ProbeResult

STATUS_STYLE = {
    "PASS": "bold green",
    "TOLERATED": "bold yellow",
    "ALERT": "bold red",
}


def render(results: list[ProbeResult], console: Console) -> None:
    table = Table(title="PlaneSplit — Control-Plane / Data-Plane Consistency Probes")
    table.add_column("Scenario")
    table.add_column("Probe")
    table.add_column("Flow")
    table.add_column("Intended Path")
    table.add_column("Actual Path")
    table.add_column("Status")

    for r in results:
        style = STATUS_STYLE[r.status]
        table.add_row(
            r.scenario,
            r.label,
            str(r.flow),
            " -> ".join(r.intended) if r.intended else "(none)",
            " -> ".join(r.actual) if r.actual else "(none)",
            f"[{style}]{r.status}[/{style}]",
        )
    console.print(table)

    alerts = [r for r in results if r.status == "ALERT"]
    if alerts:
        console.print(f"\n[bold red]{len(alerts)} alert(s) raised:[/bold red]")
        for r in alerts:
            a = r.alert
            console.print(
                f"  - flow=[bold]{a.flow}[/bold] responsible_router=[bold]{a.responsible_router}[/bold] "
                f"detected_at={a.detected_at}s\n    reason: {a.reason}"
            )
    else:
        console.print("\n[bold green]No alerts raised.[/bold green]")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PlaneSplit demo runner")
    parser.add_argument("--scenario", type=int, choices=sorted(SCENARIO_BY_NUMBER), help="run a single scenario by its docs/TEST_PLAN.md number (1-6)")
    parser.add_argument("--all", action="store_true", help="run every scenario (default if no flag given)")
    args = parser.parse_args(argv)

    console = Console()
    scenarios_to_run = ALL_SCENARIOS if (args.all or args.scenario is None) else [SCENARIO_BY_NUMBER[args.scenario]]

    all_results: list[ProbeResult] = []
    for scenario_fn in scenarios_to_run:
        all_results.extend(scenario_fn())

    render(all_results, console)
    return 0


if __name__ == "__main__":
    sys.exit(main())
