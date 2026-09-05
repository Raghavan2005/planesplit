"""One-command demo entry point: `python -m planesplit.cli.demo [--all|--scenario N]`.

Runs the shared scenario definitions (scenarios/definitions.py — the same
functions the repeatability test exercises) and prints each probe's status
using rich for color-coded PASS/TOLERATED/ALERT output, per
docs/ARCHITECTURE.md §4 (CLI-first demo decision).
"""
import argparse
import sys

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from planesplit.scenarios.definitions import ALL_SCENARIOS, SCENARIO_BY_NUMBER, ProbeResult, remediation_demo
from planesplit.verify.remediator import RemediationResult

STATUS_STYLE = {
    "PASS": "bold green",
    "TOLERATED": "bold yellow",
    "ALERT": "bold red",
}

# Deliberately general, not tied to any specific named incident or statistic —
# CLAUDE.md §4/§8 rule out asserting a fact ("Company X was down for Y hours")
# that hasn't been verified against a primary source. The failure class itself
# (control-plane intent silently diverging from data-plane reality) is well
# documented across SDN, Kubernetes NetworkPolicy propagation, and BGP
# convergence — see docs/RESEARCH.md — which is enough to motivate the demo
# without inventing a specific case.
HOOK_TEXT = (
    "[bold]Every SDN controller, every Kubernetes NetworkPolicy, every BGP "
    "route push makes the same silent promise: the rule you configured is "
    "the rule actually running on the device.[/bold]\n\n"
    "That promise breaks more often than dashboards admit. An update can be "
    "delayed, dropped, or only partially applied — and the device keeps "
    "forwarding traffic on stale or corrupted rules, invisibly, until "
    "someone notices packets going somewhere they shouldn't.\n\n"
    "This demo proves — with a real simulated packet traced through the "
    "actual forwarding tables, not a config diff — that this system can "
    "tell the difference between a transient, tolerable delay and a "
    "genuine, persistent divergence."
)

CLOSING_TEXT = (
    "Every PASS/TOLERATED/ALERT above came from tracing a simulated packet "
    "through each router's real forwarding table (RIB for intent, FIB for "
    "reality) — never from comparing configuration strings. That's the "
    "difference between [italic]believing[/italic] a network is consistent "
    "and [italic]proving[/italic] it."
)


def print_hook(console: Console) -> None:
    console.print(Panel(HOOK_TEXT, title="Why this matters", border_style="cyan", expand=False))


def print_closing(console: Console) -> None:
    console.print(Panel(CLOSING_TEXT, title="What you just saw", border_style="cyan", expand=False))


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


def print_remediation_evidence(result: RemediationResult, console: Console) -> None:
    a = result.alert
    console.print(Panel(
        f"[bold]Alert responded to:[/bold] flow=[bold]{a.flow}[/bold] "
        f"responsible_router=[bold]{a.responsible_router}[/bold]\n"
        f"  reason: {a.reason}\n\n"
        f"[bold]Remediation:[/bold] restored FIB entry at [bold]{result.router_id}[/bold] "
        f"to next_hop=[bold]{result.restored_next_hop}[/bold] at t={result.fixed_at}s, "
        "by replaying the RIB's own (never-faulted) intent through one clean "
        "UpdateChannel.apply() call — no LLM, no inference, no candidate-fix "
        "scoring. See docs/INNOVATION.md \"Innovation 2\" for the full design "
        "rationale, including why a persistent re-divergence after this point "
        "is deliberately re-alerted rather than silently re-patched.",
        title="Auto-Remediation Evidence", border_style="magenta", expand=False,
    ))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PlaneSplit demo runner")
    parser.add_argument("--scenario", type=int, choices=sorted(SCENARIO_BY_NUMBER), help="run a single scenario by its docs/TEST_PLAN.md number (1-6)")
    parser.add_argument("--all", action="store_true", help="run every scenario (default if no flag given)")
    parser.add_argument(
        "--remediation-demo",
        action="store_true",
        help="run the added-value auto-remediation demo (docs/INNOVATION.md Innovation 2) instead of the PS31-baseline scenarios",
    )
    args = parser.parse_args(argv)

    console = Console()

    if args.remediation_demo:
        results, remediation = remediation_demo()
        print_hook(console)
        console.print()
        render(results, console)
        console.print()
        print_remediation_evidence(remediation, console)
        return 0

    scenarios_to_run = ALL_SCENARIOS if (args.all or args.scenario is None) else [SCENARIO_BY_NUMBER[args.scenario]]

    all_results: list[ProbeResult] = []
    for scenario_fn in scenarios_to_run:
        all_results.extend(scenario_fn())

    print_hook(console)
    console.print()
    render(all_results, console)
    console.print()
    print_closing(console)
    return 0


if __name__ == "__main__":
    sys.exit(main())
