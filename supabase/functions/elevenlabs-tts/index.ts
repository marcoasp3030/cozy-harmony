import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Portuguese Text Normalization for TTS ──

const UNITS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function numberToWords(n: number): string {
  if (n === 0) return 'zero';
  if (n === 100) return 'cem';
  if (n < 0) return 'menos ' + numberToWords(-n);

  const parts: string[] = [];

  if (n >= 1000000) {
    const millions = Math.floor(n / 1000000);
    parts.push(millions === 1 ? 'um milhão' : numberToWords(millions) + ' milhões');
    n %= 1000000;
    if (n > 0) parts.push(n < 100 ? 'e' : '');
  }

  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    parts.push(thousands === 1 ? 'mil' : numberToWords(thousands) + ' mil');
    n %= 1000;
    if (n > 0) parts.push(n < 100 ? 'e' : '');
  }

  if (n >= 100) {
    if (n === 100) { parts.push('cem'); return parts.join(' '); }
    parts.push(HUNDREDS[Math.floor(n / 100)]);
    n %= 100;
    if (n > 0) parts.push('e');
  }

  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]);
    n %= 10;
    if (n > 0) parts.push('e ' + UNITS[n]);
  } else if (n >= 10) {
    parts.push(TEENS[n - 10]);
  } else if (n > 0) {
    parts.push(UNITS[n]);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeCurrency(text: string): string {
  // R$ 1.234,56 or R$1234.56 etc.
  return text.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)/g, (_match, value) => {
    const cleaned = value.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    const reais = Math.floor(num);
    const centavos = Math.round((num - reais) * 100);

    let result = '';
    if (reais > 0) {
      result += numberToWords(reais) + (reais === 1 ? ' real' : ' reais');
    }
    if (centavos > 0) {
      if (reais > 0) result += ' e ';
      result += numberToWords(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
    }
    return result || 'zero reais';
  });
}

function normalizePercentages(text: string): string {
  return text.replace(/(\d+(?:[,.]\d+)?)\s?%/g, (_match, num) => {
    const cleaned = num.replace(',', '.');
    const val = parseFloat(cleaned);
    if (Number.isInteger(val)) return numberToWords(val) + ' por cento';
    const intPart = Math.floor(val);
    const decPart = Math.round((val - intPart) * 10);
    return numberToWords(intPart) + ' vírgula ' + numberToWords(decPart) + ' por cento';
  });
}

function normalizeNumbers(text: string): string {
  // Standalone numbers (not part of currency/percentage already converted)
  return text.replace(/\b(\d{1,7})\b/g, (_match, num) => {
    const n = parseInt(num, 10);
    if (n > 9999999) return num; // too large, keep as-is
    return numberToWords(n);
  });
}

function normalizePhoneNumbers(text: string): string {
  // Common BR phone patterns: (11) 99999-9999 or 11999999999
  return text.replace(/\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/g, (match) => {
    return match.replace(/\d/g, (d) => UNITS[parseInt(d)] || d).split('').join(' ');
  });
}

const ACRONYMS: Record<string, string> = {
  'CPF': 'cê pê éfe',
  'CNPJ': 'cê ene pê jota',
  'RG': 'érre gê',
  'PIX': 'picks',
  'CEO': 'cê i ôu',
  'TI': 'tê í',
  'RH': 'érre agá',
  'SMS': 'ésse ême ésse',
  'PDF': 'pê dê éfe',
  'CEP': 'cê ê pê',
  'ONG': 'ô ene gê',
  'SUS': 'ésse ú ésse',
  'INSS': 'í ene ésse ésse',
  'FGTS': 'éfe gê tê ésse',
  'CLT': 'cê éle tê',
  'MEI': 'mêi',
  'LTDA': 'limitada',
  'S.A.': 'ésse á',
  'SA': 'ésse á',
  'KG': 'quilos',
  'kg': 'quilos',
  'KM': 'quilômetros',
  'km': 'quilômetros',
  'ML': 'mililitros',
  'ml': 'mililitros',
  'GB': 'gigabytes',
  'MB': 'megabytes',
  'TB': 'terabytes',
};

function normalizeAcronyms(text: string): string {
  for (const [acronym, spoken] of Object.entries(ACRONYMS)) {
    const regex = new RegExp(`\\b${acronym.replace('.', '\\.')}\\b`, 'g');
    text = text.replace(regex, spoken);
  }
  // Generic: all-caps 2-4 letter words not in dictionary → spell out
  text = text.replace(/\b([A-Z]{2,4})\b/g, (match) => {
    if (ACRONYMS[match]) return ACRONYMS[match]; // already handled
    const letters: Record<string, string> = {
      'A':'á','B':'bê','C':'cê','D':'dê','E':'ê','F':'éfe','G':'gê','H':'agá',
      'I':'í','J':'jota','K':'cá','L':'éle','M':'ême','N':'ene','O':'ó','P':'pê',
      'Q':'quê','R':'érre','S':'ésse','T':'tê','U':'ú','V':'vê','W':'dáblio',
      'X':'xis','Y':'ípsilon','Z':'zê',
    };
    return match.split('').map(c => letters[c] || c).join(' ');
  });
  return text;
}

function normalizeOrdinals(text: string): string {
  const ordMap: Record<string, string> = {
    '1º': 'primeiro', '2º': 'segundo', '3º': 'terceiro', '4º': 'quarto', '5º': 'quinto',
    '6º': 'sexto', '7º': 'sétimo', '8º': 'oitavo', '9º': 'nono', '10º': 'décimo',
    '1ª': 'primeira', '2ª': 'segunda', '3ª': 'terceira', '4ª': 'quarta', '5ª': 'quinta',
    '6ª': 'sexta', '7ª': 'sétima', '8ª': 'oitava', '9ª': 'nona', '10ª': 'décima',
  };
  for (const [ord, spoken] of Object.entries(ordMap)) {
    text = text.replaceAll(ord, spoken);
  }
  return text;
}

function normalizeSymbols(text: string): string {
  return text
    .replace(/&/g, ' e ')
    .replace(/@/g, ' arroba ')
    .replace(/\+/g, ' mais ')
    .replace(/=/g, ' igual ')
    .replace(/\//g, ' barra ')
    .replace(/#/g, ' hashtag ')
    .replace(/\*/g, '') // remove asterisks (bold markup)
    .replace(/_/g, ' ') // remove underscores
    .replace(/\n+/g, '... ') // line breaks → pauses
    .replace(/\s{2,}/g, ' ');
}

function normalizeTextForTTS(text: string): string {
  let normalized = text;
  normalized = normalizeCurrency(normalized);
  normalized = normalizePercentages(normalized);
  normalized = normalizeOrdinals(normalized);
  normalized = normalizeAcronyms(normalized);
  normalized = normalizePhoneNumbers(normalized);
  normalized = normalizeNumbers(normalized);
  normalized = normalizeSymbols(normalized);
  return normalized.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { text, voiceId, model, outputFormat, voiceSettings } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: "Texto é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load ElevenLabs API key from user settings
    const { data: settings } = await supabase
      .from("settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "elevenlabs")
      .single();

    const apiKey = (settings?.value as any)?.apiKey;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API Key ElevenLabs não configurada. Vá em Configurações → ElevenLabs." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const selectedVoice = voiceId || "EXAVITQu4vr4xnSDxMaL";
    const selectedModel = model || "eleven_multilingual_v2";
    const format = outputFormat || "mp3_44100_128";

    // ── Normalize text for natural pronunciation ──
    const normalizedText = normalizeTextForTTS(text);
    console.log("[TTS] Original:", text.substring(0, 100));
    console.log("[TTS] Normalized:", normalizedText.substring(0, 100));

    const body: any = {
      text: normalizedText,
      model_id: selectedModel,
    };

    // Default voice settings optimized for natural, humanized speech in Portuguese
    body.voice_settings = {
      stability: voiceSettings?.stability ?? 0.3,
      similarity_boost: voiceSettings?.similarity_boost ?? 0.75,
      style: voiceSettings?.style ?? 0.5,
      use_speaker_boost: voiceSettings?.use_speaker_boost ?? true,
      speed: voiceSettings?.speed ?? 0.95,
    };

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}?output_format=${format}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("ElevenLabs TTS error:", resp.status, errText);
      return new Response(
        JSON.stringify({ error: `Erro na API ElevenLabs (${resp.status}). Verifique sua API Key e cota.` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await resp.arrayBuffer();
    const audioBase64 = base64Encode(audioBuffer);

    return new Response(
      JSON.stringify({ audioContent: audioBase64, format }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("elevenlabs-tts error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
