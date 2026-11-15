// Tela de uma conversa: análise completa + mensagens numeradas. Usada pelo gestor e pelo corretor.

import { CRITERIOS, NOME_CATEGORIA_PERDA, NOME_CRITERIO, type Analise } from "../analise/esquema.js";
import { formatarData } from "../analise/transcricao.js";
import { query, queryOne } from "../db.js";
import { NOME_DA_ETAPA, type Etapa } from "../funil.js";
import { formatarMinutos, type Metricas } from "../metricas.js";
import { barras, html, nota, raw, type Raw } from "./html.js";

const ROTULO_PERFIL: Record<string, string> = {
  objetivo: "Objetivo",
  tipo_imovel: "Tipo de imóvel",
  regiao: "Região",
  orcamento: "Orçamento",
  pagamento: "Pagamento",
  prazo: "Prazo",
  decisores: "Quem decide",
};

export function seloEtapa(etapa: string | null): Raw {
  if (!etapa) return raw(`<span class="selo">sem etapa</span>`);
  const classe = etapa === "fechou" ? "bom" : etapa === "perdido" ? "ruim" : "marca";
  return html`<span class="selo ${classe}">${NOME_DA_ETAPA[etapa as Etapa] ?? etapa}</span>`;
}

export function nomeContato(c: { nome_contato: string | null; remote_jid: string }): string {
  return c.nome_contato || `+${c.remote_jid.split("@")[0]}`;
}

export async function telaConversa(conversaId: number, corretorId?: number): Promise<{ titulo: string; corpo: Raw } | undefined> {
  const conversa = await queryOne(
    `SELECT c.*, k.nome AS corretor_nome FROM conversas c JOIN corretores k ON k.id = c.corretor_id
     WHERE c.id = $1 AND ($2::int IS NULL OR c.corretor_id = $2)`,
    [conversaId, corretorId ?? null],
  );
  if (!conversa) return undefined;
  const ultima = await queryOne<{ resultado: Analise; metricas: Metricas; criada_em: Date; modelo: string; nota_geral: string }>(
    "SELECT resultado, metricas, criada_em, modelo, nota_geral FROM analises WHERE conversa_id = $1 ORDER BY criada_em DESC LIMIT 1",
    [conversaId],
  );
  const mensagens = await query<{ do_corretor: boolean; tipo: string; texto: string | null; enviada_em: Date }>(
    "SELECT do_corretor, tipo, texto, enviada_em FROM mensagens WHERE conversa_id = $1 ORDER BY enviada_em",
    [conversaId],
  );

  const a = ultima?.resultado;
  const m = ultima?.metricas;
  const destaque = a?.ponto_de_perda.mensagem ?? null;
  const titulo = nomeContato(conversa);

  const analise = a
    ? html`
      ${ultima!.modelo === "simulada" ? html`<div class="aviso">Esta é uma <b>análise simulada</b> (sem IA). Configure a chave da Anthropic para a análise detalhada.</div>` : ""}
      <div class="kpis">
        <div class="kpi"><div class="valor">${nota(ultima!.nota_geral)}</div><div class="rotulo">Nota do atendimento</div></div>
        <div class="kpi"><div class="valor">${seloEtapa(conversa.etapa)}</div><div class="rotulo">Etapa ${conversa.etapa_manual ? "(definida pelo corretor)" : `(IA, confiança ${a.confianca_etapa})`}</div></div>
        <div class="kpi"><div class="valor">${formatarMinutos(m?.primeiraRespostaMin)}</div><div class="rotulo">Primeira resposta</div></div>
        <div class="kpi"><div class="valor">${formatarMinutos(m?.respostaMedianaMin)}</div><div class="rotulo">Tempo de resposta (mediana)</div></div>
      </div>
      <div class="card"><h2>Resumo</h2><p>${a.resumo}</p>
        ${a.ponto_de_perda.categoria !== "nenhuma"
          ? html`<p><span class="selo ruim">Onde travou: ${NOME_CATEGORIA_PERDA[a.ponto_de_perda.categoria]}</span> ${a.ponto_de_perda.mensagem ? html`<a href="#m${a.ponto_de_perda.mensagem}">mensagem #${a.ponto_de_perda.mensagem}</a>` : ""}<br>${a.ponto_de_perda.descricao}</p>`
          : ""}
        ${a.proximo_passo ? html`<h3>Próximo passo (${a.proximo_passo.urgencia === "alta" ? "urgente" : `urgência ${a.proximo_passo.urgencia}`})</h3><p>${a.proximo_passo.acao}</p><div class="mensagem-sugerida">${a.proximo_passo.mensagem_sugerida}</div>` : ""}
      </div>
      <div class="grade">
        <div class="card"><h2>Dicas para melhorar</h2>
          ${a.dicas.map((d) => html`<div class="dica"><h3>${d.titulo}</h3><p class="pequeno suave">${d.o_que_aconteceu}</p><p>${d.como_fazer}</p><div class="mensagem-sugerida">${d.exemplo_mensagem}</div></div>`)}
          ${a.pontos_fortes.length ? html`<h3>Pontos fortes</h3><ul>${a.pontos_fortes.map((p) => html`<li>${p}</li>`)}</ul>` : ""}
        </div>
        <div class="card"><h2>Notas por critério</h2>
          ${barras(
            CRITERIOS.map((c) => a.notas.find((n) => n.criterio === c))
              .filter((n): n is Analise["notas"][number] => Boolean(n && n.nota !== null))
              .map((n) => ({ rotulo: NOME_CRITERIO[n.criterio], valor: n.nota!, ruim: n.nota! < 5 })),
            10,
          )}
          <details><summary class="pequeno">Ver justificativas</summary>
            <table>${a.notas.map((n) => html`<tr><td><b>${NOME_CRITERIO[n.criterio]}</b><br>${nota(n.nota)}</td><td>${n.comentario}<br><span class="suave pequeno">${n.evidencia}</span></td></tr>`)}</table>
          </details>
        </div>
      </div>
      <div class="card"><h2>Perfil do cliente</h2>
        <table>${Object.entries(a.perfil_cliente).map(([k, v]) => html`<tr><th>${ROTULO_PERFIL[k] ?? k}</th><td>${v ?? html`<span class="selo alerta">não descoberto</span>`}</td></tr>`)}</table>
      </div>`
    : html`<div class="info">${conversa.erro_analise ? `Erro na última análise: ${conversa.erro_analise}` : conversa.tipo === "cliente" || conversa.tipo === "indefinido" ? "Esta conversa ainda não foi analisada. A análise roda alguns minutos depois que a conversa para." : "Esta conversa não é de cliente e não é analisada."}</div>`;

  const chat = mensagens.length
    ? html`<div class="card"><h2>Conversa (${mensagens.length} mensagens)</h2><div class="chat">
        ${mensagens.map(
          (msg, i) => html`<div id="m${i + 1}" class="msg ${msg.do_corretor ? "corretor" : ""} ${destaque === i + 1 ? "destaque" : ""}"><span class="meta">#${i + 1} · ${formatarData(msg.enviada_em)}</span>${msg.tipo !== "texto" ? html`<i>[${msg.tipo}]</i> ` : ""}${msg.texto ?? ""}</div>`,
        )}
      </div></div>`
    : "";

  return {
    titulo,
    corpo: html`<h1>${titulo}</h1><p class="suave">Corretor: ${conversa.corretor_nome}${ultima ? ` · analisada em ${formatarData(ultima.criada_em)}` : ""}</p>${analise}${chat}`,
  };
}
