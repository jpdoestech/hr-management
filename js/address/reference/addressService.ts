import citiesData from "./cities.json";
import provincesData from "./provinces.json";
import regionsData from "./regions.json";

export type Region = { code: string; name: string };
export type Province = { code: string; name: string; regionCode: string };
export type City = { code: string; name: string; regionCode: string; provinceCode: string };
export type Barangay = { code: string; name: string; cityCode: string };

export const regions = [...(regionsData as Region[])].sort((a, b) => a.name.localeCompare(b.name));
export const provinces = [...(provincesData as Province[])].sort((a, b) => a.name.localeCompare(b.name));
export const cities = [...(citiesData as City[])].sort((a, b) => a.name.localeCompare(b.name));

let barangayIndex: Barangay[] | null = null;

export function provincesForRegion(regionCode: string) {
  return provinces.filter((province) => province.regionCode === regionCode);
}

export function citiesForProvince(provinceCode: string) {
  return cities.filter((city) => city.provinceCode === provinceCode);
}

export async function barangaysForCity(cityCode: string) {
  if (!barangayIndex) {
    const response = await fetch(new URL("./barangay-search-index.json", import.meta.url));
    if (!response.ok) throw new Error("Unable to load barangay reference data.");
    barangayIndex = (await response.json()) as Barangay[];
  }

  return barangayIndex.filter((barangay) => barangay.cityCode === cityCode);
}
