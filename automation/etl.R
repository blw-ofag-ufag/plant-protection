# ------------------------------------------------------------------
# ADD LIBRARIES TO SEARCH PATH
# ------------------------------------------------------------------

library(xml2)
library(dplyr)
library(srppp)
library(jsonlite)
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

source("automation/helpers.R")

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

# transform XML to lists
L1 = XML |>
  xml_find_all("//Product") |>
  as_list()
L2 = XML |>
  xml_find_all("//Parallelimport") |>
  as_list()

# construct a index data frame with the id for unique chemical and brand products
index = data.frame(
  
  # id unique to a chemical product
  w = c(
    getW(sub("-.*$", "", sapply(L1, attr, "wNbr"))),
    getW(sapply(L2, attr, "wNbr"))
  ),
  
  # id unique to a product as it is sold (with name and seller)
  p = c(
    getW(sapply(L1, attr, "wNbr")),
    sapply(L2, attr, "id")
  )
)

# other product information (not in SRPPP package)
describe <- function(x, parallelimport = FALSE) {
  
  # get the correct IDs (depending on whether product is parallel import or not)
  if(parallelimport) {
    p = attr(x, "id")
    w = getW(attr(x, "wNbr"))
    subject = uri(p, base)
    triple(subject, "a", ":ParallelImport")
  } else {
    p = getW(attr(x, "wNbr"))
    w = getW(sub("-.*$", "", attr(x, "wNbr")))
    subject = uri(p, base)
    triple(subject, "a", ":Product")
  }
  
  # assign product categories
  for (i in srppp_product_category[getFK(x[["ProductInformation"]], "ProductCategory"),]) {
    triple(subject, "a", uri(i))
  }
  
  # product label
  triple(subject, "rdfs:label", literal(attr(x, "name")))
  
  # Numbers for this product
  triple(subject, ":federalAdmissionNumber", literal(p))
  triple(subject, ":foreignAdmissionNumber", literal(attr(x, "admissionnumber")))
  triple(subject, ":packageInsertNumber", literal(attr(x, "packageInsert")))
  
  # find the chemically identical products and make the identity explicit
  for (i in index[index[,"w"]==w,"p"]) {
    if (i != p) {
      triple(subject, ":isSameProductAs", uri(i, base))
    }
  }
  
  # reuse existing company from lindas zefix, if possible; otherwise point at own company
  companies <- getFK(x[["ProductInformation"]], "PermissionHolderKey")
  if(length(companies)>0) {
    for (company in companies) {
      zefix_iri = zefix_company[as.character(company),"IRI"]
      if(!is.na(zefix_iri)) {
        triple(subject, ":hasPermissionHolder", uri(zefix_iri))
      } else {
        triple(subject, ":hasPermissionHolder", uri(file.path("company",company), base))
      }
    }
  }
  
  # producing country
  triple(subject, ":hasCountryOfOrigin", uri(lindas_country[attr(x, "producingCountryPrimaryKey"),]))
  
  # dates
  for (variable in c("soldoutDeadline", "exhaustionDeadline")) {
    triple(subject, paste0(":",variable), typed(attr(x, variable), "date"))
  }
  
  # add diverse links to codes
  prefix = paste0(base, "code/")
  for (variable in c("FormulationCode", "CodeR", "CodeS", "DangerSymbol", "SignalWords")) {
    triple(subject, paste0(":has",variable), uri(getFK(x[["ProductInformation"]], variable), prefix))
  }
  
  # Save the ingredients (here, we work with blank nodes)
  PI = x[["ProductInformation"]]
  prefix = paste0(base, "substance/")
  for (ingredient in PI[names(PI)=="Ingredient"]) {
    blank <- paste0("_:", nano_id(24))
    triple(subject, ":hasComponentPortion", blank)
    triple(blank, "a", uri(snake_to_camel(unlist(ingredient[["SubstanceType"]])), base))
    triple(blank, ":hasComponentSubstance", uri(getPK(ingredient[["Substance"]]), prefix))
    triple(blank, ":hasPercentage", attr(ingredient, "inPercent"))
    triple(blank, ":hasGrammPerLitre", attr(ingredient, "inGrammPerLitre"))
  }
}

sink("rdf/products.ttl")
cat(prefixes)
for (x in L1) describe(x, FALSE)
for (x in L2) describe(x, TRUE)
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
    if(!is.na(unlist(companies[i,property]))) {
      triple(address, uri(property, "http://schema.org/"), literal(unlist(companies[i,property])))
    }
  }
  triple(address, "schema:addressCountry", uri(companies[i,"addressCountry"]))
  
  # consider same ZEFIX company
  if (as.character(companies[i,"IRI"])%in%rownames(zefix_company)) {
    triple(x, "owl:sameAs", uri(zefix_company[companies[i,"IRI"],"IRI"]))
  }
  
}
sink()
rm(companies, cities, company_xml, email_from_fax, email_from_phone, email_regex, address)


# ------------------------------------------------------------------
# WRITE VARIOUS CODES/ENUMERATED LISTS
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  c(list(
    subject = uri(file.path("code", getPK(x)), base)),
    `:hasHazardStatementCode` = literal(attr(x$Description$Code, "value")),
    getLabels(x))
}

# Write Turtle file
sink("rdf/codes.ttl")
cat(prefixes)
for (varname in c("CodeR", "CodeS", "DangerSymbol", "SignalWords")) {
  XML |> xml_find_all(sprintf("//MetaData[@name='%s']/Detail", varname)) |>
    as_list() |>
    lapply(convert) |>
    printList(sprintf(":%s", varname), properties = ":hasHazardStatementCode")
}
sink()


# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  c(list(
    subject = uri(file.path("code", getPK(x)), base)),
    `:code` = literal(attr(x$Description$Code, "value")),
    getLabels(x))
}

# Write Turtle file
sink("rdf/codes.ttl", append = TRUE)
cat(prefixes)
for (varname in c("FormulationCode", "ApplicationArea", "CultureForm", "Measure", "TimeMeasure")) {
  XML |> xml_find_all(sprintf("//MetaData[@name='%s']/Detail", varname)) |>
    as_list() |>
    lapply(convert) |>
    printList(sprintf(":%s", varname), properties = ":code")
}
sink()

# ------------------------------------------------------------------
# Write data about crops
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  c(list(
      subject = uri(file.path("crop",getPK(x)), base),
      `:hasParentCropGroup` = uri(file.path("crop", getFK(x, "Parent")), base)
    ), getLabels(x)
  )
}

# Write Turtle file
sink("rdf/crops.ttl")
cat(prefixes)
XML |>
  xml_find_all("//MetaData[@name='Culture']/Detail") |>
  as_list() |>
  lapply(convert) |>
  printList(":CropGroup", ":hasParentCropGroup")
sink()

# ------------------------------------------------------------------
# Write data about pests
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
data <- read_json("tables/mapping/crop-stressors.json")
describe <- function(x) {
  
  i = which(sapply(data, function(x) x[["srppp-id"]])==getPK(x))
  subject = uri(file.path("pest",getPK(x)), base)
  
  if(length(i)>0) {
    if(data[[i]][["type"]]=="biotic") {
      triple(subject, "a", c(":CropStressor", ":BioticStressor"))
    } else if (data[[i]][["type"]]=="abiotic") {
      triple(subject, "a", c(":CropStressor", ":AbioticStressor"))
    } else {
      triple(subject, "a", ":CropStressor")
    }
    Q = data[[i]][["wikidata-iri"]]
    if(!is.null(Q)) {
      triple(subject, uri("isDefinedByBiologicalTaxon",base), uri(Q, "http://www.wikidata.org/entity/"))
    }
  }
  
  # print labels
  printLabels(c(list(subject = subject), getLabels(x)))
}

# Write Turtle file
sink("rdf/pests.ttl")
cat(prefixes)
invisible({
  XML |>
    xml_find_all("//MetaData[@name='Pest']/Detail") |>
    as_list() |> lapply(describe)
})
sink()

# ------------------------------------------------------------------
# Write data about substances
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  c(list(
    subject = uri(file.path("substance",getPK(x)), base),
    `:iupac` = literal(attr(x, "iupacName"))
  ), getLabels(x)
  )
}

sink("rdf/substances.ttl")
cat(prefixes)
XML |>
  xml_find_all("//MetaData[@name='Substance']/Detail") |>
  as_list() |>
  lapply(convert) |>
  printList(":Substance", ":iupac")
sink()

# ------------------------------------------------------------------
# Write data about Application comments and obligations
# ------------------------------------------------------------------

# Function to convert *one* crop object to a better processable list
convert <- function(x) {
  c(list(subject = uri(file.path("note", getPK(x)), base)), getLabels(x))
}

# Write Turtle file
sink("rdf/notes.ttl")
cat(prefixes)
XML |> xml_find_all("//MetaData[@name='Obligation']/Detail") |>
  as_list() |>
  lapply(convert) |>
  printList(":ActionNotice, :Obligation")
XML |> xml_find_all("//MetaData[@name='ApplicationComment']/Detail") |>
  as_list() |>
  lapply(convert) |>
  printList(":ActionNotice, :ApplicationComment")
sink()

# ------------------------------------------------------------------
# Write data about indications
# ------------------------------------------------------------------

describe = function(x, parallelimport = FALSE) {
  
  # save indications
  indications = x$ProductInformation[names(x$ProductInformation)=="Indication"]
  
  for (indication in indications) {
    
    # generate an anonymous hash-uuid-URI that will always be the same from the same attributes
    subject = uri(uuid::UUIDfromName("acdb7485-3f2b-45f0-a783-01133f235c2a", rlang::hash(indication)), base)
    
    
    triple(subject, ":involves", if(parallelimport) {
      uri(attr(x, "id"), base)
    } else {
      uri(paste0("W-",attr(x, "wNbr")), base)
    })
    
    triple(subject, "a", ":Indication")
    triple(subject, ":minimumTreatmentDosage", literal(attr(indication, "dosageFrom")))
    triple(subject, ":maximumTreatmentDosage", literal(attr(indication, "dosageTo")))
    triple(subject, ":waitingPeriod", attr(indication, "waitingPeriod"))
    triple(subject, ":expenditureTo", attr(indication, "expenditureTo"))
    triple(subject, ":expenditureFrom", attr(indication, "expenditureFrom"))
    triple(subject, ":hasApplicationArea", uri(file.path("code", getFK(indication, "ApplicationArea")), base))
    triple(subject, ":hasApplicationComment", uri(file.path("note", getFK(indication, "Obligation")), base))
    triple(subject, ":isConcernedBy", uri(file.path("note",getFK(indication, "Obligation")), base))
    triple(subject, ":mitigates", uri(file.path("pest",getFK(indication, "Pest")), base))
    triple(subject, ":protects", uri(file.path("crop",getFK(indication, "Culture")), base))
  }
}


sink("rdf/indications.ttl")
cat(prefixes)
L = XML |>
  xml_find_all("//Product") |>
  as_list()
for (x in L) describe(x)
L = XML |>
  xml_find_all("//Parallelimport") |>
  as_list()
for (x in L) describe(x)
sink()
