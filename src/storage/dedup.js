import crypto from 'crypto';

// Compute SHA-256 hash of normalized text or canonical URL
export function computeContentHash(text, url = '') {
  const normalized = (url ? url.toLowerCase().trim() : '') + '|' + (text || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').slice(0, 500);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Tokenize text into words / word n-grams
function getTokens(text) {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
  
  const unigrams = [...words];
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`);
  }
  return [...unigrams, ...bigrams];
}

// Compute term frequency vector
function getTermFreq(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  return tf;
}

// Cosine similarity between two TF vectors
export function computeCosineSimilarity(tf1, tf2) {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (const k in tf1) {
    norm1 += tf1[k] * tf1[k];
    if (tf2[k]) {
      dotProduct += tf1[k] * tf2[k];
    }
  }

  for (const k in tf2) {
    norm2 += tf2[k] * tf2[k];
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// Jaccard similarity for quick token overlap check
export function computeJaccardSimilarity(tokens1, tokens2) {
  const s1 = new Set(tokens1);
  const s2 = new Set(tokens2);
  let intersection = 0;
  for (const t of s1) {
    if (s2.has(t)) intersection++;
  }
  const union = s1.size + s2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate a batch of candidate documents against existing database documents
 * and against each other in the batch.
 * @param {Array} newDocs - Candidate documents
 * @param {Array} existingDocs - Already stored documents in DB
 * @param {number} similarityThreshold - Threshold for considering two docs duplicate (default 0.82)
 * @returns {Array} Unique, deduplicated documents
 */
export function deduplicateDocuments(newDocs, existingDocs = [], similarityThreshold = 0.82) {
  const uniqueList = [];
  const existingHashes = new Set(existingDocs.map(d => d.hash));
  const existingTFs = existingDocs.map(d => ({
    id: d.id,
    title: d.title,
    tf: getTermFreq(getTokens((d.title || '') + ' ' + (d.abstract || '')))
  }));

  for (const doc of newDocs) {
    // 1. Exact hash check
    if (existingHashes.has(doc.hash)) {
      continue;
    }

    const docTokens = getTokens((doc.title || '') + ' ' + (doc.abstract || ''));
    const docTF = getTermFreq(docTokens);

    // 2. Similarity check against existing database docs
    let isDuplicate = false;
    for (const ex of existingTFs) {
      const sim = computeCosineSimilarity(docTF, ex.tf);
      if (sim >= similarityThreshold) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) continue;

    // 3. Similarity check against newly accepted docs in current batch
    for (const accepted of uniqueList) {
      const acceptedTF = getTermFreq(getTokens((accepted.title || '') + ' ' + (accepted.abstract || '')));
      const sim = computeCosineSimilarity(docTF, acceptedTF);
      if (sim >= similarityThreshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      existingHashes.add(doc.hash);
      existingTFs.push({ id: doc.id, title: doc.title, tf: docTF });
      uniqueList.push(doc);
    }
  }

  return uniqueList;
}
