> [!NOTE]
> This GitHub repository is used as a proof-of-concept. It does not contain any official information from the Federal Office for Agriculture.

# Visual ontology exploration

You can use the browser tool [WebVOWL](https://github.com/VisualDataWeb/WebVOWL) order to visually explore the ontologies. The following links will open the current drafts for ontologies:

- [**A plant protection ontology for Swiss agriculture.**](https://service.tib.eu/webvowl/#iri=https://raw.githubusercontent.com/blw-ofag-ufag/plant-protection/refs/heads/main/rdf/ontology.ttl)

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
    :federalAdmissionNumber ?WNbr ;
    :isInvolvedIn [
      :protects/schema:name "Kartoffeln"@de ;
      :mitigates/schema:name "Kraut- und Knollenfäule"@de
  	] .
}

GROUP BY ?company
ORDER BY DESC(?Number)
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

## [Federated query: Get all taxon names + authors for pests that belong to the order of *Lepidoptera*](https://s.zazuko.com/25ER8Pj)

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
    :isMitigatedBy/:involves ?product .
  FILTER(LANG(?name) = "de")
  
  # query Wikidata for the 
  SERVICE <https://qlever.cs.uni-freiburg.de/api/wikidata> {
    ?taxon wdt:P225 ?taxonname ;
      wdt:P3031 ?eppo ;
      wdt:P171*/wdt:P225 "Lepidoptera" .
    OPTIONAL {
      ?taxon prop:P225/qualifier:P405/wdt:P1559 ?author .
    }
  }
}

GROUP BY ?pest ?name ?taxon ?eppo ?author ?taxonname
ORDER BY DESC(?products)
```

## Other queries

- [What insecticide indication has most obligations?](https://s.zazuko.com/2MSLoHB)
- [Count number of indications per application area](https://s.zazuko.com/2w3CpY4)
- [Get all class and property labels and comments](https://s.zazuko.com/aJyrxh)
- [Count the instances per (sub)class](https://s.zazuko.com/j55kjw)
- [A list of all substances, their IUPAC name, role, average percentages and how many products they are in](https://s.zazuko.com/3ssB5gY)
- [Count the involved pests and crops per indication](https://s.zazuko.com/272TFvJ)
- [Product list](https://s.zazuko.com/SLoUx8)
