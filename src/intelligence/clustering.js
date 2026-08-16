import { computeCosineSimilarity } from '../storage/dedup.js';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'our', 'are', 'was', 'were', 'been',
  'which', 'have', 'has', 'had', 'can', 'could', 'should', 'would', 'will', 'also', 'such',
  'into', 'than', 'then', 'over', 'these', 'those', 'their', 'they', 'them', 'using', 'used',
  'show', 'shows', 'shown', 'propose', 'proposed', 'paper', 'model', 'models', 'method',
  'approach', 'results', 'based', 'data', 'learning', 'neural', 'networks', 'task', 'tasks',
  'system', 'systems', 'study', 'performance', 'state', 'art', 'new', 'via', 'through', 'about',
  'more', 'both', 'between', 'each', 'after', 'before', 'where', 'while', 'when', 'under'
]);

/**
 * Tokenize text into filtered vocabulary terms
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Compute TF-IDF matrix for a collection of documents
 */
export function buildTfIdf(documents) {
  const docCount = documents.length;
  if (docCount === 0) return { terms: [], vectors: [], docFrequencies: {} };

  const docTokens = documents.map(d => tokenize((d.title || '') + ' ' + (d.abstract || '')));
  const docFreq = {};

  // Compute Document Frequencies
  for (const tokens of docTokens) {
    const uniqueInDoc = new Set(tokens);
    for (const term of uniqueInDoc) {
      docFreq[term] = (docFreq[term] || 0) + 1;
    }
  }

  // Filter terms that appear at least once and not in 100% of documents (unless docCount is tiny)
  const vocabulary = Object.keys(docFreq).filter(term => docFreq[term] >= 1);

  // Compute TF-IDF vector for each document
  const vectors = docTokens.map((tokens, idx) => {
    const tf = {};
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }
    const vector = {};
    for (const term of vocabulary) {
      if (tf[term]) {
        // TF-IDF = TF * log(N / DF)
        const idf = Math.log((docCount + 1) / (docFreq[term] + 1)) + 1;
        vector[term] = tf[term] * idf;
      }
    }
    return vector;
  });

  return { vocabulary, vectors, docFreq };
}

/**
 * Extract top distinctive keywords for a set of documents
 */
export function extractTopKeywords(clusterDocs, docFreq, totalDocsCount, topN = 6) {
  const termScores = {};
  for (const doc of clusterDocs) {
    const tokens = tokenize((doc.title || '') + ' ' + (doc.abstract || ''));
    for (const t of tokens) {
      const idf = Math.log((totalDocsCount + 1) / ((docFreq[t] || 1) + 1)) + 1;
      termScores[t] = (termScores[t] || 0) + idf;
    }
  }

  const sortedTerms = Object.entries(termScores)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  return sortedTerms.slice(0, topN);
}

/**
 * Format title case topic name from top keywords and themes
 */
function generateClusterTitle(keywords, docs) {
  if (keywords.length === 0) return 'Emerging Research Development';

  // Capitalize terms
  const titleKeywords = keywords.slice(0, 3).map(k => k.charAt(0).toUpperCase() + k.slice(1));
  
  if (titleKeywords.length >= 3) {
    return `${titleKeywords[0]} & ${titleKeywords[1]}: Advances in ${titleKeywords[2]}`;
  } else if (titleKeywords.length === 2) {
    return `${titleKeywords[0]} & ${titleKeywords[1]} Research`;
  }
  return `${titleKeywords[0]} Innovations`;
}

/**
 * Dynamic Topic Clustering:
 * Groups documents into thematic topic clusters based on TF-IDF cosine similarity graphs.
 * @param {Array} documents - Ingested documents
 * @param {number} similarityThreshold - Min similarity to form an edge (default 0.18)
 */
export function clusterDocuments(documents, similarityThreshold = 0.18) {
  if (!documents || documents.length === 0) return [];

  if (documents.length === 1) {
    const doc = documents[0];
    const keywords = tokenize(doc.title).slice(0, 5);
    return [{
      id: `cluster-1`,
      title: doc.title,
      keywords: keywords,
      documents: [doc],
      source_types: [doc.source_type],
      confidence_score: 0.95
    }];
  }

  const { vocabulary, vectors, docFreq } = buildTfIdf(documents);
  const n = documents.length;

  // Build Adjacency Matrix
  const similarityMatrix = Array(n).fill(0).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    similarityMatrix[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const sim = computeCosineSimilarity(vectors[i], vectors[j]);
      similarityMatrix[i][j] = sim;
      similarityMatrix[j][i] = sim;
    }
  }

  // Connected Components / Graph Community Detection
  const visited = new Set();
  const rawClusters = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    const currentClusterIndices = [i];
    visited.add(i);
    const queue = [i];

    while (queue.length > 0) {
      const curr = queue.shift();
      for (let neighbor = 0; neighbor < n; neighbor++) {
        if (!visited.has(neighbor) && similarityMatrix[curr][neighbor] >= similarityThreshold) {
          visited.add(neighbor);
          currentClusterIndices.push(neighbor);
          queue.push(neighbor);
        }
      }
    }

    rawClusters.push(currentClusterIndices);
  }

  // Form structured topic cluster objects
  const clusters = rawClusters.map((indices, clusterIdx) => {
    const clusterDocs = indices.map(idx => documents[idx]);
    const keywords = extractTopKeywords(clusterDocs, docFreq, n, 6);
    const title = generateClusterTitle(keywords, clusterDocs);
    const sourceTypes = Array.from(new Set(clusterDocs.map(d => d.source_type)));

    // Calculate cluster coherence / confidence score
    let totalPairSim = 0;
    let pairs = 0;
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        totalPairSim += similarityMatrix[indices[a]][indices[b]];
        pairs++;
      }
    }
    const avgCoherence = pairs > 0 ? (totalPairSim / pairs) : 0.85;
    const confidenceScore = Math.min(0.99, Math.max(0.70, Number((0.65 + avgCoherence * 0.4 + (clusterDocs.length > 1 ? 0.1 : 0)).toFixed(2))));

    return {
      id: `topic-${Date.now()}-${clusterIdx + 1}`,
      title,
      keywords,
      documents: clusterDocs,
      source_types: sourceTypes,
      confidence_score: confidenceScore
    };
  });

  return clusters;
}
