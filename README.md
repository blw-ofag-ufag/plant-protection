# Plant Protection Products as Linked Data

This project extracts the Swiss Plant Protection Product (PPP) registry, maps the data to RDF and publishes it on [LINDAS](https://lindas.admin.ch). The ETL logic lives in [`automation/etl.R`](automation/etl.R) and uses a few CSV files in [`tables/mapping`](tables/mapping) for manual mappings such as company identifiers or product categories.

A couple of small demonstration pages are available in the [`docs`](docs) folder and are hosted via GitHub Pages:

- [Example product overview site.](https://blw-ofag-ufag.github.io/plant-protection/registry/product/?id=W-7055) At the moment, the shown product can only be switched via the URL by passing `?id=XYZ`, with `XYZ` being the W-number of any product.
- [Example of how any fetched table could look like on a federal webpage.](https://blw-ofag-ufag.github.io/plant-protection/table/)

These sites illustrate how linked data from LINDAS can be embedded in a website and **are not meant as full fledged applications**.

## Querying the dataset

The resulting RDF is loaded into the graph `<https://lindas.admin.ch/foag/plant-protection>` on the public LINDAS SPARQL endpoint at `https://lindas.admin.ch/query`. SPARQL is the query language for RDF datasets.

> [!NOTE]
> The following examples can be opened directly in your browser via the [s.zazuko.com](https://s.zazuko.com/) shortener. Via the links, you can view the SPARQL query, edit it yourself and query the LINDAS triple store however you wish.

## Example queries

### [Companies that sell product applicable agains potato late blight](https://s.zazuko.com/2VSLCsf)

```rq
PREFIX schema: <http://schema.org/>
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>

SELECT
  ?company
  (GROUP_CONCAT(CONCAT(?name, " (", ?WNbr, ")"); separator=", ") AS ?Product)
  (COUNT(?product) AS ?Number)

WHERE
{
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

### [Get all subclasses of `:Product` with names and descriptions](https://s.zazuko.com/yWk6Fz)

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

### [Federated query: Get all taxon names + authors for pests that belong to the order of *Lepidoptera*](https://s.zazuko.com/36zyoKS)

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

WHERE
{

  # query LINDAS for pests, their german name, the taxon and any product that is allowed on the pest
  ?pest a :BioticStressor ;
    schema:name ?name ;
    :isDefinedByBiologicalTaxon ?taxon ;
    ^:cropStressor/^:indication ?product .
  FILTER(LANG(?name) = "de")

  # query Wikidata for more information about the taxon
  # (note that we use the *very fast* Qlever endpoint in this case)
  SERVICE <https://qlever.cs.uni-freiburg.de/api/wikidata>
  {
    ?taxon wdt:P225 ?taxonname ;
      wdt:P171*/wdt:P225 "Lepidoptera" .
    OPTIONAL
    {
      ?taxon wdt:P3031 ?eppo .
    }
    OPTIONAL
    {
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
