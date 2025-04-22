# ------------------------------------------------------------------
# ADD LIBRARIES TO SEARCH PATH
# ------------------------------------------------------------------

library(xml2)
library(dplyr)
library(srppp)
library(rdfhelper) # install from <https://github.com/damian-oswald/rdfhelper>

# ------------------------------------------------------------------
# DEFINE GLOBAL PARAMETERS
# ------------------------------------------------------------------

base <- "https://agriculture.ld.admin.ch/plant-protection/"
prefixes <- sprintf("@prefix : <%s> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix wd: <http://www.wikidata.org/entity/> .
@prefix schema: <http://schema.org/> .
@prefix zefix: <https://register.ld.admin.ch/zefix/company/> .
", base)

# ------------------------------------------------------------------
# DEFINE HELPER FUNCTIONS
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

# ------------------------------------------------------------------
# DOWNLOAD THE SWISS PLANT PROTECTION REGISTRY AS AN XML FILE
# ------------------------------------------------------------------

# Download registry using `srppp` package
SRPPP <- srppp_dm()

# Download and unzip the file
srppp_zip_url <- "https://www.blv.admin.ch/dam/blv/de/dokumente/zulassung-pflanzenschutzmittel/pflanzenschutzmittelverzeichnis/daten-pflanzenschutzmittelverzeichnis.zip.download.zip/Daten%20Pflanzenschutzmittelverzeichnis.zip"
temp_zip <- tempfile(fileext = ".zip")
unzip_dir <- tempdir()
download.file(srppp_zip_url, temp_zip, mode = "wb")
unzip(temp_zip, exdir = unzip_dir)
xml_file_path <- file.path(unzip_dir, "PublicationData.xml")
XML <- read_xml(xml_file_path)
rm(xml_file_path, srppp_zip_url, temp_zip, unzip_dir)

# Read mapping tables
lindas_country = read.csv("tables/mapping/lindas-country.csv", row.names = 1)
srppp_product_category = read.csv("tables/mapping/srppp-product-category.csv", row.names = 1)
zefix_company = read.csv("tables/mapping/zefix-company.csv", row.names = 1)

# ------------------------------------------------------------------
# WRITE PRODUCT INFORMATION
# ------------------------------------------------------------------

# pre-process product tables
swiss_products = SRPPP$products[,c("pNbr", "wNbr", "name", "exhaustionDeadline", "soldoutDeadline", "permission_holder")]
colnames(swiss_products) = c("pNbr", "hasFederalAdmissionNumber", "rdfs:label", "hasExhaustionDeadline", "hasSoldoutDeadline", "hasPermissionHolder")
swiss_products[,"hasFederalAdmissionNumber"] = paste0("W-", unlist(swiss_products[,"hasFederalAdmissionNumber"]))
swiss_products[,"hasCountryOfOrigin"] = "https://ld.admin.ch/country/CHE"
swiss_products[,"hasForeignAdmissionNumber"] = NA
swiss_products[,"isParallelImport"] = FALSE

# pre-process parallel imports tables
parallel_imports = SRPPP$parallel_imports[,c("pNbr", "id", "name", "exhaustionDeadline", "soldoutDeadline", "permission_holder", "producingCountryPrimaryKey", "admissionnumber")]
colnames(parallel_imports) = colnames(swiss_products)
parallel_imports[,"hasCountryOfOrigin"] = lindas_country[as.character(unlist(parallel_imports[,"hasCountryOfOrigin"])),]
parallel_imports[,"isParallelImport"] = TRUE

# merge the two tables
products = rbind(swiss_products, parallel_imports)
rm(swiss_products, parallel_imports)
products = as.data.frame(products)
products[products==""] <- NA

# tag the products that are allowed non-professionally (runn `unique(SRPPP$CodeS[SRPPP$CodeS$desc_pk==13876,]` to check code ID)
products[,"isNonProfessionallyAllowed"] = products[,"pNbr"] %in% unlist(SRPPP$CodeS[SRPPP$CodeS$desc_pk==13876,"pNbr"])

# sort by product ID (this is important for the "sameProductAs" search)
products = products[order(products$pNbr),]

# open file
sink("rdf/products.ttl")

cat(prefixes)

# write triples
for (i in 1:nrow(products)) {
  
  # save the current row
  x = as.list(products[i,])
  
  # save the current product
  subject = uri(x$hasFederalAdmissionNumber, base)
  
  # save classes as one string
  classes <- uri(srppp_product_category[as.character(unlist(SRPPP$categories[SRPPP$categories$pNbr==products[i,"pNbr"],2])),1])
  if(products[i,"isParallelImport"]) classes = c(classes, uri("ParallelImport", base))
  
  triple(subject, "a", classes)
  triple(subject, "rdfs:label", literal(x[["rdfs:label"]]))
  for (j in setdiff(names(x), c("pNbr","rdfs:label","isParallelImport"))) {
    
    # save predicate and object
    predicate <- paste0(":", j)
    object <- x[[j]]
    
    # check if object is not NA
    if(!is.na(object)) {
      
      # conditionally make statement based on object class
      if(class(object)=="character") {
        if(length(grep("https://", object))>0) {
          triple(subject, predicate, uri(object))
        } else {
          triple(subject, predicate, literal(object))
        }
      } else if(class(object)=="logical") {
        triple(subject, predicate, typed(tolower(object), datatype = "boolean"))
      } else if(class(object)=="Date") {
        triple(subject, predicate, typed(object, datatype = "date"))
      }
    }
  }

  # find the chemically identical products
  if(sum(products[,"pNbr"]==products[i,"pNbr"])>1) {
    for (j in which(products[,"pNbr"]==products[i,"pNbr"])) {
      if(i != j) {
        triple(subject, ":isSameProductAs", uri(products[j,"hasFederalAdmissionNumber"], base))
      }
    }
  }

  # reuse existing company from lindas zefix, if possible
  company <- products[i,"hasPermissionHolder"]
  if(!is.na(company)) {
    zefix_iri = zefix_company[as.character(company),"IRI"]
    if(!is.na(zefix_iri)) {
      triple(subject, ":hasPermissionHolder", uri(zefix_iri))
    } else {
      triple(subject, ":hasPermissionHolder", uri(file.path("company",company), base))
    }
  }
}

sink()

# ------------------------------------------------------------------
# WRITE COMPANY (PERMISSION HOLDER) INFORMATION
# ------------------------------------------------------------------

# Function to convert *one* city object
convert <- function(x) {
  list(
    id = attr(x, "primaryKey"),
    postalCode = attr(x, "primaryKey"),
    addressLocality = attr(x[["Description"]], "value")
  )
}

# Batch processing city
XML |>
  xml_find_all(".//MetaData[@name='City']/Detail") |>
  as_list() |>
  sapply(convert) |>
  t() |> data.frame(row.names = 1) -> cities


# extract company elements from XML file
company_xml <- xml_find_all(XML, "//PermissionHolder")

# create company table
companies <- nodeset_to_dataframe(company_xml)
companies$hasUID <- zefix_company[companies$primaryKey,"UID"]
companies$city_id	 <- xml_attr(xml_find_all(company_xml, "City"), "primaryKey")
companies$addressLocality	 <- cities[companies$city_id,"addressLocality"]
companies$postalCode	 <- cities[companies$city_id,"postalCode"]
companies$locatedInCountry <- lindas_country[xml_attr(xml_find_all(company_xml, "Country"), "primaryKey"),]

# Format phone and fax according to RFC3966 and extract email addresses that were typed into phone or fax field...
email_regex <- "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
email_from_phone <- ifelse(grepl(email_regex, companies$Phone), tolower(companies$Phone), NA)
email_from_fax <- ifelse(grepl(email_regex, companies$Fax), tolower(companies$Fax), NA)
companies$hasEmailAddress <- ifelse(is.na(email_from_phone), email_from_fax, email_from_phone)
companies$hasEmailAddress <- ifelse(is.na(companies$hasEmailAddress),NA,paste0("mailto:",companies$hasEmailAddress))
companies$hasPhoneNumber <- companies$Phone |> dialr::phone("CH") |> format(format = "RFC3966", clean = FALSE)
companies$hasFaxNumber <- companies$Fax |> dialr::phone("CH") |> format(format = "RFC3966", clean = FALSE)

# rearrange and rename
companies <- as.data.frame(companies)
companies[companies==""] <- NA
companies <- companies[,c("primaryKey","Name","hasUID","hasPhoneNumber","hasFaxNumber","hasEmailAddress","PostOfficeBox","Street","postalCode","addressLocality","locatedInCountry")]
colnames(companies) <- c("IRI","label","hasUID","telephone","faxNumber","email","postOfficeBoxNumber","streetAddress","postalCode","addressLocality","addressCountry")

# match zefix IRI
companies$zefixIRI <- zefix_company[companies[,"IRI"],"IRI"]

# open file
sink("rdf/companies.ttl")

cat(prefixes)

# loop over every company
for (i in 1:nrow(companies)) {
  
  # define a new company IRI
  x = uri(file.path("company",companies[i,"IRI"]), base)
  
  # set company (legal) name and contact info
  triple(x, "a", "schema:Organization")
  triple(x, "schema:name", literal(companies[i,"label"]))
  triple(x, "schema:legalName", literal(companies[i,"label"]))
  for (property in c("email","telephone","faxNumber")) {
    if(!is.na(companies[i,property])) {
      triple(x, uri(property, "http://schema.org/"), uri(companies[i,property]))
    }
  }
  
  # construct address IRI
  address = uri(uuid::UUIDfromName("2034115b-8c4e-43a1-960f-c73320210196", companies[i,"IRI"]), base)
  triple(x, "schema:address", address)
  for (property in c("postOfficeBoxNumber","streetAddress","postalCode", "addressLocality")) {
    if(!is.na(companies[i,property])) {
      triple(address, uri(property, "http://schema.org/"), literal(companies[i,property]))
    }
  }
  triple(address, "schema:addressCountry", uri(companies[i,"addressCountry"]))
  
  # consider same ZEFIX company
  if (as.character(companies[i,"IRI"])%in%rownames(zefix_company)) {
    triple(x, "owl:sameAs", uri(zefix_company[companies[i,"IRI"],"IRI"]))
  }
  
}

sink()

# ------------------------------------------------------------------
# Write data about hazard codes (Code R and Code S)
# ------------------------------------------------------------------

CodeR = unique(SRPPP$CodeR[,-1])
colnames(CodeR) <- c("id", "code", "de", "fr", "it", "en")
CodeS = unique(SRPPP$CodeS[,-1])
colnames(CodeS) <- c("id", "code", "de", "fr", "it", "en")
codes = data.frame(rbind(CodeR, CodeS), type = c(rep(":CodeR", nrow(CodeR)), rep(":CodeS", nrow(CodeS))))
rm(CodeR, CodeS)

sink("rdf/hazard-statements.ttl")

cat(prefixes)

for (i in 1:nrow(codes)) {
  subject = uri(file.path("code", codes[i,1]),base)
  triple(subject, "a", codes[i,"type"])
  if(!is.na(codes[i,2])) triple(subject, ":hasHazardStatementCode", literal(codes[i,2]))
  for (lang in c("de","fr","it","en")) {
    label = codes[i,lang]
    if(label!="") triple(subject, "rdfs:label", langstring(label, lang = lang))
  }
  J = products[products$pNbr %in% unlist(SRPPP$CodeR[SRPPP$CodeR$desc_pk==as.numeric(codes[i,1]),"pNbr"]),"hasFederalAdmissionNumber"]
  for (j in J) {
    triple(subject, ":appliesToProduct", uri(j, base))
  }
}

sink()

# ------------------------------------------------------------------
# Write data about crops
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  parents <- sapply(x[names(x)=="Parent"], attr, "primaryKey")
  descs <- x[names(x)=="Description"]
  lang <- sapply(descs, attr, "language")
  vals  <- sapply(descs, attr, "value")
  c(list(
      id = attr(x, "primaryKey"),
      parents = unname(parents)
    ),
    setNames(as.list(vals), lang)
  )
}

# Read all crops
crops = xml_find_all(XML, "//MetaData[@name='Culture']/Detail") |>
  as_list() |> lapply(convert)

# Write Turtle file
sink("rdf/crops.ttl")
cat(prefixes)
for (crop in crops) {
  subject <- uri(file.path("crop",crop[["id"]]), base)
  triple(subject, "a", ":CropGroup")
  for (lang in c("de","fr","it","en")) {
    label <- crop[lang]
    if(label!=""&!is.na(label)) {
      triple(subject, "rdfs:label", langstring(label, lang))
    }
  }
  for (parent in crop[["parents"]]) {
    triple(subject, ":hasParentCropGroup", uri(file.path("crop", parent), base))
  }
}
sink()

# ------------------------------------------------------------------
# Write data about pests
# ------------------------------------------------------------------

# extract all pests (we can re-use the convert function from before)
pests <- xml_find_all(XML, "//MetaData[@name='Pest']/Detail") |>
  as_list() |> lapply(convert)

# Write Turtle file
sink("rdf/pests.ttl")
cat(prefixes)
for (pest in pests) {
  subject <- uri(file.path("pest",pest[["id"]]), base)
  triple(subject, "a", ":CropStressor")
  for (lang in c("de","fr","it","en", "lt")) {
    label <- pest[lang]
    if(label!=""&!is.na(label)) {
      triple(subject, "rdfs:label", langstring(gsub("\"", "'", label), lang))
    }
  }
}
sink()


# ------------------------------------------------------------------
# Write data about substances
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  descs <- x[names(x)=="Description"]
  lang <- sapply(descs, attr, "language")
  vals  <- sapply(descs, attr, "value")
  c(list(
    id = attr(x, "primaryKey"),
    iupac = attr(x, "iupacName")
  ),
  setNames(as.list(vals), lang)
  )
}

# extract all substances (we can re-use the convert function from before)
substances <- xml_find_all(XML, "//MetaData[@name='Substance']/Detail") |>
  as_list() |> lapply(convert)

# Write Turtle file
sink("rdf/substances.ttl")
cat(prefixes)
for (substance in substances) {
  subject <- uri(file.path("substance", substance[["id"]]), base)
  triple(subject, "a", ":Substance")
  for (lang in c("de","fr","it","en", "lt")) {
    label <- substance[lang]
    if(label!=""&!is.na(label)) {
      triple(subject, "rdfs:label", langstring(gsub("\"", "'", label), lang))
    }
  }
  triple(subject, ":iupac", literal(substance[["iupac"]]))
}
sink()


# ------------------------------------------------------------------
# Write data about Application comments and 
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  descs <- x[names(x)=="Description"]
  lang <- sapply(descs, attr, "language")
  vals  <- sapply(descs, attr, "value")
  c(list(
    id = attr(x, "primaryKey"),
    iupac = attr(x, "iupacName")
  ),
  setNames(as.list(vals), lang)
  )
}

# extract all substances (we can re-use the convert function from before)
L <- xml_find_all(XML, "//MetaData[@name='Obligation']/Detail") |>
  as_list() |>
  lapply(convert)

# Write Turtle file
sink("rdf/obligations.ttl")
cat(prefixes)
for (object in L) {
  subject <- uri(file.path("note", object[["id"]]), base)
  triple(subject, "a", ":ActionNotice, :Obligation")
  for (lang in c("de","fr","it","en")) {
    label <- object[[lang]]
    if(label!="" & !is.na(label) & !is.null(label)) {
      triple(subject, "rdfs:label", langstring(gsub("\"", "'", label), lang))
    }
  }
}
sink()

# ------------------------------------------------------------------
# Write data about indications
# ------------------------------------------------------------------

convert = function(x) {
  indication = x$ProductInformation$Indication
  list(
    id = attr(x, "wNbr"),
    obligations = unname(sapply(indication[names(indication)=="Obligation"], attr, "primaryKey")),
    pests = unname(sapply(indication[names(indication)=="Pest"], attr, "primaryKey")),
    crops = unname(sapply(indication[names(indication)=="Culture"], attr, "primaryKey"))
  )
}

L <- xml_find_all(XML, "//Product") |>
  as_list() |> lapply(convert)

sink("rdf/indications.ttl")
cat(prefixes)
for (object in L) {
  uuid = uuid::UUIDfromName("acdb7485-3f2b-45f0-a783-01133f235c2a", paste0(object,collapse = "-"))
  subject = uri(uuid, base)
  product = uri(paste0("W-", object$id), base)
  triple(subject, "a", ":Treatment")
  triple(subject, ":involves", product)
  for (obligation in object$obligations) {
    triple(subject, ":isConcernedBy", uri(file.path("note",obligation), base))
  }
  for (pest in object$pests) {
    triple(subject, ":mitigates", uri(file.path("pest",pest), base))
  }
  for (crop in object$crops) {
    triple(subject, ":protects", uri(file.path("crop",crop), base))
  }
}
sink()

