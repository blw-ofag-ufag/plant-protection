#!/usr/bin/env python3
"""
reason.py -- Merge, sort, and perform very lightweight reasoning over
             one ontology and multiple data Turtle files.

Key features
------------
* Deterministic sorting of all Turtle output using OrderedTurtleSerializer.
* Flexible namespace rebinding: define all forced prefixes in CUSTOM_NAMESPACES.
* Simple RDFS subclass closure and OWL inverseOf expansion.
* Convenience CLI: `python reason.py ontology.ttl data1.ttl data2.ttl ...`
  Produces `rdf/graph.ttl` (sorted) with inferred triples added.

Author: Damian Oswald
"""

import sys
import os
import rdflib
from rdflib import (
    Graph,
    URIRef,
    Namespace,
    RDF,
    RDFS,
    OWL,
)
from rdflib.namespace import NamespaceManager

# Ordered, deterministic serializer (pip install otsrdflib)
from otsrdflib import OrderedTurtleSerializer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CUSTOM_NAMESPACES = {
    "schema":    "http://schema.org/",
    "srppp":     "https://agriculture.ld.admin.ch/plant-protection/",
    "crop":      "https://agriculture.ld.admin.ch/plant-protection/crop/",
    "pest":      "https://agriculture.ld.admin.ch/plant-protection/pest/",
    "substance": "https://agriculture.ld.admin.ch/plant-protection/substance/",
    "company":   "https://agriculture.ld.admin.ch/plant-protection/company/",
    "code":      "https://agriculture.ld.admin.ch/plant-protection/code/",
    "note":      "https://agriculture.ld.admin.ch/plant-protection/note/"
}

SCHEMA = Namespace(CUSTOM_NAMESPACES["schema"])

OUTPUT_DIR = "rdf"
OUTPUT_FILE = f"{OUTPUT_DIR}/graph.ttl"

# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------


def _apply_custom_namespaces(graph: Graph) -> None:
    """Remove any existing bindings for the prefixes/URIs in CUSTOM_NAMESPACES
    and re‑bind them exactly as specified."""

    nm = NamespaceManager(Graph())

    # Retain all unrelated prefixes
    for prefix, uri in graph.namespace_manager.namespaces():
        if (
            prefix in CUSTOM_NAMESPACES
            or str(uri) in CUSTOM_NAMESPACES.values()
        ):
            continue
        nm.bind(prefix, uri)

    # Force‑bind the customs
    for prefix, uri in CUSTOM_NAMESPACES.items():
        nm.bind(prefix, uri, replace=True)

    graph.namespace_manager = nm


def sort_and_overwrite_turtle(graph: Graph, file_path: str) -> None:
    """Deterministically sort `graph` and overwrite `file_path` in Turtle.
    Also make sure the namespaces in CUSTOM_NAMESPACES are bound as requested."""

    _apply_custom_namespaces(graph)

    with open(file_path, "wb") as fh:
        serializer = OrderedTurtleSerializer(graph)
        serializer.namespace_manager = graph.namespace_manager
        serializer.serialize(fh)

    print(f"File '{file_path}': Triples sorted and namespaces updated.")


def load_and_sort_ttl(path: str) -> Graph:
    g = Graph()
    g.parse(path, format="turtle")
    sort_and_overwrite_turtle(g, path)
    return g


def load_and_sort_ttl_list(paths) -> Graph:
    merged = Graph()
    for p in paths:
        print(f"Processing data file: {p}")
        merged += load_and_sort_ttl(p)
    return merged


# ---------------------------------------------------------------------------
# Reasoning
# ---------------------------------------------------------------------------


def reason_subclass_and_inverse(
    ontology_graph: Graph, data_graph: Graph
) -> Graph:
    """Very small forward‑chaining reasoner implementing:

      1. Subclass closure for rdf:type.
      2. InverseOf property expansion.

    Also duplicates rdfs:label → schema:name and
    rdfs:comment → schema:description.

    Returns a *new* graph with original + inferred triples.
    """
    g = ontology_graph + data_graph  # merged copy

    # Collect direct subclassOf and inverseOf relationships
    subclass_of: dict[URIRef, set[URIRef]] = {}
    inverse_of: dict[URIRef, URIRef] = {}

    for s, p, o in ontology_graph:
        if p == RDFS.subClassOf and isinstance(s, URIRef) and isinstance(o, URIRef):
            subclass_of.setdefault(s, set()).add(o)
        elif p == OWL.inverseOf and isinstance(s, URIRef) and isinstance(o, URIRef):
            inverse_of[s] = o
            inverse_of[o] = s  # ensure symmetry

    changed = True
    while changed:
        changed = False
        existing = set(g)

        # 1) InverseOf expansion
        for s, p, o in existing:
            inv = inverse_of.get(p)
            if inv and (o, inv, s) not in g:
                g.add((o, inv, s))

        # 2) SubclassOf (type propagation)
        for subj, pred, obj in existing:
            if pred == RDF.type and obj in subclass_of:
                for super_c in subclass_of[obj]:
                    if (subj, RDF.type, super_c) not in g:
                        g.add((subj, RDF.type, super_c))

        if len(g) > len(existing):
            changed = True

    # Copy label/comment to schema:name/description
    _duplicate_human_readable_terms(g)

    print(f"Finished reasoning. Total triples: {len(g)}")
    return g


def _duplicate_human_readable_terms(graph: Graph) -> None:
    """For every rdfs:label add schema:name, and
    for every rdfs:comment add schema:description (if absent)."""

    additions = []
    for s, p, o in graph:
        if p == RDFS.label and (s, SCHEMA.name, o) not in graph:
            additions.append((s, SCHEMA.name, o))
        elif p == RDFS.comment and (s, SCHEMA.description, o) not in graph:
            additions.append((s, SCHEMA.description, o))

    for triple in additions:
        graph.add(triple)


# ---------------------------------------------------------------------------
# Main CLI
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> None:
    if len(argv) < 3:
        print(
            "USAGE: python reason.py <ontology.ttl> <data1.ttl> [data2.ttl ...]",
            file=sys.stderr,
        )
        sys.exit(1)

    ontology_path = argv[1]
    data_paths = argv[2:]

    print(f"Sorting ontology: {ontology_path}")
    ontology = load_and_sort_ttl(ontology_path)

    data = load_and_sort_ttl_list(data_paths)

    inferred = reason_subclass_and_inverse(ontology, data)

    # Ensure output dir exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Serializing inferred graph to {OUTPUT_FILE}")
    inferred.serialize(destination=OUTPUT_FILE, format="turtle")

    # Final sort of the aggregated graph
    sort_and_overwrite_turtle(inferred, OUTPUT_FILE)

    print("All done ✨")


if __name__ == "__main__":
    main(sys.argv)
