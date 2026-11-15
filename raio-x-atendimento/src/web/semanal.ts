// Componentes das telas semanais: antes x depois do marco de IA, evolução e relatórios.

import { CRITERIOS, NOME_CRITERIO, type RelatorioCorretor, type RelatorioTime } from "../analise/esquema.js";
import { config } from "../config.js";
import { query, queryOne } from "../db.js";
import { evolucaoPorCorretor, indicadores, serieSemanal, type Indicadores, type PontoSemanal, type Tendencia } from "../semanal/estatisticas.js";
import { rotuloSemana, somarDias, ultimaSemanaCompleta } from "../semanal/semanas.js";
import { html, nota, raw, type Raw } from "./html.js";

export const dataDoMarco = () => config.marcoIa.split("-").reverse().join("/");

const SELO_TENDENCIA: Record<Tendencia, Raw> = {
  melhorando: raw(`<span class="selo bom">▲ melhorando</span>`),
  estavel: raw(`<span class="selo">● estável</span>`),
  piorando: raw(`<span class="selo ruim">▼ piorando</span>`),
  sem_dados: raw(`<span class="selo">sem dados</span>`),
};
export const seloTendencia = (t: Tendencia) => SELO_TENDENCIA[t];

function delta(antes: number | null | undefined, depois: number | null | undefined): Raw {
  if (antes === null || antes === undefined || depois === null || depois === undefined) return raw(`<span class="suave">—</span>`);
  const d = Math.round((depois - antes) * 10) / 10;
  const classe = d >= 0.5 ? "bom" : d <= -0.5 ? "ruim" : "";
  return html`<span class="nota ${classe}">${d > 0 ? "+" : ""}${d.toFixed(1).replace(".", ",")}</span>`;
}

/** Gráfico de barras verticais: nota média por semana, separando antes e depois do marco. */
export function graficoSemanal(serie: PontoSemanal[]): Raw {
  if (serie.length === 0) return raw(`<p class="suave">Ainda sem semanas analisadas.</p>`);
  return html`<div class="colunas" role="img" aria-label="Nota média por semana">
    ${serie.map(
      (p) => html`<div class="coluna ${p.periodo}" title="${rotuloSemana(p.semana)}: nota ${p.nota ?? "—"}, ${p.conversas} conversa(s), ${p.usoIa}% com indício de IA">
        <span class="valor">${p.nota === null ? "—" : p.nota.toFixed(1).replace(".", ",")}</span>
        <div class="barra-v" style="height:${Math.max(4, ((p.nota ?? 0) / 10) * 100)}%"></div>
        <span class="rotulo">${rotuloSemana(p.semana).split(" a ")[0]}</span>
      </div>`,
    )}
  </div>
  <p class="suave pequeno"><span class="legenda antes"></span> antes do marco (${dataDoMarco()}) · <span class="legenda depois"></span> depois</p>`;
}

/** Tabela de critérios: antes x depois. */
export function tabelaAntesDepois(antes: Indicadores, depois: Indicadores): Raw {
  return html`<div class="tabela"><table>
    <tr><th>Critério</th><th>Antes</th><th>Depois</th><th>Diferença</th></tr>
    <tr><td><b>Nota geral</b></td><td>${nota(antes.nota)}</td><td>${nota(depois.nota)}</td><td>${delta(antes.nota, depois.nota)}</td></tr>
    ${CRITERIOS.map(
      (c) => html`<tr><td>${NOME_CRITERIO[c]}</td><td>${nota(antes.criterios[c])}</td><td>${nota(depois.criterios[c])}</td><td>${delta(antes.criterios[c], depois.criterios[c])}</td></tr>`,
    )}
    <tr><td class="suave">Conversas-semana analisadas</td><td class="suave">${antes.conversas}</td><td class="suave">${depois.conversas}</td><td></td></tr>
  </table></div>`;
}

/** Bloco "Efeito da IA" da visão do time. */
export async function blocoEfeitoIa(): Promise<Raw> {
  const antes = await indicadores({ periodo: "antes" });
  const depois = await indicadores({ periodo: "depois" });
  const serie = await serieSemanal(undefined, somarDias(ultimaSemanaCompleta(), -7 * 15));
  const evolucao = await evolucaoPorCorretor();
  const totalDepois = depois.conversas || 1;
  return html`
    <h2 style="margin-top:8px">Efeito da IA no atendimento</h2>
    <p class="suave">Comparação antes e depois de ${dataDoMarco()}, quando o time passou a usar IA. Os indícios de uso vêm da leitura das mensagens, não de uma medição exata.</p>
    <div class="kpis">
      <div class="kpi"><div class="valor">${nota(antes.nota)}</div><div class="rotulo">Nota média antes</div></div>
      <div class="kpi"><div class="valor">${nota(depois.nota)}</div><div class="rotulo">Nota média depois</div></div>
      <div class="kpi"><div class="valor">${delta(antes.nota, depois.nota)}</div><div class="rotulo">Diferença</div></div>
      <div class="kpi"><div class="valor">${Math.round(((depois.usoIa.uso_personalizado + depois.usoIa.uso_generico) / totalDepois) * 100)}%</div><div class="rotulo">Conversas com indício de IA (depois)</div></div>
      <div class="kpi"><div class="valor">${Math.round((depois.usoIa.uso_generico / totalDepois) * 100)}%</div><div class="rotulo">IA usada de forma genérica</div></div>
    </div>
    <div class="grade">
      <div class="card"><h2>Nota média do time por semana</h2>${graficoSemanal(serie)}</div>
      <div class="card"><h2>Critérios: antes x depois</h2>${tabelaAntesDepois(antes, depois)}</div>
    </div>
    <div class="card"><h2>Evolução por corretor</h2><div class="tabela"><table>
      <tr><th>Corretor</th><th>Antes</th><th>Depois</th><th>Diferença</th><th>Tendência</th><th>Indício de IA</th><th>IA genérica</th></tr>
      ${evolucao.map(
        (e) => html`<tr><td><a href="/gestor/corretor/${e.corretor_id}">${e.nome}</a></td><td>${nota(e.antes)} <span class="suave pequeno">(${e.conversasAntes})</span></td><td>${nota(e.depois)} <span class="suave pequeno">(${e.conversasDepois})</span></td><td>${delta(e.antes, e.depois)}</td><td>${seloTendencia(e.tendencia)}</td><td>${e.conversasDepois ? `${e.usoIaDepois}%` : "—"}</td><td>${e.conversasDepois ? (e.usoGenericoDepois ? html`<span class="selo alerta">${e.usoGenericoDepois}%</span>` : "0%") : "—"}</td></tr>`,
      )}
    </table></div><p class="suave pequeno">Entre parênteses: quantas conversas-semana foram analisadas. Com poucas conversas, a diferença ainda não é conclusiva.</p></div>`;
}

// ---------- Relatórios ----------

export function blocoRelatorioCorretor(r: RelatorioCorretor, semana: string, linkConversa: (id: number) => string): Raw {
  // Transforma "C123" em link para a conversa.
  const comLinks = (texto: string) => raw(html`${texto}`.html.replace(/\bC(\d+)\b/g, (_, id) => `<a href="${linkConversa(Number(id))}">C${id}</a>`));
  return html`
    <div class="card destaque-card">
      <h2>Relatório da semana ${rotuloSemana(semana)} ${seloTendencia(r.tendencia)}</h2>
      <p>${r.resumo_semana}</p>
      <p><b>Evolução:</b> ${r.evolucao}</p>
      ${r.pontos_fortes.length ? html`<h3>O que está indo bem</h3><ul>${r.pontos_fortes.map((p) => html`<li>${p}</li>`)}</ul>` : ""}
    </div>
    <div class="grade">
      <div class="card"><h2>🎯 Foco da semana</h2>
        ${r.focos.map((f) => html`<div class="dica"><h3>${f.titulo}</h3><p class="pequeno suave">${comLinks(f.por_que)}</p><p>${f.como_fazer}</p>${f.exemplo_mensagem ? html`<div class="mensagem-sugerida">${f.exemplo_mensagem}</div>` : ""}</div>`)}
      </div>
      <div class="card"><h2>🤖 Como usar melhor a IA</h2>
        ${r.dicas_ia.map((d) => html`<div class="dica"><h3>${d.titulo}</h3><p>${d.como_fazer}</p><p class="pequeno suave">Peça assim ao Claude:</p><div class="prompt">${d.exemplo_prompt}</div></div>`)}
        ${r.dicas_ligacao.length ? html`<h2 style="margin-top:16px">📞 Quando ligar</h2>${r.dicas_ligacao.map((d) => html`<div class="dica"><h3>${comLinks(d.situacao)}</h3><p>${d.recomendacao}</p></div>`)}` : ""}
      </div>
    </div>`;
}

export async function ultimoRelatorioCorretor(corretorId: number): Promise<{ semana: string; conteudo: RelatorioCorretor } | undefined> {
  return queryOne("SELECT to_char(semana, 'YYYY-MM-DD') AS semana, conteudo FROM relatorios WHERE corretor_id = $1 ORDER BY semana DESC LIMIT 1", [corretorId]);
}

export async function telaRelatorioTime(semana?: string): Promise<Raw> {
  const semanas = await query<{ semana: string }>("SELECT to_char(semana, 'YYYY-MM-DD') AS semana FROM relatorios WHERE corretor_id IS NULL ORDER BY semana DESC LIMIT 26");
  const alvo = semana ?? semanas[0]?.semana;
  const rel = alvo
    ? await queryOne<{ conteudo: RelatorioTime; modelo: string }>("SELECT conteudo, modelo FROM relatorios WHERE corretor_id IS NULL AND semana = $1::date", [alvo])
    : undefined;
  if (!rel || !alvo) return html`<h1>Relatório semanal do time</h1><p class="suave">O primeiro relatório sai na segunda-feira, depois da análise da semana.</p>`;
  const r = rel.conteudo;
  const lista = (itens: string[]) => (itens.length ? html`<ul>${itens.map((i) => html`<li>${i}</li>`)}</ul>` : raw(`<p class="suave">—</p>`));
  return html`
    <h1>Relatório do time: semana ${rotuloSemana(alvo)}</h1>
    <form class="linha" method="get" action="/gestor/relatorio" style="margin-bottom:16px">
      <select name="semana" onchange="this.form.submit()">${semanas.map((s) => html`<option value="${s.semana}" ${s.semana === alvo ? "selected" : ""}>Semana ${rotuloSemana(s.semana)}</option>`)}</select>
    </form>
    ${rel.modelo === "simulada" ? html`<div class="aviso">Relatório <b>simulado</b> (sem IA). Configure a chave da Anthropic para o relatório completo.</div>` : ""}
    <div class="card destaque-card"><h2>Resumo</h2><p>${r.resumo_executivo}</p></div>
    <div class="card"><h2>A IA está melhorando o atendimento?</h2>
      <p>${r.efeito_ia.conclusao}</p>${lista(r.efeito_ia.evidencias)}
      <div class="grade">
        <div><h3>Evoluindo</h3>${lista(r.efeito_ia.corretores_evoluindo)}</div>
        <div><h3>Precisam de apoio</h3>${lista(r.efeito_ia.corretores_estagnados)}</div>
      </div>
    </div>
    <div class="grade">
      <div class="card"><h2>Onde perdemos clientes</h2>${r.onde_perdemos.map((p) => html`<div class="dica"><h3>${p.tema}</h3><p class="pequeno suave">${p.dimensao}</p><p>${p.recomendacao}</p></div>`)}</div>
      <div class="card"><h2>Uso da IA pelo time</h2><p>${r.uso_ia.diagnostico}</p>${lista(r.uso_ia.recomendacoes)}</div>
    </div>
    <div class="grade">
      <div class="card"><h2>Objeções mais frequentes</h2>${r.objecoes_frequentes.map((o) => html`<div class="dica"><h3>${o.objecao}</h3><p>${o.como_responder}</p></div>`)}</div>
      <div class="card"><h2>Perguntas mais frequentes dos clientes</h2>${r.perguntas_frequentes.length ? r.perguntas_frequentes.map((p) => html`<div class="dica"><h3>${p.pergunta}</h3><p>${p.sugestao}</p></div>`) : raw(`<p class="suave">—</p>`)}</div>
    </div>
    <div class="card"><h2>Boas práticas da semana (para treinamento)</h2>
      ${r.boas_praticas.length ? r.boas_praticas.map((b) => html`<div class="dica"><h3>${b.titulo} <span class="selo">${b.corretor}</span></h3><div class="mensagem-sugerida">${b.exemplo}</div><p class="pequeno">${b.por_que_funciona}</p></div>`) : raw(`<p class="suave">—</p>`)}
    </div>
    <div class="grade">
      <div class="card"><h2>Treinamentos sugeridos</h2>${r.treinamentos_sugeridos.length ? html`<table><tr><th>Tema</th><th>Para quem</th><th>Formato</th></tr>${r.treinamentos_sugeridos.map((t) => html`<tr><td>${t.tema}</td><td>${t.para_quem}</td><td>${t.formato}</td></tr>`)}</table>` : raw(`<p class="suave">—</p>`)}</div>
      <div class="card"><h2>⚠️ Alertas</h2>${lista(r.alertas)}</div>
    </div>`;
}
