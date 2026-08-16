import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

// PostgreSQL Connection Pool Configuration
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/research_intel';
let pgPool = null;
let usePostgres = false;

// Fallback in-memory/file-persisted relational store if Postgres server is not running locally
const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'db_store.json');

const localStore = {
  documents: [],
  topic_clusters: [],
  topic_documents: [],
  sources_config: [
    { id: 'src-1', type: 'arxiv', name: 'arXiv cs.AI (Artificial Intelligence)', query: 'cat:cs.AI', enabled: true, frequency: 'daily' },
    { id: 'src-2', type: 'arxiv', name: 'arXiv cs.CL (Computation & Language)', query: 'cat:cs.CL', enabled: true, frequency: 'daily' },
    { id: 'src-3', type: 'arxiv', name: 'arXiv cs.LG (Machine Learning)', query: 'cat:cs.LG', enabled: true, frequency: 'daily' },
    { id: 'src-4', type: 'rss', name: 'AI Breakfast Newsletter', query: 'https://aibreakfast.beehiiv.com/feed', enabled: true, frequency: 'hourly' },
    { id: 'src-5', type: 'rss', name: 'Hugging Face Blog RSS', query: 'https://huggingface.co/blog/feed.xml', enabled: true, frequency: 'hourly' },
    { id: 'src-6', type: 'rss', name: 'The Gradient RSS', query: 'https://thegradient.pub/rss/', enabled: true, frequency: 'daily' }
  ],
  user_feedback: [],
  pipeline_runs: []
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLocalStore() {
  ensureDataDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      Object.assign(localStore, data);
    } catch (e) {
      console.warn('[DB] Could not parse existing local store file, starting fresh.');
    }
  }
}

function saveLocalStore() {
  try {
    ensureDataDir();
    fs.writeFileSync(DB_FILE, JSON.stringify(localStore, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Error saving local store:', err);
  }
}

export async function initDatabase() {
  loadLocalStore();
  
  if (process.env.DISABLE_PG !== 'true') {
    try {
      pgPool = new Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 2000
      });
      
      const client = await pgPool.connect();
      console.log(' [DB] Connected successfully to PostgreSQL knowledge store!');
      usePostgres = true;

      // Initialize PostgreSQL relational schema
      await client.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          abstract TEXT,
          clean_text TEXT,
          source_type TEXT NOT NULL,
          url TEXT,
          authors TEXT[],
          published_at TIMESTAMP WITH TIME ZONE,
          category TEXT,
          hash TEXT UNIQUE,
          sections JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS topic_clusters (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          key_insights JSONB,
          breakthroughs JSONB,
          cross_source_analysis TEXT,
          open_questions JSONB,
          source_types TEXT[],
          confidence_score REAL,
          rank_score REAL,
          keywords TEXT[],
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS topic_documents (
          topic_id TEXT REFERENCES topic_clusters(id) ON DELETE CASCADE,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          relevance_score REAL,
          PRIMARY KEY (topic_id, document_id)
        );

        CREATE TABLE IF NOT EXISTS user_feedback (
          id TEXT PRIMARY KEY,
          topic_id TEXT,
          rating TEXT, -- 'thumbs_up' or 'thumbs_down'
          note TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sources_config (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          query TEXT NOT NULL,
          enabled BOOLEAN DEFAULT TRUE,
          frequency TEXT DEFAULT 'daily'
        );

        CREATE TABLE IF NOT EXISTS pipeline_runs (
          id TEXT PRIMARY KEY,
          run_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          documents_ingested INT,
          clusters_formed INT,
          status TEXT,
          duration_ms INT,
          logs JSONB
        );
      `);

      client.release();
      return;
    } catch (err) {
      console.log(` [DB] PostgreSQL not reachable at ${databaseUrl.replace(/:[^:@]+@/, ':***@')} (${err.message}). Using high-performance relational local store.`);
      usePostgres = false;
      if (pgPool) {
        pgPool.end().catch(() => {});
        pgPool = null;
      }
    }
  } else {
    console.log(' [DB] Using file-backed local relational store.');
  }
}

// Database helper operations supporting both PostgreSQL & local adapter

export async function getDocuments(filters = {}) {
  if (usePostgres && pgPool) {
    let query = 'SELECT * FROM documents';
    const params = [];
    const conditions = [];

    if (filters.source_type) {
      params.push(filters.source_type);
      conditions.push(`source_type = $${params.length}`);
    }
    if (filters.category) {
      params.push(filters.category);
      conditions.push(`category = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(title ILIKE $${params.length} OR abstract ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY published_at DESC LIMIT ' + (filters.limit || 100);

    const res = await pgPool.query(query, params);
    return res.rows;
  } else {
    let docs = [...localStore.documents];
    if (filters.source_type) {
      docs = docs.filter(d => d.source_type === filters.source_type);
    }
    if (filters.category) {
      docs = docs.filter(d => d.category === filters.category);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      docs = docs.filter(d => 
        (d.title && d.title.toLowerCase().includes(q)) || 
        (d.abstract && d.abstract.toLowerCase().includes(q))
      );
    }
    docs.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
    return docs.slice(0, filters.limit || 100);
  }
}

export async function insertDocuments(docs) {
  if (!docs || docs.length === 0) return 0;
  let insertedCount = 0;

  if (usePostgres && pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const doc of docs) {
        const res = await client.query(`
          INSERT INTO documents (id, title, abstract, clean_text, source_type, url, authors, published_at, category, hash, sections)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (hash) DO NOTHING
          RETURNING id;
        `, [
          doc.id,
          doc.title,
          doc.abstract,
          doc.clean_text,
          doc.source_type,
          doc.url,
          doc.authors,
          doc.published_at,
          doc.category,
          doc.hash,
          JSON.stringify(doc.sections || {})
        ]);
        if (res.rowCount > 0) insertedCount++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } else {
    for (const doc of docs) {
      const existing = localStore.documents.find(d => d.hash === doc.hash || d.id === doc.id);
      if (!existing) {
        localStore.documents.push({
          ...doc,
          created_at: new Date().toISOString()
        });
        insertedCount++;
      }
    }
    saveLocalStore();
  }

  return insertedCount;
}

export async function saveTopicClusters(clusters) {
  if (usePostgres && pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      // Clear previous topic clusters for fresh re-clustering or upsert
      await client.query('DELETE FROM topic_documents');
      await client.query('DELETE FROM topic_clusters');

      for (const cluster of clusters) {
        await client.query(`
          INSERT INTO topic_clusters 
          (id, title, summary, key_insights, breakthroughs, cross_source_analysis, open_questions, source_types, confidence_score, rank_score, keywords, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        `, [
          cluster.id,
          cluster.title,
          cluster.summary,
          JSON.stringify(cluster.key_insights || []),
          JSON.stringify(cluster.breakthroughs || []),
          cluster.cross_source_analysis,
          JSON.stringify(cluster.open_questions || []),
          cluster.source_types || [],
          cluster.confidence_score || 0.85,
          cluster.rank_score || 0.8,
          cluster.keywords || []
        ]);

        if (cluster.documents && cluster.documents.length > 0) {
          for (const doc of cluster.documents) {
            await client.query(`
              INSERT INTO topic_documents (topic_id, document_id, relevance_score)
              VALUES ($1, $2, $3)
              ON CONFLICT DO NOTHING
            `, [cluster.id, doc.id, doc.relevance_score || 1.0]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } else {
    localStore.topic_clusters = clusters.map(c => ({
      ...c,
      created_at: new Date().toISOString()
    }));
    localStore.topic_documents = [];
    for (const cluster of clusters) {
      if (cluster.documents) {
        for (const doc of cluster.documents) {
          localStore.topic_documents.push({
            topic_id: cluster.id,
            document_id: doc.id,
            relevance_score: doc.relevance_score || 1.0
          });
        }
      }
    }
    saveLocalStore();
  }
}

export async function getTopicClusters() {
  if (usePostgres && pgPool) {
    const clusterRes = await pgPool.query(`
      SELECT tc.*, 
        COALESCE(
          json_agg(
            json_build_object(
              'id', d.id,
              'title', d.title,
              'abstract', d.abstract,
              'url', d.url,
              'source_type', d.source_type,
              'authors', d.authors,
              'published_at', d.published_at,
              'category', d.category
            )
          ) FILTER (WHERE d.id IS NOT NULL), '[]'
        ) AS documents
      FROM topic_clusters tc
      LEFT JOIN topic_documents td ON tc.id = td.topic_id
      LEFT JOIN documents d ON td.document_id = d.id
      GROUP BY tc.id
      ORDER BY tc.rank_score DESC
    `);
    return clusterRes.rows;
  } else {
    return localStore.topic_clusters.map(cluster => {
      const docIds = localStore.topic_documents
        .filter(td => td.topic_id === cluster.id)
        .map(td => td.document_id);
      const docs = localStore.documents.filter(d => docIds.includes(d.id));
      return {
        ...cluster,
        documents: docs
      };
    }).sort((a, b) => (b.rank_score || 0) - (a.rank_score || 0));
  }
}

export async function saveFeedback(feedback) {
  const item = {
    id: feedback.id || `fb-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    topic_id: feedback.topic_id,
    rating: feedback.rating,
    note: feedback.note || '',
    created_at: new Date().toISOString()
  };

  if (usePostgres && pgPool) {
    await pgPool.query(`
      INSERT INTO user_feedback (id, topic_id, rating, note, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [item.id, item.topic_id, item.rating, item.note]);
  } else {
    localStore.user_feedback.push(item);
    saveLocalStore();
  }
  return item;
}

export async function getFeedback() {
  if (usePostgres && pgPool) {
    const res = await pgPool.query('SELECT * FROM user_feedback ORDER BY created_at DESC');
    return res.rows;
  } else {
    return localStore.user_feedback;
  }
}

export async function getSources() {
  if (usePostgres && pgPool) {
    const res = await pgPool.query('SELECT * FROM sources_config ORDER BY name ASC');
    if (res.rows.length === 0) {
      // Seed default sources if empty
      for (const src of localStore.sources_config) {
        await pgPool.query(`
          INSERT INTO sources_config (id, type, name, query, enabled, frequency)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [src.id, src.type, src.name, src.query, src.enabled, src.frequency]);
      }
      return localStore.sources_config;
    }
    return res.rows;
  } else {
    return localStore.sources_config;
  }
}

export async function saveSource(source) {
  if (usePostgres && pgPool) {
    await pgPool.query(`
      INSERT INTO sources_config (id, type, name, query, enabled, frequency)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        query = EXCLUDED.query,
        enabled = EXCLUDED.enabled,
        frequency = EXCLUDED.frequency
    `, [source.id, source.type, source.name, source.query, source.enabled, source.frequency]);
  } else {
    const idx = localStore.sources_config.findIndex(s => s.id === source.id);
    if (idx >= 0) {
      localStore.sources_config[idx] = source;
    } else {
      localStore.sources_config.push(source);
    }
    saveLocalStore();
  }
  return source;
}

export async function recordPipelineRun(runData) {
  const run = {
    id: `run-${Date.now()}`,
    run_timestamp: new Date().toISOString(),
    documents_ingested: runData.documents_ingested || 0,
    clusters_formed: runData.clusters_formed || 0,
    status: runData.status || 'success',
    duration_ms: runData.duration_ms || 0,
    logs: runData.logs || []
  };

  if (usePostgres && pgPool) {
    await pgPool.query(`
      INSERT INTO pipeline_runs (id, run_timestamp, documents_ingested, clusters_formed, status, duration_ms, logs)
      VALUES ($1, NOW(), $2, $3, $4, $5, $6)
    `, [run.id, run.documents_ingested, run.clusters_formed, run.status, run.duration_ms, JSON.stringify(run.logs)]);
  } else {
    localStore.pipeline_runs.unshift(run);
    if (localStore.pipeline_runs.length > 50) localStore.pipeline_runs.pop();
    saveLocalStore();
  }
  return run;
}

export async function getAnalytics() {
  const docs = await getDocuments({ limit: 1000 });
  const topics = await getTopicClusters();
  const feedback = await getFeedback();

  const sourceCounts = {};
  docs.forEach(d => {
    sourceCounts[d.source_type] = (sourceCounts[d.source_type] || 0) + 1;
  });

  const categoryCounts = {};
  docs.forEach(d => {
    if (d.category) {
      categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1;
    }
  });

  return {
    total_documents: docs.length,
    total_topics: topics.length,
    source_distribution: sourceCounts,
    category_distribution: categoryCounts,
    feedback_stats: {
      total: feedback.length,
      thumbs_up: feedback.filter(f => f.rating === 'thumbs_up').length,
      thumbs_down: feedback.filter(f => f.rating === 'thumbs_down').length
    },
    use_postgres: usePostgres
  };
}
