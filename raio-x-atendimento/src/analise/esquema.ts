import { z } from "zod";
import { ETAPAS } from "../funil.js";

export const CRITERIOS = [
  "velocidade",
  "rapport",
  "qualificacao",
  "descoberta_necessidade",
  "apresentacao_imoveis",
  "conducao_visita",
  "objecoes",
  "proximo_passo",
  "followup",
  "comunicacao",
] as const;
export type Criterio = (typeof CRITERIOS)[number];

export const NOME_CRITERIO: Record<Criterio, string> = {
  velocidade: "Velocidade de resposta",
  rapport: "Relacionamento",
  qualificacao: "Qualificação",
  descoberta_necessidade: "Descoberta da necessidade",
  apresentacao_imoveis: "Apresentação de imóveis",
  conducao_visita: "Condução para visita",
  objecoes: "Tratamento de objeções",
  proximo_passo: "Próximo passo",
  followup: "Follow-up",
  comunicacao: "Comunicação",
};

export const CATEGORIAS_PERDA = [
  "nenhuma",
  "demora_resposta",
  "sem_qualificacao",
  "imoveis_sem_entender_necessidade",
  "sem_convite_visita",
  "objecao_mal_tratada",
  "sem_proximo_passo",
  "sem_followup",
  "followup_sem_valor",
  "comunicacao_confusa",
  "cliente_sem_perfil",
  "comprou_com_concorrente",
  "outro",
] as const;
export type CategoriaPerda = (typeof CATEGORIAS_PERDA)[number];

export const NOME_CATEGORIA_PERDA: Record<CategoriaPerda, string> = {
  nenhuma: "Sem travamento",
  demora_resposta: "Demora para responder",
  sem_qualificacao: "Não qualificou o cliente",
  imoveis_sem_entender_necessidade: "Mandou imóveis sem entender a necessidade",
  sem_convite_visita: "Não convidou para visita",
  objecao_mal_tratada: "Objeção mal tratada",
  sem_proximo_passo: "Conversa terminou sem próximo passo",
  sem_followup: "Não fez follow-up",
  followup_sem_valor: "Follow-up sem valor (\"alguma novidade?\")",
  comunicacao_confusa: "Comunicação confusa",
  cliente_sem_perfil: "Cliente sem perfil",
  comprou_com_concorrente: "Comprou com concorrente",
  outro: "Outro motivo",
};

export const TriagemSchema = z.object({
  tipo: z
    .enum(["cliente", "pessoal", "outro"])
    .describe("cliente = atendimento imobiliário a um cliente ou lead; pessoal = família, amigos, assuntos pessoais; outro = colegas, parceiros, fornecedores, proprietários captando"),
  motivo: z.string().describe("Uma frase curta justificando"),
});
export type Triagem = z.infer<typeof TriagemSchema>;

const texto = (d: string) => z.string().nullable().describe(d);

export const USO_IA = ["nenhum", "uso_personalizado", "uso_generico"] as const;
export type UsoIa = (typeof USO_IA)[number];
export const NOME_USO_IA: Record<UsoIa, string> = {
  nenhum: "Sem indícios de IA",
  uso_personalizado: "IA bem usada (personalizada)",
  uso_generico: "IA mal usada (texto genérico)",
};

export const AnaliseSchema = z.object({
  etapa: z.enum(ETAPAS).describe("Etapa atual do funil em que o cliente está"),
  confianca_etapa: z.enum(["alta", "media", "baixa"]),
  resumo: z.string().describe("2 a 3 frases: quem é o cliente, o que busca e como está a negociação"),
  perfil_cliente: z.object({
    objetivo: texto("morar, investir, alugar... ou null se não descoberto"),
    tipo_imovel: texto("tipo de imóvel buscado"),
    regiao: texto("bairros/regiões de interesse"),
    orcamento: texto("faixa de valor"),
    pagamento: texto("à vista, financiamento, FGTS, permuta..."),
    prazo: texto("quando pretende comprar/mudar"),
    decisores: texto("quem decide junto"),
  }),
  notas: z
    .array(
      z.object({
        criterio: z.enum(CRITERIOS),
        nota: z.number().nullable().describe("0 a 10; null quando o critério não se aplica a esta conversa"),
        evidencia: z.string().describe("Referência às mensagens (#número) e citação curta que justificam a nota"),
        comentario: z.string().describe("O que foi bem ou mal, em uma frase"),
      }),
    )
    .describe("Uma entrada para cada um dos 10 critérios"),
  nota_geral: z.number().describe("0 a 10, visão geral do atendimento"),
  ponto_de_perda: z.object({
    categoria: z.enum(CATEGORIAS_PERDA).describe("Principal motivo de a conversa ter travado/esfriado; 'nenhuma' se está avançando bem"),
    mensagem: z.number().nullable().describe("Número (#) da mensagem onde a conversa começou a travar"),
    descricao: z.string().describe("O que aconteceu nesse momento, em 1-2 frases"),
  }),
  pontos_fortes: z.array(z.string()).describe("Até 3 coisas que o corretor fez bem"),
  uso_ia: z.object({
    indicio: z
      .enum(USO_IA)
      .describe(
        "Indício de que o corretor escreveu mensagens com ajuda de IA (texto muito estruturado, formal, longo, com listas ou linguagem padronizada). " +
          "uso_personalizado = parece IA, mas adaptado ao que o cliente disse; uso_generico = parece texto pronto, sem ligação com a conversa; nenhum = sem indícios",
      ),
    mensagens: z.array(z.number()).describe("Números (#) das mensagens do corretor com esses indícios"),
    comentario: z.string().describe("Uma frase: o uso ajudou ou atrapalhou o atendimento?"),
  }),
  ligacao: z.object({
    recomendada: z.boolean().describe("true se uma ligação teria ajudado nesta semana (objeção, cliente indeciso, mensagens longas do cliente, negociação)"),
    mensagem: z.number().nullable().describe("Número (#) da mensagem em que valia ligar"),
    motivo: z.string(),
  }),
  objecoes: z.array(z.string()).describe("Objeções do cliente nesta semana, em poucas palavras cada (ex.: 'preço acima do orçamento')"),
  perguntas_cliente: z.array(z.string()).describe("Principais perguntas do cliente nesta semana, resumidas"),
  melhor_mensagem: z
    .object({
      mensagem: z.number().describe("Número (#) da mensagem do corretor"),
      por_que_funcionou: z.string(),
    })
    .nullable()
    .describe("Uma mensagem do corretor desta semana que serve de bom exemplo para treinar o time; null se nenhuma se destaca"),
  dicas: z
    .array(
      z.object({
        titulo: z.string(),
        o_que_aconteceu: z.string().describe("Cite a mensagem (#número)"),
        como_fazer: z.string(),
        exemplo_mensagem: z.string().describe("Mensagem pronta, no tom de WhatsApp, que o corretor poderia ter enviado"),
      }),
    )
    .describe("As 3 dicas mais importantes, da mais impactante para a menos"),
  cliente_aguarda_resposta: z
    .boolean()
    .describe("true se a última mensagem é do cliente e pede ou espera retorno (pergunta, pedido, dúvida). false se o corretor falou por último ou se o cliente só encerrou (\"ok\", \"combinado\", \"obrigado\")"),
  proximo_passo: z
    .object({
      acao: z.string(),
      mensagem_sugerida: z.string().describe("Mensagem pronta para o corretor enviar agora"),
      urgencia: z.enum(["alta", "media", "baixa"]),
    })
    .nullable()
    .describe("null se o negócio já fechou ou foi perdido em definitivo"),
});
export type Analise = z.infer<typeof AnaliseSchema>;

export const RelatorioCorretorSchema = z.object({
  resumo_semana: z.string().describe("2 a 3 frases sobre os atendimentos da semana"),
  tendencia: z.enum(["melhorando", "estavel", "piorando", "sem_dados"]),
  evolucao: z.string().describe("Comparação com antes do marco de uso de IA e com as últimas semanas, citando números"),
  pontos_fortes: z.array(z.string()).describe("Até 3"),
  focos: z
    .array(
      z.object({
        titulo: z.string(),
        por_que: z.string().describe("O que se repetiu nas conversas, citando os códigos das conversas (ex.: C123)"),
        como_fazer: z.string(),
        exemplo_mensagem: z.string().describe("Mensagem pronta no tom de WhatsApp"),
      }),
    )
    .describe("Os 3 pontos mais importantes para a próxima semana"),
  dicas_ia: z
    .array(
      z.object({
        titulo: z.string(),
        como_fazer: z.string(),
        exemplo_prompt: z.string().describe("Pedido pronto para o corretor colar no Claude, com espaços como [cole aqui a conversa]"),
      }),
    )
    .describe("1 a 3 dicas de como usar melhor a IA no atendimento, baseadas no que foi visto"),
  dicas_ligacao: z
    .array(z.object({ situacao: z.string(), recomendacao: z.string() }))
    .describe("Situações da semana em que ligar ou falar pessoalmente teria ajudado, com orientação de como conduzir a ligação"),
  mensagem_whatsapp: z
    .string()
    .describe("Resumo para enviar ao corretor no WhatsApp: até 900 caracteres, tom de gestor que apoia, com *negrito* do WhatsApp, sem citar códigos de conversa"),
});
export type RelatorioCorretor = z.infer<typeof RelatorioCorretorSchema>;

export const RelatorioTimeSchema = z.object({
  resumo_executivo: z.string().describe("4 a 6 frases para a diretoria"),
  efeito_ia: z.object({
    conclusao: z.string().describe("O atendimento melhorou depois do marco de uso de IA? Seja honesto sobre o tamanho da amostra e outros fatores"),
    evidencias: z.array(z.string()),
    corretores_evoluindo: z.array(z.string()).describe("Nomes"),
    corretores_estagnados: z.array(z.string()).describe("Nomes de quem não evoluiu ou piorou"),
  }),
  onde_perdemos: z.array(z.object({ tema: z.string(), dimensao: z.string().describe("Quantas conversas, % etc."), recomendacao: z.string() })),
  objecoes_frequentes: z.array(z.object({ objecao: z.string(), como_responder: z.string() })),
  perguntas_frequentes: z.array(z.object({ pergunta: z.string(), sugestao: z.string().describe("Como o time pode se preparar ou que material criar") })),
  boas_praticas: z
    .array(z.object({ titulo: z.string(), corretor: z.string(), exemplo: z.string().describe("A mensagem real, como foi enviada"), por_que_funciona: z.string() }))
    .describe("Exemplos reais da semana para usar em treinamento"),
  uso_ia: z.object({
    diagnostico: z.string().describe("Como o time está usando a IA, pelo que se vê nas conversas"),
    recomendacoes: z.array(z.string()),
  }),
  treinamentos_sugeridos: z.array(z.object({ tema: z.string(), para_quem: z.string(), formato: z.string() })),
  alertas: z.array(z.string()).describe("Riscos que pedem ação do gestor (clientes quentes abandonados, quedas bruscas etc.)"),
});
export type RelatorioTime = z.infer<typeof RelatorioTimeSchema>;
