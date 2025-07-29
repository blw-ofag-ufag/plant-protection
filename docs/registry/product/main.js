/* ---------------------------------------------------------------
 *  script.js – Plant‑Protection Product Profile
 *                (v3  – lightweight tiles, local CheBI link only)
 * --------------------------------------------------------------*/
(async () => {

  /* ╭──────────────────── Helpers ────────────────────╮ */
  const $loading = document.getElementById('loading');
  const $card = document.getElementById('card');

  /** Run a SPARQL query against LIN:das */
  async function fetchSparql(q) {
      const res = await fetch('https://lindas.admin.ch/query', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/sparql-query',
              'Accept': 'application/sparql-results+json'
          },
          body: q
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
  }

  /** “CHEBI:12345” from full IRI */
  const chebiId = iri => iri?.split('/').pop().replace('_', ':') || null;

  /* ╭──────────────────── Main flow ───────────────────╮ */
  try {
      /* 1· url param */
      const qs = new URLSearchParams(location.search);
      const id = qs.get('id');
      if (!id) {
          $loading.innerHTML = `
      <div class="error">
        Missing URL parameter <code>?id=…</code>.<br>
        Try <a href="${location.pathname}?id=W-7300">?id=W-7300</a>
      </div>`;
          return;
      }

      /* 2· core product */
      const sparqlProduct = `
PREFIX :       <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT ?p ?productName ?federalNo ?foreignNo ?countryName ?countryCode ?company
     ?formLabel ?producttype ?producttypeLabel
     ?sameProduct ?sameProductName
WHERE {
GRAPH <https://lindas.admin.ch/foag/plant-protection> {
  VALUES ?p { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
  ?p a ?producttype ;
     schema:name ?productName ;
     :federalAdmissionNumber ?federalNo ;
     :hasPermissionHolder ?company .
  OPTIONAL { ?p :foreignAdmissionNumber ?foreignNo }
  OPTIONAL { ?p :isSameProductAs ?sameProduct .
             ?sameProduct schema:name ?sameProductName }
  OPTIONAL { ?p :formulation ?fc .
             ?fc schema:name ?formLabel FILTER(lang(?formLabel)="de") }
  OPTIONAL { ?producttype schema:name ?producttypeLabel FILTER(lang(?producttypeLabel)="de") }
}
OPTIONAL { ?p :hasCountryOfOrigin ?c .
           ?c schema:name ?countryName FILTER(lang(?countryName)="de")
           ?c schema:alternateName ?countryCode }
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
      const countryCode = core.countryCode?.value;
      const companyIRI = core.company.value;
      const formulation = core.formLabel?.value ;

      const types = [...new Map(
          prodRows.filter(r => r.producttype && r.producttypeLabel)
          .map(r => [r.producttype.value, r.producttypeLabel.value])
      )];

      const sameProducts = [...new Map(
          prodRows.filter(r => r.sameProduct && r.sameProductName)
          .map(r => [r.sameProduct.value, r.sameProductName.value])
      )].sort((a, b) => a[1].localeCompare(b[1], 'de'));

      /* 3· company, hazards, components */
      const sparqlCompany = `
PREFIX schema:<http://schema.org/>
SELECT ?name ?streetAddress ?postalCode ?addressLocality
     ?telephone ?email ?fax ?idName ?idValue
WHERE{
VALUES ?c{<${companyIRI}>}
?c schema:name ?name .
OPTIONAL{?c schema:address ?a .
         ?a schema:streetAddress ?streetAddress ;
            schema:postalCode ?postalCode ;
            schema:addressLocality ?addressLocality}
OPTIONAL{?c schema:telephone ?telephone}
OPTIONAL{?c schema:email ?email}
OPTIONAL{?c schema:fax ?fax}
OPTIONAL{
  ?c schema:identifier ?idObj .
  ?idObj schema:name ?idName ; schema:value ?idValue .
  FILTER(?idName IN("CompanyUID","CompanyCHID","CompanyEHRAID"))
}
}`;

      const sparqlHazards = `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX :<https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema:<http://schema.org/>
SELECT ?class ?code ?label
WHERE{
GRAPH <https://lindas.admin.ch/foag/plant-protection>{
  :${id} :notice ?statement .
  ?statement schema:name ?label ;
    a/schema:name ?class .
  FILTER(lang(?label)="de")
  OPTIONAL{
    ?statement :hasHazardStatementCode ?code
  }
  VALUES ?class {
    "R-Satz"@de
    "S-Satz"@de
    "Gefahrensymbol"@de
    "Signalwort"@de 
  }
}
}`;

      /* components without federated SERVICE */
      const sparqlComponents = `
PREFIX :       <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT *
WHERE{
GRAPH <https://lindas.admin.ch/foag/plant-protection>{
  VALUES ?p{<https://agriculture.ld.admin.ch/plant-protection/${id}>}
  ?p :hasComponentPortion ?portion .
  ?portion :substance ?substance ; :role ?roleIRI .
  OPTIONAL{?portion :hasGrammPerLitre ?grams}
  OPTIONAL{?portion :hasPercentage ?pct}
  ?substance schema:name ?subName FILTER(lang(?subName)="de"||lang(?subName)="")
  ?roleIRI schema:name ?roleName FILTER(lang(?roleName)="de"||lang(?roleName)="")
  OPTIONAL{?substance :hasChebiIdentity ?chebiIRI}
  OPTIONAL{?substance <http://purl.obolibrary.org/obo/chebi/formula> ?formula}
  OPTIONAL{?substance <http://purl.obolibrary.org/obo/chebi/smiles> ?smiles}
  OPTIONAL{?substance :iupac ?iupac }
}
}
ORDER BY DESC(?pct) DESC(?grams)`;

      const [companyJ, hazardJ, cmpJ] = await Promise.all([
          fetchSparql(sparqlCompany),
          fetchSparql(sparqlHazards),
          fetchSparql(sparqlComponents)
      ]);

      /* company obj */
      const cRows = companyJ.results.bindings,
          c0 = cRows[0] || {};
      const comp = {
          name: c0.name?.value,
          street: c0.streetAddress?.value,
          postal: c0.postalCode?.value,
          locality: c0.addressLocality?.value,
          tel: c0.telephone?.value,
          mail: c0.email?.value,
          fax: c0.fax?.value,
          UID: null,
          CHID: null,
          EHRAID: null
      };
      cRows.forEach(r => {
          if (r.idName?.value === 'CompanyUID') comp.UID = r.idValue?.value;
          if (r.idName?.value === 'CompanyCHID') comp.CHID = r.idValue?.value;
          if (r.idName?.value === 'CompanyEHRAID') comp.EHRAID = r.idValue?.value;
      });

      /* components ------------------------------------------------------ */
      const components = cmpJ.results.bindings.map(r => ({
          uri: r.substance.value,
          name: r.subName.value,
          role: r.roleName.value,
          grams: r.grams?.value || null,
          pct: r.pct?.value || null,
          chebi: r.chebiIRI?.value || null,
          iupac: r.iupac?.value || null,
          smiles: r.smiles?.value || null,
          formula: r.formula?.value || null
      }));

      const componentsHTML = components.length ?
          `<ul class="components">
    ${components.map(c => `
      <li class="tile" data-uri="${c.chebi ? c.chebi : c.uri }">
        <header><h4 class="substance">${c.name}</h4></header>
        <div class="meta">
          ${c.formula ? `<span><b>Summenformel:</b> ${c.formula}</span>` : ''}
          ${c.role ? `<span><b>Rolle:</b> ${c.role}</span>` : ''}
          ${c.grams? `<span><b>Anteil:</b> ${Number(c.grams).toLocaleString('de-CH')} g/L</span>` : ''}
          ${c.pct  ? `<span><b>Anteil:</b> ${Number(c.pct ).toLocaleString('de-CH')} %</span>` : ''}
          ${c.chebi? `<span><b>ChEBI-Entität:</b> <a href="${c.chebi}" target="_blank" rel="noopener">${chebiId(c.chebi)}</a></span>` : ''}
        </div>
      </li>`).join('')}
  </ul>` :
          `<p>Keine Angaben.</p>`;

      /* hazards --------------------------------------------------------- */
      const hazardRows = hazardJ.results.bindings.map(r => ({
          class: r.class.value, // Signalwort, R‑Satz, …
          code: r.code?.value || null, // may be null
          label: r.label.value
      }));

      /* group rows by class so we can compute rowspan ------------------- */
      const byClass = hazardRows.reduce((acc, h) => {
          acc[h.class] = acc[h.class] || [];
          acc[h.class].push(h);
          return acc;
      }, {});

      /* build the HTML table -------------------------------------------- */
      let hazardsTableHTML = '';
      if (hazardRows.length) {
          hazardsTableHTML = `
            <table class="hazards">
              <thead><tr><th>Typ</th><th>Code</th><th>Text</th></tr></thead>
              <tbody>
                ${Object.entries(byClass).map(([cls, arr]) =>
                    arr.map((h, i) => `
                      <tr>
                        ${i === 0 ? `<td rowspan="${arr.length}">${cls}</td>` : ''}
                        <td>${h.code ? `<span class="identifier">${h.code}</span>` : '—'}</td>
                        <td>${h.label}</td>
                      </tr>`).join('')
                ).join('')}
              </tbody>
            </table>`;
      }

      /* 4· build card */
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <header>
        <h1>${productName}</h1>
        <p class="subtitle">Eingetragenes Pflanzenschutzmittel</p>
        <div>${types.map(([iri,l])=>{
                  const slug=iri.split('/').pop();
                  return `<a class="tag" href="../overview/index.html?type=${encodeURIComponent(slug)}">${l}</a>`}).join('')}</div>
        </header>

        <h2>Produktidentifikatoren</h2>
        <dl>
        <dt>Globaler Identifikator</dt><dd><a href="${productUri}" target="_blank">${productUri}</a></dd>
        <dt>Eidgenössische Zulassungsnummer</dt><dd><span class="identifier">${federalNo}</span></dd>
        ${foreignNo?`<dt>Ausländische Zulassungsnummer</dt><dd><span class="identifier">${foreignNo}</span></dd>`:''}
        ${countryName?`<dt>Herkunftsland</dt><dd>${countryName}</dd>`:''}
        </dl>

        <h2>Bewilligungsinhaber</h2>
        <dl>
        ${comp.name?`<dt>Firma</dt><dd><a href="${companyIRI}" target="_blank" rel="noopener">${comp.name}</a></dd>`:''}
        ${(comp.street||comp.postal||comp.locality)?`<dt>Adresse</dt><dd>${[comp.street,comp.postal,comp.locality].filter(Boolean).join(', ')}</dd>`:''}
        ${comp.tel?`<dt>Telefon</dt><dd><a href="${comp.tel}">${comp.tel.replace(/^tel:/,'')}</a></dd>`:''}
        ${comp.mail?`<dt>Email</dt><dd><a href="mailto:${comp.mail}">${comp.mail}</a></dd>`:''}
        ${comp.fax?`<dt>Fax</dt><dd><a href="${comp.fax}">${comp.fax.replace(/^tel:/,'')}</a></dd>`:''}
        ${comp.UID?`<dt>UID</dt><dd><span class="identifier">${comp.UID}</span></dd>`:''}
        ${comp.CHID?`<dt>CHID</dt><dd><span class="identifier">${comp.CHID}</span></dd>`:''}
        ${comp.EHRAID?`<dt>EHRAID</dt><dd><span class="identifier">${comp.EHRAID}</span></dd>`:''}
        </dl>

        <h2>Formulierung</h2>
        <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
          ${productName} ${formulation?`ist als ${formulation} formuliert und`:''} besteht aus den folgenden Komponenten:
        </p>
        ${componentsHTML}

        <h2>Gefahrenhinweise</h2>
        ${hazardsTableHTML || `<p>Keine Gefahrenhinweise verfügbar.</p>`}

        <h2>Chemisch identische Produkte unter anderem Namen</h2>
        <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
        Die folgenden Produkte werden zwar unter anderem Namen verkauft, weisen aber dieselbe chemische Formulierung auf.
        </p>
        <div id="sameProducts"></div>
      `;
      $card.appendChild(wrap);

      /* 5· same‑product badges */
      const tpl = document.getElementById('badge-template');
      const $same = $card.querySelector('#sameProducts');
      sameProducts.forEach(([iri, name]) => {
          const a = tpl.content.firstElementChild.cloneNode(true);
          a.href = `${location.pathname}?id=${encodeURIComponent(iri.split('/').pop())}`;
          a.textContent = name;
          $same.appendChild(a);
      });

      /* 6· done */
      $loading.classList.add('hidden');
      $card.classList.remove('hidden');

      /* link the entire tile ------------------------------------------- */
      $card.addEventListener('click', e => {
          const tile = e.target.closest('.components .tile');
          if (!tile) return; // click outside a tile
          // Ignore clicks on real links inside the tile (e.g. the ChEBI link)
          if (e.target.tagName === 'A') return;
          const uri = tile.dataset.uri;
          if (uri) window.open(uri, '_blank', 'noopener');
      });

  } catch (err) {
      console.error(err);
      $loading.innerHTML = `<div class="error">${err.message}</div>`;
  }

})();