import { chunkDocument } from '../processing/chunker.js';

/**
 * Topic Synthesizer Agent:
 * Takes a ranked cluster of documents and generates a structured research topic digest.
 */
export async function synthesizeTopicDigest(cluster) {
  const docs = cluster.documents || [];
  if (docs.length === 0) return cluster;

  // Check if external LLM API key is available
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await synthesizeWithGemini(cluster, process.env.GEMINI_API_KEY);
      if (result) return { ...cluster, ...result };
    } catch (e) {
      console.warn(`[Synthesizer] Gemini API call failed (${e.message}), using local synthesis engine.`);
    }
  } else if (process.env.OPENAI_API_KEY) {
    try {
      const result = await synthesizeWithOpenAI(cluster, process.env.OPENAI_API_KEY);
      if (result) return { ...cluster, ...result };
    } catch (e) {
      console.warn(`[Synthesizer] OpenAI API call failed (${e.message}), using local synthesis engine.`);
    }
  }

  // High-performance Grounded Heuristic Synthesizer (RAG chunk synthesis)
  return synthesizeHeuristic(cluster);
}

/**
 * Grounded Heuristic Synthesizer:
 * Aggregates structured sections (Context, Innovation, Findings, Implications) from clustered documents
 * to generate a cohesive synthesis without external API dependencies.
 */
function synthesizeHeuristic(cluster) {
  const docs = cluster.documents || [];
  const chunkedDocs = docs.map(d => chunkDocument(d));

  const arxivCount = docs.filter(d => d.source_type === 'arxiv').length;
  const newsletterCount = docs.filter(d => d.source_type === 'newsletter').length;
  const searchCount = docs.filter(d => d.source_type === 'search' || d.source_type === 'web').length;

  const mainDoc = docs[0] || {};
  const keywords = (cluster.keywords || []).slice(0, 4).join(', ');

  // 1. Executive Summary
  let summary = '';
  if (docs.length === 1) {
    summary = `This research explores ${mainDoc.title.toLowerCase()}. ${mainDoc.abstract}`;
  } else {
    summary = `Recent developments across ${docs.length} independent publications emphasize accelerating progress in ${keywords || 'AI architectures'}. Primary findings point to improved efficiency, structured reasoning, and cross-source verification across peer-reviewed arXiv preprints and industry newsletters.`;
  }

  // 2. Key Insights
  const keyInsights = [];
  chunkedDocs.forEach((cd, i) => {
    if (cd.sections?.innovation) {
      keyInsights.push({
        source: cd.title,
        insight: cd.sections.innovation,
        author: (cd.authors && cd.authors[0]) || 'Researchers'
      });
    } else if (cd.abstract) {
      keyInsights.push({
        source: cd.title,
        insight: cd.abstract.slice(0, 180) + '...',
        author: (cd.authors && cd.authors[0]) || 'Contributors'
      });
    }
  });

  // 3. Breakthroughs & Novel Contributions
  const breakthroughs = [];
  chunkedDocs.forEach(cd => {
    if (cd.sections?.findings) {
      breakthroughs.push(cd.sections.findings);
    }
  });
  if (breakthroughs.length === 0 && mainDoc.abstract) {
    breakthroughs.push(mainDoc.abstract.slice(0, 220));
  }

  // 4. Cross-Source Analysis
  let crossSourceAnalysis = '';
  if (arxivCount > 0 && newsletterCount > 0) {
    crossSourceAnalysis = `Strong cross-source agreement: Academic papers provide theoretical grounding and empirical benchmarks, while industry newsletters focus on practical operationalization and system integration trade-offs.`;
  } else if (arxivCount > 1) {
    crossSourceAnalysis = `Multiple independent academic teams on arXiv are converging on complementary architectures with shared benchmark evaluations.`;
  } else {
    crossSourceAnalysis = `Emerging single-stream development with potential for wider industry adoption and peer validation.`;
  }

  // 5. Open Questions & Future Research
  const openQuestions = [
    `How will these techniques scale across multi-modal benchmarks and production latencies?`,
    `What are the compute trade-offs and memory overheads when deploying in resource-constrained environments?`
  ];
  chunkedDocs.forEach(cd => {
    if (cd.sections?.implications) {
      openQuestions.unshift(cd.sections.implications);
    }
  });

  return {
    ...cluster,
    summary,
    key_insights: keyInsights.slice(0, 4),
    breakthroughs: breakthroughs.slice(0, 3),
    cross_source_analysis: crossSourceAnalysis,
    open_questions: openQuestions.slice(0, 3)
  };
}

/**
 * Gemini LLM Synthesis
 */
async function synthesizeWithGemini(cluster, apiKey) {
  const docs = cluster.documents || [];
  const prompt = `You are a Principal AI Research Scientist. Synthesize a research topic digest for the following cluster of ${docs.length} papers/articles:
Topic Keywords: ${(cluster.keywords || []).join(', ')}

Documents:
${docs.map((d, i) => `[Doc ${i+1}] Title: ${d.title} (Source: ${d.source_type}, URL: ${d.url})\nAbstract: ${d.abstract}`).join('\n\n')}

Respond ONLY with valid JSON matching this schema:
{
  "title": "Concise Descriptive Title for Topic",
  "summary": "Comprehensive 2-paragraph executive synthesis",
  "key_insights": [{"source": "Doc Title", "insight": "Core takeaway", "author": "Author name"}],
  "breakthroughs": ["Point 1", "Point 2"],
  "cross_source_analysis": "Synthesis of academic consensus vs newsletter reports",
  "open_questions": ["Question 1", "Question 2"]
}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });

  if (!res.ok) throw new Error(`Gemini API returned status ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

/**
 * OpenAI LLM Synthesis
 */
async function synthesizeWithOpenAI(cluster, apiKey) {
  const docs = cluster.documents || [];
  const prompt = `Synthesize a research topic digest for these ${docs.length} papers:\n` +
    docs.map((d, i) => `[${i+1}] ${d.title} (${d.source_type}): ${d.abstract}`).join('\n\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an AI research digest synthesizer. Output JSON with fields: title, summary, key_insights (array of {source, insight, author}), breakthroughs (array), cross_source_analysis, open_questions (array).' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) throw new Error(`OpenAI API returned status ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
