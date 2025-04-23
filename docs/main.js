(async function(){
  const $loading = document.getElementById('loading');
  const $card    = document.getElementById('card');

  // Get ?id=…
  const qs = new URLSearchParams(window.location.search);
  const id = qs.get('id');
  if (!id) {
    $loading.innerHTML = `
      <div class="error">
        Missing URL parameter <code>?id=…</code>.
        Try <a href="${location.pathname}?id=W-4495-1">?id=W-4495-1</a>
      </div>`;
    return;
  }

  const endpoint = 'https://lindas.admin.ch/query';
  const sparql = `
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT *
WHERE {
  VALUES ?product { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
  ?product a ?producttype ;
           schema:name ?productName ;
           :hasFederalAdmissionNumber ?federalNo ;
           :hasCountryOfOrigin ?country ;
           :hasPermissionHolder ?company ;
           :isSameProductAs ?sameProduct .
  OPTIONAL {
    ?producttype schema:name ?producttypeLabel .
    FILTER (lang(?producttypeLabel)='de')
  }
  OPTIONAL {
    ?country schema:name ?countryName .
    FILTER (lang(?countryName)='de')
  }
  OPTIONAL { ?company schema:name ?companyName . }
  OPTIONAL { ?sameProduct schema:name ?sameProductName . }
  OPTIONAL { ?product :hasForeignAdmissionNumber ?foreignAdmissionNumber }
}
`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json'
      },
      body: sparql
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const json = await res.json();
    const data = json.results.bindings;
    if (!data.length) throw new Error('No data for id=' + id);

    // Pick first row for main fields
    const first = data.find(r => r.productName && r.federalNo) || data[0];
    const productName = first.productName.value;
    const federalNo   = first.federalNo.value;
    const countryName = first.countryName?.value || '—';
    const companyIRI  = first.company?.value || null;
    const companyName = first.companyName?.value || companyIRI || '—';

    // Distinct product types
    const classes = [...new Set(
      data.map(r => r.producttypeLabel?.value).filter(Boolean)
    )];

    // Distinct same-products
    const sameProductsMap = new Map();
    data.forEach(r => {
      if (r.sameProduct && r.sameProductName) {
        sameProductsMap.set(r.sameProduct.value, r.sameProductName.value);
      }
    });
    const sameProducts = [...sameProductsMap.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'de'));

    // Build card
    const el = document.createElement('div');
    el.innerHTML = `
      <header>
        <h1>${productName}</h1>
        <p class="subtitle">Eingetragenes Pflanzenschutzmittel</p>
        <div>${classes.map(c => `<span class="tag">${c}</span>`).join('')}</div>
      </header>
      <h2>Schnelle Fakten</h2>
      <dl>
        <dt>Eidgenössische Zulassungsnummer</dt><dd>${federalNo}</dd>
        <dt>Herkunftsland</dt><dd>${countryName}</dd>
        <dt>Bewilligungsinhaber</dt>
        <dd>${companyIRI
          ? `<a href="${companyIRI}" target="_blank" rel="noopener">${companyName}</a>`
          : companyName}
        </dd>
      </dl>
      <h2>Gleichwertige Produkte unter anderem Namen</h2>
      <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
        Die folgenden Produkte werden zwar unter anderem Namen verkauft,
        sind von Inhaltsstoffen her aber identisch.
      </p>
      <div id="sameProducts"></div>
    `;
    $card.appendChild(el);

    // Render same-product badges
    const $same = $card.querySelector('#sameProducts');
    const tpl   = document.getElementById('badge-template');
    sameProducts.forEach(([iri, name]) => {
      const code = iri.substring(iri.lastIndexOf('/') + 1);
      const a = tpl.content.firstElementChild.cloneNode(true);
      a.href = `${location.pathname}?id=${encodeURIComponent(code)}`;
      a.textContent = name;
      $same.appendChild(a);
    });

    // Show
    $loading.classList.add('hidden');
    $card.classList.remove('hidden');

  } catch (err) {
    console.error(err);
    $loading.innerHTML = `<div class="error">${err.message}</div>`;
  }
})();
