import { describe, it, expect } from "vitest";

const PIX_DIFFICULTY_KEYWORDS = /(n[aã]o.*consig[ou].*pag|n[aã]o.*conseg.*pag|n[aã]o.*consigo.*fazer.*pag|n[aã]o.*consegui.*pag|n[aã]o.*passou|n[aã]o.*aceito[ua]?|n[aã]o.*aceita|n[aã]o.*funciono[ua]|problema.*pag|erro.*pag|erro.*totem|pag.*erro|pag.*n[aã]o.*foi|cobran[cç]a.*indevid|valor.*cobrado.*errado|cobrou.*errado|cobrou.*mais|cobrou.*a\s*mais|cobrou.*diferente|estorno|reembolso|devolu[cç][aã]o|totem.*n[aã]o|totem.*com.*defeito|totem.*erro|totem.*travou|totem.*desligad|cart[aã]o.*recus|cart[aã]o.*n[aã]o|pix.*n[aã]o.*funciono|pix.*erro|pix.*problema|dificuldade.*pag|n[aã]o.*conseg.*pix|n[aã]o.*consig.*pix|n[aã]o.*conseg.*fazer.*pag|n[aã]o.*estou.*conseguindo|n[aã]o.*t[aá].*conseguindo|n[aã]o.*consigo.*pix)/i;

describe("PIX_DIFFICULTY_KEYWORDS regex", () => {
  const shouldMatch = [
    "Não consigo fazer o pagamento",
    "não consegui pagar",
    "não consigo pagar no totem",
    "erro no totem",
    "totem travou",
    "totem com defeito",
    "totem não funciona",
    "cartão recusado",
    "cartão não passou",
    "o pagamento não foi",
    "problema no pagamento",
    "erro no pagamento",
    "cobrança indevida",
    "cobrou errado",
    "cobrou a mais",
    "cobrou diferente",
    "pix não funcionou",
    "pix erro",
    "pix problema",
    "dificuldade pagamento",
    "não estou conseguindo pagar",
    "não tá conseguindo",
    "não está conseguindo",
    "quero estorno",
    "quero reembolso",
    "devolução",
    "não consigo pix",
    "valor cobrado errado",
    "não aceita o cartão",
    "não aceitou",
    "não funcionou o pagamento",
    "não passou o cartão",
  ];

  const shouldNotMatch = [
    "quero pagar via pix",
    "me envia a chave pix",
    "oi, tudo bem?",
    "qual o preço?",
    "bom dia",
    "obrigado",
    "pode enviar a chave",
    "sim, quero pagar",
  ];

  for (const text of shouldMatch) {
    it(`✅ should match: "${text}"`, () => {
      expect(PIX_DIFFICULTY_KEYWORDS.test(text)).toBe(true);
    });
  }

  for (const text of shouldNotMatch) {
    it(`❌ should NOT match: "${text}"`, () => {
      expect(PIX_DIFFICULTY_KEYWORDS.test(text)).toBe(false);
    });
  }
});
