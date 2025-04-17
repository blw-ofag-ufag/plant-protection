import sys
import rdflib
from rdflib import Graph, URIRef, Namespace
from rdflib.namespace import NamespaceManager
from otsrdflib import OrderedTurtleSerializer

# 1) Define *all* your custom namespaces here:
CUSTOM_NAMESPACES = {
    "schema":    "http://schema.org/",
    "srppp":     "https://agriculture.ld.admin.ch/plant-protection/",
    "crop":      "https://agriculture.ld.admin.ch/plant-protection/crop/"
    # …add more as needed
}

def sort_and_overwrite_turtle(graph: Graph, file_path: str):
    """
    Sorts the given RDF graph and overwrites the given Turtle file in sorted form.
    Rebinds *all* prefixes in CUSTOM_NAMESPACES exactly as specified.
    """

    # Create a fresh namespace manager
    nm = NamespaceManager(Graph())

    # Copy over *other* prefixes (i.e. those not in CUSTOM_NAMESPACES)
    for prefix, uri in graph.namespace_manager.namespaces():
        if prefix in CUSTOM_NAMESPACES or str(uri) in CUSTOM_NAMESPACES.values():
            continue
        nm.bind(prefix, uri)

    # Now bind *all* our custom namespaces (replace if already present)
    for prefix, uri in CUSTOM_NAMESPACES.items():
        nm.bind(prefix, uri, replace=True)

    graph.namespace_manager = nm

    # Serialize using OrderedTurtleSerializer
    with open(file_path, "wb") as f:
        serializer = OrderedTurtleSerializer(graph)
        serializer.namespace_manager = nm
        serializer.serialize(f)

    print(f"File '{file_path}': Triples sorted and namespaces updated.")


def load_and_sort_ttl(file_path: str) -> Graph:
    g = Graph()
    g.parse(file_path, format="turtle")
    sort_and_overwrite_turtle(g, file_path)
    return g


def load_and_sort_ttl_list(file_paths) -> Graph:
    merged = Graph()
    for fp in file_paths:
        print(f"Processing: {fp}")
        g = load_and_sort_ttl(fp)
        merged += g
    return merged


def reason_subclass_and_inverse(ontology_graph: Graph, data_graph: Graph) -> Graph:
    """
    Same as before— no changes needed here except that
    we've now bound *all* the CUSTOM_NAMESPACES in the sorted files.
    """
    g = ontology_graph + data_graph
    # … your existing reasoning code …
    return g


if __name__ == "__main__":
    # (same CLI driver as before)
    if len(sys.argv) < 3:
        print("ERROR: Please specify 1 ontology file and at least 1 data file.")
        sys.exit(1)

    ont_path = sys.argv[1]
    data_paths = sys.argv[2:]
    print(f"Sorting ontology: {ont_path}")
    ont = load_and_sort_ttl(ont_path)
    data = load_and_sort_ttl_list(data_paths)
    inferred = reason_subclass_and_inverse(ont, data)
    out = "rdf/graph.ttl"
    inferred.serialize(destination=out, format="turtle")
    sort_and_overwrite_turtle(inferred, out)
    print("Done.")
