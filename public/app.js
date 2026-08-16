// NexusResearch AI Client Application
let state = {
  topics: [],
  documents: [],
  sources: [],
  analytics: {},
  activeTab: 'topics-tab',
  selectedTopic: null
};

// DOM Elements
const statDocsCount = document.getElementById('stat-docs-count');
const statTopicsCount = document.getElementById('stat-topics-count');
const statDbType = document.getElementById('stat-db-type');
const pipelineStatusText = document.getElementById('pipeline-status-text');

const topicsContainer = document.getElementById('topics-container');
const docsTbody = document.getElementById('docs-tbody');
const sourcesContainer = document.getElementById('sources-container');
const markdownExportPreview = document.getElementById('markdown-export-preview');

const btnRunPipeline = document.getElementById('btn-run-pipeline');
const btnRefreshTopics = document.getElementById('btn-refresh-topics');
const topicSearchInput = document.getElementById('topic-search-input');
const docSearchInput = document.getElementById('doc-search-input');
const docSourceFilter = document.getElementById('doc-source-filter');

const btnCopyMd = document.getElementById('btn-copy-md');
const btnDownloadMd = document.getElementById('btn-download-md');

// Modals
const modalRunPipeline = document.getElementById('modal-run-pipeline');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnModalDismiss = document.getElementById('btn-modal-dismiss');
const pipelineLogsOutput = document.getElementById('pipeline-logs-output');

const modalAddSource = document.getElementById('modal-add-source');
const btnAddSourceModal = document.getElementById('btn-add-source-modal');
const btnCloseSourceModal = document.getElementById('btn-close-source-modal');
const btnCancelSource = document.getElementById('btn-cancel-source');
const btnSaveSource = document.getElementById('btn-save-source');

// Tab Switching
document.querySelectorAll('.tab-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    
    btn.classList.add('active');
    const targetTab = btn.getAttribute('data-tab');
    document.getElementById(targetTab).classList.add('active');
    state.activeTab = targetTab;

    if (targetTab === 'graph-tab') {
      initGraphVisualizer();
    } else if (targetTab === 'export-tab') {
      loadExportPreview();
    }
  });
});

// Initialization
async function initApp() {
  await Promise.all([
    fetchAnalytics(),
    fetchTopics(),
    fetchDocuments(),
    fetchSources()
  ]);
}

// Fetch Analytics
async function fetchAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    const data = await res.json();
    if (data.success) {
      state.analytics = data.analytics;
      statDocsCount.textContent = data.analytics.total_documents || 0;
      statTopicsCount.textContent = data.analytics.total_topics || 0;
      statDbType.textContent = data.analytics.use_postgres ? 'PostgreSQL' : 'Relational (Local)';
    }
  } catch (err) {
    console.error('Failed to fetch analytics:', err);
  }
}

// Fetch Topics
async function fetchTopics() {
  try {
    const res = await fetch('/api/topics');
    const data = await res.json();
    if (data.success) {
      state.topics = data.topics || [];
      renderTopics(state.topics);
      statTopicsCount.textContent = state.topics.length;
    }
  } catch (err) {
    topicsContainer.innerHTML = `<div class="loading-state"><p style="color:var(--accent-rose)">Failed to load topics: ${err.message}</p></div>`;
  }
}

// Render Topic Digest Cards
function renderTopics(topics) {
  if (!topics || topics.length === 0) {
    topicsContainer.innerHTML = `
      <div class="loading-state" style="grid-column: 1 / -1;">
        <p>No topic digests generated yet.</p>
        <button class="btn btn-primary" onclick="triggerPipelineRun()" style="margin-top:12px;">⚡ Trigger Initial Ingestion Run</button>
      </div>
    `;
    return;
  }

  topicsContainer.innerHTML = topics.map((t, idx) => {
    const docCount = (t.documents || []).length;
    const arxivCount = (t.documents || []).filter(d => d.source_type === 'arxiv').length;
    const rssCount = (t.documents || []).filter(d => d.source_type === 'newsletter').length;
    const searchCount = (t.documents || []).filter(d => d.source_type === 'search' || d.source_type === 'web').length;

    let sourceSummary = [];
    if (arxivCount > 0) sourceSummary.push(`${arxivCount} arXiv`);
    if (rssCount > 0) sourceSummary.push(`${rssCount} Newsletters`);
    if (searchCount > 0) sourceSummary.push(`${searchCount} Web`);

    return `
      <article class="topic-card" data-topic-id="${t.id}">
        <div class="topic-meta-bar">
          <div class="topic-badges">
            <span class="badge badge-rank">Rank #${idx + 1} (${Math.round((t.rank_score || 0.8) * 100)}%)</span>
            <span class="badge badge-source">${sourceSummary.join(' • ') || `${docCount} Sources`}</span>
            <span class="badge" style="background:rgba(99,102,241,0.15); color:#a5b4fc;">${Math.round((t.confidence_score || 0.85) * 100)}% Coherence</span>
          </div>
        </div>

        <h3>${escapeHtml(t.title)}</h3>
        
        <p class="topic-summary">${escapeHtml(t.summary)}</p>

        ${t.key_insights && t.key_insights.length > 0 ? `
          <div class="topic-section-box">
            <div class="section-box-title">Key Innovations & Findings</div>
            <ul class="insights-list">
              ${t.key_insights.map(k => `
                <li><strong>${escapeHtml(k.author || 'Author')}:</strong> ${escapeHtml(k.insight)}</li>
              `).join('')}
            </ul>
          </div>
        ` : ''}

        ${t.cross_source_analysis ? `
          <div class="topic-section-box" style="border-left: 3px solid var(--accent-cyan);">
            <div class="section-box-title" style="color:var(--accent-cyan);">Cross-Source Synthesis</div>
            <p class="section-box-content">${escapeHtml(t.cross_source_analysis)}</p>
          </div>
        ` : ''}

        <div class="citations-accordion">
          <div class="citations-title" onclick="toggleCitations('${t.id}')">
            <span>📚 Constituents & Citations (${docCount})</span>
            <span id="chevron-${t.id}">▾</span>
          </div>
          <div class="citations-list" id="citations-${t.id}" style="display:none;">
            ${(t.documents || []).map(d => `
              <div class="citation-item">
                <a href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer" class="citation-link">
                  🔗 ${escapeHtml(d.title)}
                </a>
                <span class="badge badge-${d.source_type}">${d.source_type}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="topic-footer">
          <div class="feedback-controls">
            <button class="btn-feedback" onclick="handleFeedback('${t.id}', 'thumbs_up', this)">👍 Accurate</button>
            <button class="btn-feedback" onclick="handleFeedback('${t.id}', 'thumbs_down', this)">👎 Off-topic</button>
          </div>
          <span style="font-size:0.75rem; color:var(--text-muted);">ID: ${t.id.slice(0, 12)}</span>
        </div>
      </article>
    `;
  }).join('');
}

window.toggleCitations = function(topicId) {
  const list = document.getElementById(`citations-${topicId}`);
  const chev = document.getElementById(`chevron-${topicId}`);
  if (list) {
    if (list.style.display === 'none') {
      list.style.display = 'flex';
      if (chev) chev.textContent = '▴';
    } else {
      list.style.display = 'none';
      if (chev) chev.textContent = '▾';
    }
  }
};

// Handle Feedback
window.handleFeedback = async function(topicId, rating, btnElement) {
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic_id: topicId,
        rating: rating,
        note: `User marked topic as ${rating}`
      })
    });
    const data = await res.json();
    if (data.success) {
      const parent = btnElement.parentElement;
      parent.querySelectorAll('.btn-feedback').forEach(b => {
        b.classList.remove('active-up', 'active-down');
      });
      btnElement.classList.add(rating === 'thumbs_up' ? 'active-up' : 'active-down');
    }
  } catch (e) {
    console.error('Feedback error:', e);
  }
};

// Fetch Documents
async function fetchDocuments() {
  try {
    const res = await fetch('/api/documents');
    const data = await res.json();
    if (data.success) {
      state.documents = data.documents || [];
      renderDocuments(state.documents);
      statDocsCount.textContent = state.documents.length;
    }
  } catch (err) {
    console.error('Failed to fetch documents:', err);
  }
}

function renderDocuments(docs) {
  if (!docs || docs.length === 0) {
    docsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color:var(--text-muted);">No documents indexed yet. Run the pipeline to ingest papers.</td></tr>`;
    return;
  }

  docsTbody.innerHTML = docs.map(d => {
    const pubDate = d.published_at ? new Date(d.published_at).toLocaleDateString() : '--';
    const authors = Array.isArray(d.authors) ? d.authors.slice(0, 3).join(', ') : (d.authors || 'Unknown');
    
    return `
      <tr>
        <td><span class="badge badge-${d.source_type}">${d.source_type}</span></td>
        <td>
          <a href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer" class="doc-title-link">
            ${escapeHtml(d.title)}
          </a>
          <span class="doc-abstract-snippet">${escapeHtml(d.abstract || '')}</span>
        </td>
        <td><span class="badge" style="background:rgba(255,255,255,0.05);">${escapeHtml(d.category || 'AI')}</span></td>
        <td style="color:var(--text-secondary); font-size:0.8rem;">${escapeHtml(authors)}</td>
        <td style="color:var(--text-muted); font-size:0.8rem; font-family:'JetBrains Mono';">${pubDate}</td>
        <td>
          <a href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="padding:4px 10px; font-size:0.75rem;">
            View
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

// Fetch Sources
async function fetchSources() {
  try {
    const res = await fetch('/api/sources');
    const data = await res.json();
    if (data.success) {
      state.sources = data.sources || [];
      renderSources(state.sources);
    }
  } catch (err) {
    console.error('Failed to fetch sources:', err);
  }
}

function renderSources(sources) {
  sourcesContainer.innerHTML = sources.map(s => `
    <div class="source-card">
      <div class="source-card-header">
        <strong>${escapeHtml(s.name)}</strong>
        <span class="badge badge-${s.type}">${s.type.toUpperCase()}</span>
      </div>
      <div class="source-query">${escapeHtml(s.query)}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text-muted); margin-top:auto;">
        <span>Frequency: ${s.frequency || 'daily'}</span>
        <span style="color:var(--accent-emerald);">● Active</span>
      </div>
    </div>
  `).join('');
}

// Load Export Preview
async function loadExportPreview() {
  try {
    const res = await fetch('/api/export?format=markdown');
    const md = await res.text();
    markdownExportPreview.value = md;
  } catch (err) {
    markdownExportPreview.value = `Failed to generate markdown export: ${err.message}`;
  }
}

// Trigger Pipeline Run
async function triggerPipelineRun() {
  modalRunPipeline.classList.remove('hidden');
  pipelineStatusText.textContent = 'Ingesting & Clustering...';
  pipelineLogsOutput.textContent = '[00:00:01] ⚡ Initiating autonomous research intelligence pipeline...\n';

  const steps = ['step-ingest', 'step-process', 'step-dedup', 'step-cluster', 'step-synth'];
  steps.forEach(s => {
    document.getElementById(s).classList.remove('completed', 'active');
  });
  document.getElementById('step-ingest').classList.add('active');

  try {
    // Step progression animation
    setTimeout(() => {
      document.getElementById('step-ingest').classList.replace('active', 'completed');
      document.getElementById('step-process').classList.add('active');
    }, 1200);

    setTimeout(() => {
      document.getElementById('step-process').classList.replace('active', 'completed');
      document.getElementById('step-dedup').classList.add('active');
    }, 2400);

    setTimeout(() => {
      document.getElementById('step-dedup').classList.replace('active', 'completed');
      document.getElementById('step-cluster').classList.add('active');
    }, 3600);

    setTimeout(() => {
      document.getElementById('step-cluster').classList.replace('active', 'completed');
      document.getElementById('step-synth').classList.add('active');
    }, 4800);

    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPapersPerSource: 10 })
    });

    const data = await res.json();
    if (data.success) {
      steps.forEach(s => {
        document.getElementById(s).className = 'step-item completed';
      });

      pipelineLogsOutput.textContent = (data.result.logs || []).join('\n');
      pipelineStatusText.textContent = 'Ready (Synced)';

      await Promise.all([
        fetchAnalytics(),
        fetchTopics(),
        fetchDocuments()
      ]);
    } else {
      pipelineLogsOutput.textContent += `\n❌ Pipeline Error: ${data.message || 'Unknown error'}`;
      pipelineStatusText.textContent = 'Error';
    }
  } catch (err) {
    pipelineLogsOutput.textContent += `\n❌ Network Error: ${err.message}`;
    pipelineStatusText.textContent = 'Error';
  }
}

// Interactive HTML5 Canvas Topic Cluster Graph
let animationFrameId = null;
function initGraphVisualizer() {
  const canvas = document.getElementById('cluster-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('graph-tooltip');

  // Resize canvas to match display container
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  const topics = state.topics || [];
  if (topics.length === 0) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No topics available for cluster graph visualization.', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Create graph nodes and links
  const nodes = [];
  const links = [];

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // Topic Centroid Nodes
  topics.forEach((t, tIdx) => {
    const angle = (tIdx / topics.length) * 2 * Math.PI;
    const radius = Math.min(canvas.width, canvas.height) * 0.28;
    const topicNode = {
      id: t.id,
      title: t.title,
      type: 'topic',
      x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
      y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      radius: 20,
      color: '#818cf8',
      summary: t.summary
    };
    nodes.push(topicNode);

    // Connected Document Leaf Nodes
    (t.documents || []).slice(0, 5).forEach((doc, dIdx) => {
      const docAngle = angle + (dIdx - 2) * 0.35;
      const docRadius = radius + 90;
      
      let docColor = '#f87171';
      if (doc.source_type === 'newsletter') docColor = '#fbbf24';
      if (doc.source_type === 'search' || doc.source_type === 'web') docColor = '#34d399';

      const docNode = {
        id: doc.id,
        title: doc.title,
        type: doc.source_type,
        x: centerX + Math.cos(docAngle) * docRadius + (Math.random() - 0.5) * 20,
        y: centerY + Math.sin(docAngle) * docRadius + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        radius: 8,
        color: docColor,
        url: doc.url
      };
      nodes.push(docNode);
      links.push({ source: topicNode, target: docNode });
    });
  });

  // Physics simulation loop
  function simulate() {
    // Spring links
    links.forEach(l => {
      const dx = l.target.x - l.source.x;
      const dy = l.target.y - l.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 80) * 0.005;
      l.source.vx += (dx / dist) * force;
      l.source.vy += (dy / dist) * force;
      l.target.vx -= (dx / dist) * force;
      l.target.vy -= (dy / dist) * force;
    });

    // Node repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 140) {
          const force = (140 - dist) * 0.02;
          nodes[i].vx -= (dx / dist) * force;
          nodes[i].vy -= (dy / dist) * force;
          nodes[j].vx += (dx / dist) * force;
          nodes[j].vy += (dy / dist) * force;
        }
      }
    }

    // Apply velocities with damping & bounds
    nodes.forEach(n => {
      n.vx *= 0.88;
      n.vy *= 0.88;
      n.x += n.vx;
      n.y += n.vy;

      n.x = Math.max(n.radius + 10, Math.min(canvas.width - n.radius - 10, n.x));
      n.y = Math.max(n.radius + 10, Math.min(canvas.height - n.radius - 10, n.y));
    });

    // Draw graph
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Links
    ctx.lineWidth = 1.5;
    links.forEach(l => {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.stroke();
    });

    // Draw Nodes
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);
      ctx.fillStyle = n.color;
      ctx.shadowBlur = n.type === 'topic' ? 14 : 6;
      ctx.shadowColor = n.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw Topic Labels
      if (n.type === 'topic') {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        const label = n.title.length > 22 ? n.title.slice(0, 20) + '...' : n.title;
        ctx.fillText(label, n.x, n.y + n.radius + 14);
      }
    });

    animationFrameId = requestAnimationFrame(simulate);
  }

  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  simulate();

  // Tooltip interaction
  canvas.onmousemove = (e) => {
    const cRect = canvas.getBoundingClientRect();
    const mx = e.clientX - cRect.left;
    const my = e.clientY - cRect.top;

    let hoveredNode = null;
    for (const n of nodes) {
      const dx = n.x - mx;
      const dy = n.y - my;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 4) {
        hoveredNode = n;
        break;
      }
    }

    if (hoveredNode) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${mx + 15}px`;
      tooltip.style.top = `${my + 15}px`;
      tooltip.innerHTML = `
        <strong style="color:${hoveredNode.color}; text-transform:uppercase; font-size:0.7rem;">[${hoveredNode.type}]</strong>
        <p style="margin-top:4px; font-weight:600;">${escapeHtml(hoveredNode.title)}</p>
      `;
    } else {
      tooltip.style.display = 'none';
    }
  };
}

// Utility Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Event Listeners
btnRunPipeline.addEventListener('click', triggerPipelineRun);
btnRefreshTopics.addEventListener('click', fetchTopics);

btnCloseModal.addEventListener('click', () => modalRunPipeline.classList.add('hidden'));
btnModalDismiss.addEventListener('click', () => modalRunPipeline.classList.add('hidden'));

// Search Filters
topicSearchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = state.topics.filter(t => 
    t.title.toLowerCase().includes(query) ||
    t.summary.toLowerCase().includes(query) ||
    (t.keywords || []).some(k => k.toLowerCase().includes(query))
  );
  renderTopics(filtered);
});

docSearchInput.addEventListener('input', () => filterDocs());
docSourceFilter.addEventListener('change', () => filterDocs());

function filterDocs() {
  const query = docSearchInput.value.toLowerCase();
  const source = docSourceFilter.value;

  const filtered = state.documents.filter(d => {
    const matchQuery = (d.title && d.title.toLowerCase().includes(query)) || 
                       (d.abstract && d.abstract.toLowerCase().includes(query)) ||
                       (d.authors && JSON.stringify(d.authors).toLowerCase().includes(query));
    const matchSource = !source || d.source_type === source;
    return matchQuery && matchSource;
  });

  renderDocuments(filtered);
}

// Export Buttons
btnCopyMd.addEventListener('click', () => {
  navigator.clipboard.writeText(markdownExportPreview.value).then(() => {
    btnCopyMd.textContent = '✓ Copied!';
    setTimeout(() => { btnCopyMd.textContent = '📋 Copy Markdown'; }, 2000);
  });
});

btnDownloadMd.addEventListener('click', () => {
  const blob = new Blob([markdownExportPreview.value], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `research-topic-digest-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

// Add Source Modal
btnAddSourceModal.addEventListener('click', () => modalAddSource.classList.remove('hidden'));
btnCloseSourceModal.addEventListener('click', () => modalAddSource.classList.add('hidden'));
btnCancelSource.addEventListener('click', () => modalAddSource.classList.add('hidden'));

btnSaveSource.addEventListener('click', async () => {
  const type = document.getElementById('new-source-type').value;
  const name = document.getElementById('new-source-name').value.trim();
  const query = document.getElementById('new-source-query').value.trim();

  if (!name || !query) {
    alert('Please enter both name and query/feed URL.');
    return;
  }

  try {
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name, query, enabled: true, frequency: 'daily' })
    });
    const data = await res.json();
    if (data.success) {
      modalAddSource.classList.add('hidden');
      await fetchSources();
    }
  } catch (e) {
    alert(`Failed to save stream: ${e.message}`);
  }
});

// App Start
initApp();
