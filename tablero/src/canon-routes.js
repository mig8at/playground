// El paso pertenece a una variante; no es el ID de una estación global.
export const ROUTE_REF = /^([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:#([A-Za-z0-9][A-Za-z0-9._-]*))?$/;

export function routeReference(value) {
  const match = String(value).match(ROUTE_REF);
  return match ? { topic: `${match[1]}/context`, variant: match[2], step: match[3] || '' } : null;
}
