import assert from 'assert';
import { normalizeDocument } from '../src/processing/normalizer.js';
import { chunkDocument } from '../src/processing/chunker.js';
import { computeContentHash, computeCosineSimilarity, deduplicateDocuments } from '../src/storage/dedup.js';
import { clusterDocuments, buildTfIdf } from '../src/intelligence/clustering.js';
import { rankTopicClusters } from '../src/intelligence/ranking.js';
import { synthesizeTopicDigest } from '../src/intelligence/synthesizer.js';

console.log('🧪 Starting Automated Unit & Pipeline Verification Tests...\n');

// 1. Test Normalizer
console.log('▶ [Test 1] Testing Normalizer & Text Cleaner...');
const rawSample = {
  id: 'arxiv:2401.0001',
  title: '<b>Agentic RAG</b> &amp; Dynamic Reasoning',
  abstract: '<p>We propose a novel framework for multi-agent reasoning. arXiv:2401.0001 [cs.AI] Comments: 12 pages. https://example.com</p>',
  authors: ['Alice Smith', 'Bob Jones'],
  source_type: 'arxiv',
  category: 'cs.AI'
};
const normDoc = normalizeDocument(rawSample);
assert.strictEqual(normDoc.title, 'Agentic RAG & Dynamic Reasoning');
assert.ok(!normDoc.abstract.includes('<p>'));
assert.ok(!normDoc.abstract.includes('arXiv:'));
assert.strictEqual(normDoc.authors.length, 2);
console.log('  ✓ Normalizer passed successfully.');

// 2. Test Section Chunker
console.log('▶ [Test 2] Testing Logical Section Chunker...');
const chunked = chunkDocument({
  id: 'doc-1',
  title: 'Test Paper',
  abstract: 'Large language models suffer from reasoning bottlenecks. We propose an iterative verification tree architecture. Experiments demonstrate a 32% accuracy improvement over standard baselines. This work highlights new paths for autonomous code generation.'
});
assert.ok(chunked.sections.context.length > 0);
assert.ok(chunked.sections.innovation.length > 0);
assert.ok(chunked.sections.findings.length > 0);
assert.ok(chunked.sections.implications.length > 0);
console.log('  ✓ Section Chunker extracted Context, Innovation, Findings, Implications correctly.');

// 3. Test Deduplication & Similarity
console.log('▶ [Test 3] Testing Deduplication & Similarity Engine...');
const docA = normalizeDocument({
  id: 'doc-a',
  title: 'Speculative Decoding for Fast LLM Inference',
  abstract: 'Speculative decoding speeds up autoregressive sampling by predicting tokens in advance.',
  url: 'https://arxiv.org/abs/2401.001'
});
const docADuplicate = normalizeDocument({
  id: 'doc-a-dup',
  title: 'Speculative Decoding for Fast LLM Inference',
  abstract: 'Speculative decoding speeds up autoregressive sampling by predicting tokens in advance with Draft models.',
  url: 'https://newsletter.com/speculative-decoding'
});
const docB = normalizeDocument({
  id: 'doc-b',
  title: 'Vision-Language Robotics Navigation Framework',
  abstract: 'We present a spatial foundation model for embodied robotics locomotion.',
  url: 'https://arxiv.org/abs/2401.002'
});

const dedupResult = deduplicateDocuments([docA, docADuplicate, docB], [], 0.75);
assert.strictEqual(dedupResult.length, 2, 'Should filter out near-duplicate docADuplicate');
console.log('  ✓ Deduplication accurately identified and removed near-duplicate.');

// 4. Test Topic Clustering
console.log('▶ [Test 4] Testing Dynamic Topic Clustering & TF-IDF Graph...');
const clusterDocs = [
  normalizeDocument({ id: 'c1', title: 'Agentic RAG Reasoning with Multi-Agent Systems', abstract: 'Multi-agent frameworks for retrieval augmented generation and reasoning decomposition.', source_type: 'arxiv' }),
  normalizeDocument({ id: 'c2', title: 'Evaluating Agentic Workflows in Production RAG Systems', abstract: 'Practical production benchmarks for multi-agent RAG reasoning.', source_type: 'newsletter' }),
  normalizeDocument({ id: 'c3', title: 'Quantum Circuit Optimization Using Tensor Networks', abstract: 'Simulating 100-qubit quantum circuits using matrix product states.', source_type: 'arxiv' })
];

const clusters = clusterDocuments(clusterDocs, 0.15);
assert.ok(clusters.length >= 2, 'Should separate AI Agentic RAG from Quantum Circuits into distinct clusters');
const aiCluster = clusters.find(c => c.keywords.includes('rag') || c.keywords.includes('agentic'));
assert.ok(aiCluster, 'Should form emergent Agentic RAG topic cluster');
assert.strictEqual(aiCluster.documents.length, 2, 'Agentic cluster should group both paper and newsletter');
console.log(`  ✓ Formed ${clusters.length} emergent clusters. Discovered topic: "${clusters[0].title}"`);

// 5. Test Ranking Agent
console.log('▶ [Test 5] Testing Multi-Factor Ranking Agent...');
const ranked = rankTopicClusters(clusters, [{ topic_id: aiCluster.id, rating: 'thumbs_up', note: 'rag agentic' }]);
assert.ok(ranked[0].rank_score >= ranked[1].rank_score);
assert.ok(ranked[0].ranking_factors.cross_source_score >= 0.7);
console.log(`  ✓ Ranking score calculated: #${1} "${ranked[0].title}" (Score: ${ranked[0].rank_score})`);

// 6. Test Synthesizer Agent
console.log('▶ [Test 6] Testing Topic Synthesizer Agent...');
const synthesized = await synthesizeTopicDigest(ranked[0]);
assert.ok(synthesized.summary.length > 20);
assert.ok(synthesized.key_insights.length > 0);
assert.ok(synthesized.cross_source_analysis.length > 0);
console.log(`  ✓ Synthesizer generated structured topic digest with citations.`);

console.log('\n=============================================');
console.log('🎉 ALL PIPELINE TESTS PASSED WITH 100% SUCCESS');
console.log('=============================================\n');
