/**
 * Parser para o Bilhete de Identidade de Moçambique.
 * Recebe o texto bruto do OCR e extrai os campos estruturados.
 */

/**
 * Limpa texto OCR — remove caracteres espúrios comuns.
 */
function clean(text) {
  return text
    .replace(/[|]/g, 'I')
    .replace(/[`'']/g, "'")
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Extrai número de BI moçambicano.
 * Formato real: 12345678910 B (11 dígitos + espaço + letra) ou variantes OCR.
 * Também aceita formatos antigos: 123456789L001MZ
 */
function extractBiNumber(text) {
  // Procura a linha/contexto após "N.º BI", "Nº BI", "BILHETE", "DOCUMENTO Nº", "IDENTITY No"
  const labelMatch = text.match(/(?:N[°º.]?\s*(?:DE\s*)?(?:BI|BILHETE|IDENTIDADE|IDENTITY)[^\n:]*[:.\s]+)([0-9]{5,12}[\s\-]*[A-Z]?)/i);
  if (labelMatch) {
    const raw = labelMatch[1].replace(/\s+/g, '').trim();
    if (raw.length >= 5) return raw;
  }
  // Formato moçambicano moderno: 11 dígitos + letra (ex: 12345678910B)
  const modernMatch = text.match(/\b(\d{11}[A-Z])\b/);
  if (modernMatch) return modernMatch[1];
  // Formato alternativo: 9 dígitos + letra + 3 dígitos + 2 letras (antigo)
  const oldMatch = text.match(/\b(\d{8,9}[A-Z]\d{3}[A-Z]{2})\b/);
  if (oldMatch) return oldMatch[1];
  // Formato longo com espaços: 12345678 9 A 001 MZ
  const longMatch = text.match(/(\d{8,9})\s+([A-Z])\s+(\d{3})\s+([A-Z]{2})\b/);
  if (longMatch) return longMatch[1] + longMatch[2] + longMatch[3] + longMatch[4];
  // Sequência numérica longa isolada (≥9 dígitos) próxima de "BI" ou no início do documento
  const numOnly = text.match(/(?:N[°º\s]*BI|BILHETE)[^\n]{0,20}?(\d{6,12})/i);
  if (numOnly) return numOnly[1].trim();
  return null;
}

/**
 * Extrai o nome completo do titular (não do pai/mãe).
 * Estrutura do BI MZ:
 *   APELIDO / SURNAME → <apelido>
 *   NOME / NAME (ou OUTROS NOMES) → <nome próprio>
 *   FILIAÇÃO / FATHER'S NAME → <pai>  ← deve ser ignorado
 * Estratégia: combinar APELIDO + NOME, parar antes de FILIAÇÃO.
 */
function extractName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let apelido = null;
  let nomesProprios = null;

  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toUpperCase();

    // Parar quando chegar à filiação
    if (/FILIA[ÇC][AÃ]O|FATHER|MOTHER|M[AÃ]E/.test(upper)) break;

    // Capturar apelido
    if (/^APELIDO|^SURNAME/.test(upper) && !apelido) {
      const same = lines[i].replace(/^(APELIDO|SURNAME)[^A-ZÀ-Ö]*/i, '').trim();
      if (same.length > 1) { apelido = capitalise(same); continue; }
      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (/^[A-ZÀ-Ö]{2,}/.test(next) && !/NOME|NAME|DATA|SEXO|BI\b/.test(next.toUpperCase())) {
          apelido = capitalise(next);
        }
      }
    }

    // Capturar nome próprio — "NOME" mas NÃO "NOME DO PAI/MÃE" nem "NOME DA MÃE"
    if (/^NOME\b|^NAME\b|^OUTROS NOMES|^OTHER NAMES/.test(upper) && !nomesProprios) {
      if (/PAI|M[AÃ]E|FATHER|MOTHER/.test(upper)) continue; // ignorar filiação
      const same = lines[i].replace(/^(NOME|NAME|OUTROS NOMES|OTHER NAMES)[^A-ZÀ-Ö]*/i, '').trim();
      if (same.length > 1) { nomesProprios = capitalise(same); continue; }
      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (/^[A-ZÀ-Ö]{2,}/.test(next) && !/^FILIA|^FATHER|^MOTHER|^DATA|^SEXO/.test(next.toUpperCase())) {
          nomesProprios = capitalise(next);
        }
      }
    }
  }

  if (apelido && nomesProprios) return `${nomesProprios} ${apelido}`;
  if (nomesProprios) return nomesProprios;
  if (apelido) return apelido;
  return null;
}

/**
 * Extrai género (M/F).
 */
function extractGender(text) {
  const m = text.match(/SEXO[^A-Z]*([MF])\b/i)
    || text.match(/\bSEXO[\s:\/]*([MF])\b/i)
    || text.match(/\b(MASCULINO|FEMININO)\b/i);
  if (!m) return null;
  const val = m[1].toUpperCase();
  if (val === 'M' || val === 'MASCULINO') return 'M';
  if (val === 'F' || val === 'FEMININO') return 'F';
  return null;
}

/**
 * Tenta detectar a província pela naturalidade ou endereço.
 * Dá prioridade a linhas após "NATURALIDADE" / "LOCAL DE NASC".
 */
const PROVINCES = [
  'MAPUTO CIDADE', 'MAPUTO', 'GAZA', 'INHAMBANE', 'SOFALA', 'MANICA',
  'ZAMBÉZIA', 'ZAMBEZIA', 'TETE', 'NAMPULA',
  'CABO DELGADO', 'NIASSA',
];
function normaliseProvince(p) {
  if (p === 'ZAMBEZIA') return 'Zambézia';
  if (p === 'CABO DELGADO') return 'Cabo Delgado';
  if (p === 'MAPUTO CIDADE') return 'Maputo Cidade';
  return p.charAt(0) + p.slice(1).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function extractProvince(text) {
  const upper = text.toUpperCase();
  // Tenta primeiro a linha após "NATURALIDADE" ou "LOCAL DE NASC"
  const natMatch = upper.match(/(?:NATURALIDADE|LOCAL\s+DE\s+NASC[^\n]*)\n([^\n]+)/);
  if (natMatch) {
    const line = natMatch[1].toUpperCase();
    for (const p of PROVINCES) {
      if (line.includes(p)) return normaliseProvince(p);
    }
  }
  // Fallback: varredura geral
  for (const p of PROVINCES) {
    if (upper.includes(p)) return normaliseProvince(p);
  }
  return null;
}

/**
 * Extrai o local de residência (bairro/distrito/cidade).
 * Procura linhas após "RESIDÊNCIA", "MORADA", "ENDEREÇO".
 */
function extractResidence(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const keywords = ['RESIDÊNCIA', 'RESIDENCIA', 'MORADA', 'ENDEREÇO', 'ENDERECO', 'LOCAL DE RESIDÊNCIA'];
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].toUpperCase();
    for (const kw of keywords) {
      if (upper.includes(kw)) {
        // Valor na mesma linha após ':'
        const same = lines[i].replace(new RegExp(kw, 'i'), '').replace(/[:/]/g, '').trim();
        if (same.length > 3) return capitalise(same);
        // Linha seguinte
        if (i + 1 < lines.length && lines[i + 1].length > 3) {
          return capitalise(lines[i + 1]);
        }
      }
    }
  }
  return null;
}

function capitalise(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

/**
 * Função principal — recebe o texto OCR e devolve campos estruturados.
 */
function parseMzBI(rawText) {
  const text = clean(rawText);
  return {
    bi:            extractBiNumber(text),
    name:          extractName(text),
    date_of_birth: extractDate(text),
    gender:        extractGender(text),
    province:      extractProvince(text),
    residence:     extractResidence(text),
  };
}

module.exports = { parseMzBI };
