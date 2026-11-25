// Versão da IA para quando o FotoCal roda dentro do claude.ai (Artifact):
// usa o Claude da conta de quem está usando, sem chave da API.
// O build-artifact.py troca o ai.js por este arquivo.

export class ScanError extends Error {}

export const needsKey = false;
export const useServiceWorker = false;

const sampleReady = (window.claude?.use ? window.claude.use("sample") : Promise.resolve(null)).catch(() => null);

const PROMPT = `Você é um nutricionista que estima calorias a partir de fotos de refeições, para um app brasileiro de contagem de calorias.
A imagem anexada é a foto de uma refeição.
Identifique cada alimento visível separadamente, estime a porção pelo tamanho do prato, talheres e outros objetos de referência, e calcule calorias e macronutrientes com base em tabelas como a TACO e a USDA.
Considere preparos típicos brasileiros (arroz branco, feijão carioca, farofa, óleo de cozimento) quando forem os mais prováveis.
Seja realista: não subestime óleo, manteiga, molhos e frituras.
Escreva tudo em português do Brasil.

Responda SOMENTE com um objeto JSON neste formato:
{"e_comida": true, "prato": "Frango com arroz e feijão", "observacao": "dica curta ou ressalva, ou vazio",
 "itens": [{"nome": "Arroz branco", "porcao_estimada": "4 colheres de sopa", "gramas": 100, "calorias": 128, "proteina_g": 2.5, "carboidratos_g": 28.1, "gorduras_g": 0.2}]}

Se a foto não mostrar comida, responda {"e_comida": false, "prato": "", "itens": [], "observacao": "<explique>"}.`;

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

export async function analyzeFoodPhoto({ dataUrl, profile }) {
  const sample = await sampleReady;
  if (!sample) throw new ScanError("Abra o FotoCal pelo claude.ai (ou pelo app do Claude) para analisar fotos.");
  const limits = await sample.limits().catch(() => null);
  if (!limits?.images) throw new ScanError("Este aparelho ou visualizador não permite enviar fotos ao Claude.");

  const goal = { perder: "perder peso", manter: "manter o peso", ganhar: "ganhar peso" }[profile?.goal];
  let parsed;
  try {
    parsed = await sample.json(PROMPT + (goal ? `\n\n(A pessoa quer ${goal}.)` : ""), {
      images: await dataUrlToBlob(dataUrl),
      modelTier: "default",
    });
  } catch (e) {
    throw new ScanError(friendly(e?.code));
  }
  if (!parsed || typeof parsed !== "object") throw new ScanError("Resposta inesperada da IA. Tente novamente.");
  parsed.e_comida = parsed.e_comida !== false;
  parsed.prato = String(parsed.prato || "");
  parsed.observacao = String(parsed.observacao || "");
  parsed.itens = (Array.isArray(parsed.itens) ? parsed.itens : []).map((it) => ({
    nome: String(it?.nome || "Alimento"),
    porcao_estimada: String(it?.porcao_estimada || ""),
    gramas: Math.max(0, +it?.gramas || 0),
    calorias: Math.max(0, +it?.calorias || 0),
    proteina_g: Math.max(0, +it?.proteina_g || 0),
    carboidratos_g: Math.max(0, +it?.carboidratos_g || 0),
    gorduras_g: Math.max(0, +it?.gorduras_g || 0),
  }));
  return parsed;
}

function friendly(code) {
  switch (code) {
    case "not_granted": return "Você não permitiu que o FotoCal use o Claude. Recarregue a página para permitir.";
    case "rate_limited": return "Muitas análises seguidas ou limite de uso atingido. Tente de novo mais tarde.";
    case "session_expired": return "Sua sessão expirou. Entre de novo no claude.ai.";
    case "image_rejected": return "Não consegui abrir essa imagem. Tente outra foto (JPG ou PNG).";
    case "images_unavailable": return "Este aparelho ou visualizador não permite enviar fotos ao Claude.";
    case "sampling_disabled": return "O Claude não está disponível para esta conta.";
    case "refused": return "A IA não conseguiu analisar esta imagem. Tente outra foto do prato.";
    case "invalid_json": case "empty_completion": return "A resposta veio incompleta. Tente novamente.";
    case "cancelled": return "Análise cancelada.";
    default: return "Falha temporária ao analisar a foto. Tente novamente.";
  }
}
