// Página pessoal do corretor (/c/<token>): conectar o WhatsApp e ver o próprio "raio-x".

import type { Analise } from "../analise/esquema.js";
import { NOME_CATEGORIA_PERDA } from "../analise/esquema.js";
import { query } from "../db.js";
import { etiquetasFaltando } from "../etiquetas.js";
import { followups, panoramaCorretor } from "../resumo.js";
import { nomeContato, seloEtapa } from "./conversa.js";
import { html, nota, raw, tempoRelativo, type Raw } from "./html.js";
import { serieSemanal } from "../semanal/estatisticas.js";
import { somarDias, ultimaSemanaCompleta } from "../semanal/semanas.js";
import { blocoRelatorioCorretor, graficoSemanal, ultimoRelatorioCorretor } from "./semanal.js";

export interface CorretorDaPagina {
  id: number;
  nome: string;
  token: string;
  status_conexao: string;
  telefone: string | null;
}

const O_QUE_COLETAMOS = html`
  <details class="card"><summary><b>O que é coletado e quem vê</b></summary>
    <ul>
      <li>O sistema lê as conversas do seu WhatsApp Business para identificar quais são de <b>clientes</b>.</li>
      <li>Conversas <b>pessoais</b> (família, amigos) e de colegas são descartadas: o conteúdo é apagado e nunca aparece em nenhum painel.
        Se quiser garantir, aplique a etiqueta <b>Pessoal</b> na conversa.</li>
      <li>Nas conversas com clientes, nomes, telefones, e-mails e documentos são mascarados antes da análise pela IA.</li>
      <li>Você vê as análises das suas conversas. O gestor vê os indicadores e as análises do time para orientar o trabalho.</li>
      <li>O sistema <b>não envia mensagens para seus clientes</b> e não marca mensagens como lidas. A única mensagem enviada é o seu resumo diário, para você mesmo.</li>
      <li>Você pode desconectar quando quiser, nesta página ou em WhatsApp &gt; Aparelhos conectados.</li>
    </ul>
  </details>`;

export function telaConectar(c: CorretorDaPagina, erro?: string): Raw {
  const primeiroNome = c.nome.split(" ")[0];
  return html`
    <h1>Olá, ${primeiroNome}! 👋</h1>
    <p>Conecte seu WhatsApp Business e receba, todo dia, a lista de clientes para retomar, mensagens prontas e dicas para fechar mais negócios.</p>
    ${erro ? html`<div class="aviso">${erro}</div>` : ""}
    <div class="grade">
      <div class="card">
        <h2>Como conectar (5 minutos)</h2>
        <ol class="passos">
          <li><b>Faça backup das conversas</b><br><span class="suave pequeno">WhatsApp &gt; Configurações &gt; Conversas &gt; Backup de conversas.</span></li>
          <li><b>Instale o WhatsApp Business</b> e use o mesmo número.<br><span class="suave pequeno">O app oferece trazer suas conversas: aceite. Nada se perde.</span></li>
          <li><b>Escaneie o QR Code ao lado</b><br><span class="suave pequeno">No WhatsApp Business: ⋮ (ou Configurações) &gt; Aparelhos conectados &gt; Conectar aparelho.</span></li>
          <li><b>Pronto!</b> Em alguns minutos suas conversas com clientes aparecem organizadas por etiqueta.</li>
        </ol>
      </div>
      <div class="card">
        <h2>QR Code</h2>
        ${c.status_conexao === "desconectado"
          ? html`<form method="post" action="/c/${c.token}/conectar">
              <p><label><input type="checkbox" name="aceite" value="sim" required> Li e concordo com o que é coletado (abaixo).</label></p>
              <button class="botao" type="submit">Gerar QR Code</button>
            </form>`
          : html`<div class="qr" id="qr"><span class="suave">Carregando QR Code…</span></div>
            <p class="suave pequeno" id="status">O QR Code muda a cada poucos segundos. Esta página atualiza sozinha quando conectar.</p>
            <script>
              async function atualizar() {
                try {
                  const r = await fetch(location.pathname.replace(/\\/$/, "") + "/qr", { cache: "no-store" });
                  const d = await r.json();
                  if (d.status === "conectado") { location.reload(); return; }
                  const box = document.getElementById("qr");
                  if (d.qr) box.innerHTML = '<img alt="QR Code para conectar o WhatsApp" src="' + d.qr + '">';
                  else if (d.erro) box.innerHTML = '<span class="suave">' + d.erro.replace(/[<>&]/g, "") + '</span>';
                } catch (e) {}
                setTimeout(atualizar, 5000);
              }
              atualizar();
            </script>`}
      </div>
    </div>
    ${O_QUE_COLETAMOS}`;
}

export async function telaPainelCorretor(c: CorretorDaPagina, aviso?: string): Promise<Raw> {
  const p = await panoramaCorretor(c.id);
  const pendentes = await followups(c.id, 30);
  const faltando = await etiquetasFaltando(c.id);
  const analises = await query<{ conversa_id: number; nome_contato: string | null; remote_jid: string; etapa: string | null; nota_geral: string; resultado: Analise }>(
    `SELECT DISTINCT ON (c.id) c.id AS conversa_id, c.nome_contato, c.remote_jid, c.etapa, a.nota_geral, a.resultado, a.criada_em
     FROM conversas c JOIN analises a ON a.conversa_id = c.id
     WHERE c.corretor_id = $1 AND c.tipo = 'cliente'
     ORDER BY c.id, a.semana DESC`,
    [c.id],
  );
  analises.sort((a, b) => Number(a.nota_geral) - Number(b.nota_geral));
  const recentesNaoAnalisadas = await query<{ id: number; nome_contato: string | null; remote_jid: string; tipo: string }>(
    `SELECT id, nome_contato, remote_jid, tipo FROM conversas
     WHERE corretor_id = $1 AND tipo IN ('pessoal', 'outro') AND ultima_mensagem_em > now() - interval '30 days'
     ORDER BY ultima_mensagem_em DESC LIMIT 20`,
    [c.id],
  );
  const primeiroNome = c.nome.split(" ")[0];
  const relatorio = await ultimoRelatorioCorretor(c.id);
  const serie = await serieSemanal(c.id, somarDias(ultimaSemanaCompleta(), -7 * 11));

  return html`
    <h1>Seu raio-x, ${primeiroNome}</h1>
    ${aviso ? html`<div class="info">${aviso}</div>` : ""}
    ${c.status_conexao !== "conectado" ? html`<div class="aviso">Seu WhatsApp está <b>desconectado</b>. <a href="/c/${c.token}?reconectar=1">Conectar de novo</a></div>` : ""}
    ${faltando.length
      ? html`<div class="aviso"><b>Falta criar ${faltando.length} etiqueta(s) no seu WhatsApp Business</b> para o sistema organizar seus clientes:
          ${raw(faltando.map((f) => `<span class="selo">${f}</span>`).join(" "))}
          <br><span class="pequeno">No app: Ferramentas comerciais &gt; Etiquetas &gt; + (nova etiqueta). Use exatamente estes nomes. Leva 1 minuto.</span></div>`
      : ""}
    <div class="kpis">
      <div class="kpi"><div class="valor">${p.clientes}</div><div class="rotulo">Clientes identificados</div></div>
      <div class="kpi"><div class="valor">${p.aguardandoResposta}</div><div class="rotulo">Aguardando sua resposta</div></div>
      <div class="kpi"><div class="valor">${p.parados7dias}</div><div class="rotulo">Parados há 7+ dias</div></div>
      <div class="kpi"><div class="valor">${nota(p.notaMedia)}</div><div class="rotulo">Sua nota média</div></div>
    </div>
    ${relatorio
      ? blocoRelatorioCorretor(relatorio.conteudo, relatorio.semana, (id) => `/c/${c.token}/conversa/${id}`)
      : html`<div class="info">Toda segunda-feira você recebe aqui (e no seu WhatsApp) o relatório da semana: o que melhorou, onde focar e dicas para usar melhor a IA.</div>`}
    ${p.principalPerda ? html`<div class="info">📉 Onde você mais perde clientes hoje: <b>${NOME_CATEGORIA_PERDA[p.principalPerda]}</b>.</div>` : ""}
    <div class="card"><h2>Sua evolução semana a semana</h2>${graficoSemanal(serie)}</div>

    <div class="card"><h2>Retome hoje (${pendentes.length})</h2>
      ${pendentes.length
        ? pendentes.map((f) => {
            const numero = f.remote_jid.endsWith("@s.whatsapp.net") ? f.remote_jid.split("@")[0] : null;
            return html`<div class="dica">
              <h3><a href="/c/${c.token}/conversa/${f.conversa_id}">${nomeContato(f)}</a> ${seloEtapa(f.etapa)}
                ${f.cliente_aguardando ? html`<span class="selo alerta">esperando você ${tempoRelativo(f.horas)}</span>` : html`<span class="selo">sem conversa ${tempoRelativo(f.horas)}</span>`}</h3>
              ${f.acao ? html`<p>${f.acao}</p>` : ""}
              ${f.mensagem_sugerida ? html`<div class="mensagem-sugerida">${f.mensagem_sugerida}</div>` : ""}
              ${numero && f.mensagem_sugerida ? html`<a class="botao pequeno" href="https://wa.me/${numero}?text=${encodeURIComponent(f.mensagem_sugerida)}" target="_blank" rel="noopener">Abrir no WhatsApp com a mensagem</a>` : ""}
            </div>`;
          })
        : html`<p class="suave">Ninguém esperando. Bom trabalho! 👏</p>`}
    </div>

    <div class="card"><h2>Suas conversas analisadas (semana mais recente de cada uma)</h2>
      <p class="suave pequeno">Das notas mais baixas para as mais altas: comece pelas que mais têm a ensinar.</p>
      ${analises.length
        ? html`<div class="tabela"><table><tr><th>Cliente</th><th>Etapa</th><th>Nota</th><th>Principal dica</th><th></th></tr>
          ${analises.map((a) => html`<tr>
            <td><a href="/c/${c.token}/conversa/${a.conversa_id}">${nomeContato(a)}</a></td>
            <td>${seloEtapa(a.etapa)}</td><td>${nota(a.nota_geral)}</td>
            <td>${a.resultado.dicas[0]?.titulo ?? "—"}</td>
            <td><form method="post" action="/c/${c.token}/conversa/${a.conversa_id}/tipo"><input type="hidden" name="tipo" value="pessoal"><button class="botao secundario pequeno" title="Tira esta conversa da análise e apaga o conteúdo">Não é cliente</button></form></td>
          </tr>`)}
          </table></div>`
        : html`<p class="suave">As análises aparecem aqui alguns minutos depois que as conversas forem importadas.</p>`}
    </div>

    ${recentesNaoAnalisadas.length
      ? html`<details class="card"><summary><b>Conversas que o sistema considerou pessoais (${recentesNaoAnalisadas.length} recentes)</b></summary>
          <p class="suave pequeno">O conteúdo delas não é guardado. Se alguma for de cliente, marque para incluir na análise.</p>
          <table>${recentesNaoAnalisadas.map((r) => html`<tr><td>${nomeContato(r)}</td><td><form method="post" action="/c/${c.token}/conversa/${r.id}/tipo"><input type="hidden" name="tipo" value="cliente"><button class="botao secundario pequeno">É cliente</button></form></td></tr>`)}</table>
        </details>`
      : ""}
    ${O_QUE_COLETAMOS}
    <form method="post" action="/c/${c.token}/desconectar" onsubmit="return confirm('Desconectar seu WhatsApp do Raio-X?')"><button class="botao secundario pequeno">Desconectar meu WhatsApp</button></form>`;
}
