/* ---------------------------------------------------------------
 * Plant Protection Product Profile
 * --------------------------------------------------------------*/
(async () => {

  /* ╭──────────────────── Helpers ────────────────────╮ */
  const $loading = document.getElementById('loading');
  const $card = document.getElementById('card');

  /** Run a SPARQL query against LIN:das */
  async function fetchSparql(q) {
      const res = await fetch('https://lindas.admin.ch/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json' },
          body: q
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
  }

  /** “CHEBI:12345” from full IRI */
  const chebiId = iri => iri?.split('/').pop().replace('_', ':') || null;

  /** Convert “C9H17NO3” → “C<sub>9</sub>H<sub>17</sub>N<sub>O3</sub>”  */
  function htmlFormula(formula) {
    return formula.replace(/(\d+)/g, '<sub>$1</sub>');
  }

  /* ╭──────────────────── Search ────────────────────╮ */
  let allProducts = [];
  async function initSearch() {
    const $searchForm = document.getElementById('search-form');
    const $searchInput = document.getElementById('search-input');
    const $suggestions = document.getElementById('search-suggestions');
    const sparqlAllProducts = `
      PREFIX schema: <http://schema.org/>
      PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
      SELECT ?product ?name ?federalAdmissionNumber WHERE {
        ?product a :Product ; schema:name ?name ; :federalAdmissionNumber ?federalAdmissionNumber .
      }`;
    try {
      const allProductsJ = await fetchSparql(sparqlAllProducts);
      allProducts = allProductsJ.results.bindings.map(r => ({ id: r.federalAdmissionNumber.value, name: r.name.value }));
      allProducts.forEach(p => {
        const option = document.createElement('option');
        option.value = `${p.name} (${p.id})`;
        $suggestions.appendChild(option);
      });
    } catch (err) { console.error("Failed to initialize search:", err); }

    $searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = $searchInput.value.toLowerCase();
      if (!query) return;
      const foundProduct = allProducts.find(p => p.id.toLowerCase() === query || p.name.toLowerCase() === query || `${p.name} (${p.id})`.toLowerCase() === query);
      if (foundProduct) {
        window.location.href = `${location.pathname}?id=${foundProduct.id}`;
      } else {
        const partialMatch = allProducts.find(p => p.id.toLowerCase().includes(query) || p.name.toLowerCase().includes(query));
        if (partialMatch) { window.location.href = `${location.pathname}?id=${partialMatch.id}`; }
        else { alert('Produkt nicht gefunden.'); }
      }
    });
  }

  /* ╭──────────────────── Main flow ───────────────────╮ */
  async function main() {
    try {
        const qs = new URLSearchParams(location.search);
        const id = qs.get('id');
        if (!id) {
            $loading.innerHTML = `<div class="error">Kein Produkt ausgewählt. Bitte verwenden Sie die Suche oben.<br>Oder versuchen Sie <a href="${location.pathname}?id=W-7300">?id=W-7300</a></div>`;
            return;
        }

        const sparqlProduct = `
        PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
        PREFIX schema: <http://schema.org/>
        SELECT * WHERE {
          GRAPH ?graph {
            VALUES ?p { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
            ?p a ?producttype ; schema:name ?productName ; :federalAdmissionNumber ?federalNo ; :hasPermissionHolder ?company .
            OPTIONAL { ?p :foreignAdmissionNumber ?foreignNo . }
            OPTIONAL { ?p :formulation ?fc . ?fc schema:name ?formLabel . FILTER (lang(?formLabel) = "de") }
            OPTIONAL { ?producttype schema:name ?producttypeLabel . FILTER (lang(?producttypeLabel) = "de") }
          }
          OPTIONAL { ?p :hasCountryOfOrigin ?c . ?c schema:name ?countryName . FILTER (lang(?countryName) = "de") ?c schema:alternateName ?countryCode . }
          OPTIONAL { ?p :isSameProductAs ?sameProduct . ?sameProduct schema:name ?sameProductName . OPTIONAL { ?sameProduct :hasCountryOfOrigin/schema:alternateName ?sameCountryCode . } }
        }`;
        const prodJ = await fetchSparql(sparqlProduct);
        const prodRows = prodJ.results.bindings;
        if (!prodRows.length) throw new Error(`Kein Datensatz für id=${id} gefunden`);
        const core = prodRows.find(r => r.productName && r.federalNo) || prodRows[0];

        const productUri = core.p.value;
        const productName = core.productName.value;
        const federalNo = core.federalNo.value;
        const foreignNo = core.foreignNo?.value || null;
        const countryName = core.countryName?.value;
        const companyIRI = core.company.value;
        const formulation = core.formLabel?.value ;

        const types = [...new Map(prodRows.filter(r => r.producttype && r.producttypeLabel).map(r => [r.producttype.value, r.producttypeLabel.value]))];
        const sameProducts = new Map(prodRows.filter(r => r.sameProduct && r.sameProductName).map(r => [r.sameProduct.value, { name: r.sameProductName.value, code: r.sameCountryCode?.value || null } ]));

        const sparqlCompany = `PREFIX schema:<http://schema.org/> SELECT * WHERE { VALUES ?c{<${companyIRI}>} ?c schema:name ?name . OPTIONAL { ?c schema:address ?a . ?a schema:streetAddress ?streetAddress ; schema:postalCode ?postalCode ; schema:addressLocality ?addressLocality } OPTIONAL { ?c schema:identifier ?idObj . ?idObj schema:name ?idName ; schema:value ?idValue . FILTER(?idName IN("CompanyUID","CompanyCHID","CompanyEHRAID")) } }`;
        const sparqlHazards = `PREFIX :<https://agriculture.ld.admin.ch/plant-protection/> PREFIX schema:<http://schema.org/> SELECT * WHERE { GRAPH <https://lindas.admin.ch/foag/plant-protection> { :${id} :notice ?statement . ?statement schema:name ?label ; a/schema:name ?class . FILTER(lang(?label)="de") OPTIONAL{ ?statement :hasHazardStatementCode ?code } VALUES ?class { "R-Satz"@de "S-Satz"@de "Gefahrensymbol"@de "Signalwort"@de } } }`;
        const sparqlComponents = `PREFIX : <https://agriculture.ld.admin.ch/plant-protection/> PREFIX schema: <http://schema.org/> PREFIX obochebi: <http://purl.obolibrary.org/obo/chebi/> SELECT * WHERE { GRAPH <https://lindas.admin.ch/foag/plant-protection> { VALUES ?p{ :${id} } ?p :hasComponentPortion ?portion . ?portion :substance ?substance ; :role ?roleIRI . OPTIONAL{ ?portion :hasGrammPerLitre ?grams} OPTIONAL{ ?portion :hasPercentage ?pct} ?substance schema:name ?subName FILTER(lang(?subName)="de"||lang(?subName)="") ?roleIRI schema:name ?roleName FILTER(lang(?roleName)="de"||lang(?roleName)="") OPTIONAL{ ?substance :hasChebiIdentity ?chebiIRI} OPTIONAL{ ?substance obochebi:formula ?formula} OPTIONAL{ ?substance obochebi:smiles ?smiles} OPTIONAL{ ?substance :iupac ?iupac } } } ORDER BY DESC(?pct) DESC(?grams)`;
        const sparqlIndications = `PREFIX : <https://agriculture.ld.admin.ch/plant-protection/> PREFIX schema: <http://schema.org/> SELECT * WHERE { GRAPH <https://lindas.admin.ch/foag/plant-protection> { VALUES ?p { :${id} } ?p :indication ?ind . ?ind :applicationArea ?areaUri . ?areaUri schema:name ?area . FILTER(lang(?area)="de") ?ind :cropGroup ?cropUri . ?cropUri schema:name ?cropLabel . FILTER(lang(?cropLabel)="de") ?ind :cropStressor ?pestUri . ?pestUri schema:name ?pestLabel . FILTER(lang(?pestLabel)="de") OPTIONAL { ?ind :notice ?obl . ?obl schema:name ?oblLabel . FILTER(lang(?oblLabel)="de") } OPTIONAL { ?ind :dosage ?d . OPTIONAL { ?d schema:minValue ?dosageMin . } OPTIONAL { ?d schema:maxValue ?dosageMax . } OPTIONAL { ?d schema:unitCode ?dosageUnitUri . ?dosageUnitUri schema:name ?dosageUnit . FILTER(lang(?dosageUnit)="de") } } OPTIONAL { ?ind :expenditure ?e . OPTIONAL { ?e schema:minValue ?expMin . } OPTIONAL { ?e schema:maxValue ?expMax . } OPTIONAL { ?e schema:unitCode ?expUnitUri . ?expUnitUri schema:name ?expUnit . FILTER(lang(?expUnit)="de") } } OPTIONAL { ?ind :waitingPeriod ?w . OPTIONAL { ?w schema:value ?waitValue . } OPTIONAL { ?w schema:unitCode ?waitUnitUri . ?waitUnitUri schema:name ?waitUnit . FILTER(lang(?waitUnit)="de") } } } }`;
        const [companyJ, hazardJ, cmpJ, indJ] = await Promise.all([fetchSparql(sparqlCompany), fetchSparql(sparqlHazards), fetchSparql(sparqlComponents), fetchSparql(sparqlIndications)]);

        const cRows = companyJ.results.bindings, c0 = cRows[0] || {};
        const comp = { name: c0.name?.value, street: c0.streetAddress?.value, postal: c0.postalCode?.value, locality: c0.addressLocality?.value, UID: null, CHID: null, EHRAID: null };
        cRows.forEach(r => { if (r.idName?.value === 'CompanyUID') comp.UID = r.idValue?.value; if (r.idName?.value === 'CompanyCHID') comp.CHID = r.idValue?.value; if (r.idName?.value === 'CompanyEHRAID') comp.EHRAID = r.idValue?.value; });

        const components = cmpJ.results.bindings.map(r => ({ uri: r.substance.value, name: r.subName.value, role: r.roleName.value, grams: r.grams?.value || null, pct: r.pct?.value || null, chebi: r.chebiIRI?.value || null, iupac: r.iupac?.value || null, smiles: r.smiles?.value || null, formula: r.formula?.value || null }));
        const placeholderSvg = `<br><br><svg class="mol placeholder" viewBox="0 0 160 120" role="img" aria-label="Keine Strukturformel vorhanden"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="100" font-family="Inter, sans-serif" fill="none" stroke="#000000" stroke-width="0.75" stroke-linejoin="round">?</text></svg>`;
        const componentsHTML = components.length ? `<ul class="components">${components.map(c => { const pct = c.pct ? `${(+c.pct).toFixed(2)} %` : null; const gram = c.grams ? `${(+c.grams).toFixed(1)} g L<sup>−1</sup>` : null; const portion = [pct, gram].filter(Boolean).join(' / '); return `<li class="tile" data-uri="${c.uri}"><header><h4 class="substance">${c.name}</h4>${portion ? `<div class="portion">${portion}</div>` : ''}</header>${c.smiles ? `<svg class="mol" data-smiles="${c.smiles}" data-smiles-theme="oldschool" alt="Molekülzeichnung von ${c.name}" />` : placeholderSvg}<div class="meta">${c.formula ? `<span><b>Summenformel:</b> ${htmlFormula(c.formula)}</span>` : ''}${c.role ? `<span><b>Rolle:</b> ${c.role}</span>` : ''}${c.chebi ? `<span><b>ChEBI‑Entität:</b> <a href="${c.chebi}" target="_blank" rel="noopener">${chebiId(c.chebi)}</a></span>` : ''}</div></li>`; }).join('')}</ul>` : `<p>Keine Angaben.</p>`;

        const hazardRows = hazardJ.results.bindings.map(r => ({ class: r.class.value, code: r.code?.value || null, label: r.label.value }));
        const byClass = hazardRows.reduce((acc, h) => { (acc[h.class] = acc[h.class] || []).push(h); return acc; }, {});
        let hazardsTableHTML = '';
        if (hazardRows.length) { hazardsTableHTML = `<table class="hazards"><thead><tr><th>Typ</th><th>Code</th><th>Text</th></tr></thead><tbody>${Object.entries(byClass).map(([cls, arr]) => arr.map((h, i) => `<tr>${i === 0 ? `<td rowspan="${arr.length}">${cls}</td>` : ''}<td>${h.code ? `<span class="identifier">${h.code}</span>` : '—'}</td><td>${h.label}</td></tr>`).join('')).join('')}</tbody></table>`; }

        const byInd = new Map();
        indJ.results.bindings.forEach(r => {
          const key = r.ind.value;
          if (!byInd.has(key)) { byInd.set(key, { area: { label: r.area.value, uri: r.areaUri.value }, crops: new Map(), pests: new Map(), obls: new Set(), dosage: r.dosageUnit ? { min: r.dosageMin?.value, max: r.dosageMax?.value, unit: r.dosageUnit.value } : null, expenditure: r.expUnit ? { min: r.expMin?.value, max: r.expMax?.value, unit: r.expUnit.value } : null, waitingPeriod: r.waitUnit ? { value: r.waitValue?.value, unit: r.waitUnit.value } : null }); }
          const obj = byInd.get(key);
          obj.crops.set(r.cropUri.value, { label: r.cropLabel.value, uri: r.cropUri.value });
          obj.pests.set(r.pestUri.value, { label: r.pestLabel.value, uri: r.pestUri.value });
          if (r.obl) { obj.obls.add(r.oblLabel.value); }
        });

        /**
         * Formats a quantitative value for display. Handles single values,
         * min/max ranges, and cases where values might be missing.
         */
        const formatRange = (item) => {
          if (!item) return '—';
          const unit = item.unit || '';
          if (item.value) {
            return `${item.value} ${unit}`.trim();
          }
          const min = item.min;
          const max = item.max;
          if (!min && !max) return '—';
          if (min && max && min !== max) {
            return `${min}–${max} ${unit}`.trim();
          }
          return `${min || max} ${unit}`.trim();
        };

        let indicationsHTML = '';
        if (byInd.size) {
          indicationsHTML = `<div class="indications-accordion">${[...byInd.values()].map(ind => `
            <details class="indication-item">
              <summary>
                <div class="summary-title">
                  <span class="area-tag">${ind.area.label}</span>
                  <strong>${[...ind.crops.values()].map(c => c.label).join(', ')}</strong>
                </div>
                <div class="summary-pest">
                  <span>Gegen</span>
                  <strong>${[...ind.pests.values()].map(p => p.label).join(', ')}</strong>
                </div>
              </summary>
              <div class="indication-details">
                <dl>
                  <dt>Anwendungsbereich</dt><dd><a href="${ind.area.uri}" target="_blank" rel="noopener">${ind.area.label}</a></dd>
                  <dt>Kultur</dt><dd>${[...ind.crops.values()].map(c => `<a href="${c.uri}" target="_blank" rel="noopener">${c.label}</a>`).join(', ')}</dd>
                  <dt>Schadorganismus</dt><dd>${[...ind.pests.values()].map(p => `<a href="${p.uri}" target="_blank" rel="noopener">${p.label}</a>`).join(', ')}</dd>
                  <dt>Dosierung</dt><dd>${formatRange(ind.dosage)}</dd>
                  <dt>Aufwand</dt><dd>${formatRange(ind.expenditure)}</dd>
                  <dt>Wartefrist</dt><dd>${formatRange(ind.waitingPeriod)}</dd>
                  ${ind.obls.size ? `<dt>Auflagen</dt><dd><ul class="obligations">${[...ind.obls].map(o => `<li>${o}</li>`).join('')}</ul></dd>` : ''}
                </dl>
              </div>
            </details>`).join('')}</div>`;
        }

        const wrap = document.createElement('div');
        wrap.innerHTML = `
          <header><h1>${productName}</h1><div>${types.map(([iri,l]) => `<a class="tag" href="${iri}">${l}</a>`).join('')}</div></header>
          <h2>Produktidentifikatoren</h2>
          <dl><dt>Globaler Identifikator</dt><dd><a href="${productUri}" target="_blank">${productUri}</a></dd><dt>Eidg. Zulassungsnr.</dt><dd><span class="identifier">${federalNo}</span></dd>${foreignNo ? `<dt>Ausl. Zulassungsnr.</dt><dd><span class="identifier">${foreignNo}</span></dd>`:''}${countryName ? `<dt>Herkunftsland</dt><dd>${countryName}</dd>`:''}</dl>
          <h2>Bewilligungsinhaber</h2>
          <dl>${comp.name ? `<dt>Firma</dt><dd><a href="${companyIRI}" target="_blank" rel="noopener">${comp.name}</a></dd>`:''}${(comp.street||comp.postal||comp.locality) ? `<dt>Adresse</dt><dd>${[comp.street,comp.postal,comp.locality].filter(Boolean).join(', ')}</dd>`:''}${comp.UID ? `<dt>UID</dt><dd><span class="identifier">${comp.UID}</span></dd>`:''}${comp.CHID ? `<dt>CHID</dt><dd><span class="identifier">${comp.CHID}</span></dd>`:''}${comp.EHRAID ? `<dt>EHRAID</dt><dd><span class="identifier">${comp.EHRAID}</span></dd>`:''}</dl>
          <h2>Chemisch identische Produkte</h2>
          <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">Die folgenden Produkte werden zwar unter anderem Namen verkauft, weisen aber dieselbe chemische Formulierung auf.</p><div id="sameProducts"></div>
          <h2>Formulierung</h2>
          <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">${productName} ${formulation ? `ist als ${formulation} formuliert und`:''} besteht aus den folgenden Komponenten:</p>${componentsHTML}
          <h2>Zulassungen</h2>${indicationsHTML || `<p>Keine Angaben verfügbar.</p>`}
          <h2>Gefahrenhinweise</h2>${hazardsTableHTML || `<p>Keine Gefahrenhinweise verfügbar.</p>`}`;
        $card.appendChild(wrap);
        if (window.SmiDrawer) { SmiDrawer.apply(); }

        const tpl = document.getElementById('tag-template');
        const $same = $card.querySelector('#sameProducts');
        sameProducts.forEach(({ name, code }, iri) => { const a = tpl.content.firstElementChild.cloneNode(true); a.href = `${location.pathname}?id=${encodeURIComponent(iri.split('/').pop())}`; a.textContent = code && code !== 'CH' ? `${name} (${code})` : name; $same.appendChild(a); });

        $loading.classList.add('hidden');
        $card.classList.remove('hidden');

        // --- Event Listeners ---
        $card.addEventListener('click', e => {
            const tile = e.target.closest('.components .tile');
            if (!tile || e.target.tagName === 'A') return;
            const uri = tile.dataset.uri;
            if (uri) window.open(uri, '_blank', 'noopener');
        });

        // Add exclusive open behavior to indications accordion
        const accordion = $card.querySelector('.indications-accordion');
        if (accordion) {
          const details = accordion.querySelectorAll('.indication-item');
          details.forEach(detail => {
            detail.addEventListener('toggle', (e) => {
              if (e.target.open) {
                details.forEach(otherDetail => {
                  if (otherDetail !== e.target) {
                    otherDetail.open = false;
                  }
                });
              }
            });
          });
        }

    } catch (err) {
        console.error(err);
        $loading.innerHTML = `<div class="error">${err.message}</div>`;
    }
  }

  initSearch();
  main();

})();