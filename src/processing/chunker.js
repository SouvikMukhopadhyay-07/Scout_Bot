/**
 * Logical section chunker: segments academic papers and newsletter essays
 * into structured semantic segments (Context/Problem, Innovation/Method, Findings, Implications).
 */
export function extractSections(text) {
  if (!text) {
    return { context: '', innovation: '', findings: '', implications: '' };
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const total = sentences.length;

  if (total <= 2) {
    return {
      context: sentences[0] ? sentences[0].trim() : '',
      innovation: sentences[1] ? sentences[1].trim() : '',
      findings: '',
      implications: ''
    };
  }

  // Keywords that hint at section boundaries
  const innovationKeywords = /(we propose|we introduce|our approach|we present|method|framework|architecture|model)/i;
  const findingsKeywords = /(results show|experiments demonstrate|we find|outperforms|achieves|state-of-the-art|accuracy|evaluation)/i;
  const implicationsKeywords = /(in conclusion|this work highlights|future work|broader impact|implications|potential)/i;

  let contextSentences = [];
  let innovationSentences = [];
  let findingsSentences = [];
  let implicationsSentences = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (implicationsKeywords.test(s) && i >= total / 2) {
      implicationsSentences.push(s);
    } else if (findingsKeywords.test(s) && i >= 1) {
      findingsSentences.push(s);
    } else if (innovationKeywords.test(s) || (i >= 1 && i < Math.ceil(total * 0.6))) {
      innovationSentences.push(s);
    } else {
      if (innovationSentences.length === 0) {
        contextSentences.push(s);
      } else if (findingsSentences.length === 0) {
        innovationSentences.push(s);
      } else {
        findingsSentences.push(s);
      }
    }
  }

  return {
    context: contextSentences.join(' ').trim() || sentences[0].trim(),
    innovation: innovationSentences.join(' ').trim() || (sentences[1] ? sentences[1].trim() : ''),
    findings: findingsSentences.join(' ').trim() || (sentences[2] ? sentences[2].trim() : ''),
    implications: implicationsSentences.join(' ').trim()
  };
}

/**
 * Split long documents into sliding chunks while preserving semantic headers
 */
export function chunkDocument(doc, maxChunkLength = 800) {
  const sections = extractSections(doc.abstract || doc.clean_text);
  const chunks = [];

  if (sections.context) {
    chunks.push({
      doc_id: doc.id,
      section: 'Problem & Context',
      text: sections.context
    });
  }

  if (sections.innovation) {
    chunks.push({
      doc_id: doc.id,
      section: 'Core Innovation',
      text: sections.innovation
    });
  }

  if (sections.findings) {
    chunks.push({
      doc_id: doc.id,
      section: 'Key Findings',
      text: sections.findings
    });
  }

  if (sections.implications) {
    chunks.push({
      doc_id: doc.id,
      section: 'Implications & Future Work',
      text: sections.implications
    });
  }

  return {
    ...doc,
    sections,
    chunks: chunks.length > 0 ? chunks : [{ doc_id: doc.id, section: 'Full', text: doc.abstract || doc.clean_text }]
  };
}
