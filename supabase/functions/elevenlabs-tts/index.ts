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

function normalizeDecimalNumbers(text: string): string {
  // Handle decimal numbers like 3,5 or 2.5 (not already handled by currency/percentage)
  return text.replace(/\b(\d{1,7})[,.](\d{1,2})\b/g, (_match, intPart, decPart) => {
    const intNum = parseInt(intPart, 10);
    const decNum = parseInt(decPart, 10);
    if (intNum > 9999999) return _match;
    return numberToWords(intNum) + ' vírgula ' + numberToWords(decNum);
  });
}

function normalizeNumbers(text: string): string {
  // Standalone integers (not part of already-converted patterns)
  return text.replace(/\b(\d{1,7})\b/g, (_match, num) => {
    const n = parseInt(num, 10);
    if (n > 9999999) return num;
    return numberToWords(n);
  });
}

function normalizePhoneNumbers(text: string): string {
  // Spell out digits for phone numbers
  const DIGIT_WORDS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  return text.replace(/\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/g, (match) => {
    return match.replace(/\d/g, (d) => DIGIT_WORDS[parseInt(d)] + ' ');
  });
}

// ── English words commonly used in Brazilian Portuguese ──
const ENGLISH_PRONUNCIATIONS: Record<string, string> = {
  // Tech & business
  'WhatsApp': 'uótsapp',
  'whatsapp': 'uótsapp',
  'Instagram': 'instagrãm',
  'instagram': 'instagrãm',
  'Facebook': 'feicebuk',
  'facebook': 'feicebuk',
  'Google': 'gúgol',
  'google': 'gúgol',
  'YouTube': 'iutúbi',
  'youtube': 'iutúbi',
  'Twitter': 'tuíter',
  'twitter': 'tuíter',
  'TikTok': 'tiquetóque',
  'tiktok': 'tiquetóque',
  'LinkedIn': 'linquedín',
  'linkedin': 'linquedín',
  'iPhone': 'aifôni',
  'iphone': 'aifôni',
  'Android': 'androide',
  'Windows': 'uíndous',
  'Apple': 'épol',
  'Samsung': 'sãmçung',
  'Netflix': 'nétiflics',
  'Spotify': 'espotifái',
  'Uber': 'úber',
  'delivery': 'delivéri',
  'Delivery': 'delivéri',
  'online': 'onlaine',
  'Online': 'onlaine',
  'offline': 'oflaine',
  'Offline': 'oflaine',
  'Wi-Fi': 'uaifai',
  'wifi': 'uaifai',
  'WiFi': 'uaifai',
  'Wi-fi': 'uaifai',
  'website': 'uébissaite',
  'site': 'sáite',
  'link': 'linque',
  'links': 'linques',
  'Link': 'linque',
  'e-mail': 'iméil',
  'email': 'iméil',
  'Email': 'iméil',
  'E-mail': 'iméil',
  'login': 'lóguin',
  'Login': 'lóguin',
  'password': 'péssuord',
  'software': 'sóftuer',
  'hardware': 'rarduer',
  'backup': 'béquiap',
  'Backup': 'béquiap',
  'download': 'daunlôud',
  'upload': 'aplôud',
  'feedback': 'fídbéque',
  'Feedback': 'fídbéque',
  'layout': 'lêiaut',
  'design': 'dizáin',
  'Design': 'dizáin',
  'designer': 'dizáiner',
  'marketing': 'marquéting',
  'Marketing': 'marquéting',
  'freelancer': 'frílâncer',
  'startup': 'startap',
  'Startup': 'startap',
  'pitch': 'pítch',
  'budget': 'bâdjet',
  'deadline': 'dédlaine',
  'insight': 'insáite',
  'insights': 'insáites',
  'coach': 'côutch',
  'coaching': 'côutching',
  'performance': 'perfórmãnce',
  'benchmark': 'bêntchmarque',
  'branding': 'brénding',
  'target': 'társguit',
  'trend': 'trênd',
  'trends': 'trênds',
  'story': 'estóri',
  'stories': 'estóris',
  'Stories': 'estóris',
  'post': 'pôst',
  'posts': 'pôsts',
  'like': 'laike',
  'likes': 'laikes',
  'follow': 'fólou',
  'followers': 'fólouers',
  'hashtag': 'réshtag',
  'sticker': 'istíquer',
  'stickers': 'istíquers',
  'GIF': 'gif',
  'gif': 'gif',
  'live': 'laive',
  'Live': 'laive',
  'chat': 'tchét',
  'bot': 'bót',
  'Bot': 'bót',
  'chatbot': 'tchétbót',
  'token': 'tôquen',
  'tokens': 'tôquens',
  'app': 'épp',
  'apps': 'épps',
  'App': 'épp',
  'update': 'apdêite',
  'updates': 'apdêites',
  'feature': 'fítcher',
  'features': 'fítchers',
  'ok': 'oquei',
  'OK': 'oquei',
  'Ok': 'oquei',
  'check': 'tchéque',
  'checklist': 'tchéqueliste',
  'call': 'cól',
  'meeting': 'míting',
  'coworking': 'cou-uôrquing',
  'home office': 'rôme ófice',
  'home-office': 'rôme ófice',
  'weekend': 'uíquend',
  'happy hour': 'répi áuer',
  'show': 'chôu',
  'shopping': 'chóping',
  'Shopping': 'chóping',
  'fitness': 'fítnéss',
  'personal': 'persônau',
  'trainer': 'trêiner',
  'look': 'lúque',
  'fashion': 'féchion',
  'sale': 'sêil',
  'Sale': 'sêil',
  'black friday': 'bléque fraidêi',
  'Black Friday': 'bléque fraidêi',
  'voucher': 'váutcher',
  'cashback': 'quéchbéque',
  'Cashback': 'quéchbéque',
  'drive-thru': 'dráive trú',
  'self-service': 'sélfi sérvice',
  'drive': 'dráive',
  'web': 'uéb',
  'Web': 'uéb',
  'blog': 'blóg',
  'Blog': 'blóg',
  'podcast': 'pódcast',
  'Podcast': 'pódcast',
  'playlist': 'plêiliste',
  'streaming': 'estríming',
  'Streaming': 'estríming',
  'top': 'tóp',
  'Top': 'tóp',
  'VIP': 'víp',
  'vip': 'víp',
  'premium': 'prêmium',
  'Premium': 'prêmium',
  'free': 'frí',
  'Free': 'frí',
  'plus': 'plâs',
  'Plus': 'plâs',
  'pro': 'pró',
  'Pro': 'pró',
  'kit': 'quít',
  'Kit': 'quít',
  'stock': 'estóque',
  'input': 'ínput',
  'output': 'áutput',
  'status': 'stétus',
  'Status': 'stétus',
  'ticket': 'tíquete',
  'tickets': 'tíquetes',
  'SLA': 'ésse éle á',
  'CRM': 'cê érre ême',
  'ERP': 'ê érre pê',
  'API': 'á pê í',
  'dashboard': 'déchbord',
  'Dashboard': 'déchbord',
  'setup': 'setâp',
  'Setup': 'setâp',
  'reset': 'risét',
  'Reset': 'risét',
  // Atendimento & vendas
  'follow-up': 'fólou âp',
  'follow up': 'fólou âp',
  'upsell': 'âpssél',
  'cross-sell': 'cróss sél',
  'lead': 'líd',
  'leads': 'líds',
  'Lead': 'líd',
  'Leads': 'líds',
  'funil': 'funíl',
  'pipeline': 'páiplaine',
  'Pipeline': 'páiplaine',
  'churn': 'tchârn',
  'onboarding': 'onbôrding',
  'Onboarding': 'onbôrding',
  'outbound': 'áutbaund',
  'inbound': 'ínbaund',
  'customer success': 'câstomer sacéss',
  'helpdesk': 'rélpidésk',
  'suporte': 'supôrte',
  'workflow': 'uôrkflou',
  'Workflow': 'uôrkflou',
  'template': 'têmpleite',
  'templates': 'têmpleites',
  'Template': 'têmpleite',
  'Templates': 'têmpleites',
  'trigger': 'tríguer',
  'triggers': 'trícuers',
  'webhook': 'uéb rúque',
  'Webhook': 'uéb rúque',
  'endpoint': 'êndpóint',
  'paywall': 'pêiuól',
  'checkout': 'tchéquiaut',
  'Checkout': 'tchéquiaut',
  // Pagamentos & finanças
  'boleto': 'boléto',
  'QR code': 'quiú-ár côde',
  'QR Code': 'quiú-ár côde',
  'qr code': 'quiú-ár côde',
  'invoice': 'ínvoice',
  'refund': 'rífând',
  'gateway': 'guêituêi',
  'Gateway': 'guêituêi',
  'split': 'esplít',
  'royalties': 'roiáutis',
  'markup': 'márcâp',
  'fee': 'fí',
  'fees': 'fís',
  'spread': 'espréd',
  // Logística & operação
  'tracking': 'tréquing',
  'Tracking': 'tréquing',
  'rastreio': 'rastréio',
  'express': 'êxpréss',
  'Express': 'êxpréss',
  'pickup': 'picâp',
  'hub': 'râb',
  'Hub': 'râb',
  'last mile': 'lást máil',
  'supply chain': 'suplái tchêin',
  'shelf': 'chélf',
  'scanner': 'esquêner',
  'barcode': 'barcôde',
  // RH & gestão
  'headcount': 'réd-cáunt',
  'turnover': 'târnôver',
  'offboarding': 'ófbôrding',
  'compliance': 'complaiânce',
  'Compliance': 'complaiânce',
  'networking': 'nétuôrquing',
  'Networking': 'nétuôrquing',
  'brainstorm': 'brêinstôrm',
  'brainstorming': 'brêinstôrming',
  'mindset': 'máindisét',
  'skillset': 'esquíusét',
  'know-how': 'nôu ráu',
  'roadmap': 'rôdmépe',
  'Roadmap': 'rôdmépe',
  'sprint': 'esprinte',
  'Sprint': 'esprinte',
  'scrum': 'escrâm',
  'Scrum': 'escrâm',
  'kanban': 'canbân',
  'Kanban': 'canbân',
  'backlog': 'béquilóg',
  'Backlog': 'béquilóg',
  'standup': 'stêndup',
  'stand-up': 'stêndup',
  // Comunicação & mídia
  'influencer': 'influêncer',
  'influencers': 'influêncers',
  'engajamento': 'engajamênto',
  'reach': 'rítch',
  'awareness': 'auérness',
  'briefing': 'brífing',
  'Briefing': 'brífing',
  'banner': 'béner',
  'banners': 'béners',
  'flyer': 'fláier',
  'flyers': 'fláiers',
  'landing page': 'lénding pêidge',
  'Landing Page': 'lénding pêidge',
  'popup': 'pópâp',
  'pop-up': 'pópâp',
  'newsletter': 'niuzléter',
  'Newsletter': 'niuzléter',
  'spam': 'espâm',
  'Spam': 'espâm',
  'unsubscribe': 'ânsubscráibe',
  'opt-in': 'ópti ín',
  'opt-out': 'ópti áut',
  // Comida & varejo
  'combo': 'cômbo',
  'menu': 'mêniu',
  'snack': 'esnéque',
  'snacks': 'esnéques',
  'brownie': 'bráuni',
  'brownies': 'bráunis',
  'milkshake': 'míuquichêique',
  'smoothie': 'esmúdi',
  'sundae': 'sândei',
  'cupcake': 'câpquêique',
  'cupcakes': 'câpquêiques',
  'cookie': 'cúqui',
  'cookies': 'cúquis',
  'cheesecake': 'tchízkêique',
  'pancake': 'pãnquêique',
  'waffle': 'uóful',
  'waffles': 'uófuls',
  'wrap': 'répe',
  'wraps': 'répes',
  'burger': 'bârguer',
  'burgers': 'bârguers',
  'wings': 'uíngs',
  'steak': 'estêique',
  'toast': 'tôst',
  'brunch': 'brânch',
  'happy hour': 'répi áuer',
  // Saúde & bem-estar
  'wellness': 'uélness',
  'mindfulness': 'máindfulnéss',
  'pilates': 'pilátes',
  'crossfit': 'cróssfit',
  'Crossfit': 'cróssfit',
  'CrossFit': 'cróssfit',
  'personal trainer': 'persônau trêiner',
  'gym': 'djím',
  'spa': 'espá',
  'detox': 'ditócs',
  'skincare': 'esquínquer',
  'makeup': 'mêiquiâp',
  'make-up': 'mêiquiâp',
  'make up': 'mêiquiâp',
  // Moda & estilo
  'outfit': 'áutfit',
  'outfits': 'áutfits',
  'jeans': 'djíns',
  'sneakers': 'esnícuers',
  'vintage': 'víntage',
  'oversize': 'ôverssáize',
  'oversized': 'ôverssáized',
  'must-have': 'mâst rév',
  'must have': 'mâst rév',
  'streetwear': 'estrítuêr',
  'closet': 'clózet',
  // Imobiliário
  'loft': 'lóft',
  'penthouse': 'pêntráus',
  'flat': 'flét',
  'open house': 'ôpen ráus',
  'showroom': 'chôurúm',
  'Showroom': 'chôurúm',
  'rooftop': 'rúftóp',
  // Geral
  'sorry': 'sóri',
  'please': 'plíz',
  'thanks': 'thênqs',
  'amazing': 'amêizing',
  'awesome': 'óssum',
  'cool': 'cúl',
  'nice': 'náice',
  'wow': 'uáu',
  'yes': 'iés',
  'no': 'nôu',
  'bye': 'bái',
  'hi': 'rái',
  'hello': 'relôu',
  'sorry': 'sóri',
  'best seller': 'bést séler',
  'best-seller': 'bést séler',
  'hype': 'ráipe',
  'hot': 'rót',
  'cool': 'cúl',
  'crush': 'crâch',
  'spoiler': 'espóiler',
  'spoilers': 'espóilers',
  'selfie': 'sélfi',
  'selfies': 'sélfis',
  'drone': 'drôune',
  'drones': 'drôunes',
  'startup': 'startâp',
  'cofounder': 'co-fáunder',
  'co-founder': 'co-fáunder',
  'CEO': 'cê i ôu',
  'CFO': 'cê éfe ôu',
  'CTO': 'cê tê ôu',
  'COO': 'cê ôu ôu',
  'CMO': 'cê ême ôu',
  // Marcas de carros & nomes próprios frequentemente malpronunciados
  'Audi': 'áudi',
  'audi': 'áudi',
  'AUDI': 'áudi',
  'Hyundai': 'riundái',
  'hyundai': 'riundái',
  'Chevrolet': 'chevrôlé',
  'chevrolet': 'chevrôlé',
  'Peugeot': 'pejô',
  'peugeot': 'pejô',
  'Renault': 'renô',
  'renault': 'renô',
  'Citroën': 'citroén',
  'Porsche': 'pórche',
  'porsche': 'pórche',
  'Mercedes': 'mersêdes',
  'BMW': 'bê ême dáblio',
  'Volkswagen': 'fólquisváguen',
  'volkswagen': 'fólquisváguen',
  'Fiat': 'fiát',
  'fiat': 'fiát',
  'Jeep': 'djípe',
  'jeep': 'djípe',
  'Toyota': 'toiôta',
  'toyota': 'toiôta',
  'Nissan': 'níçan',
  'nissan': 'níçan',
  'Honda': 'rônda',
  'honda': 'rônda',
  'Mitsubishi': 'mitsubíchi',
  'Suzuki': 'suzúqui',
  'Subaru': 'subáru',
  'Volvo': 'vólvo',
  'Land Rover': 'lând rôver',
  'Range Rover': 'rêindj rôver',
  'B2B': 'bê tu bê',
  'B2C': 'bê tu cê',
  'ROI': 'érre ôu ái',
  'KPI': 'cá pê ái',
  'OKR': 'ôu quei ár',
  'MVP': 'ême vê pê',
  'SaaS': 'sás',
  'SAAS': 'sás',
};

const ACRONYMS: Record<string, string> = {
  'CPF': 'cê pê éfe',
  'CNPJ': 'cê ene pê jota',
  'RG': 'érre gê',
  'PIX': 'picks',
  'pix': 'picks',
  'Pix': 'picks',
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
  'GB': 'gigabáites',
  'MB': 'megabáites',
  'TB': 'terabáites',
  'NPS': 'ene pê ésse',
  'FAQ': 'éfe á quê',
  'IOF': 'í ô éfe',
  'IPTU': 'í pê tê ú',
  'IPVA': 'í pê vê á',
  'IR': 'í érre',
  'PJ': 'pê jota',
  'PF': 'pê éfe',
  'CNAE': 'cê ene á ê',
  'DAS': 'dás',
};

// Common Portuguese words that happen to be ALL CAPS but should NOT be spelled out
const COMMON_WORDS_UPPER = new Set([
  'EU', 'TU', 'ELE', 'ELA', 'NOS', 'VOS', 'NÃO', 'SIM', 'JÁ', 'DE', 'DO', 'DA', 'EM', 'NO', 'NA',
  'UM', 'UMA', 'SE', 'OU', 'QUE', 'COM', 'POR', 'AO', 'OS', 'AS', 'DOS', 'DAS', 'NOS', 'NAS',
  'MAS', 'ATÉ', 'SÓ', 'VAI', 'VEM', 'FEZ', 'BOM', 'BOA', 'MAU', 'MAL',
]);

function normalizeEnglishWords(text: string): string {
  // Replace known English words with phonetic Portuguese equivalents
  // Process longer phrases first, then single words
  const entries = Object.entries(ENGLISH_PRONUNCIATIONS).sort((a, b) => b[0].length - a[0].length);
  for (const [eng, ptBr] of entries) {
    // Use word boundary for single words, looser match for phrases with spaces/hyphens
    if (eng.includes(' ') || eng.includes('-')) {
      text = text.replace(new RegExp(eng.replace(/[-\s]/g, '[-\\s]'), 'gi'), ptBr);
    } else {
      text = text.replace(new RegExp(`\\b${eng}\\b`, 'g'), ptBr);
    }
  }
  return text;
}

function normalizeAcronyms(text: string): string {
  // First pass: known acronyms
  for (const [acronym, spoken] of Object.entries(ACRONYMS)) {
    const regex = new RegExp(`\\b${acronym.replace('.', '\\.')}\\b`, 'g');
    text = text.replace(regex, spoken);
  }
  // Second pass: unknown ALL CAPS 2-4 letter words → spell out (unless common PT word)
  text = text.replace(/\b([A-Z]{2,4})\b/g, (match) => {
    if (ACRONYMS[match]) return ACRONYMS[match];
    if (COMMON_WORDS_UPPER.has(match)) return match;
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
    .replace(/\n+/g, '. ') // line breaks → sentence end (natural pause)
    .replace(/\s{2,}/g, ' ');
}

function insertBreathingPauses(text: string): string {
  let result = text;
  
  // Add micro-pauses with commas at natural clause boundaries for human-like rhythm
  // After conjunctions followed by longer clauses
  result = result.replace(/\b(mas|porém|então|porque|pois|quando|enquanto|embora)\s+/gi, '$1, ');
  
  // Add natural pause after greetings/interjections
  result = result.replace(/^(oi|olá|bom dia|boa tarde|boa noite|tudo bem|e aí)\b/gi, '$1, ');
  
  // Ensure sentence endings have proper spacing for natural pause
  result = result.replace(/([.!?])\s+/g, '$1 ');
  
  // Replace ellipsis with a natural pause marker
  result = result.replace(/\.{3,}/g, '... ');
  
  // Remove double commas that might have been created
  result = result.replace(/,\s*,/g, ',');
  
  return result;
}

// ── Clean up markdown and formatting artifacts ──
function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold** → just text
    .replace(/\*(.*?)\*/g, '$1')       // *italic* → just text
    .replace(/__(.*?)__/g, '$1')       // __underline__ → just text
    .replace(/~~(.*?)~~/g, '$1')       // ~~strikethrough~~ → just text
    .replace(/`(.*?)`/g, '$1')         // `code` → just text
    .replace(/^[-•]\s+/gm, '')         // bullet points → remove
    .replace(/^\d+\.\s+/gm, '')        // numbered lists → remove
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // [link text](url) → just text
    .replace(/>\s+/g, '')              // > blockquotes → remove
    .trim();
}

// ── Time normalization: 14:30 → quatorze e trinta ──
function normalizeTime(text: string): string {
  return text.replace(/\b(\d{1,2}):(\d{2})\b/g, (_match, h, m) => {
    const hours = parseInt(h, 10);
    const minutes = parseInt(m, 10);
    if (hours > 23 || minutes > 59) return _match;
    let result = numberToWords(hours) + ' hora' + (hours !== 1 ? 's' : '');
    if (minutes > 0) {
      result += ' e ' + numberToWords(minutes) + ' minuto' + (minutes !== 1 ? 's' : '');
    }
    return result;
  });
}

// ── Date normalization: 15/03/2024 → quinze de março de dois mil e vinte e quatro ──
function normalizeDates(text: string): string {
  const MONTHS = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return text.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (_match, d, m, y) => {
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return _match;
    let result = numberToWords(day) + ' de ' + MONTHS[month];
    if (y) {
      let year = parseInt(y, 10);
      if (year < 100) year += 2000;
      result += ' de ' + numberToWords(year);
    }
    return result;
  });
}

function normalizeTextForTTS(text: string): string {
  let normalized = text;
  normalized = cleanMarkdown(normalized);
  normalized = normalizeEnglishWords(normalized);
  normalized = normalizeCurrency(normalized);
  normalized = normalizePercentages(normalized);
  normalized = normalizeOrdinals(normalized);
  normalized = normalizeAcronyms(normalized);
  normalized = normalizePhoneNumbers(normalized);
  normalized = normalizeTime(normalized);
  normalized = normalizeDates(normalized);
  normalized = normalizeDecimalNumbers(normalized);
  normalized = normalizeNumbers(normalized);
  normalized = normalizeSymbols(normalized);
  normalized = insertBreathingPauses(normalized);
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
    const selectedModel = model || "eleven_turbo_v2_5";
    const format = outputFormat || "mp3_44100_128";

    // ── Normalize text for natural pronunciation ──
    const normalizedText = normalizeTextForTTS(text);
    console.log("[TTS] Original:", text.substring(0, 100));
    console.log("[TTS] Normalized:", normalizedText.substring(0, 100));

    const body: any = {
      text: normalizedText,
      model_id: selectedModel,
    };

    // Voice settings optimized for maximum humanization in Portuguese
    // Low stability = more expressive variation (human-like inflections)
    // Higher style = more emotional range and prosody variation
    // Speed slightly under 1.0 = more deliberate, natural pacing
    body.voice_settings = {
      stability: voiceSettings?.stability ?? 0.25,
      similarity_boost: voiceSettings?.similarity_boost ?? 0.72,
      style: voiceSettings?.style ?? 0.55,
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
