A repository to convert the Swiss registry of plant protection products to linked data.

# Example queries

## Companies that sell product applicable agains potato late blight

```rq
PREFIX aschema: <https://schema.ld.admin.ch/>
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>

SELECT
?company
(GROUP_CONCAT(CONCAT(?name, " (", ?WNbr, ")"); separator=", ") AS ?Product)
(COUNT(?product) AS ?Number)

WHERE {
  ?product schema:name ?name ;
    :hasPermissionHolder/schema:legalName ?company ;
    :hasFederalAdmissionNumber ?WNbr ;
    :isInvolvedIn [
      :protects/schema:name "Kartoffeln"@de ;
      :mitigates/schema:name "Kraut- und Knollenfäule"@de
  	] .
}

GROUP BY ?company
ORDER BY DESC(?N)
```

## Get all subclasses of `:Product` with names and descriptions

```rq
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>

SELECT ?label ?comment

WHERE
{
  ?class rdfs:subClassOf* :Product ;
    rdfs:label ?label ;
    rdfs:comment ?comment .

  VALUES ?lang { "en" }
  FILTER (
    LANG(?label) = ?lang &&
    LANG(?comment) = ?lang 
  )
}

ORDER BY ?class
```

## Federated query: Get all taxon names, ranks and authors from Wikidata

```rq
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>
PREFIX prop: <http://www.wikidata.org/prop/>
PREFIX qualifier: <http://www.wikidata.org/prop/qualifier/>
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
SELECT  * WHERE {
  ?pest a :BioticStressor ;
    schema:name ?name ;
    schema:name ?latinName ;
    :bioticStressorIsDefinedByBiologicalTaxon ?taxon .
  
  FILTER(LANG(?name) = "de" && LANG(?latinName) = "lt")
  SERVICE <https://query.wikidata.org/sparql> {
    ?taxon wdt:P225 ?taxonname ;
      wdt:P3031 ?eppo ;
      wdt:P105/rdfs:label ?rank .
    OPTIONAL {
      ?taxon prop:P225/qualifier:P405/wdt:P1559 ?author .
    }
    FILTER(LANG(?rank)="de")
  }
}
```

## Other queries

- [What insecticide indication has most obligations?](https://s.zazuko.com/3b3h8CL)
- [Count number of indications per application area](https://s.zazuko.com/2w3CpY4)
