/**
 * Multi-Factor Ranking & Scoring Agent:
 * Evaluates each topic cluster by cross-source authority, publication recency,
 * document volume, cluster coherence, and user feedback history.
 */
export function rankTopicClusters(clusters, userFeedback = [], trackedKeywords = ['agentic', 'rag', 'llm', 'reasoning', 'multimodal']) {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Build feedback sentiment map by topic/keyword
  const positiveKeywords = new Set();
  const negativeKeywords = new Set();

  for (const fb of userFeedback) {
    if (fb.rating === 'thumbs_up' && fb.note) {
      fb.note.toLowerCase().split(/\s+/).forEach(w => positiveKeywords.add(w));
    } else if (fb.rating === 'thumbs_down' && fb.note) {
      fb.note.toLowerCase().split(/\s+/).forEach(w => negativeKeywords.add(w));
    }
  }

  return clusters.map(cluster => {
    // 1. Cross-Source Corroboration Score (0.0 to 1.0)
    // Topics covered across both arXiv research papers AND newsletters/search are high-signal
    const sourceTypes = new Set(cluster.source_types || []);
    let crossSourceScore = 0.5;
    if (sourceTypes.size >= 3) crossSourceScore = 1.0;
    else if (sourceTypes.size === 2) crossSourceScore = 0.85;
    else if (sourceTypes.has('arxiv')) crossSourceScore = 0.70;

    // 2. Volume and Breadth (0.0 to 1.0)
    const docCount = (cluster.documents || []).length;
    const volumeScore = Math.min(1.0, 0.4 + (docCount * 0.15));

    // 3. Recency Decay Score (0.0 to 1.0)
    let avgAgeDays = 1.0;
    if (cluster.documents && cluster.documents.length > 0) {
      const totalAge = cluster.documents.reduce((acc, d) => {
        const pubTime = new Date(d.published_at || d.created_at || now).getTime();
        const ageDays = Math.max(0, (now - pubTime) / ONE_DAY_MS);
        return acc + ageDays;
      }, 0);
      avgAgeDays = totalAge / cluster.documents.length;
    }
    // Exponential decay with 14-day half-life
    const recencyScore = Math.exp(-avgAgeDays / 14);

    // 4. Keyword & Interest Alignment Score (0.0 to 1.0)
    let interestScore = 0.5;
    const clusterText = (cluster.title + ' ' + (cluster.keywords || []).join(' ')).toLowerCase();
    for (const kw of trackedKeywords) {
      if (clusterText.includes(kw.toLowerCase())) {
        interestScore += 0.15;
      }
    }
    interestScore = Math.min(1.0, interestScore);

    // 5. User Feedback Multiplier (0.5 to 1.5)
    let feedbackMultiplier = 1.0;
    for (const kw of positiveKeywords) {
      if (clusterText.includes(kw)) feedbackMultiplier += 0.15;
    }
    for (const kw of negativeKeywords) {
      if (clusterText.includes(kw)) feedbackMultiplier -= 0.25;
    }
    feedbackMultiplier = Math.max(0.4, Math.min(1.6, feedbackMultiplier));

    // Composite Weighted Rank Score
    const rawScore = (
      crossSourceScore * 0.30 +
      volumeScore * 0.25 +
      recencyScore * 0.25 +
      interestScore * 0.20
    ) * feedbackMultiplier;

    const normalizedRank = Number(Math.min(0.99, Math.max(0.10, rawScore)).toFixed(3));

    return {
      ...cluster,
      rank_score: normalizedRank,
      ranking_factors: {
        cross_source_score: Number(crossSourceScore.toFixed(2)),
        volume_score: Number(volumeScore.toFixed(2)),
        recency_score: Number(recencyScore.toFixed(2)),
        interest_score: Number(interestScore.toFixed(2)),
        feedback_multiplier: Number(feedbackMultiplier.toFixed(2))
      }
    };
  }).sort((a, b) => b.rank_score - a.rank_score);
}
