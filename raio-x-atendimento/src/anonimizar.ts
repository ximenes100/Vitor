// Remove dados pessoais do texto antes de enviar para a IA (LGPD: minimização de dados).
// Nomes do cliente e do corretor são trocados por papéis; documentos, contatos e links são mascarados.

const PADROES: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[cpf]"],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[cnpj]"],
  [/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]"],
  [/\b\d{5}-\d{3}\b/g, "[cep]"],
  [/https?:\/\/\S+/g, "[link]"],
  // Chave PIX aleatória (UUID)
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[chave-pix]"],
];

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function anonimizar(texto: string, nomes: { cliente?: string | null; corretor?: string | null } = {}): string {
  let saida = texto;
  for (const [padrao, troca] of PADROES) saida = saida.replace(padrao, troca);

  const trocarNome = (nomeCompleto: string | null | undefined, papel: string) => {
    if (!nomeCompleto) return;
    // Troca o nome completo e cada parte com 3+ letras (ex.: "Maria Souza" -> "Maria" e "Souza").
    const partes = [nomeCompleto, ...nomeCompleto.split(/\s+/)].filter((p) => p.length >= 3);
    for (const parte of partes) {
      saida = saida.replace(new RegExp(`(?<![\\p{L}])${escaparRegex(parte)}(?![\\p{L}])`, "giu"), papel);
    }
  };
  trocarNome(nomes.cliente, "[cliente]");
  trocarNome(nomes.corretor, "[corretor]");
  return saida;
}
