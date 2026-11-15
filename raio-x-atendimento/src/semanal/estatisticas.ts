// Indicadores calculados a partir das análises semanais (sem IA).

import { CRITERIOS, type CategoriaPerda, type Criterio, type UsoIa } from "../analise/esquema.js";
import { query, queryOne } from "../db.js";

export interface Filtro {
  corretorId?: number;
  semana?: string;
  periodo?: "antes" | "depois";
  semanasDesde?: string;
}

export interface Indicadores {
  conversas: number;
  nota: number | null;
  respostaMedianaMin: number | null;
  criterios: Partial<Record<Criterio, number>>;
  usoIa: Record<UsoIa, number>;
  perdas: Partial<Record<CategoriaPerda, number>>;
  ligacoesRecomendadas: number;
}

function onde(f: Filtro): { sql: string; params: unknown[] } {
  const partes: string[] = ["c.tipo = 'cliente'"];
  const params: unknown[] = [];
  if (f.corretorId !== undefined) partes.push(`c.corretor_id = $${params.push(f.corretorId)}`);
  if (f.semana) partes.push(`a.semana = $${params.push(f.semana)}::date`);
  if (f.periodo) partes.push(`a.periodo = $${params.push(f.periodo)}`);
  if (f.semanasDesde) partes.push(`a.semana >= $${params.push(f.semanasDesde)}::date`);
  return { sql: partes.join(" AND "), params };
}

const arred = (v: string | number | null | undefined, casas = 1) => (v === null || v === undefined ? null : Math.round(Number(v) * 10 ** casas) / 10 ** casas);

export async function indicadores(f: Filtro): Promise<Indicadores> {
  const { sql, params } = onde(f);
  const base = `FROM analises a JOIN conversas c ON c.id = a.conversa_id WHERE ${sql}`;
  const geral = await queryOne<{ n: number; nota: string | null; resposta: string | null; ligacoes: number }>(
    `SELECT count(*)::int AS n, avg(a.nota_geral) AS nota,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (a.metricas->>'respostaMedianaMin')::numeric) AS resposta,
            count(*) FILTER (WHERE (a.resultado->'ligacao'->>'recomendada')::boolean)::int AS ligacoes
     ${base}`,
    params,
  );
  const criterios = await query<{ criterio: Criterio; media: string }>(
    `SELECT n->>'criterio' AS criterio, avg((n->>'nota')::numeric) AS media
     ${base.replace("WHERE", ", jsonb_array_elements(a.resultado->'notas') n WHERE")} AND n->>'nota' IS NOT NULL GROUP BY 1`,
    params,
  );
  const uso = await query<{ uso_ia: UsoIa; n: number }>(`SELECT a.uso_ia, count(*)::int AS n ${base} GROUP BY 1`, params);
  const perdas = await query<{ categoria_perda: CategoriaPerda; n: number }>(
    `SELECT a.categoria_perda, count(*)::int AS n ${base} AND a.categoria_perda <> 'nenhuma' GROUP BY 1 ORDER BY 2 DESC`,
    params,
  );
  return {
    conversas: geral?.n ?? 0,
    nota: arred(geral?.nota),
    respostaMedianaMin: arred(geral?.resposta, 0),
    criterios: Object.fromEntries(criterios.filter((c) => CRITERIOS.includes(c.criterio)).map((c) => [c.criterio, arred(c.media)!])),
    usoIa: {
      nenhum: uso.find((u) => u.uso_ia === "nenhum")?.n ?? 0,
      uso_personalizado: uso.find((u) => u.uso_ia === "uso_personalizado")?.n ?? 0,
      uso_generico: uso.find((u) => u.uso_ia === "uso_generico")?.n ?? 0,
    },
    perdas: Object.fromEntries(perdas.map((p) => [p.categoria_perda, p.n])),
    ligacoesRecomendadas: geral?.ligacoes ?? 0,
  };
}

export interface PontoSemanal {
  semana: string;
  periodo: "antes" | "depois";
  conversas: number;
  nota: number | null;
  usoIa: number; // % das conversas com indício de IA
}

/** Nota média por semana (do time ou de um corretor). */
export async function serieSemanal(corretorId?: number, desde?: string): Promise<PontoSemanal[]> {
  const { sql, params } = onde({ corretorId, semanasDesde: desde });
  const linhas = await query<{ semana: string; periodo: "antes" | "depois"; n: number; nota: string; ia: string }>(
    `SELECT to_char(a.semana, 'YYYY-MM-DD') AS semana, min(a.periodo) AS periodo, count(*)::int AS n, avg(a.nota_geral) AS nota,
            100.0 * count(*) FILTER (WHERE a.uso_ia <> 'nenhum') / count(*) AS ia
     FROM analises a JOIN conversas c ON c.id = a.conversa_id WHERE ${sql}
     GROUP BY a.semana ORDER BY a.semana`,
    params,
  );
  return linhas.map((l) => ({ semana: l.semana, periodo: l.periodo, conversas: l.n, nota: arred(l.nota), usoIa: Math.round(Number(l.ia)) }));
}

export type Tendencia = "melhorando" | "estavel" | "piorando" | "sem_dados";

/** Compara a nota depois do marco com a de antes (diferença mínima de 0,5 ponto para contar como mudança). */
export function tendencia(antes: number | null, depois: number | null): Tendencia {
  if (antes === null || depois === null) return "sem_dados";
  const d = depois - antes;
  return d >= 0.5 ? "melhorando" : d <= -0.5 ? "piorando" : "estavel";
}

export interface LinhaEvolucao {
  corretor_id: number;
  nome: string;
  antes: number | null;
  depois: number | null;
  conversasAntes: number;
  conversasDepois: number;
  tendencia: Tendencia;
  usoIaDepois: number; // % das conversas depois do marco com indício de IA
  usoGenericoDepois: number; // % com indício de uso genérico
}

/** Antes x depois do marco, por corretor. */
export async function evolucaoPorCorretor(): Promise<LinhaEvolucao[]> {
  const linhas = await query<{
    corretor_id: number;
    nome: string;
    antes: string | null;
    depois: string | null;
    n_antes: number;
    n_depois: number;
    ia: string | null;
    generico: string | null;
  }>(
    `SELECT k.id AS corretor_id, k.nome,
            avg(a.nota_geral) FILTER (WHERE a.periodo = 'antes') AS antes,
            avg(a.nota_geral) FILTER (WHERE a.periodo = 'depois') AS depois,
            count(a.id) FILTER (WHERE a.periodo = 'antes')::int AS n_antes,
            count(a.id) FILTER (WHERE a.periodo = 'depois')::int AS n_depois,
            100.0 * count(a.id) FILTER (WHERE a.periodo = 'depois' AND a.uso_ia <> 'nenhum') / NULLIF(count(a.id) FILTER (WHERE a.periodo = 'depois'), 0) AS ia,
            100.0 * count(a.id) FILTER (WHERE a.periodo = 'depois' AND a.uso_ia = 'uso_generico') / NULLIF(count(a.id) FILTER (WHERE a.periodo = 'depois'), 0) AS generico
     FROM corretores k
     LEFT JOIN conversas c ON c.corretor_id = k.id AND c.tipo = 'cliente'
     LEFT JOIN analises a ON a.conversa_id = c.id
     GROUP BY k.id, k.nome ORDER BY k.nome`,
  );
  return linhas.map((l) => {
    const antes = arred(l.antes);
    const depois = arred(l.depois);
    return {
      corretor_id: l.corretor_id,
      nome: l.nome,
      antes,
      depois,
      conversasAntes: l.n_antes,
      conversasDepois: l.n_depois,
      tendencia: tendencia(antes, depois),
      usoIaDepois: Math.round(Number(l.ia ?? 0)),
      usoGenericoDepois: Math.round(Number(l.generico ?? 0)),
    };
  });
}
