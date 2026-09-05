import sys
from pathlib import Path

# repo root, so `import planesplit` resolves
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
# backend/, so `from state import SimulationState` resolves
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
