import { useState } from 'react';
import api from '../../api/client';

export default function AIChat() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const ask = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/ai/analyze', {
        scope_type: 'grade',
        scope: '6',
        question: question
      });
      setAnswer(res.data.summary || 'No response');
    } catch (err) {
      setAnswer('AI service unavailable. Please configure Groq API key in backend.');
    }
    setLoading(false);
  };

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>AI Assistant</h2>
        <p>Ask questions about school performance</p>
      </div>

      <div className="glass" style={{ padding: 28, marginBottom: 24 }}>
        <form onSubmit={ask} style={{ display: 'flex', gap: 12 }}>
          <input
            type="text"
            placeholder="e.g., Who is the top performer in Grade 6?"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            className="input"
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ minWidth: 100 }}>
            {loading ? '...' : 'Ask'}
          </button>
        </form>
      </div>

      {answer && (
        <div className="glass animate-scale" style={{ padding: 28, background: 'linear-gradient(135deg, #faf5ff 0%, #f0e6ff 100%)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            Response
          </h3>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-primary)' }}>{answer}</p>
        </div>
      )}
    </div>
  );
}