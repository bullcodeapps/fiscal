import rows from "./municipalities.json";

// IBGE municipality list (servicodados.ibge.gov.br, 5571 rows, fetched
// 2026-10-26) as [code, UF, name].
const MUNICIPALITIES = rows as [string, string, string][];

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let index: Map<string, string> | null = null;

function lookupIndex(): Map<string, string> {
  if (!index) {
    index = new Map(
      MUNICIPALITIES.map(([code, uf, name]) => [`${uf}:${normalize(name)}`, code]),
    );
  }
  return index;
}

/**
 * 7-digit IBGE code for a city typed by a person ("Itajai", "SÃO PAULO").
 * Accents, case, apostrophes and hyphens are ignored. Null when no
 * municipality of that state has the name.
 */
export function findMunicipalityCode(city: string, uf: string): string | null {
  return lookupIndex().get(`${uf.trim().toUpperCase()}:${normalize(city)}`) ?? null;
}

let byCode: Map<string, { name: string; uf: string }> | null = null;

/** Municipality name and UF for a 7-digit IBGE code. */
export function findMunicipality(code: string): { name: string; uf: string } | null {
  if (!byCode) {
    byCode = new Map(MUNICIPALITIES.map(([c, uf, name]) => [c, { name, uf }]));
  }
  return byCode.get(code) ?? null;
}
