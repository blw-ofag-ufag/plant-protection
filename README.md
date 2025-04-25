A repository to convert the Swiss registry of plant protection products to linked data.

# Example queries

## Companies that sell product applicable agains potato late blight

```sparql
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>

SELECT
?company
(GROUP_CONCAT(CONCAT(?name, " (", ?WNbr, ")"); separator=", ") AS ?Product)
(COUNT(?product) AS ?Number)

WHERE {
  ?product a :Product ;
    schema:name ?name ;
    :hasPermissionHolder/schema:legalName ?company ;
    :isInvolvedIn ?indication ;
    :hasFederalAdmissionNumber ?WNbr .
  ?indication :protects/schema:name "Kartoffeln"@de ;
    :mitigates/schema:name "Kraut- und Knollenfäule"@de .
}

GROUP BY ?company
ORDER BY DESC(?N)
```

## Get all subclasses of `:Product` with names and descriptions

```sparql
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

## Other queries

- [Number of obligations per indication](https://s.zazuko.com/3BQAbAA)