/* ---------------------------------------------------------------
 * Plant Protection Product Profile - "Cool" Version
 * --------------------------------------------------------------*/
(async () => {
  /* ╭──────────────────── DOM & State ────────────────────╮ */
  const $loading = document.getElementById('loading');
  const $pageContent = document.getElementById('page-content');
  const $sidebar = document.getElementById('sidebar');
  const $mainContent = document.getElementById('main-content');

  const templates = {
    component: document.getElementById('component-tile-template'),
    indication: document.getElementById('indication-item-template'),
  };

  /* ╭──────────────────── Helpers ────────────────────╮ */
  const fetchSparql = async (q) => {
    const res = await fetch('https://lindas.admin.ch/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json' },
      body: q
    });
    if (!res.ok) throw new Error(`SPARQL Query Failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  const chebiId = (iri) => iri?.split('/').pop().replace('_', ':') || null;
  const htmlFormula = (formula) => formula.replace(/(\d+)/g, '<sub>$1</sub>');

  /* ╭──────────────────── Search ────────────────────╮ */
  const initSearch = () => {
    const $searchForm = document.getElementById('search-form');
    const $searchInput = document.getElementById('search-input');

    // The search form now redirects to the search page with the query.
    $searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = $searchInput.value.trim();
      if (!query) return;

      window.location.href = `search.html?search=${encodeURIComponent(query)}`;
    });
  };

  /* ╭──────────────────── Accordion Logic ────────────────────╮ */
  /**
   * Initializes "harmonica" behavior for a list of <details> elements.
   * When one is opened, all others are closed.
   */
  const initAccordion = () => {
    const indicationsList = document.querySelector('.indications-list');
    if (!indicationsList) return;

    const allDetails = indicationsList.querySelectorAll('details.indication-item');

    allDetails.forEach(details => {
      details.addEventListener('toggle', (event) => {
        // If the <details> was opened...
        if (event.target.open) {
          // ...close all other <details> elements in the list.
          allDetails.forEach(otherDetails => {
            if (otherDetails !== event.target) {
              otherDetails.open = false;
            }
          });
        }
      });
    });
  };


  /* ╭──────────────────── Render Functions ────────────────────╮ */

  const renderSidebar = (data) => {
    const { productName, federalNo, foreignNo, types, company, countryName } = data;

    // Create slugs from IRIs for the new search links.
    const companySlug = company.iri ? company.iri.split('/').pop() : '';
    const typeChips = types.map(([iri, label]) => {
      const classSlug = iri.split('/').pop();
      // The chips are now links to the search page.
      return `<a href="search.html?class=${classSlug}" class="chip">${label}</a>`;
    }).join('');

    $sidebar.innerHTML = `
      <div class="card" id="product-info-panel">
        <div id="product-header">
          <h1 id="product-name">${productName}</h1>
          <div class="chip-set">${typeChips}</div>
        </div>
        <hr style="margin: 1.5rem 0; border-color: var(--border-color);">
        <div id="product-identifiers">
          <ul class="identifier-list">
            <li><dt>Eidg. Zulassungsnr.</dt><dd>${federalNo}</dd></li>
            ${foreignNo ? `<li><dt>Ausl. Zulassungsnr.</dt><dd>${foreignNo}</dd></li>` : ''}
            ${countryName ? `<li><dt>Herkunftsland</dt><dd>${countryName}</dd></li>` : ''}
          </ul>
        </div>
        <hr style="margin: 1.5rem 0; border-color: var(--border-color);">
        <div id="product-company">
          <div class="company-info">
            <div class="company-name">
              <!-- The company name now links to the search page. -->
              <a href="search.html?company=${companySlug}">${company.name}</a>
            </div>
            <div class="company-address">${[company.street, company.postal, company.locality].filter(Boolean).join(', ')}</div>
          </div>
        </div>
      </div>
    `;
  };

  const renderMainContent = (data) => {
    $mainContent.innerHTML = `
      <section id="same-products">
        <h2>Chemisch identische Produkte</h2>
        <div class="chip-set">${renderSameProducts(data.sameProducts)}</div>
      </section>
      <section id="hazards">
        <h2>Gefahrenhinweise</h2>
        <div class="data-table-container">${renderHazardsTable(data.hazards) || '<p>Keine Gefahrenhinweise verfügbar.</p>'}</div>
      </section>
      <section id="indications">
        <h2>Zulassungen</h2>
        <div class="indications-list">${data.indications.map(renderIndicationItem).join('') || '<p>Keine Zulassungsinformationen verfügbar.</p>'}</div>
      </section>
      <section id="formulation">
        <br>
        <h2>Formulierung</h2>
        <p>${data.productName} ${data.formulation ? `ist als <b>${data.formulation}</b> formuliert und`:''} besteht aus den folgenden Komponenten:</p>
        <br>
        <ul class="component-grid">${data.components.map(renderComponentTile).join('') || '<p>Keine Komponenteninformationen verfügbar.</p>'}</ul>
      </section>
    `;
    if (window.SmiDrawer) SmiDrawer.apply({ theme: 'dark' });
  };

  const renderComponentTile = (c) => {
    const pct = c.pct ? `${(+c.pct).toFixed(2)} %` : null;
    const gram = c.grams ? `${(+c.grams).toFixed(1)} g/L` : null;
    const portion = [pct, gram].filter(Boolean).join('<br>');
    const placeholderSvg = `<svg viewBox="0 0 160 120" role="img"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="100" font-family="Poppins" fill="none" stroke="var(--text-tertiary)" stroke-width="1" stroke-linejoin="round">?</text></svg>`;

    return `
      <li class="component-tile" data-uri="${c.uri}">
        <a href="substance.html?id=${c.uri.split('/').pop()}">
          <div class="tile-header">
            <h4 class="component-name">${c.name}</h4>
            ${portion ? `<div class="component-portion">${portion}</div>` : ''}
          </div>
          <div class="smiles-container">
            ${c.smiles ? `<svg data-smiles="${c.smiles}" alt="Molekülzeichnung von ${c.name}" data-smiles-theme="gruvbox-dark"></svg>` : placeholderSvg}
          </div>
          <div class="component-meta">
            ${c.formula ? `<span><b>Formel:</b> ${htmlFormula(c.formula)}</span>` : ''}
          </div>
          <div class="tile-footer">
            <span class="component-role">${c.role}</span>
          </div>
        </a>
      </li>`;
  };

  const renderSameProducts = (sameProducts) => {
    if (sameProducts.size === 0) return '<p>Keine bekannt.</p>';
    return [...sameProducts.entries()].map(([iri, { name, code }]) => {
      const text = code && code !== 'CH' ? `${name} (${code})` : name;
      const url = `${location.pathname}?id=${encodeURIComponent(iri.split('/').pop())}`;
      return `<a href="${url}" class="chip">${text}</a>`;
    }).join('');
  };

  const renderIndicationItem = (ind) => {
    const formatRange = (item) => {
      if (!item) return '—';
      const unit = item.unit || '';
      if (item.value) return `${item.value} ${unit}`.trim();
      const [min, max] = [item.min, item.max];
      if (!min && !max) return '—';
      if (min && max && min !== max) return `${min}–${max} ${unit}`.trim();
      return `${min || max} ${unit}`.trim();
    };

    return `
      <details class="indication-item">
        <summary>
          <div class="summary-main">
            <span class="summary-crop">${[...ind.crops.values()].map(c => c.label).join(', ')}</span>
            <span class="summary-pest">Gegen: ${[...ind.pests.values()].map(p => p.label).join(', ')}</span>
          </div>
          <span class="material-symbols-outlined chevron">expand_more</span>
        </summary>
        <div class="indication-details">
          <dl class="indication-dl">
            <dt>Anwendungsbereich</dt><dd><a href="${ind.area.uri}" target="_blank" rel="noopener">${ind.area.label}</a></dd>
            <dt>Kultur</dt><dd>${[...ind.crops.values()].map(c => `<a href="${c.uri}" target="_blank" rel="noopener">${c.label}</a>`).join(', ')}</dd>
            <dt>Dosierung</dt><dd>${formatRange(ind.dosage)}</dd>
            <dt>Aufwand</dt><dd>${formatRange(ind.expenditure)}</dd>
            <dt>Wartefrist</dt><dd>${formatRange(ind.waitingPeriod)}</dd>
            ${ind.obls.size ? `<dt>Auflagen</dt><dd><ul class="obligations">${[...ind.obls].map(o => `<li>${o}</li>`).join('')}</ul></dd>` : ''}
          </dl>
        </div>
      </details>`;
  };

  const renderHazardsTable = (hazards) => {
    if (!hazards.length) return null;
    const byClass = hazards.reduce((acc, h) => {
      (acc[h.class] = acc[h.class] || []).push(h);
      return acc;
    }, {});

    return `
      <table class="data-table">
        <thead><tr><th>Typ</th><th>Code</th><th>Text</th></tr></thead>
        <tbody>
          ${Object.entries(byClass).map(([cls, arr]) =>
            arr.map((h, i) => `
              <tr>
                ${i === 0 ? `<td rowspan="${arr.length}">${cls}</td>` : ''}
                <td>${h.code ? `<span class="chip">${h.code}</span>` : '—'}</td>
                <td>${h.label}</td>
              </tr>`).join('')
          ).join('')}
        </tbody>
      </table>`;
  };


  /* ╭──────────────────── Main Flow ────────────────────╮ */
  const main = async () => {
    initSearch(); // No longer async

    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
      $loading.innerHTML = `<p>Kein Produkt ausgewählt. Bitte verwenden Sie die Suche oben.<br>Versuchen Sie z.B. <a href="${location.pathname}?id=W-7300">?id=W-7300</a></p>`;
      return;
    }

    try {
      // Define all queries
      const sparqlProduct = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
        PREFIX schema: <http://schema.org/>
        SELECT *
        WHERE {
          GRAPH <https://lindas.admin.ch/foag/plant-protection> {
            VALUES ?p { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
            ?producttype rdfs:subClassOf+ :Product .
            ?p a ?producttype ;
              schema:name ?productName ;
              :federalAdmissionNumber ?federalNo ;
              :hasPermissionHolder ?company .
            OPTIONAL { ?p :foreignAdmissionNumber ?foreignNo . }
            OPTIONAL { ?p :formulation ?fc . ?fc schema:name ?formLabel . FILTER (lang(?formLabel) = "de") }
            OPTIONAL { ?producttype schema:name ?producttypeLabel . FILTER (lang(?producttypeLabel) = "de") }
          }
          OPTIONAL { ?p :hasCountryOfOrigin ?c . ?c schema:name ?countryName . FILTER (lang(?countryName) = "de") }
          OPTIONAL { ?p :isSameProductAs ?sameProduct . ?sameProduct schema:name ?sameProductName . OPTIONAL { ?sameProduct :hasCountryOfOrigin/schema:alternateName ?sameCountryCode . } }
        }`;
      const sparqlComponents = `PREFIX : <https://agriculture.ld.admin.ch/plant-protection/> PREFIX schema: <http://schema.org/> PREFIX obochebi: <http://purl.obolibrary.org/obo/chebi/> SELECT * WHERE { GRAPH <https://lindas.admin.ch/foag/plant-protection> { :${id} :hasComponentPortion ?portion . ?portion :substance ?substance ; :role ?roleIRI . ?substance schema:name ?subName . ?roleIRI schema:name ?roleName . FILTER(lang(?subName)="de"||lang(?subName)="") FILTER(lang(?roleName)="de") OPTIONAL{?portion :hasGrammPerLitre ?grams} OPTIONAL{?portion :hasPercentage ?pct} OPTIONAL{ ?substance :hasChebiIdentity ?chebiIRI} OPTIONAL{ ?substance obochebi:formula ?formula} OPTIONAL{ ?substance obochebi:smiles ?smiles} } } ORDER BY DESC(?pct) DESC(?grams)`;
      const sparqlIndications = `PREFIX : <https://agriculture.ld.admin.ch/plant-protection/> PREFIX schema: <http://schema.org/> SELECT * WHERE { GRAPH <https://lindas.admin.ch/foag/plant-protection> { :${id} :indication ?ind . ?ind :applicationArea ?areaUri . ?areaUri schema:name ?area . FILTER(lang(?area)="de") ?ind :cropGroup ?cropUri . ?cropUri schema:name ?cropLabel . FILTER(lang(?cropLabel)="de") ?ind :cropStressor ?pestUri . ?pestUri schema:name ?pestLabel . FILTER(lang(?pestLabel)="de") OPTIONAL { ?ind :notice ?obl . ?obl schema:name ?oblLabel . FILTER(lang(?oblLabel)="de") } OPTIONAL { ?ind :dosage ?d . OPTIONAL { ?d schema:minValue ?dosageMin . } OPTIONAL { ?d schema:maxValue ?dosageMax . } OPTIONAL { ?d schema:unitCode/schema:name ?dosageUnit . FILTER(lang(?dosageUnit)="de") } } OPTIONAL { ?ind :expenditure ?e . OPTIONAL { ?e schema:minValue ?expMin . } OPTIONAL { ?e schema:maxValue ?expMax . } OPTIONAL { ?e schema:unitCode/schema:name ?expUnit . FILTER(lang(?expUnit)="de") } } OPTIONAL { ?ind :waitingPeriod ?w . OPTIONAL { ?w schema:value ?waitValue . } OPTIONAL { ?w schema:unitCode/schema:name ?waitUnit . FILTER(lang(?waitUnit)="de") } } } }`;
      const sparqlHazards = `PREFIX :<https://agriculture.ld.admin.ch/plant-protection/> PREFIX schema:<http://schema.org/> SELECT * WHERE { GRAPH <https://lindas.admin.ch/foag/plant-protection> { :${id} :notice ?statement . ?statement schema:name ?label ; a/schema:name ?class . FILTER(lang(?label)="de") OPTIONAL{ ?statement :hasHazardStatementCode ?code } VALUES ?class { "R-Satz"@de "S-Satz"@de "Gefahrensymbol"@de "Signalwort"@de } } }`;

      // Fetch product data first to get company IRI
      const prodJ = await fetchSparql(sparqlProduct);
      if (!prodJ.results.bindings.length) throw new Error(`Kein Datensatz für ID=${id} gefunden.`);
      const core = prodJ.results.bindings[0];
      const companyIri = core.company.value;

      // Fetch company details and other data in parallel
      const sparqlCompany = `PREFIX schema:<http://schema.org/> SELECT * WHERE { VALUES ?c{<${companyIri}>} ?c schema:name ?name . OPTIONAL { ?c schema:address ?a . ?a schema:streetAddress ?streetAddress ; schema:postalCode ?postalCode ; schema:addressLocality ?addressLocality } }`;
      const [companyJ, cmpJ, indJ, hazardJ] = await Promise.all([
        fetchSparql(sparqlCompany),
        fetchSparql(sparqlComponents),
        fetchSparql(sparqlIndications),
        fetchSparql(sparqlHazards),
      ]);

      // Process and structure all data
      const companyData = companyJ.results.bindings[0] || {};
      const indicationsByInd = new Map();
      indJ.results.bindings.forEach(r => {
        const key = r.ind.value;
        if (!indicationsByInd.has(key)) indicationsByInd.set(key, { area: {label:r.area.value, uri:r.areaUri.value}, crops: new Map(), pests: new Map(), obls: new Set(), dosage:r.dosageUnit ? {min:r.dosageMin?.value, max:r.dosageMax?.value, unit:r.dosageUnit.value}:null, expenditure:r.expUnit ? {min:r.expMin?.value, max:r.expMax?.value, unit:r.expUnit.value}:null, waitingPeriod:r.waitUnit ? {value:r.waitValue?.value, unit:r.waitUnit.value}:null});
        const obj = indicationsByInd.get(key);
        obj.crops.set(r.cropUri.value, {label:r.cropLabel.value, uri:r.cropUri.value});
        obj.pests.set(r.pestUri.value, {label:r.pestLabel.value, uri:r.pestUri.value});
        if (r.obl) obj.obls.add(r.oblLabel.value);
      });

      const structuredData = {
        productName: core.productName.value,
        federalNo: core.federalNo.value,
        foreignNo: core.foreignNo?.value || null,
        countryName: core.countryName?.value,
        formulation: core.formLabel?.value,
        types: [...new Map(prodJ.results.bindings.filter(r => r.producttype && r.producttypeLabel).map(r => [r.producttype.value, r.producttypeLabel.value]))],
        company: { iri: companyIri, name: companyData.name?.value, street: companyData.streetAddress?.value, postal: companyData.postalCode?.value, locality: companyData.addressLocality?.value },
        sameProducts: new Map(prodJ.results.bindings.filter(r => r.sameProduct && r.sameProductName).map(r => [r.sameProduct.value, { name: r.sameProductName.value, code: r.sameCountryCode?.value || null } ])),
        components: cmpJ.results.bindings.map(r => ({ uri: r.substance.value, name: r.subName.value, role: r.roleName.value, grams: r.grams?.value, pct: r.pct?.value, chebi: r.chebiIRI?.value, smiles: r.smiles?.value, formula: r.formula?.value })),
        indications: [...indicationsByInd.values()],
        hazards: hazardJ.results.bindings.map(r => ({ class: r.class.value, code: r.code?.value, label: r.label.value })),
      };

      // Render page
      renderSidebar(structuredData);
      renderMainContent(structuredData);

      // Initialize the accordion behavior after rendering.
      initAccordion();

      // Show content
      $loading.classList.add('hidden');
      $pageContent.classList.add('visible');
      $pageContent.classList.remove('hidden');

    } catch (err) {
      console.error(err);
      $loading.innerHTML = `<p class="error">${err.message}</p>`;
    }
  };

  main();
})();