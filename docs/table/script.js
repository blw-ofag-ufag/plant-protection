/* -----------------------------------------------------------
   Mobile burger (kept from your original file)
----------------------------------------------------------- */
document
  .querySelector('#main-header button.burger')
  .addEventListener('click', () =>
    document.body.classList.toggle('body--mobile-menu-is-open')
  );

/* -----------------------------------------------------------
   LINDAS helper
----------------------------------------------------------- */
window.ENDPOINT = 'https://lindas.admin.ch/query';

window.getSparqlData = async function (query) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  return res.json();
};

/* -----------------------------------------------------------
   Load and build the substance table
----------------------------------------------------------- */
async function loadSubstanceTable() {
  const query = `
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX schema: <http://schema.org/>
    PREFIX substance: <https://agriculture.ld.admin.ch/plant-protection/substance/>
    PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>

    SELECT ?substance ?substanceName ?iupac
          (GROUP_CONCAT(DISTINCT ?roleName; separator = " + ") AS ?roles)
          (COUNT(?product) AS ?products)
          (ROUND(AVG(?percentage)*100)/100 AS ?averagePercentage)
    WHERE {
      ?product :hasComponentPortion [
        :role ?role ;
        :substance ?substance ;
        :hasPercentage ?percentage ;
      ] .
      ?role schema:name ?roleName .
      FILTER (LANG(?roleName) = "de")

      ?substance schema:name ?substanceName .
      FILTER (LANG(?substanceName) = "de")

      OPTIONAL { ?substance :iupac ?iupac }
    }
    GROUP BY ?substance ?substanceName ?iupac
    ORDER BY DESC(?products)
  `;

  try {
    const { results } = await getSparqlData(query);
    const tbody = document.querySelector('#substance-table tbody');
    tbody.innerHTML = '';

    results.bindings.forEach((row) => {
      const iri = row.substance.value;
      const slug = iri.split('/').pop();
      const name = row.substanceName.value;
      const iupac = row.iupac ? row.iupac.value : '';
      const roles = row.roles ? row.roles.value : '';
      const products = row.products ? row.products.value : '';
      const average = row.averagePercentage
        ? row.averagePercentage.value
        : '';

      const link = `<a href="https://www.psm.admin.ch/de/wirkstoffe/${slug}" target="_blank">${name}</a>`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${link}</td>
        <td>${iupac}</td>
        <td>${roles}</td>
        <td style="text-align:right;">${products}</td>
        <td style="text-align:right;">${average}</td>
      `;
      tbody.appendChild(tr);
    });

    /* initialise (or re-initialise) DataTables */
    const $table = $('#substance-table');
    if ($.fn.DataTable.isDataTable($table)) {
      $table.DataTable().clear().destroy();
    }
    $('#substance-table').DataTable({
      // everything you already had …
      language: {
        url: 'https://cdn.datatables.net/plug-ins/1.13.8/i18n/de-DE.json',
      },
    
      /* ▼ NEW ▼ */
      // put the length-selector left, the search right, both in one line
      dom: "<'row mb-2 align-items-center'<'col-sm-6'l><'col-sm-6'f>>" +
           "tr" +
           "<'row mt-2'<'col-sm-6'i><'col-sm-6'p>>",
      // make the inputs look like the rest of the site
      classes: {
        sLengthSelect: 'form-select form-select-sm',
        sFilterInput:  'form-control form-control-sm',
      },
      pageLength: 10,
      order: [[3, 'desc']],
    });    
  } catch (err) {
    console.error('Error loading substance table:', err);
  }
}

/* run once the DOM is ready */
document.addEventListener('DOMContentLoaded', loadSubstanceTable);
