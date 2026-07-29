// Dos nodos: la entrada y la tabla. Nada más.
//
// El nodo de Cálculo se fue a propósito — generaba ruido y la tabla ya muestra el resultado
// fila por fila. Las fórmulas siguen existiendo (`periodRate`, `installment`); simplemente no
// se dibujan. Para verlas: el botón `documento`.
const COL_W = 486   // deja lugar a la etiqueta de la arista ("installment 528.711")

export function layoutSheet(def, out, opts = {}) {
  const { inputValues = {} } = opts

  const nodes = [{
    id: '@entrada', type: 'inputsNode', position: { x: 0, y: 0 },
    data: { inputs: def.inputs || [], values: inputValues },
  }]

  const edges = []
  const S = out.series
  if (S) {
    nodes.push({
      id: '@series', type: 'seriesNode', position: { x: COL_W, y: 0 },
      data: {
        title: 'Plan de pagos',
        cols: S.cols || [], rows: S.rows || [], error: S.error,
      },
    })
    const r = out.res[def.output]
    edges.push({
      id: 'entrada->series', source: '@entrada', target: '@series',
      label: r?.status === 'ok'
        ? def.output + ' ' + Math.round(r.value).toLocaleString('es-CO')
        : def.output,
      style: { strokeWidth: 1.6 },
    })
  }
  return { nodes, edges }
}
