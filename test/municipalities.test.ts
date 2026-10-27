import { describe, expect, it } from "vitest";
import { findMunicipalityCode } from "../src";

describe("findMunicipalityCode", () => {
  it.each([
    { city: "Itajaí", uf: "SC", code: "4208203" },
    { city: "itajai", uf: "sc", code: "4208203" },
    { city: "  SÃO   PAULO ", uf: "SP", code: "3550308" },
    { city: "Alta Floresta D'Oeste", uf: "RO", code: "1100015" },
    { city: "Alta Floresta D Oeste", uf: "RO", code: "1100015" },
  ])("resolves $city/$uf", ({ city, uf, code }) => {
    expect(findMunicipalityCode(city, uf)).toBe(code);
  });

  it.each([
    { city: "Itajaí", uf: "SP" },
    { city: "Cidade Inexistente", uf: "SC" },
  ])("returns null for $city/$uf", ({ city, uf }) => {
    expect(findMunicipalityCode(city, uf)).toBeNull();
  });
});
