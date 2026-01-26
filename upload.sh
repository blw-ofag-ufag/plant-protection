# Running ETL pipeline
# Rscript automation/etl.R

# Run the Python script
echo "Running Python reasoning script..."
python3 automation/reason.py rdf/ontology.ttl rdf/products.ttl rdf/companies.ttl rdf/crops.ttl\
  rdf/pests.ttl rdf/substances.ttl rdf/notes.ttl rdf/indications.ttl rdf/mapping/substances.ttl rdf/mapping/images.ttl\
  rdf/mapping/MoA.ttl rdf/foreign/wikidata.ttl rdf/foreign/ChEBI.ttl rdf/foreign/parallelimports.ttl\
  rdf/comments/comments.ttl

echo "Delete existing data from LINDAS"
curl \
  --user $USER:$PASSWORD \
  -X DELETE \
  "$ENDPOINT?graph=$GRAPH"

echo "Upload graph.ttl file to LINDAS"
curl \
  --user $USER:$PASSWORD \
  -X POST \
  -H "Content-Type: text/turtle" \
  --data-binary @rdf/graph.ttl \
  "$ENDPOINT?graph=$GRAPH"

echo "Remove graph.ttl file"
rm rdf/graph.ttl

echo "Remove graph.ttl file"
rm rdf/graph.ttl

echo "All commands executed."
