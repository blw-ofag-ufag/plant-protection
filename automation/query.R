library(rdfhelper)

sparql <- function (query, endpoint) 
{
    base::suppressMessages(httr::content(httr::POST(url = endpoint, 
        body = list(query = query), 
        encode = "form"), encoding = "UTF-8"))
}

chebi <- '
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
'

data <- sparql(
  query    = chebi,
  endpoint = "https://lindas.admin.ch/query"
)

data
