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

# functions to help deal with lists constructed from XML
getLabels = function(x) {
  descs <- x[names(x)=="Description"]
  lang <- sapply(descs, attr, "language")
  vals  <- sapply(descs, attr, "value")
  setNames(as.list(vals), lang)
}

getPK = function(x) {
  attr(x, "primaryKey")
}

getFK = function(x, variable, key = "primaryKey") {
  unname(sapply(x[names(x)==variable], attr, key))
}

printLabels <- function(x) {
  for (lang in c("de","fr","it","en","lt")) {
    label <- x[[lang]]
    if(!is.null(label) && !is.na(label) && label!="") {
      triple(x[["subject"]], "schema:name", langstring(gsub("\"", "'", label), lang))
    }
  }
}

printProperty = function(x, property) {
  for (i in x[[property]]) {
    triple(x[["subject"]], property, i)
  }
}

printList <- function(L, subjectclass, properties = NULL) {
  for (i in L) {
    triple(i[["subject"]], "a", subjectclass)
    printLabels(i)
    for (property in properties) {
      printProperty(i, property)
    }
  }
}

getW <- function(x) paste0("W-", x)

snake_to_camel <- function(x, sep = "_") {
  # x: character vector
  # sep: the separator between words (default "_")
  x <- tolower(x)
  sapply(x, function(str) {
    parts <- strsplit(str, sep, fixed = TRUE)[[1]]
    # capitalize first letter of each part, leave rest as-is
    parts <- paste0(toupper(substr(parts, 1, 1)), substr(parts, 2, nchar(parts)))
    paste(parts, collapse = "")
  }, USE.NAMES = FALSE)
}


