// Tipos que reflejan la forma real de modelo-dominio.json (v4).
export interface Atributo {
  n: string
  t: string
  note?: string
  legacy?: string
  nuevo?: boolean // true = columna nueva del deber-ser (no existe en la tabla legacy). Marca explícita vs "olvidé mapear".
  aws?: string // sigla del recurso AWS que referencia esta columna (S3, SM, COG…)
  event?: string // si su cambio publica un domain event (texto = tooltip). Comportamiento, no almacenamiento.
}

export interface Relacion {
  a: string // entidad destino (key)
  card: string // p.ej. "N:1", "1:1", "1:N"
  rol?: string // FK / rol
  tipo: 'interna' | 'referencia'
}

export interface Entidad {
  key: string
  name: string
  contexto: string
  tipo: 'aggregateRoot' | 'entity' | 'external'
  identidad?: string
  descripcion?: string
  atributos: Atributo[]
  legacy?: {
    tabla?: string
    ref?: string
    absorbe?: string[]
    unificacion?: string // por qué se unificaron las tablas absorbidas (lenguaje de negocio)
    reducidas?: { n: string; legacy: string; via: string }[]
  }
  relaciones?: Relacion[]
}

export interface Contexto {
  key: string
  name: string
  tipo: string
  desc: string
}

export interface Agregado {
  root: string
  contexto: string
  miembros: string[]
  nota?: string
}

export interface Modelo {
  version: string
  contextos: Contexto[]
  entidades: Entidad[]
  agregados: Agregado[]
  valueObjects?: { key: string; agg?: string }[]
}

// data que cuelga de cada nodo de Vue Flow
export interface TableNodeData {
  entidad: Entidad
  contextoName: string
  fkColumns: Set<string>
  dimmed: boolean
  selected: boolean
  color?: string // override de color (p.ej. por microservicio); si falta, usa el del contexto
}
