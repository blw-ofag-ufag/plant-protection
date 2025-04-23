// script.js

(async function(){
  const $loading = document.getElementById('loading');
  const $card    = document.getElementById('card');

  // Helper to run a SPARQL query
  async function fetchSparql(query) {
    const res = await fetch('https://lindas.admin.ch/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json'
      },
      body: query
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
  }

  try {
    // 1) Read URL param
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

    // 2) Fetch product data
    const sparqlProduct = `
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT ?productName ?federalNo ?foreignNo ?countryName ?company
       ?producttypeLabel ?sameProduct ?sameProductName
WHERE {
  VALUES ?product { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
  ?product a ?producttype ;
           schema:name ?productName ;
           :hasFederalAdmissionNumber ?federalNo ;
           :hasCountryOfOrigin ?country ;
           :hasPermissionHolder ?company ;
           :isSameProductAs ?sameProduct .
  OPTIONAL { ?product :hasForeignAdmissionNumber ?foreignNo . }
  OPTIONAL {
    ?producttype schema:name ?producttypeLabel .
    FILTER(lang(?producttypeLabel)='de')
  }
  OPTIONAL {
    ?country schema:name ?countryName .
    FILTER(lang(?countryName)='de')
  }
  OPTIONAL { ?sameProduct schema:name ?sameProductName . }
}
`;
    const prodJson = await fetchSparql(sparqlProduct);
    const prodData = prodJson.results.bindings;
    if (!prodData.length) throw new Error('No data for id=' + id);

    const firstRow    = prodData.find(r => r.productName && r.federalNo) || prodData[0];
    const productName = firstRow.productName.value;
    const federalNo   = firstRow.federalNo.value;
    const foreignNo   = firstRow.foreignNo?.value || null;
    const countryName = firstRow.countryName?.value || '—';
    const companyIRI  = firstRow.company.value;

    const productTypes = [...new Set(
      prodData.map(r => r.producttypeLabel?.value).filter(Boolean)
    )];

    const sameMap = new Map();
    prodData.forEach(r => {
      if (r.sameProduct && r.sameProductName) {
        sameMap.set(r.sameProduct.value, r.sameProductName.value);
      }
    });
    const sameProducts = [...sameMap.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'de'));

    // 3) Fetch company & hazards in parallel
    const sparqlCompany = `
PREFIX schema: <http://schema.org/>
SELECT ?name ?streetAddress ?postalCode ?addressLocality
       ?telephone ?email ?fax
WHERE {
  VALUES ?company { <${companyIRI}> }
  ?company schema:name ?name .
  OPTIONAL {
    ?company schema:address ?address .
    ?address schema:streetAddress ?streetAddress .
    ?address schema:postalCode ?postalCode .
    ?address schema:addressLocality ?addressLocality .
  }
  OPTIONAL { ?company schema:telephone ?telephone . }
  OPTIONAL { ?company schema:email ?email . }
  OPTIONAL { ?company schema:fax ?fax . }
}
`;

    const sparqlHazards = `
PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT ?statementName ?codeIRI WHERE {
  VALUES ?product { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
  ?product :hasHazardStatement ?stmt .
  ?stmt schema:name ?statementName .
  FILTER(lang(?statementName)='de')
  OPTIONAL { ?stmt :hasHazardStatementCode ?codeIRI . }
}
`;

    const [compJson, hazJson] = await Promise.all([
      fetchSparql(sparqlCompany),
      fetchSparql(sparqlHazards)
    ]);

    // Company data
    const compData = compJson.results.bindings[0] || {};

    // Hazard data
    const hazData = hazJson.results.bindings;
    const hazardMap = new Map();
    hazData.forEach(r => {
      const txt = r.statementName.value;
      const iri = r.codeIRI?.value;
      if (!hazardMap.has(txt)) hazardMap.set(txt, iri);
    });
    const hazards = Array.from(hazardMap, ([name, codeIRI]) => ({ name, codeIRI }));

    // 4) Build and render
    const el = document.createElement('div');
    let html = `
      <header>
        <h1>${productName}</h1>
        <p class="subtitle">Eingetragenes Pflanzenschutzmittel</p>
        <div>${productTypes.map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      </header>

      <h2>Schnelle Fakten</h2>
      <dl>
        <dt>Eidgenössische Zulassungsnummer</dt><dd>${federalNo}</dd>
        ${foreignNo ? `<dt>Ausländische Zulassungsnummer</dt><dd>${foreignNo}</dd>` : ''}
        <dt>Herkunftsland</dt><dd>${countryName}</dd>
      </dl>

      <h2>Bewilligungsinhaber</h2>
      <dl>
        ${compData.name ? `
          <dt>Firma</dt>
          <dd><a href="${companyIRI}" target="_blank" rel="noopener">${compData.name.value}</a></dd>
        ` : ''}
        ${(compData.streetAddress || compData.postalCode || compData.addressLocality) ? `
          <dt>Adresse</dt>
          <dd>
            ${[compData.streetAddress?.value, compData.postalCode?.value, compData.addressLocality?.value]
               .filter(Boolean).join(', ')}
          </dd>
        ` : ''}
        ${compData.telephone ? `
          <dt>Telefon</dt>
          <dd><a href="${compData.telephone.value}">${compData.telephone.value.replace('tel:', '')}</a></dd>
        ` : ''}
        ${compData.email ? `
          <dt>Email</dt>
          <dd><a href="mailto:${compData.email.value}">${compData.email.value}</a></dd>
        ` : ''}
        ${compData.fax ? `
          <dt>Fax</dt>
          <dd><a href="${compData.fax.value}">${compData.fax.value.replace('tel:', '')}</a></dd>
        ` : ''}
      </dl>

      <h2>Gefahrenhinweise</h2>
      ${hazards.length
        ? `<ul>
            ${hazards.map(h => {
              if (h.codeIRI) {
                const codeText = h.codeIRI.substring(h.codeIRI.lastIndexOf('/') + 1);
                return `<li>
                          <a href="${h.codeIRI}" target="_blank" rel="noopener">${codeText}:</a> ${h.name}
                        </li>`;
              } else {
                return `<li>${h.name}</li>`;
              }
            }).join('')}
           </ul>`
        : `<p>Keine Gefahrenhinweise verfügbar.</p>`
      }

      <h2>Gleichwertige Produkte unter anderem Namen</h2>
      <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
        Die folgenden Produkte werden zwar unter anderem Namen verkauft,
        sind von Inhaltsstoffen her aber identisch.
      </p>
      <div id="sameProducts"></div>
    `;
    el.innerHTML = html;
    $card.appendChild(el);

    // same-product badges
    const $same = $card.querySelector('#sameProducts');
    const tpl   = document.getElementById('badge-template');
    sameProducts.forEach(([iri, name]) => {
      const code = iri.substring(iri.lastIndexOf('/') + 1);
      const a = tpl.content.firstElementChild.cloneNode(true);
      a.href = `${location.pathname}?id=${encodeURIComponent(code)}`;
      a.textContent = name;
      $same.appendChild(a);
    });

    // 5) Show
    $loading.classList.add('hidden');
    $card.classList.remove('hidden');

  } catch (err) {
    console.error(err);
    $loading.innerHTML = `<div class="error">${err.message}</div>`;
  }
})();
