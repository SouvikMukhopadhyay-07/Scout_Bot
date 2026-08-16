import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { initDatabase, getDocuments, getTopicClusters, saveFeedback, getSources, saveSource, getAnalytics } from './src/storage/db.js';
import { runPipeline } from './src/intelligence/orchestrator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Knowledge Store Database (PostgreSQL / Local Relational Adapter)
await initDatabase();

// --- REST API ENDPOINTS ---

// 1. Get Topic Digests
app.get('/api/topics', async (req, res) => {
  try {
    const topics = await getTopicClusters();
    res.json({ success: true, count: topics.length, topics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Get Documents
app.get('/api/documents', async (req, res) => {
  try {
    const { source_type, category, search, limit } = req.query;
    const documents = await getDocuments({
      source_type,
      category,
      search,
      limit: limit ? parseInt(limit, 10) : 100
    });
    res.json({ success: true, count: documents.length, documents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Trigger Ingestion & Intelligence Pipeline Run
let isPipelineRunning = false;
app.post('/api/pipeline/run', async (req, res) => {
  if (isPipelineRunning) {
    return res.status(429).json({ success: false, message: 'Pipeline is currently executing a run.' });
  }

  isPipelineRunning = true;
  try {
    const result = await runPipeline(req.body || {});
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    isPipelineRunning = false;
  }
});

// 4. Submit Relevance Feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { topic_id, rating, note } = req.body;
    if (!topic_id || !rating) {
      return res.status(400).json({ success: false, message: 'topic_id and rating are required.' });
    }
    const feedback = await saveFeedback({ topic_id, rating, note });
    res.json({ success: true, feedback });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Sources Management
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await getSources();
    res.json({ success: true, sources });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sources', async (req, res) => {
  try {
    const source = req.body;
    if (!source.name || !source.query || !source.type) {
      return res.status(400).json({ success: false, message: 'name, query, and type are required' });
    }
    if (!source.id) source.id = `src-${Date.now()}`;
    const saved = await saveSource(source);
    res.json({ success: true, source: saved });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Analytics & Overview
app.get('/api/analytics', async (req, res) => {
  try {
    const analytics = await getAnalytics();
    res.json({ success: true, analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Digest Export (Markdown / Slack format)
app.get('/api/export', async (req, res) => {
  try {
    const format = req.query.format || 'markdown';
    const topics = await getTopicClusters();
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (format === 'markdown') {
      let md = `# 🔬 Research & Intelligence Topic Digest — ${dateStr}\n\n`;
      md += `> Automated multi-agent intelligence digest synthesizing latest arXiv papers, newsletters, and search streams.\n\n---\n\n`;

      topics.forEach((t, i) => {
        md += `## ${i + 1}. ${t.title}\n\n`;
        md += `**Confidence**: ${(t.confidence_score * 100).toFixed(0)}% | **Rank Score**: ${(t.rank_score * 100).toFixed(0)} | **Sources**: ${(t.source_types || []).join(', ')}\n\n`;
        md += `### Executive Synthesis\n${t.summary}\n\n`;
        
        if (t.key_insights && t.key_insights.length > 0) {
          md += `### Key Insights & Findings\n`;
          t.key_insights.forEach(k => {
            md += `- **${k.source || 'Insight'}**: ${k.insight}\n`;
          });
          md += `\n`;
        }

        if (t.cross_source_analysis) {
          md += `### Cross-Source Analysis\n${t.cross_source_analysis}\n\n`;
        }

        if (t.documents && t.documents.length > 0) {
          md += `### Referenced Documents\n`;
          t.documents.forEach(d => {
            md += `- [${d.title}](${d.url}) — *${d.authors?.join(', ') || d.source_type}*\n`;
          });
          md += `\n`;
        }

        md += `---\n\n`;
      });

      res.setHeader('Content-Type', 'text/markdown');
      return res.send(md);
    }

    res.json({ success: true, topics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`\n==========================================================`);
  console.log(` 🧠 AI Research & Content Intelligence Server Started`);
  console.log(` 📡 Local Dashboard: http://localhost:${PORT}`);
  console.log(` 🔌 REST API Ready: http://localhost:${PORT}/api/topics`);
  console.log(`==========================================================\n`);

  // Run initial bootstrap pipeline if database is empty
  try {
    const existing = await getDocuments({ limit: 1 });
    if (existing.length === 0) {
      console.log(' [Bootstrap] No existing documents found. Triggering initial bootstrap ingestion run...');
      runPipeline().catch(err => console.error(' [Bootstrap Error]', err));
    }
  } catch (e) {
    console.warn(' [Bootstrap Check]', e.message);
  }
});
