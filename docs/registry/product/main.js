/* ---------------------------------------------------------------
 *  script.js – Plant‑Protection Product Profile
 *                (v3  – lightweight tiles, local CheBI link only)
 * --------------------------------------------------------------*/
(async () => {

  /* ╭──────────────────── Helpers ────────────────────╮ */
  const $loading = document.getElementById('loading');
  const $card    = document.getElementById('card');

  /** Run a SPARQL query against LIN:das */
  async function fetchSparql(q) {
    const res = await fetch('https://lindas.admin.ch/query', {
      method : 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept'      : 'application/sparql-results+json'
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
SELECT ?productName ?federalNo ?foreignNo ?countryName ?company
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
    OPTIONAL { ?p :hasFormulationCode ?fc .
               ?fc schema:name ?formLabel FILTER(lang(?formLabel)="de") }
    OPTIONAL { ?producttype schema:name ?producttypeLabel FILTER(lang(?producttypeLabel)="de") }
  }
  OPTIONAL { ?p :hasCountryOfOrigin ?c .
             ?c schema:name ?countryName FILTER(lang(?countryName)="de") }
}`;
    const prodJ = await fetchSparql(sparqlProduct);
    const prodRows = prodJ.results.bindings;
    if (!prodRows.length) throw new Error(`Kein Datensatz für id=${id} gefunden`);
    const core = prodRows.find(r => r.productName && r.federalNo) || prodRows[0];

    const productName = core.productName.value;
    const federalNo   = core.federalNo.value;
    const foreignNo   = core.foreignNo?.value || null;
    const countryName = core.countryName?.value || '—';
    const companyIRI  = core.company.value;
    const formulation = core.formLabel?.value || '—';

    const types = [...new Map(
      prodRows.filter(r=>r.producttype&&r.producttypeLabel)
              .map(r=>[r.producttype.value,r.producttypeLabel.value])
    )];

    const sameProducts = [...new Map(
      prodRows.filter(r=>r.sameProduct&&r.sameProductName)
              .map(r=>[r.sameProduct.value,r.sameProductName.value])
    )].sort((a,b)=>a[1].localeCompare(b[1],'de'));

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
PREFIX :<https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema:<http://schema.org/>
SELECT ?statementName ?codeIRI WHERE{
  GRAPH <https://lindas.admin.ch/foag/plant-protection>{
    VALUES ?p{<https://agriculture.ld.admin.ch/plant-protection/${id}>}
    ?p :notice ?stmt .
    ?stmt schema:name ?statementName .
    FILTER(lang(?statementName)="de")
    OPTIONAL{?stmt :hasHazardStatementCode ?codeIRI}
  }
}`;

    /* components without federated SERVICE */
    const sparqlComponents = `
PREFIX :       <https://agriculture.ld.admin.ch/plant-protection/>
PREFIX schema: <http://schema.org/>
SELECT ?grams ?pct ?subIRI ?subName ?roleName ?chebiIRI WHERE{
  GRAPH <https://lindas.admin.ch/foag/plant-protection>{
    VALUES ?p{<https://agriculture.ld.admin.ch/plant-protection/${id}>}
    ?p :hasComponentPortion ?portion .
    ?portion :substance ?subIRI ; :role ?roleIRI .
    OPTIONAL{?portion :hasGrammPerLitre ?grams}
    OPTIONAL{?portion :hasPercentage ?pct}
    ?subIRI schema:name ?subName FILTER(lang(?subName)="de"||lang(?subName)="")
    ?roleIRI schema:name ?roleName FILTER(lang(?roleName)="de"||lang(?roleName)="")
    OPTIONAL{?subIRI :hasChebiIdentity ?chebiIRI}
  }
}
ORDER BY DESC(?pct) DESC(?grams)`;

    const [companyJ,hazardJ,cmpJ] = await Promise.all([
      fetchSparql(sparqlCompany),
      fetchSparql(sparqlHazards),
      fetchSparql(sparqlComponents)
    ]);

    /* company obj */
    const cRows=companyJ.results.bindings, c0=cRows[0]||{};
    const comp={name:c0.name?.value,street:c0.streetAddress?.value,postal:c0.postalCode?.value,
      locality:c0.addressLocality?.value,tel:c0.telephone?.value,mail:c0.email?.value,
      fax:c0.fax?.value,UID:null,CHID:null,EHRAID:null};
    cRows.forEach(r=>{
      if(r.idName?.value==='CompanyUID')comp.UID=r.idValue?.value;
      if(r.idName?.value==='CompanyCHID')comp.CHID=r.idValue?.value;
      if(r.idName?.value==='CompanyEHRAID')comp.EHRAID=r.idValue?.value;
    });

    /* hazards */
    const hazards=[...new Map(
      hazardJ.results.bindings.map(r=>[r.statementName.value,r.codeIRI?.value||null])
    )].map(([name,iri])=>({name,iri}));

    /* components */
    const components=cmpJ.results.bindings.map(r=>({
      name :r.subName.value,
      role :r.roleName.value,
      grams:r.grams?.value||null,
      pct  :r.pct?.value||null,
      chebi:r.chebiIRI?.value||null
    }));

    const componentsHTML=components.length
      ? `<ul class="components">
          ${components.map(c=>`
            <li class="tile">
              <header>
                <h4 class="substance">${c.name}</h4>
              </header>
              <div class="meta">
                ${c.role?`<span>Rolle: ${c.role}</span>`:''}
                ${c.grams?`<span>Anteil [g/ml]: ${Number(c.grams).toLocaleString('de-CH')} g/L</span>`:''}
                ${c.pct  ?`<span>Anteil [%]: ${Number(c.pct ).toLocaleString('de-CH')} %</span>`:''}
                ${c.chebi?`<span>ChEBI-Entität: <a href="${c.chebi}" target="_blank" rel="noopener">${chebiId(c.chebi)}</a></span>`:''}
              </div>
            </li>`).join('')}
        </ul>`
      : `<p>Keine Angaben.</p>`;

    /* 4· build card */
    const wrap=document.createElement('div');
    wrap.innerHTML=`
<header>
  <h1>${productName}</h1>
  <p class="subtitle">Eingetragenes Pflanzenschutzmittel</p>
  <div>${types.map(([iri,l])=>{
            const slug=iri.split('/').pop();
            return `<a class="tag" href="../overview/index.html?type=${encodeURIComponent(slug)}">${l}</a>`}).join('')}</div>
</header>

<h2>Schnelle Fakten</h2>
<dl>
  <dt>Eidgenössische Zulassungsnummer</dt><dd>${federalNo}</dd>
  ${foreignNo?`<dt>Ausländische Zulassungsnummer</dt><dd>${foreignNo}</dd>`:''}
  <dt>Herkunftsland</dt><dd>${countryName}</dd>
  <dt>Formulierungscode</dt><dd>${formulation}</dd>
</dl>

<h2>Bewilligungsinhaber</h2>
<dl>
  ${comp.name?`<dt>Firma</dt><dd><a href="${companyIRI}" target="_blank" rel="noopener">${comp.name}</a></dd>`:''}
  ${comp.UID?`<dt>UID</dt><dd>${comp.UID}</dd>`:''}
  ${comp.CHID?`<dt>CHID</dt><dd>${comp.CHID}</dd>`:''}
  ${comp.EHRAID?`<dt>EHRAID</dt><dd>${comp.EHRAID}</dd>`:''}
  ${(comp.street||comp.postal||comp.locality)?`<dt>Adresse</dt><dd>${[comp.street,comp.postal,comp.locality].filter(Boolean).join(', ')}</dd>`:''}
  ${comp.tel?`<dt>Telefon</dt><dd><a href="${comp.tel}">${comp.tel.replace(/^tel:/,'')}</a></dd>`:''}
  ${comp.mail?`<dt>Email</dt><dd><a href="mailto:${comp.mail}">${comp.mail}</a></dd>`:''}
  ${comp.fax?`<dt>Fax</dt><dd><a href="${comp.fax}">${comp.fax.replace(/^tel:/,'')}</a></dd>`:''}
</dl>

<h2>Formulierung</h2>
${componentsHTML}

<h2>Gefahrenhinweise</h2>
${hazards.length
  ? `<ul>${hazards.map(h=>h.iri?`<li><a href="${h.iri}" target="_blank">${h.iri.split('/').pop()}</a>: ${h.name}</li>`:`<li>${h.name}</li>`).join('')}</ul>`
  : `<p>Keine Gefahrenhinweise verfügbar.</p>`}

<h2>Chemisch identische Produkte unter anderem Namen</h2>
<p style="margin:.6rem 0 1rem;color:#6b7280;font-size:.85rem">
  Die folgenden Produkte werden zwar unter anderem Namen verkauft, weisen aber dieselbe chemische Formulierung auf.
</p>
<div id="sameProducts"></div>
`;
    $card.appendChild(wrap);

    /* 5· same‑product badges */
    const tpl=document.getElementById('badge-template');
    const $same=$card.querySelector('#sameProducts');
    sameProducts.forEach(([iri,name])=>{
      const a=tpl.content.firstElementChild.cloneNode(true);
      a.href=`${location.pathname}?id=${encodeURIComponent(iri.split('/').pop())}`;
      a.textContent=name;
      $same.appendChild(a);
    });

    /* 6· done */
    $loading.classList.add('hidden');
    $card.classList.remove('hidden');

  } catch(err){
    console.error(err);
    $loading.innerHTML=`<div class="error">${err.message}</div>`;
  }

})();  /* IIFE */
