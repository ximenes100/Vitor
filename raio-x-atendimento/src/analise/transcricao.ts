import { anonimizar } from "../anonimizar.js";
import { config } from "../config.js";

export interface MensagemTranscricao {
  do_corretor: boolean;
  tipo: string;
  texto: string | null;
  enviada_em: Date;
}

const ROTULO_MIDIA: Record<string, string> = {
  audio: "[áudio]",
  imagem: "[foto]",
  video: "[vídeo]",
  documento: "[documento]",
  figurinha: "[figurinha]",
  localizacao: "[localização]",
  contato: "[contato compartilhado]",
  outro: "[mídia]",
};

const formatoData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: config.fuso,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatarData(d: Date): string {
  return formatoData.format(d);
}

/**
 * Monta a conversa em texto, numerando as mensagens (#1, #2, ...) para a IA poder citá-las.
 * Os números são os mesmos que aparecem na tela da conversa no painel.
 */
export function montarTranscricao(
  mensagens: MensagemTranscricao[],
  nomes: { cliente?: string | null; corretor?: string | null },
  inicio = 0,
): string {
  return mensagens
    .map((m, i) => {
      const autor = m.do_corretor ? "CORRETOR" : "CLIENTE";
      const midia = m.tipo !== "texto" ? ROTULO_MIDIA[m.tipo] ?? "[mídia]" : "";
      const texto = m.texto ? anonimizar(m.texto, nomes) : "";
      const conteudo = [midia, texto].filter(Boolean).join(" ") || "[mensagem sem texto]";
      return `#${inicio + i + 1} [${formatarData(m.enviada_em)}] ${autor}: ${conteudo}`;
    })
    .join("\n");
}
