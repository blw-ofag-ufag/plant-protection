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

  /** Convert “C9H17NO3” → “C<sub>9</sub>H<sub>17</sub>N<sub>O3</sub>”  */
  function htmlFormula(formula) {
    return formula.replace(/(\d+)/g, '<sub>$1</sub>');
  }

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
      PREFIX : <https://agriculture.ld.admin.ch/plant-protection/>
      PREFIX schema: <http://schema.org/>
      SELECT *
      WHERE {
        GRAPH ?graph {
          VALUES ?p { <https://agriculture.ld.admin.ch/plant-protection/${id}> }
          ?p a ?producttype ;
            schema:name ?productName ;
            :federalAdmissionNumber ?federalNo ;
            :hasPermissionHolder ?company .
          OPTIONAL {
            ?p :foreignAdmissionNumber ?foreignNo .
          }
          OPTIONAL {
            ?p :formulation ?fc .
            ?fc schema:name ?formLabel .
            FILTER (lang(?formLabel) = "de")
          }
          OPTIONAL {
            ?producttype schema:name ?producttypeLabel .
            FILTER (lang(?producttypeLabel) = "de")
          }
        }
        OPTIONAL {
          ?p :hasCountryOfOrigin ?c .
          ?c schema:name ?countryName .
          FILTER (lang(?countryName) = "de")
          ?c schema:alternateName ?countryCode .
        }
        OPTIONAL {
          ?p :isSameProductAs ?sameProduct .
          ?sameProduct schema:name ?sameProductName .
          OPTIONAL {
            ?sameProduct :hasCountryOfOrigin/schema:alternateName ?sameCountryCode .
          }
        }
      }
      `;
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

      const types = [...new Map(
          prodRows.filter(r => r.producttype && r.producttypeLabel)
          .map(r => [r.producttype.value, r.producttypeLabel.value])
      )];

      const sameProducts = new Map(
        prodRows
          .filter(r => r.sameProduct && r.sameProductName)
          .map(r => [
            r.sameProduct.value,
            { name: r.sameProductName.value,
              code: r.sameCountryCode?.value || null }
          ])
      );

      /* 3· company, hazards, components */
      const sparqlCompany = `
        PREFIX schema:<http://schema.org/>
        SELECT *
        WHERE
        {
          VALUES ?c{<${companyIRI}>}
          ?c schema:name ?name .
          OPTIONAL{?c schema:address ?a .
                  ?a schema:streetAddress ?streetAddress ;
                      schema:postalCode ?postalCode ;
                      schema:addressLocality ?addressLocality}
          OPTIONAL
          {
            ?c schema:identifier ?idObj .
            ?idObj schema:name ?idName ; schema:value ?idValue .
            FILTER(?idName IN("CompanyUID","CompanyCHID","CompanyEHRAID"))
          }
        }
      `;

      const sparqlHazards = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX :<https://agriculture.ld.admin.ch/plant-protection/>
        PREFIX schema:<http://schema.org/>
        SELECT *
        WHERE{
          GRAPH <https://lindas.admin.ch/foag/plant-protection>
          {
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
        }
      `;

      /* components without federated SERVICE */
      const sparqlComponents = `
        PREFIX :         <https://agriculture.ld.admin.ch/plant-protection/>
        PREFIX schema:   <http://schema.org/>
        PREFIX obochebi: <http://purl.obolibrary.org/obo/chebi/>
        SELECT *
        WHERE
        {
          GRAPH <https://lindas.admin.ch/foag/plant-protection>
          {
            VALUES ?p{ :${id} }
            ?p :hasComponentPortion ?portion .
            ?portion :substance ?substance ; :role ?roleIRI .
            OPTIONAL{ ?portion            :hasGrammPerLitre ?grams}
            OPTIONAL{ ?portion            :hasPercentage ?pct}
            ?substance schema:name ?subName FILTER(lang(?subName)="de"||lang(?subName)="")
            ?roleIRI   schema:name ?roleName FILTER(lang(?roleName)="de"||lang(?roleName)="")
            OPTIONAL{ ?substance          :hasChebiIdentity ?chebiIRI}
            OPTIONAL{ ?substance  obochebi:formula          ?formula}
            OPTIONAL{ ?substance  obochebi:smiles           ?smiles}
            OPTIONAL{ ?substance          :iupac            ?iupac }
          }
        }
        ORDER BY DESC(?pct) DESC(?grams)
      `;

      /* --- indications ------------------------------------------------ */
      const sparqlIndications = `
        PREFIX :       <https://agriculture.ld.admin.ch/plant-protection/>
        PREFIX schema: <http://schema.org/>
        SELECT *
        WHERE{
          GRAPH <https://lindas.admin.ch/foag/plant-protection>{
            VALUES ?p { :${id} }
            ?p :indication ?ind .

            ?ind :applicationArea/schema:name ?area  .
                FILTER(lang(?area)="de")

            ?ind :cropGroup ?crop .
                  ?crop schema:name ?cropLabel .
                  FILTER(lang(?cropLabel)="de")

            ?ind :cropStressor ?pest .
                  ?pest schema:name ?pestLabel .
                  FILTER(lang(?pestLabel)="de")

            OPTIONAL{
              ?ind :notice ?obl .
              ?obl schema:name ?oblLabel .
              FILTER(lang(?oblLabel)="de")
            }
          }
        }
      `;

      const [companyJ, hazardJ, cmpJ, indJ] = await Promise.all([
        fetchSparql(sparqlCompany),
        fetchSparql(sparqlHazards),
        fetchSparql(sparqlComponents),
        fetchSparql(sparqlIndications)
      ]);

      /* company obj */
      const cRows = companyJ.results.bindings,
          c0 = cRows[0] || {};
      const comp = {
          name: c0.name?.value,
          street: c0.streetAddress?.value,
          postal: c0.postalCode?.value,
          locality: c0.addressLocality?.value,
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

      /* ── fallback “no structure” SVG ───────────────────────────── */
      const placeholderSvg = `
      <br>
      <br>
      <svg class="mol placeholder" viewBox="0 0 160 120"
          role="img" aria-label="Keine Strukturformel vorhanden">
        <text x="50%" y="50%"
              dominant-baseline="middle" text-anchor="middle"
              font-size="100" font-family="Inter, sans-serif"
              fill="none" stroke="#000000" stroke-width="0.75"
              stroke-linejoin="round">?</text>
      </svg>`;

      const componentsHTML = components.length
        ? `<ul class="components">
            ${components.map(c => {
                // --- build the fancy label ---------------------------------
                const pct  = c.pct   ? `${(+c.pct ).toFixed(2)} %` : null;
                const gram = c.grams ? `${(+c.grams).toFixed(1)} g L<sup>−1</sup>` : null;
                const portion = [pct, gram].filter(Boolean).join(' / ');

                return `
                <li class="tile" data-uri="${c.uri}">
                  <header>
                    <h4 class="substance">${c.name}</h4>

                    <!-- 💥 mind‑blowing portion label -->
                    ${portion ? `<div class="portion">${portion}</div>` : ''}
                  </header>

                  ${c.smiles ? `
                    <svg class="mol"
                        data-smiles="${c.smiles}"
                        data-smiles-theme="oldschool"
                        alt="Molekülzeichnung von ${c.name}" />` : placeholderSvg}

                  <div class="meta">
                    ${c.formula ? `<span><b>Summenformel:</b> ${htmlFormula(c.formula)}</span>` : ''}
                    ${c.role    ? `<span><b>Rolle:</b> ${c.role}</span>` : ''}
                    ${c.chebi   ? `<span><b>ChEBI‑Entität:</b> <a href="${c.chebi}" target="_blank" rel="noopener">${chebiId(c.chebi)}</a></span>` : ''}
                  </div>
                </li>`; }).join('')}
          </ul>`
        : `<p>Keine Angaben.</p>`;

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

      /* indications ---------------------------------------------------- */
      const indRows = indJ.results.bindings;

      /* group by indication IRI ------------------------------------ */
      const byInd = new Map();
      indRows.forEach(r=>{
        const key = r.ind.value;
        if(!byInd.has(key)){
          byInd.set(key,{
            area : r.area.value,
            crops: new Map(),
            pests: new Map(),
            obls : new Set()
          });
        }
        const obj = byInd.get(key);
        obj.crops.set(r.crop.value , {label:r.cropLabel.value , uri:r.crop.value});
        obj.pests.set(r.pest.value , {label:r.pestLabel.value , uri:r.pest.value});
        if(r.obl){ obj.obls.add(r.oblLabel.value); }
      });

      /* deduplicate obligations globally to assign 1,2,3… ---------- */
      const oblIndex = new Map();            // text → number
      let   oblCounter = 1;
      byInd.forEach(ind=>{
        ind.obls = [...ind.obls].map(txt=>{
          if(!oblIndex.has(txt)) oblIndex.set(txt, oblCounter++);
          return txt;
        });
      });

      // HTML table for the indications
      /* build the HTML table -------------------------------------------- */
      let indTableHTML = '';
      if (byInd.size) {
        indTableHTML = `
          <table class="indications">
            <thead>
              <tr>
                <th>Bereich</th><th>Kultur</th><th>Schadorganismus</th><th>Auflagen</th>
              </tr>
            </thead>
            <tbody>
              ${[...byInd.values()].map(ind => `
                <tr>
                  <td>${ind.area}</td>

                  <td>
                    ${[...ind.crops.values()]
                      .map(c => `<a href="${c.uri}" target="_blank" rel="noopener">${c.label}</a>`)
                      .join(',<br> ')}
                  </td>

                  <td>
                    ${[...ind.pests.values()]
                      .map(p => `<a href="${p.uri}" target="_blank" rel="noopener">${p.label}</a>`)
                      .join(',<br> ')}
                  </td>

                  <td>
                    ${ind.obls.length
                        ? `<ul class="obligations">
                            ${ind.obls.map(txt => `<li>${txt}</li>`).join('')}
                          </ul>`
                        : '—'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>`;
        }


      /* 4· build card */
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <header>
        <h1>${productName}</h1>
        <div>${types.map(([iri,l])=>{
                  return `<a class="tag" href="${iri}">${l}</a>`}).join('')}</div>
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
          ${comp.fax?`<dt>Fax</dt><dd><a href="${comp.fax}">${comp.fax.replace(/^tel:/,'')}</a></dd>`:''}
          ${comp.UID?`<dt>UID</dt><dd><span class="identifier">${comp.UID}</span></dd>`:''}
          ${comp.CHID?`<dt>CHID</dt><dd><span class="identifier">${comp.CHID}</span></dd>`:''}
          ${comp.EHRAID?`<dt>EHRAID</dt><dd><span class="identifier">${comp.EHRAID}</span></dd>`:''}
        </dl>

        <h2>Chemisch identische Produkte</h2>
          <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
            Die folgenden Produkte werden zwar unter anderem Namen verkauft, weisen aber dieselbe chemische Formulierung auf.
          </p>
        <div id="sameProducts"></div>

        <h2>Formulierung</h2>
        <p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
          ${productName} ${formulation?`ist als ${formulation} formuliert und`:''} besteht aus den folgenden Komponenten:
        </p>
        ${componentsHTML}

        <h2>Zulassungen</h2>
        ${indTableHTML || `<p>Keine Angaben verfügbar.</p>`}

        <h2>Gefahrenhinweise</h2>
        ${hazardsTableHTML || `<p>Keine Gefahrenhinweise verfügbar.</p>`}
      `;
      $card.appendChild(wrap);
      // Render all data‑smiles elements that are now in the DOM
      if (window.SmiDrawer) {
        SmiDrawer.apply();
      }

      /* 5· same‑product badges */
      const tpl = document.getElementById('tag-template');
      const $same = $card.querySelector('#sameProducts');
      sameProducts.forEach(({ name, code }, iri) => {
        const a = tpl.content.firstElementChild.cloneNode(true);
        a.href = `${location.pathname}?id=${encodeURIComponent(iri.split('/').pop())}`;
        a.textContent = code && code !== 'CH' ? `${name} (${code})` : name;
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