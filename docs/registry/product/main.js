// script.js

(async function(){
  const $loading = document.getElementById('loading');
  const $card    = document.getElementById('card');

  // SPARQL helper
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

    // 2) Fetch product + types + optional country, sameProduct, formulationCode
    const sparqlProduct = `
PREFIX :      <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT
  ?productName ?federalNo ?foreignNo ?countryName ?company
  ?formLabel
  ?producttype ?producttypeLabel
  ?sameProduct ?sameProductName
WHERE {
  GRAPH <https://lindas.admin.ch/foag/plant-protection> {
    VALUES ?product { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
    ?product a           ?producttype ;
             schema:name ?productName ;
             :hasFederalAdmissionNumber ?federalNo ;
             :hasPermissionHolder ?company .

    OPTIONAL { ?product :hasForeignAdmissionNumber ?foreignNo }

    OPTIONAL {
      ?product :isSameProductAs ?sameProduct .
      ?sameProduct schema:name ?sameProductName .
    }

    OPTIONAL {
      ?product :hasFormulationCode ?formObj .
      ?formObj schema:name ?formLabel .
      FILTER(lang(?formLabel)="de")
    }

    OPTIONAL {
      ?producttype schema:name ?producttypeLabel .
      FILTER(lang(?producttypeLabel)="de")
    }
  }
  OPTIONAL {
    ?product :hasCountryOfOrigin ?country .
    ?country schema:name ?countryName .
    FILTER(lang(?countryName)="de")
  }
}`;

    const prodJson = await fetchSparql(sparqlProduct);
    const rows     = prodJson.results.bindings;
    if (!rows.length) throw new Error('No data for id=' + id);

    // pick first row for core values
    const firstRow     = rows.find(r => r.productName && r.federalNo) || rows[0];
    const productName  = firstRow.productName.value;
    const federalNo    = firstRow.federalNo.value;
    const foreignNo    = firstRow.foreignNo?.value || null;
    const countryName  = firstRow.countryName?.value || '—';
    const companyIRI   = firstRow.company.value;
    const formulation  = firstRow.formLabel?.value || '—';

    // collect unique product types
    const typeMap = new Map();
    rows.forEach(r => {
      if (r.producttype && r.producttypeLabel) {
        typeMap.set(r.producttype.value, r.producttypeLabel.value);
      }
    });
    const types = Array.from(typeMap.entries()); // [ [iri,label], ... ]

    // collect same products
    const sameMap = new Map();
    rows.forEach(r => {
      if (r.sameProduct && r.sameProductName) {
        sameMap.set(r.sameProduct.value, r.sameProductName.value);
      }
    });
    const sameProducts = Array.from(sameMap.entries())
      .sort((a,b) => a[1].localeCompare(b[1],'de'));

    // 3) Fetch company identifiers & hazards in parallel
    const sparqlCompany = `
PREFIX schema: <http://schema.org/>
SELECT
  ?name ?streetAddress ?postalCode ?addressLocality
  ?telephone ?email ?fax
  ?idName ?idValue
WHERE {
  VALUES ?company { <${companyIRI}> }
  ?company schema:name ?name .
  OPTIONAL {
    ?company schema:address ?address .
    ?address schema:streetAddress    ?streetAddress ;
             schema:postalCode        ?postalCode ;
             schema:addressLocality   ?addressLocality .
  }
  OPTIONAL { ?company schema:telephone ?telephone }
  OPTIONAL { ?company schema:email ?email }
  OPTIONAL { ?company schema:fax ?fax }

  OPTIONAL {
    ?company schema:identifier ?idObj .
    ?idObj schema:name  ?idName ;
           schema:value ?idValue .
    FILTER(?idName IN ("CompanyUID","CompanyCHID"))
  }
}`;

    const sparqlHazards = `
PREFIX :      <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT ?statementName ?codeIRI WHERE {
  GRAPH <https://lindas.admin.ch/foag/plant-protection> {
    VALUES ?product { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
    ?product :hasHazardStatement ?stmt .
    ?stmt schema:name ?statementName .
    FILTER(lang(?statementName)="de")
    OPTIONAL { ?stmt :hasHazardStatementCode ?codeIRI }
  }
}`;

    const [compJson, hazJson] = await Promise.all([
      fetchSparql(sparqlCompany),
      fetchSparql(sparqlHazards)
    ]);

    // process company info
    const compRows = compJson.results.bindings;
    const comp0    = compRows[0] || {};
    const compName = comp0.name?.value;
    const street   = comp0.streetAddress?.value;
    const postal   = comp0.postalCode?.value;
    const locality = comp0.addressLocality?.value;
    const tel      = comp0.telephone?.value;
    const mail     = comp0.email?.value;
    const fax      = comp0.fax?.value;

    let UID = null, CHID = null;
    compRows.forEach(r => {
      if (r.idName?.value === "CompanyUID")  UID  = r.idValue?.value;
      if (r.idName?.value === "CompanyCHID") CHID = r.idValue?.value;
    });

    // process hazards
    const hazRows = hazJson.results.bindings;
    const hazMap  = new Map();
    hazRows.forEach(r => {
      const txt = r.statementName.value;
      const iri = r.codeIRI?.value;
      if (!hazMap.has(txt)) hazMap.set(txt, iri);
    });
    const hazards = Array.from(hazMap.entries())
      .map(([name,iri]) => ({ name, iri }));

    // 4) Render HTML
    const el = document.createElement('div');
    el.innerHTML = `
      <header>
        <h1>${productName}</h1>
        <p class="subtitle">Eingetragenes Pflanzenschutzmittel</p>
        <div>
          ${types.map(([iri,label]) => {
            const slug = iri.split('/').pop();
            return `<a class="tag" href="../overview/index.html?type=${encodeURIComponent(slug)}">${label}</a>`;
          }).join('')}
        </div>
      </header>

      <h2>Schnelle Fakten</h2>
      <dl>
        <dt>Eidgenössische Zulassungsnummer</dt><dd>${federalNo}</dd>
        ${foreignNo ? `<dt>Ausländische Zulassungsnummer</dt><dd>${foreignNo}</dd>` : ''}
        <dt>Herkunftsland</dt><dd>${countryName}</dd>
        <dt>Formulierungscode</dt><dd>${formulation}</dd>
      </dl>

      <h2>Bewilligungsinhaber</h2>
      <dl>
        ${compName ? `
          <dt>Firma</dt>
          <dd><a href="${companyIRI}" target="_blank" rel="noopener">${compName}</a></dd>
        ` : ''}
        ${UID  ? `<dt>UID</dt><dd>${UID}</dd>`   : ''}
        ${CHID ? `<dt>CHID</dt><dd>${CHID}</dd>` : ''}
        ${(street||postal||locality) ? `
          <dt>Adresse</dt>
          <dd>${[street,postal,locality].filter(Boolean).join(', ')}</dd>
        ` : ''}
        ${tel  ? `<dt>Telefon</dt><dd><a href="${tel}">${tel.replace('tel:','')}</a></dd>` : ''}
        ${mail ? `<dt>Email</dt><dd><a href="mailto:${mail}">${mail}</a></dd>`           : ''}
        ${fax  ? `<dt>Fax</dt><dd><a href="${fax}">${fax.replace('tel:','')}</a></dd>`     : ''}
      </dl>

      <h2>Gefahrenhinweise</h2>
      ${hazards.length
        ? `<ul>${hazards.map(h => h.iri
             ? `<li><a href="${h.iri}" target="_blank">${h.iri.split('/').pop()}</a>: ${h.name}</li>`
             : `<li>${h.name}</li>`
           ).join('')}</ul>`
        : `<p>Keine Gefahrenhinweise verfügbar.</p>`}

      <h2>Gleichwertige Produkte unter anderem Namen</h2>
      <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
        Die folgenden Produkte werden zwar unter anderem Namen verkauft, sind inhaltsgleich.
      </p>
      <div id="sameProducts"></div>
    `;
    $card.appendChild(el);

    // render same-product badges
    const $same = $card.querySelector('#sameProducts');
    const tpl   = document.getElementById('badge-template');
    sameProducts.forEach(([iri,name]) => {
      const code = iri.split('/').pop();
      const a = tpl.content.firstElementChild.cloneNode(true);
      a.href = `${location.pathname}?id=${encodeURIComponent(code)}`;
      a.textContent = name;
      $same.appendChild(a);
    });

    // reveal
    $loading.classList.add('hidden');
    $card.classList.remove('hidden');

  } catch(err) {
    console.error(err);
    $loading.innerHTML = `<div class="error">${err.message}</div>`;
  }
})();
