## Files with data that is integrated from external sources

The files in this folder are automatically written.

### ChEBI entity names, SMILES, and formula

```rq
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX chebi: <http://purl.obolibrary.org/obo/chebi/>
CONSTRUCT
{
    ?entity rdfs:label ?label .
    ?substance chebi:smiles ?smiles ;
      chebi:formula ?formula .
}
WHERE {
  ?substance :hasChebiIdentity ?entity .
  SERVICE <https://sparql.rhea-db.org/sparql/>
  {
    ?entity rdfs:label ?label .
    OPTIONAL { ?entity chebi:smiles ?smiles }
    OPTIONAL { ?entity chebi:formula ?formula }
  }
}
```

### Wikidata taxon names

```rq
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
CONSTRUCT
{
  ?taxon schema:name ?name .
}
WHERE {
  ?sub :isDefinedByBiologicalTaxon ?taxon .
  SERVICE <https://qlever.cs.uni-freiburg.de/api/wikidata>
  {
    ?taxon wdt:P225 ?name .
  }
}
```