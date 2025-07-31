> [!NOTE]
> This GitHub repository is used as a proof-of-concept. It does not contain any official information from the Federal Office for Agriculture.

<img width="1378" height="661" alt="image" src="https://github.com/user-attachments/assets/9e16624d-003b-484c-8afd-36ca0983a129" />

# Example queries

## [Companies that sell product applicable agains potato late blight](https://s.zazuko.com/2VSLCsf)

```rq
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>

SELECT
?company
(GROUP_CONCAT(CONCAT(?name, " (", ?WNbr, ")"); separator=", ") AS ?Product)
(COUNT(?product) AS ?Number)

WHERE {
  ?product schema:name ?name ;
    :hasPermissionHolder/schema:legalName ?company ;
    :federalAdmissionNumber ?WNbr ;
    :indication [
      :cropGroup/schema:name "Kartoffeln"@de ;
      :cropStressor/schema:name "Kraut- und Knollenfäule"@de
  	] .
}

GROUP BY ?company
ORDER BY DESC(?Number)
```

## [Get all subclasses of `:Product` with names and descriptions](https://s.zazuko.com/yWk6Fz)

```rq
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>

SELECT ?label ?comment

WHERE
{
  ?class rdfs:subClassOf* :Product ;
    schema:name ?label ;
    schema:description ?comment .

  VALUES ?lang { "en" }
  FILTER (
    LANG(?label) = ?lang &&
    LANG(?comment) = ?lang 
  )
}

ORDER BY ?class
```

## [Federated query: Get all taxon names + authors for pests that belong to the order of *Lepidoptera*](https://s.zazuko.com/36zyoKS)

```rq
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX wdt:  <http://www.wikidata.org/prop/direct/>
PREFIX prop: <http://www.wikidata.org/prop/>
PREFIX qualifier: <http://www.wikidata.org/prop/qualifier/>
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX pest: <https://agriculture.ld.admin.ch/plant-protection/pest/>
PREFIX wd: <http://www.wikidata.org/entity/>

SELECT ?pest ?name ?taxon ?eppo ?author ?taxonname (COUNT(?product) AS ?products)

WHERE {
  
  # query LINDAS for pests, their german name, the taxon and any product that is allowed on the pest
  ?pest a :BioticStressor ;
    schema:name ?name ;
    :isDefinedByBiologicalTaxon ?taxon ;
    ^:cropStressor/^:indication ?product .
  FILTER(LANG(?name) = "de")
  
  # query Wikidata for the 
  SERVICE <https://qlever.cs.uni-freiburg.de/api/wikidata> {
    ?taxon wdt:P225 ?taxonname ;
      wdt:P171*/wdt:P225 "Lepidoptera" .
    OPTIONAL {
      ?taxon wdt:P3031 ?eppo .
    }
    OPTIONAL {
      ?taxon prop:P225/qualifier:P405/wdt:P1559 ?author .
    }
  }
}

GROUP BY ?pest ?name ?taxon ?eppo ?author ?taxonname
ORDER BY DESC(?products)
```

## Other queries

- [What insecticide indication has most obligations?](https://s.zazuko.com/mkNyy1)
- [Count number of indications per application area](https://s.zazuko.com/cCvhUJ)
- [Get all class and property names and descriptions](https://s.zazuko.com/EJKZAU)
- [Count the instances per product subclass](https://s.zazuko.com/5j9ftQ)
- [A list of all substances, their IUPAC name, role, average percentages and how many products they are in](https://s.zazuko.com/2K54Ld9)
- [Count the involved pests and crops per indication](https://s.zazuko.com/yAWBE5)
- [A list of all units, the SRPPP PK and their occurences](https://s.zazuko.com/hQVZfk)
- [List of all companies that have permission to sell plant protection products](https://s.zazuko.com/21xrM6T)
- [Federated query on CheBI database:](https://s.zazuko.com/3mxZVCq) Query the CheBI database via RHEA for chemical entity names, roles, chemical formulas and foreign keys to other databases.
