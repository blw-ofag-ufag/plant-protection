# ------------------------------------------------------------------
# ADD LIBRARIES TO SEARCH PATH
# ------------------------------------------------------------------

library(dplyr)
library(xml2)
library(rdfhelper) # install from <https://github.com/damian-oswald/rdfhelper>

# ------------------------------------------------------------------
# DEFINE GLOBAL PARAMETERS
# ------------------------------------------------------------------

base <- "https://agriculture.ld.admin.ch/plant-protection/"

# ------------------------------------------------------------------
# DEFINE GLOBAL FUNCTIONS
# ------------------------------------------------------------------

# Function to extract attributes and create a data frame
nodeset_to_dataframe <- function(nodeset) {
  data <- lapply(nodeset, function(node) {
    attrs <- as.list(xml_attrs(node))
    children <- xml_children(node)
    children_data <- sapply(children, function(child) xml_text(child))
    names(children_data) <- xml_name(children)
    c(attrs, children_data)
  })
  df <- bind_rows(data)
  return(df)
}

# function to create W-number from integer W-number
w <- function(x) {
  paste("W", x, sep = "-")
}

# function to get a product number (same for all identical products) from w number
p <- function(x) {
  sapply(strsplit(x, "-"), head, 1)
}

# function to find attribute in XML nodeset
find <- function(x, nodes, key) {
  x |>
    xml_find_all(sprintf(".//%s", nodes)) |>
    xml_attr(key)
}

# ------------------------------------------------------------------
# DOWNLOAD THE SWISS PLANT PROTECTION REGISTRY AS AN XML FILE
# ------------------------------------------------------------------

# Download and unzip the file
url <- "https://www.blv.admin.ch/dam/blv/de/dokumente/zulassung-pflanzenschutzmittel/pflanzenschutzmittelverzeichnis/daten-pflanzenschutzmittelverzeichnis.zip.download.zip/Daten%20Pflanzenschutzmittelverzeichnis.zip"
temporary_zip_file <- tempfile(fileext = ".zip")
unzip_directory <- tempdir()
download.file(url, temporary_zip_file, mode = "wb")
unzip(temporary_zip_file, exdir = unzip_directory)
xml_file_path <- file.path(unzip_directory, "PublicationData.xml")
XML <- read_xml(xml_file_path)
rm(xml_file_path, url, temporary_zip_file, unzip_directory)

# ------------------------------------------------------------------
# WRITE PRODUCT INFORMATION
# ------------------------------------------------------------------

# get a product table
products <- nodeset_to_dataframe(xml_find_all(XML, "//Product"))

# get a parallel import table
parallelimports <- nodeset_to_dataframe(xml_find_all(XML, "//Parallelimport"))

# get all product identifiers
product_identifiers = data.frame(
  pNbr = c(p(products$wNbr), parallelimports$wNbr), # same identifier for same product
  wNbr = c(w(products$wNbr), parallelimports$id) # unique identifiers
)

# create rdf file
sink("rdf/products.ttl")

products = xml_find_all(XML, "//Product")

# loop over each product
for (product in xml_children(xml_child(XML, "Products"))) {
  
  # W-number and product IRI
  product_w_number = product |> xml_attr("wNbr") |> w()
  subject = uri(product_w_number, base)
  triple(subject = subject,
         predicate = "a",
         object = uri("ChemicalCropProtectionProduct", base))
  
  # name of the product
  product_label = product |> xml_attr("name")
  triple(subject = subject,
         predicate = uri("https://www.w3.org/2000/01/rdf-schema#label"),
         object = literal(product_label))
  
  # get all same products
  product_p_number = product_identifiers[product_identifiers$wNbr==product_w_number,"pNbr"]
  same_w_numbers = product_identifiers[product_identifiers$pNbr==product_p_number,"wNbr"] |>
    setdiff(product_w_number)
  triple(subject = subject,
         predicate = uri("isSameProductAs", base),
         object = uri(same_w_numbers, base))
  
  # get the company
  company_id = product |>
    xml_child(1) |>
    xml_child("PermissionHolderKey") |>
    xml_attr("primaryKey")
  triple(subject = subject,
         predicate = uri("hasPermissionHolder", base),
         object = uri(company_id, base))
}

sink()

# ------------------------------------------------------------------
# WRITE COMPANY INFORMATION
# ------------------------------------------------------------------

# create company table
companies = nodeset_to_dataframe(xml_find_all(XML, "//PermissionHolder"))








