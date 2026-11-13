import { XMLValidator } from "fast-xml-parser";

export type XmlChild = string | false | null | undefined;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Leaf element; omitted entirely when the value is undefined/null/"". */
export function leaf(
  name: string,
  value: string | number | undefined | null,
): string {
  if (value === undefined || value === null || value === "") return "";
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** Group element; omitted when every child rendered empty. */
export function group(name: string, ...children: XmlChild[]): string {
  const body = children.filter(Boolean).join("");
  return body ? `<${name}>${body}</${name}>` : "";
}

export function decimal(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toFixed(2);
}

/** Brasília time (UTC-03:00, no DST since 2019); Sefin accepts any offset. */
export function brazilDateTime(date: Date): string {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** fast-xml-parser parses truncated XML without complaint, so callers check first. */
export function assertWellFormed(xml: string): void {
  const result = XMLValidator.validate(xml);
  if (result !== true) throw new Error(`Malformed XML: ${result.err.msg}`);
}
