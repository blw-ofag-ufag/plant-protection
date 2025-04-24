(async function(){
  const qs       = new URLSearchParams(window.location.search);
  const typeSlug = qs.get('type');
  const $card    = document.querySelector('article.card');

  if (!typeSlug) {
    $card.innerHTML = '<div class="error">Fehlender URL-Parameter <code>?type=…</code></div>';
    return;
  }

  const endpoint = 'https://lindas.admin.ch/query';
  const sparql = `
PREFIX schema: <http://schema.org/>
PREFIX :      <https://agriculture.ld.admin.ch/plant-protection/>
SELECT * WHERE {
  GRAPH <https://lindas.admin.ch/foag/plant-protection> {
	VALUES ?class { <https://agriculture.ld.admin.ch/plant-protection/${typeSlug}> }
    ?product a ?class ;
      schema:name ?name ;
      :hasFederalAdmissionNumber ?number ;
      :hasPermissionHolder ?company .
    ?class schema:name ?typeName .
    FILTER(LANG(?typeName)="de")
    OPTIONAL {
      ?class schema:description ?typeDescription .
      FILTER(LANG(?typeDescription)="de")
    }
  }
  ?company schema:legalName ?companyName .
  FILTER(LANG(?companyName)="")
}
`;

  try {
    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept':       'application/sparql-results+json'
      },
      body: sparql
    });
    if (!res.ok) throw new Error(res.statusText);

    const json = await res.json();
    const rows = json.results.bindings;
    if (!rows.length) throw new Error('Keine Einträge für Typ ' + typeSlug);

    // Header
    document.getElementById('typeName').textContent = rows[0].typeName.value;

    const descEl = document.getElementById('typeDescription');
    if (rows[0].typeDescription) {
      descEl.textContent = rows[0].typeDescription.value;
      descEl.style.display = '';            // ensure it's visible
    } else {
      descEl.style.display = 'none';        // hide subtitle if none
    }

    // Fill table
    const $tbody = $('#productTable tbody');
    rows.forEach(r => {
      const num   = r.number.value;
      const pLink = `../product/index.html?id=${encodeURIComponent(num)}`;
      const cLink = r.company.value;
      $tbody.append(`
        <tr>
          <td><a href="${pLink}">${r.name.value}</a></td>
          <td>${num}</td>
          <td><a href="${cLink}" target="_blank">${r.companyName.value}</a></td>
        </tr>
      `);
    });

    // Init DataTable
    const table = $('#productTable').DataTable({
      stripeClasses: [],     // no default zebra striping
      pageLength: 10,
      lengthChange: false,
      dom: 'rtip',
      language: {
        paginate: { previous: '‹', next: '›' },
        info: 'Zeige _START_–_END_ von _TOTAL_'
      }
    });

    // custom search
    $('#tableSearch').on('input', function(){
      table.search(this.value).draw();
    });

  } catch(err) {
    $card.innerHTML = `<div class="error">${err.message}</div>`;
  }
})();
