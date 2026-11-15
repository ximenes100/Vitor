// Painel do corretor e resumo diário enviado no próprio WhatsApp dele.

import type { Analise } from "./analise/esquema.js";
import { NOME_CATEGORIA_PERDA, type CategoriaPerda } from "./analise/esquema.js";
import { config } from "./config.js";
import { query, queryOne } from "./db.js";
import * as evolution from "./evolution.js";

export interface ItemFollowup {
  conversa_id: number;
  nome_contato: string | null;
  remote_jid: string;
  etapa: string | null;
  horas: number;
  cliente_aguardando: boolean;
  acao: string | null;
  mensagem_sugerida: string | null;
  urgencia: string | null;
}

/** Clientes que precisam de atenção: aguardando resposta ou parados há mais tempo que o limite de follow-up. */
export async function followups(corretorId: number, limite = 50): Promise<ItemFollowup[]> {
  return query<ItemFollowup>(
    `SELECT c.id AS conversa_id, c.nome_contato, c.remote_jid, c.etapa,
            floor(extract(epoch FROM now() - c.ultima_mensagem_em) / 3600)::int AS horas,
            c.aguardando_resposta AS cliente_aguardando,
            a.resultado->'proximo_passo'->>'acao' AS acao,
            a.resultado->'proximo_passo'->>'mensagem_sugerida' AS mensagem_sugerida,
            a.resultado->'proximo_passo'->>'urgencia' AS urgencia
     FROM conversas c
     LEFT JOIN LATERAL (SELECT resultado FROM analises WHERE conversa_id = c.id ORDER BY criada_em DESC LIMIT 1) a ON TRUE
     WHERE c.corretor_id = $1 AND c.tipo = 'cliente'
       AND COALESCE(c.etapa, '') NOT IN ('fechou', 'perdido')
       AND c.ultima_mensagem_em > now() - interval '60 days'
       AND (
         (c.aguardando_resposta AND c.ultima_mensagem_em < now() - interval '1 hour')
         OR c.ultima_mensagem_em < now() - make_interval(hours => $2)
       )
     ORDER BY c.aguardando_resposta DESC,
              CASE a.resultado->'proximo_passo'->>'urgencia' WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
              c.ultima_mensagem_em DESC
     LIMIT $3`,
    [corretorId, config.followupHoras, limite],
  );
}

export interface Panorama {
  clientes: number;
  pessoais: number;
  porEtapa: Record<string, number>;
  aguardandoResposta: number;
  parados7dias: number;
  notaMedia: number | null;
  principalPerda: CategoriaPerda | null;
}

export async function panoramaCorretor(corretorId: number): Promise<Panorama> {
  const tipos = await query<{ tipo: string; n: number }>("SELECT tipo, count(*)::int AS n FROM conversas WHERE corretor_id = $1 GROUP BY tipo", [corretorId]);
  const etapas = await query<{ etapa: string; n: number }>(
    "SELECT etapa, count(*)::int AS n FROM conversas WHERE corretor_id = $1 AND tipo = 'cliente' AND etapa IS NOT NULL GROUP BY etapa",
    [corretorId],
  );
  const situacao = await queryOne<{ aguardando: number; parados: number }>(
    `SELECT count(*) FILTER (WHERE aguardando_resposta)::int AS aguardando,
            count(*) FILTER (WHERE ultima_mensagem_em < now() - interval '7 days')::int AS parados
     FROM conversas WHERE corretor_id = $1 AND tipo = 'cliente' AND COALESCE(etapa, '') NOT IN ('fechou', 'perdido')`,
    [corretorId],
  );
  const notas = await queryOne<{ media: string | null }>(
    `SELECT avg(nota_geral) AS media FROM (
       SELECT DISTINCT ON (a.conversa_id) a.nota_geral FROM analises a JOIN conversas c ON c.id = a.conversa_id
       WHERE c.corretor_id = $1 ORDER BY a.conversa_id, a.criada_em DESC) t`,
    [corretorId],
  );
  const perda = await queryOne<{ categoria_perda: CategoriaPerda }>(
    `SELECT categoria_perda FROM (
       SELECT DISTINCT ON (a.conversa_id) a.categoria_perda FROM analises a JOIN conversas c ON c.id = a.conversa_id
       WHERE c.corretor_id = $1 ORDER BY a.conversa_id, a.criada_em DESC) t
     WHERE categoria_perda NOT IN ('nenhuma', 'cliente_sem_perfil')
     GROUP BY categoria_perda ORDER BY count(*) DESC LIMIT 1`,
    [corretorId],
  );
  const contagem = Object.fromEntries(tipos.map((t) => [t.tipo, t.n]));
  return {
    clientes: contagem.cliente ?? 0,
    pessoais: (contagem.pessoal ?? 0) + (contagem.outro ?? 0),
    porEtapa: Object.fromEntries(etapas.map((e) => [e.etapa, e.n])),
    aguardandoResposta: situacao?.aguardando ?? 0,
    parados7dias: situacao?.parados ?? 0,
    notaMedia: notas?.media ? Math.round(Number(notas.media) * 10) / 10 : null,
    principalPerda: perda?.categoria_perda ?? null,
  };
}

/** Dica mais recente ligada ao principal ponto de perda do corretor. */
export async function dicaDoDia(corretorId: number): Promise<Analise["dicas"][number] | null> {
  const linha = await queryOne<{ dica: Analise["dicas"][number] }>(
    `SELECT a.resultado->'dicas'->0 AS dica FROM analises a JOIN conversas c ON c.id = a.conversa_id
     WHERE c.corretor_id = $1 AND jsonb_array_length(a.resultado->'dicas') > 0
     ORDER BY a.criada_em DESC LIMIT 1`,
    [corretorId],
  );
  return linha?.dica ?? null;
}

export async function textoResumoDiario(corretor: { id: number; nome: string; token: string }): Promise<string> {
  const p = await panoramaCorretor(corretor.id);
  const lista = await followups(corretor.id, 5);
  const dica = await dicaDoDia(corretor.id);
  const primeiroNome = corretor.nome.split(" ")[0];

  const linhas = [`☀️ *Bom dia, ${primeiroNome}!* Seu resumo de hoje:`, ""];
  linhas.push(`👥 ${p.clientes} clientes na carteira`);
  if (p.aguardandoResposta) linhas.push(`⏳ *${p.aguardandoResposta} aguardando sua resposta*`);
  if (p.parados7dias) linhas.push(`💤 ${p.parados7dias} parados há mais de 7 dias`);
  if (lista.length) {
    linhas.push("", "*Priorize hoje:*");
    for (const f of lista) {
      const nome = f.nome_contato ?? `+${f.remote_jid.split("@")[0]}`;
      linhas.push(`• ${nome}: ${f.cliente_aguardando ? "está esperando resposta" : `sem conversa há ${Math.round(f.horas / 24)} dia(s)`}${f.acao ? ` → ${f.acao}` : ""}`);
    }
  }
  if (dica) linhas.push("", `💡 *Dica:* ${dica.titulo}`, `_Exemplo:_ "${dica.exemplo_mensagem}"`);
  if (p.principalPerda) linhas.push("", `📉 Onde você mais perde clientes: ${NOME_CATEGORIA_PERDA[p.principalPerda]}`);
  linhas.push("", `Veja tudo e as mensagens sugeridas: ${config.urlPublica}/c/${corretor.token}`);
  return linhas.join("\n");
}

function horaEDataLocal(d = new Date()): { hora: number; data: string } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: config.fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)!.value;
  return { hora: Number(v("hour")), data: `${v("year")}-${v("month")}-${v("day")}` };
}

/** Envia o resumo diário para quem ainda não recebeu hoje (o corretor recebe na conversa "Você" do próprio WhatsApp). */
export async function enviarResumosDiarios(): Promise<number> {
  const { hora, data } = horaEDataLocal();
  if (hora < config.resumoDiarioHora || !evolution.evolutionConfigurada()) return 0;
  const corretores = await query<{ id: number; nome: string; token: string; instancia: string; telefone: string }>(
    `SELECT id, nome, token, instancia, telefone FROM corretores
     WHERE status_conexao = 'conectado' AND receber_resumo AND telefone IS NOT NULL
       AND (ultimo_resumo_em IS NULL OR ultimo_resumo_em < $1::date)`,
    [data],
  );
  let enviados = 0;
  for (const c of corretores) {
    try {
      await evolution.enviarTexto(c.instancia, c.telefone, await textoResumoDiario(c));
      enviados++;
    } catch (e) {
      console.error(`[resumo] corretor ${c.id}:`, (e as Error).message);
    }
    // Marca mesmo com erro, para não ficar tentando o dia inteiro.
    await query("UPDATE corretores SET ultimo_resumo_em = $2::date WHERE id = $1", [c.id, data]);
  }
  return enviados;
}
