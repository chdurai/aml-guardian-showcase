"""Export the compiled graph as Mermaid for docs/README."""
from aml_guardian.graph import build_graph

if __name__ == "__main__":
    print(build_graph().get_graph().draw_mermaid())
