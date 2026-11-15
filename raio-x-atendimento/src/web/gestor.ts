// Painel do gestor: visão do time, onde se perde cliente e detalhe por corretor.

import { CRITERIOS, NOME_CATEGORIA_PERDA, NOME_CRITERIO, type CategoriaPerda, type Criterio } from "../analise/esquema.js";
import { config } from "../config.js";
import { query, queryOne } from "../db.js";
import { ETAPAS, NOME_DA_ETAPA } from "../funil.js";
import { formatarMinutos } from "../metricas.js";
import { followups, panoramaCorretor } from "../resumo.js";
import { nomeContato, seloEtapa } from "./conversa.js";
import { barras, html, nota, raw, tempoRelativo, type Raw } from "./html.js";

export const navGestor = raw(`<a href="/gestor">Visão do time</a><a href="/gestor/corretores">Corretores</a>`);

// Última análise de cada conversa de cliente (as anteriores ficam como histórico).
const ULTIMAS_ANALISES = `
  SELECT DISTINCT ON (a.conversa_id) a.*, c.corretor_id
  FROM analises a JOIN conversas c ON c.id = a.conversa_id
  WHERE c.tipo = 'cliente'
  ORDER BY a.conversa_id, a.criada_em DESC`;

const SELO_CONEXAO: Record<string, Raw> = {
  conectado: raw(`<span class="selo bom">conectado</span>`),
  aguardando_qr: raw(`<span class="selo alerta">aguardando QR</span>`),
  desconectado: raw(`<span class="selo ruim">desconectado</span>`),
};

interface LinhaCorretor {
  id: number;
  nome: string;
  equipe: string | null;
  token: string;
  status_conexao: string;
  ultima_sincronizacao: Date | null;
  clientes: number;
  aguardando: number;
  nota_media: string | null;
  resposta_mediana: string | null;
  principal_perda: CategoriaPerda | null;
}

async function linhasCorretores(): Promise<LinhaCorretor[]> {
  return query<LinhaCorretor>(
    `WITH ult AS (${ULTIMAS_ANALISES}),
     perdas AS (
       SELECT DISTINCT ON (corretor_id) corretor_id, categoria_perda FROM (
         SELECT corretor_id, categoria_perda, count(*) AS n FROM ult
         WHERE categoria_perda NOT IN ('nenhuma', 'cliente_sem_perfil') GROUP BY 1, 2) t
       ORDER BY corretor_id, n DESC)
     SELECT k.id, k.nome, k.equipe, k.token, k.status_conexao, k.ultima_sincronizacao,
            (SELECT count(*)::int FROM conversas c WHERE c.corretor_id = k.id AND c.tipo = 'cliente') AS clientes,
            (SELECT count(*)::int FROM conversas c WHERE c.corretor_id = k.id AND c.tipo = 'cliente'
               AND c.aguardando_resposta AND COALESCE(c.etapa, '') NOT IN ('fechou', 'perdido')) AS aguardando,
            (SELECT avg(nota_geral) FROM ult WHERE ult.corretor_id = k.id) AS nota_media,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (metricas->>'respostaMedianaMin')::numeric)
               FROM ult WHERE ult.corretor_id = k.id AND metricas->>'respostaMedianaMin' IS NOT NULL) AS resposta_mediana,
            p.categoria_perda AS principal_perda
     FROM corretores k LEFT JOIN perdas p ON p.corretor_id = k.id
     ORDER BY k.nome`,
  );
}

function tabelaCorretores(linhas: LinhaCorretor[]): Raw {
  if (linhas.length === 0) return raw(`<p class="suave">Nenhum corretor cadastrado ainda.</p>`);
  return html`<div class="tabela"><table>
    <tr><th>Corretor</th><th>WhatsApp</th><th>Clientes</th><th>Aguardando resposta</th><th>Tempo de resposta</th><th>Nota média</th><th>Onde mais perde</th></tr>
    ${linhas.map(
      (l) => html`<tr>
        <td><a href="/gestor/corretor/${l.id}"><b>${l.nome}</b></a>${l.equipe ? html`<br><span class="suave pequeno">${l.equipe}</span>` : ""}</td>
        <td>${SELO_CONEXAO[l.status_conexao] ?? l.status_conexao}</td>
        <td>${l.clientes}</td>
        <td>${l.aguardando ? html`<span class="selo alerta">${l.aguardando}</span>` : "0"}</td>
        <td>${formatarMinutos(l.resposta_mediana === null ? null : Number(l.resposta_mediana))}</td>
        <td>${nota(l.nota_media)}</td>
        <td>${l.principal_perda ? NOME_CATEGORIA_PERDA[l.principal_perda] : html`<span class="suave">—</span>`}</td>
      </tr>`,
    )}
  </table></div>`;
}

export async function telaTime(): Promise<Raw> {
  const totais = await queryOne<{ corretores: number; conectados: number; clientes: number; aguardando: number; analisadas: number }>(
    `SELECT (SELECT count(*)::int FROM corretores) AS corretores,
            (SELECT count(*)::int FROM corretores WHERE status_conexao = 'conectado') AS conectados,
            (SELECT count(*)::int FROM conversas WHERE tipo = 'cliente') AS clientes,
            (SELECT count(*)::int FROM conversas WHERE tipo = 'cliente' AND aguardando_resposta
               AND COALESCE(etapa, '') NOT IN ('fechou', 'perdido')) AS aguardando,
            (SELECT count(DISTINCT conversa_id)::int FROM analises) AS analisadas`,
  );
  const geral = await queryOne<{ nota: string | null; primeira: string | null; simuladas: number }>(
    `WITH ult AS (${ULTIMAS_ANALISES})
     SELECT avg(nota_geral) AS nota,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (metricas->>'primeiraRespostaMin')::numeric) AS primeira,
            count(*) FILTER (WHERE modelo = 'simulada')::int AS simuladas
     FROM ult`,
  );
  const etapas = await query<{ etapa: string; n: number }>("SELECT etapa, count(*)::int AS n FROM conversas WHERE tipo = 'cliente' AND etapa IS NOT NULL GROUP BY etapa");
  const perdas = await query<{ categoria_perda: CategoriaPerda; n: number }>(
    `WITH ult AS (${ULTIMAS_ANALISES})
     SELECT categoria_perda, count(*)::int AS n FROM ult WHERE categoria_perda <> 'nenhuma' GROUP BY 1 ORDER BY 2 DESC`,
  );
  const criterios = await query<{ criterio: Criterio; media: string }>(
    `WITH ult AS (${ULTIMAS_ANALISES})
     SELECT n->>'criterio' AS criterio, avg((n->>'nota')::numeric) AS media
     FROM ult, jsonb_array_elements(resultado->'notas') n
     WHERE n->>'nota' IS NOT NULL GROUP BY 1`,
  );
  const porEtapa = Object.fromEntries(etapas.map((e) => [e.etapa, e.n]));
  const t = totais!;

  return html`
    <h1>Visão do time</h1>
    ${geral?.simuladas ? html`<div class="aviso"><b>Modo demonstração:</b> ${geral.simuladas} análise(s) simulada(s), feitas sem IA. Configure <code>ANTHROPIC_API_KEY</code> para ter as análises reais.</div>` : ""}
    <div class="kpis">
      <div class="kpi"><div class="valor">${t.conectados}/${t.corretores}</div><div class="rotulo">Corretores conectados</div></div>
      <div class="kpi"><div class="valor">${t.clientes}</div><div class="rotulo">Clientes nas conversas</div></div>
      <div class="kpi"><div class="valor">${t.analisadas}</div><div class="rotulo">Atendimentos analisados</div></div>
      <div class="kpi"><div class="valor">${t.aguardando}</div><div class="rotulo">Clientes aguardando resposta</div></div>
      <div class="kpi"><div class="valor">${formatarMinutos(geral?.primeira === null || geral?.primeira === undefined ? null : Number(geral.primeira))}</div><div class="rotulo">1ª resposta (mediana)</div></div>
      <div class="kpi"><div class="valor">${nota(geral?.nota)}</div><div class="rotulo">Nota média do atendimento</div></div>
    </div>
    <div class="grade">
      <div class="card"><h2>Onde o time perde clientes</h2>
        <p class="suave pequeno">Momento em que cada conversa travou, segundo a análise mais recente.</p>
        ${barras(perdas.map((p) => ({ rotulo: NOME_CATEGORIA_PERDA[p.categoria_perda], valor: p.n, ruim: true })))}
      </div>
      <div class="card"><h2>Funil do time</h2>
        ${barras(ETAPAS.map((e) => ({ rotulo: NOME_DA_ETAPA[e], valor: porEtapa[e] ?? 0 })))}
      </div>
      <div class="card"><h2>Nota média por critério</h2>
        ${barras(
          CRITERIOS.map((c) => criterios.find((x) => x.criterio === c))
            .filter((x): x is { criterio: Criterio; media: string } => Boolean(x))
            .map((x) => ({ rotulo: NOME_CRITERIO[x.criterio], valor: Number(x.media), ruim: Number(x.media) < 5 })),
          10,
        )}
      </div>
    </div>
    <div class="card"><h2>Corretores</h2>${tabelaCorretores(await linhasCorretores())}</div>`;
}

export async function telaCorretores(novo?: { nome: string; token: string }): Promise<Raw> {
  const linhas = await linhasCorretores();
  return html`
    <h1>Corretores</h1>
    ${novo ? html`<div class="info">Corretor <b>${novo.nome}</b> cadastrado. Envie este link para ele (é pessoal, não compartilhe):<br><code>${config.urlPublica}/c/${novo.token}</code></div>` : ""}
    <div class="card"><h2>Cadastrar corretor</h2>
      <form class="linha" method="post" action="/gestor/corretores">
        <input type="text" name="nome" placeholder="Nome do corretor" required>
        <input type="text" name="equipe" placeholder="Equipe (opcional)">
        <button class="botao" type="submit">Cadastrar e gerar link</button>
      </form>
      <p class="suave pequeno">O corretor recebe um link pessoal. Por ele, conecta o WhatsApp Business escaneando um QR Code e passa a ver as próprias análises.</p>
    </div>
    <div class="card"><h2>Links de acesso</h2><div class="tabela"><table>
      <tr><th>Corretor</th><th>Status</th><th>Link pessoal</th></tr>
      ${linhas.map((l) => html`<tr><td><a href="/gestor/corretor/${l.id}">${l.nome}</a></td><td>${SELO_CONEXAO[l.status_conexao] ?? l.status_conexao}</td><td><code class="pequeno">${config.urlPublica}/c/${l.token}</code></td></tr>`)}
    </table></div></div>`;
}

export async function telaCorretor(id: number): Promise<Raw | undefined> {
  const corretor = await queryOne("SELECT * FROM corretores WHERE id = $1", [id]);
  if (!corretor) return undefined;
  const p = await panoramaCorretor(id);
  const pendentes = await followups(id, 15);
  const criterios = await query<{ criterio: Criterio; media: string }>(
    `WITH ult AS (${ULTIMAS_ANALISES})
     SELECT n->>'criterio' AS criterio, avg((n->>'nota')::numeric) AS media
     FROM ult, jsonb_array_elements(resultado->'notas') n
     WHERE ult.corretor_id = $1 AND n->>'nota' IS NOT NULL GROUP BY 1`,
    [id],
  );
  const conversas = await query(
    `SELECT c.id, c.nome_contato, c.remote_jid, c.etapa, c.total_mensagens, c.ultima_mensagem_em,
            floor(extract(epoch FROM now() - c.ultima_mensagem_em) / 3600)::int AS horas,
            a.nota_geral, a.categoria_perda
     FROM conversas c
     LEFT JOIN LATERAL (SELECT nota_geral, categoria_perda FROM analises WHERE conversa_id = c.id ORDER BY criada_em DESC LIMIT 1) a ON TRUE
     WHERE c.corretor_id = $1 AND c.tipo = 'cliente'
     ORDER BY c.ultima_mensagem_em DESC NULLS LAST LIMIT 300`,
    [id],
  );

  return html`
    <h1>${corretor.nome}</h1>
    <p class="suave">${SELO_CONEXAO[corretor.status_conexao] ?? ""} ${corretor.telefone ? `· +${corretor.telefone}` : ""} ${corretor.ultima_sincronizacao ? `· última sincronização ${new Date(corretor.ultima_sincronizacao).toLocaleString("pt-BR", { timeZone: config.fuso })}` : ""}</p>
    <div class="kpis">
      <div class="kpi"><div class="valor">${p.clientes}</div><div class="rotulo">Clientes</div></div>
      <div class="kpi"><div class="valor">${p.aguardandoResposta}</div><div class="rotulo">Aguardando resposta</div></div>
      <div class="kpi"><div class="valor">${p.parados7dias}</div><div class="rotulo">Parados há 7+ dias</div></div>
      <div class="kpi"><div class="valor">${nota(p.notaMedia)}</div><div class="rotulo">Nota média</div></div>
    </div>
    <div class="grade">
      <div class="card"><h2>Notas por critério</h2>
        ${barras(
          CRITERIOS.map((c) => criterios.find((x) => x.criterio === c))
            .filter((x): x is { criterio: Criterio; media: string } => Boolean(x))
            .map((x) => ({ rotulo: NOME_CRITERIO[x.criterio], valor: Number(x.media), ruim: Number(x.media) < 5 })),
          10,
        )}
      </div>
      <div class="card"><h2>Funil</h2>${barras(ETAPAS.map((e) => ({ rotulo: NOME_DA_ETAPA[e], valor: p.porEtapa[e] ?? 0 })))}</div>
    </div>
    <div class="card"><h2>Precisam de atenção (${pendentes.length})</h2>
      ${pendentes.length
        ? html`<div class="tabela"><table><tr><th>Cliente</th><th>Etapa</th><th>Situação</th><th>Próximo passo sugerido</th></tr>
          ${pendentes.map((f) => html`<tr><td><a href="/gestor/conversa/${f.conversa_id}">${nomeContato(f)}</a></td><td>${seloEtapa(f.etapa)}</td><td>${f.cliente_aguardando ? html`<span class="selo alerta">aguardando resposta ${tempoRelativo(f.horas)}</span>` : `sem conversa ${tempoRelativo(f.horas)}`}</td><td>${f.acao ?? "—"}</td></tr>`)}
          </table></div>`
        : html`<p class="suave">Nenhum cliente esperando. 👏</p>`}
    </div>
    <div class="card"><h2>Conversas com clientes</h2><div class="tabela"><table>
      <tr><th>Cliente</th><th>Etapa</th><th>Nota</th><th>Onde travou</th><th>Mensagens</th><th>Última mensagem</th></tr>
      ${conversas.map((c) => html`<tr><td><a href="/gestor/conversa/${c.id}">${nomeContato(c)}</a></td><td>${seloEtapa(c.etapa)}</td><td>${nota(c.nota_geral)}</td><td>${c.categoria_perda && c.categoria_perda !== "nenhuma" ? NOME_CATEGORIA_PERDA[c.categoria_perda as CategoriaPerda] : "—"}</td><td>${c.total_mensagens}</td><td>${c.horas === null ? "—" : tempoRelativo(c.horas)}</td></tr>`)}
    </table></div></div>`;
}
