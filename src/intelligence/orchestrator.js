import { fetchArxivPapers } from '../ingestion/arxivConnector.js';
import { fetchRssFeed } from '../ingestion/rssConnector.js';
import { fetchSearchInsights } from '../ingestion/searchConnector.js';
import { chunkDocument } from '../processing/chunker.js';
import { deduplicateDocuments } from '../storage/dedup.js';
import { 
  getDocuments, 
  insertDocuments, 
  saveTopicClusters, 
  getFeedback, 
  getSources, 
  recordPipelineRun 
} from '../storage/db.js';
import { clusterDocuments } from './clustering.js';
import { rankTopicClusters } from './ranking.js';
import { synthesizeTopicDigest } from './synthesizer.js';

/**
 * Execute end-to-end research intelligence pipeline run
 * @param {Object} options - Custom configuration (e.g. maxPapers, specific categories)
 */
export async function runPipeline(options = {}) {
  const startTime = Date.now();
  const logs = [];

  function log(msg) {
    const entry = `[${new Date().toISOString().split('T')[1].slice(0, 8)}] ${msg}`;
    console.log(entry);
    logs.push(entry);
  }

  log('🚀 Starting Research Intelligence Pipeline run...');

  try {
    // 1. Fetch configured active sources
    const sources = await getSources();
    const activeSources = sources.filter(s => s.enabled);
    log(`Found ${activeSources.length} active sources configured.`);

    const candidateDocs = [];

    // Ingest from arXiv
    const arxivSources = activeSources.filter(s => s.type === 'arxiv');
    for (const src of arxivSources) {
      log(`Ingesting papers from ${src.name} (${src.query})...`);
      const papers = await fetchArxivPapers(src.query, options.maxPapersPerSource || 10);
      candidateDocs.push(...papers);
    }

    // Ingest from RSS / Newsletters
    const rssSources = activeSources.filter(s => s.type === 'rss');
    for (const src of rssSources) {
      log(`Ingesting newsletter articles from ${src.name}...`);
      const articles = await fetchRssFeed(src.query, src.name);
      candidateDocs.push(...articles);
    }

    // Ingest from Search / Trends
    log(`Ingesting web & search research topics...`);
    const searchDocs = await fetchSearchInsights(options.searchQuery || 'agentic AI systems');
    candidateDocs.push(...searchDocs);

    log(`Total raw documents fetched across all streams: ${candidateDocs.length}`);

    // 2. Chunker & Section Extraction
    const processedDocs = candidateDocs.map(d => chunkDocument(d));

    // 3. Deduplication against PostgreSQL knowledge store
    const existingDocs = await getDocuments({ limit: 1000 });
    log(`Checking deduplication against ${existingDocs.length} existing documents in PostgreSQL knowledge store...`);
    
    const uniqueDocs = deduplicateDocuments(processedDocs, existingDocs, 0.82);
    log(`Deduplication complete: ${uniqueDocs.length} new unique documents identified (filtered out ${candidateDocs.length - uniqueDocs.length} duplicates).`);

    // 4. Save new documents to PostgreSQL knowledge store
    const inserted = await insertDocuments(uniqueDocs);
    log(`Persisted ${inserted} new documents into PostgreSQL knowledge store.`);

    // 5. Gather all recent documents for clustering
    const allRecentDocs = await getDocuments({ limit: 200 });
    log(`Gathering ${allRecentDocs.length} recent documents for dynamic topic clustering...`);

    // 6. Dynamic Topic Clustering
    const rawClusters = clusterDocuments(allRecentDocs, 0.18);
    log(`Formed ${rawClusters.length} emergent topic clusters from document similarity graphs.`);

    // 7. Multi-Factor Ranking
    const feedback = await getFeedback();
    const rankedClusters = rankTopicClusters(rawClusters, feedback);
    log(`Ranked topic clusters across source authority, recency, and user feedback.`);

    // 8. Agentic Topic Synthesis
    log(`Synthesizing structured topic digests for top clusters...`);
    const synthesizedClusters = [];
    for (let i = 0; i < rankedClusters.length; i++) {
      const cluster = rankedClusters[i];
      log(`Synthesizing Topic ${i + 1}/${rankedClusters.length}: "${cluster.title}" (${cluster.documents.length} sources)...`);
      const digest = await synthesizeTopicDigest(cluster);
      synthesizedClusters.push(digest);
    }

    // 9. Save Topic Clusters and Relational Mappings to PostgreSQL
    await saveTopicClusters(synthesizedClusters);
    log(`Successfully stored ${synthesizedClusters.length} topic digests in PostgreSQL.`);

    const durationMs = Date.now() - startTime;
    log(`🎉 Pipeline run completed successfully in ${(durationMs / 1000).toFixed(2)}s`);

    const runReport = await recordPipelineRun({
      documents_ingested: uniqueDocs.length,
      clusters_formed: synthesizedClusters.length,
      status: 'success',
      duration_ms: durationMs,
      logs: logs
    });

    return {
      success: true,
      new_documents_count: uniqueDocs.length,
      topics_count: synthesizedClusters.length,
      duration_ms: durationMs,
      topics: synthesizedClusters,
      run_id: runReport.id,
      logs: logs
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log(`❌ Pipeline failed with error: ${error.message}`);
    console.error(error);

    await recordPipelineRun({
      documents_ingested: 0,
      clusters_formed: 0,
      status: 'error',
      duration_ms: durationMs,
      logs: [...logs, `ERROR: ${error.stack || error.message}`]
    });

    throw error;
  }
}
