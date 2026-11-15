// Utilitários de HTML: escape, layout e pequenos componentes visuais.

export function esc(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Template de HTML que escapa as interpolações. Use raw() para inserir HTML já montado. */
export class Raw {
  constructor(public readonly html: string) {}
  toString() {
    return this.html;
  }
}
export const raw = (html: string) => new Raw(html);

export function html(partes: TemplateStringsArray, ...valores: unknown[]): Raw {
  let saida = partes[0];
  valores.forEach((v, i) => {
    saida += renderizar(v) + partes[i + 1];
  });
  return new Raw(saida);
}

function renderizar(v: unknown): string {
  if (v instanceof Raw) return v.html;
  if (Array.isArray(v)) return v.map(renderizar).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}

const CSS = `
:root {
  --bg: #f5f6f8; --card: #ffffff; --texto: #1d2433; --suave: #5f6b7c; --borda: #e3e7ee;
  --marca: #0f766e; --marca-clara: #ccfbf1; --alerta: #b45309; --alerta-claro: #fef3c7;
  --ruim: #b91c1c; --ruim-claro: #fee2e2; --bom: #15803d; --bom-claro: #dcfce7;
}
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--texto); }
a { color: var(--marca); text-decoration: none; }
a:hover { text-decoration: underline; }
header.topo { background: var(--texto); color: #fff; padding: 12px 16px; }
header.topo .conteudo { max-width: 1180px; margin: 0 auto; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
header.topo b { font-size: 17px; letter-spacing: .2px; }
header.topo a { color: #cbd5e1; }
main { max-width: 1180px; margin: 0 auto; padding: 20px 16px 60px; }
h1 { font-size: 24px; margin: 4px 0 16px; }
h2 { font-size: 17px; margin: 0 0 12px; }
h3 { font-size: 15px; margin: 0 0 6px; }
.grade { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start; }
.kpis { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); margin-bottom: 16px; }
.card { background: var(--card); border: 1px solid var(--borda); border-radius: 12px; padding: 16px; margin-bottom: 16px; min-width: 0; }
.kpi { background: var(--card); border: 1px solid var(--borda); border-radius: 12px; padding: 14px 16px; }
.kpi .valor { font-size: 26px; font-weight: 700; }
.kpi .rotulo { color: var(--suave); font-size: 13px; }
.suave { color: var(--suave); }
.pequeno { font-size: 13px; }
.barra { display: grid; grid-template-columns: minmax(120px, 210px) 1fr 44px; gap: 10px; align-items: center; margin: 7px 0; font-size: 14px; }
.barra .trilho { background: #eef1f5; border-radius: 6px; height: 12px; overflow: hidden; }
.barra .preenchido { background: var(--marca); height: 100%; border-radius: 6px; }
.barra .preenchido.ruim { background: #ef4444; }
.barra .num { text-align: right; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--borda); vertical-align: top; }
th { color: var(--suave); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; }
.tabela { overflow-x: auto; }
.selo { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; background: #eef1f5; color: var(--suave); }
.selo.bom { background: var(--bom-claro); color: var(--bom); }
.selo.alerta { background: var(--alerta-claro); color: var(--alerta); }
.selo.ruim { background: var(--ruim-claro); color: var(--ruim); }
.selo.marca { background: var(--marca-clara); color: var(--marca); }
.nota { font-weight: 700; font-variant-numeric: tabular-nums; }
.nota.bom { color: var(--bom); } .nota.alerta { color: var(--alerta); } .nota.ruim { color: var(--ruim); }
.aviso { background: var(--alerta-claro); border: 1px solid #fcd34d; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
.info { background: var(--marca-clara); border: 1px solid #99f6e4; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
.botao { display: inline-block; background: var(--marca); color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer; }
.botao:hover { filter: brightness(1.1); text-decoration: none; }
.botao.secundario { background: #fff; color: var(--texto); border: 1px solid var(--borda); }
.botao.pequeno { padding: 5px 10px; font-size: 13px; }
input[type=text] { font: inherit; padding: 9px 10px; border: 1px solid var(--borda); border-radius: 8px; min-width: 0; }
form.linha { display: flex; gap: 8px; flex-wrap: wrap; }
.mensagem-sugerida { background: #f0fdf4; border-left: 3px solid var(--bom); padding: 8px 10px; border-radius: 6px; margin: 6px 0; white-space: pre-wrap; }
.dica { border-top: 1px solid var(--borda); padding: 12px 0; }
.dica:first-of-type { border-top: 0; padding-top: 0; }
.chat { display: flex; flex-direction: column; gap: 6px; max-height: 720px; overflow-y: auto; padding: 8px; background: #efeae2; border-radius: 10px; }
.msg { max-width: 82%; padding: 6px 10px; border-radius: 8px; background: #fff; white-space: pre-wrap; word-wrap: break-word; font-size: 14px; }
.msg.corretor { align-self: flex-end; background: #d9fdd3; }
.msg .meta { display: block; font-size: 11px; color: var(--suave); margin-bottom: 2px; }
.msg.destaque { outline: 2px solid #ef4444; }
.passos { counter-reset: passo; list-style: none; padding: 0; }
.passos li { counter-increment: passo; position: relative; padding: 0 0 14px 40px; }
.passos li::before { content: counter(passo); position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--marca); color: #fff; display: grid; place-items: center; font-weight: 700; }
.qr { width: 264px; max-width: 100%; aspect-ratio: 1; border: 1px solid var(--borda); border-radius: 12px; display: grid; place-items: center; background: #fff; }
.qr img { width: 100%; height: 100%; }
.colunas { display: flex; align-items: flex-end; gap: 6px; height: 190px; padding-top: 8px; overflow-x: auto; }
.coluna { flex: 1 0 34px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; font-size: 11px; }
.coluna .barra-v { width: 100%; max-width: 38px; border-radius: 6px 6px 0 0; background: #94a3b8; }
.coluna.depois .barra-v { background: var(--marca); }
.coluna .valor { font-weight: 700; margin-bottom: 3px; }
.coluna .rotulo { color: var(--suave); margin-top: 4px; white-space: nowrap; }
.legenda { display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: #94a3b8; vertical-align: middle; }
.legenda.depois { background: var(--marca); }
.prompt { background: #f1f5f9; border-left: 3px solid #64748b; padding: 8px 10px; border-radius: 6px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; white-space: pre-wrap; }
.destaque-card { border-left: 4px solid var(--marca); }
select { font: inherit; padding: 8px 10px; border: 1px solid var(--borda); border-radius: 8px; background: #fff; max-width: 100%; }
@media (max-width: 640px) {
  .barra { grid-template-columns: 1fr 40px; }
  .barra .trilho { grid-column: 1 / -1; order: 3; }
  .msg { max-width: 94%; }
}
`;

export function pagina(titulo: string, conteudo: Raw, opcoes: { nav?: Raw; refresh?: number } = {}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${opcoes.refresh ? `<meta http-equiv="refresh" content="${opcoes.refresh}">` : ""}
<title>${esc(titulo)} · Raio-X do Atendimento</title>
<style>${CSS}</style>
</head>
<body>
<header class="topo"><div class="conteudo"><b>Raio-X do Atendimento</b>${opcoes.nav?.html ?? ""}</div></header>
<main>${conteudo.html}</main>
</body>
</html>`;
}

export function classeNota(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return n >= 7 ? "bom" : n >= 5 ? "alerta" : "ruim";
}

export function nota(n: number | string | null | undefined): Raw {
  if (n === null || n === undefined) return raw(`<span class="suave">—</span>`);
  const v = Number(n);
  return html`<span class="nota ${classeNota(v)}">${v.toFixed(1).replace(".", ",")}</span>`;
}

export function barras(itens: { rotulo: string; valor: number; sufixo?: string; ruim?: boolean }[], maximo?: number): Raw {
  if (itens.length === 0) return raw(`<p class="suave">Ainda sem dados.</p>`);
  const max = maximo ?? Math.max(...itens.map((i) => i.valor), 1);
  return html`${itens.map(
    (i) => html`<div class="barra"><span>${i.rotulo}</span><div class="trilho"><div class="preenchido ${i.ruim ? "ruim" : ""}" style="width:${Math.round((i.valor / max) * 100)}%"></div></div><span class="num">${Number.isInteger(i.valor) ? i.valor : i.valor.toFixed(1).replace(".", ",")}${i.sufixo ?? ""}</span></div>`,
  )}`;
}

export function tempoRelativo(horas: number): string {
  if (horas < 1) return "agora há pouco";
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}
