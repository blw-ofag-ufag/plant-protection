"""
reason.py -- Merge, sort, and perform very lightweight reasoning over
             one ontology and multiple data Turtle files.

Key features
------------
* Deterministic sorting of all Turtle output using OrderedTurtleSerializer.
* Flexible namespace rebinding: define all forced prefixes in CUSTOM_NAMESPACES.
* Simple RDFS subclass **and sub-property** closure, plus OWL inverseOf expansion.
* Convenience CLI: `python reason.py ontology.ttl data1.ttl data2.ttl ...`
  Produces `rdf/graph.ttl` (sorted) with inferred triples added.

Author: Damian Oswald
Date: April 2025
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
    DCTERMS,
)
from rdflib.namespace import NamespaceManager

# Ordered, deterministic serializer (pip install otsrdflib)
from otsrdflib import OrderedTurtleSerializer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CUSTOM_NAMESPACES = {
    "schema":    "http://schema.org/",
    "":          "https://agriculture.ld.admin.ch/plant-protection/",
    "dcterms":   "http://purl.org/dc/terms/",
    "crop":      "https://agriculture.ld.admin.ch/plant-protection/crop/",
    "pest":      "https://agriculture.ld.admin.ch/plant-protection/pest/",
    "substance": "https://agriculture.ld.admin.ch/plant-protection/substance/",
    "company":   "https://agriculture.ld.admin.ch/plant-protection/company/",
    "code":      "https://agriculture.ld.admin.ch/plant-protection/code/",
    "note":      "https://agriculture.ld.admin.ch/plant-protection/note/",
    "wikidata":  "http://www.wikidata.org/entity/",
}

SCHEMA = Namespace(CUSTOM_NAMESPACES["schema"])

OUTPUT_DIR = "rdf"
OUTPUT_FILE = f"{OUTPUT_DIR}/graph.ttl"

# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------


def _apply_custom_namespaces(graph: Graph) -> None:
    """Remove any existing bindings for the prefixes/URIs in CUSTOM_NAMESPACES
    and re-bind them exactly as specified."""

    nm = NamespaceManager(Graph())

    # Retain all unrelated prefixes
    for prefix, uri in graph.namespace_manager.namespaces():
        if (
            prefix in CUSTOM_NAMESPACES
            or str(uri) in CUSTOM_NAMESPACES.values()
        ):
            continue
        nm.bind(prefix, uri)

    # Force-bind the customs
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
    """Very small forward-chaining reasoner implementing:

    1. Subclass closure for **rdf:type**.
    2. Sub-property closure for arbitrary predicates.
    3. InverseOf property expansion.

    It also duplicates rdfs:label → schema:name and
    rdfs:comment → schema:description.

    Returns a *new* graph with original + inferred triples.
    """

    # -------------------------------------------------------------------
    # 0) Merge ontology and data (work on a copy to keep originals intact)
    # -------------------------------------------------------------------
    g = ontology_graph + data_graph

    # -------------------------------------------------------------------
    # 1) Collect schema-level relations from the ontology
    # -------------------------------------------------------------------
    subclass_of: dict[URIRef, set[URIRef]] = {}
    subproperty_of: dict[URIRef, set[URIRef]] = {}
    inverse_of: dict[URIRef, URIRef] = {}

    for s, p, o in ontology_graph:
        # Sub-class axiom: s ⊆ o
        if p == RDFS.subClassOf and isinstance(s, URIRef) and isinstance(o, URIRef):
            subclass_of.setdefault(s, set()).add(o)

        # Sub-property axiom: s ⊑ o
        elif p == RDFS.subPropertyOf and isinstance(s, URIRef) and isinstance(o, URIRef):
            subproperty_of.setdefault(s, set()).add(o)

        # Inverse axiom: s ≡ inverse(o)
        elif p == OWL.inverseOf and isinstance(s, URIRef) and isinstance(o, URIRef):
            inverse_of[s] = o
            inverse_of[o] = s  # ensure symmetry

    # -------------------------------------------------------------------
    # 2) Forward-chaining loop – repeat until fix-point
    # -------------------------------------------------------------------
    changed = True
    while changed:
        changed = False
        existing = set(g)  # snapshot of current edges

        # 2.1) InverseOf expansion: if (s p o) and p⁻¹ = q then add (o q s)
        for s, p, o in existing:
            inv = inverse_of.get(p)
            if inv and (o, inv, s) not in g:
                g.add((o, inv, s))

        # 2.2) SubClassOf closure: if (x rdf:type C) and C ⊆ D then add (x rdf:type D)
        for subj, pred, obj in existing:
            if pred == RDF.type and obj in subclass_of:
                for super_c in subclass_of[obj]:
                    if (subj, RDF.type, super_c) not in g:
                        g.add((subj, RDF.type, super_c))

        # 2.3) SubPropertyOf closure: if (x P y) and P ⊑ Q then add (x Q y)
        for subj, pred, obj in existing:
            supers = subproperty_of.get(pred)
            if supers:
                for super_p in supers:
                    if (subj, super_p, obj) not in g:
                        g.add((subj, super_p, obj))

        # If we added anything new, iterate again to chase longer chains
        if len(g) > len(existing):
            changed = True

    # -------------------------------------------------------------------
    # 3) Human-readable term duplication (labels & descriptions)
    # -------------------------------------------------------------------
    _duplicate_human_readable_terms(g)

    print(f"Finished reasoning. Total triples: {len(g)}")
    return g


def _duplicate_human_readable_terms(graph: Graph) -> None:
    """
    For every rdfs:label or dcterms:title add schema:name,
    and for every rdfs:comment or dcterms:description add schema:description (if absent).
    """

    additions = []
    for s, p, o in graph:
        # map labels and titles to schema:name
        if (p == RDFS.label or p == DCTERMS.title) and (s, SCHEMA.name, o) not in graph:
            additions.append((s, SCHEMA.name, o))

        # map comments and descriptions to schema:description
        elif (p == RDFS.comment or p == DCTERMS.description) and (s, SCHEMA.description, o) not in graph:
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
