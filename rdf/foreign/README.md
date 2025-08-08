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
  ?subject :eppo ?eppo .
}
WHERE {
  ?subject :isDefinedByBiologicalTaxon ?taxon .
  SERVICE <https://qlever.cs.uni-freiburg.de/api/wikidata>
  {
    ?taxon wdt:P225 ?name .
    ?taxon wdt:P3031 ?eppo .
  }
}
```

## Information for parallel imports

This query looks for all parallel products and matches the primary Swiss registration of a chemically equivalent product.
It then assigns all indications found for that product to the parallel product as well.

```rq
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
CONSTRUCT
{
  ?product :notice ?notice .
  ?product :indication ?indication .
  ?product :hasComponentPortion ?componentPortion .
  ?componentPortion :hasComponentPortion ?percentage .
  ?componentPortion :hasComponentPortion ?grammPerLitre .
  ?componentPortion :substance ?substance .
  ?componentPortion :role ?role .
}
WHERE
{
  ?product a :ParallelImport .
  ?product :isSameProductAs ?same .
  ?same :federalAdmissionNumber ?w .
  FILTER(REGEX(STR(?w), "^W-\\d{4}$"))
  ?same :notice ?notice .
  ?same :indication ?indication .
  ?same :hasComponentPortion ?componentPortion .
  ?componentPortion :substance ?substance .
  ?componentPortion :role ?role .
  OPTIONAL { ?componentPortion :hasPercentage ?percentage }
  OPTIONAL { ?componentPortion :hasGrammPerLitre ?grammPerLitre }
}
```