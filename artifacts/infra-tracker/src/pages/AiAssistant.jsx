import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Bot, Search, Send, Loader2, FileText, Download, 
  Sparkles, AlertCircle, Database, CheckCircle2, 
  Clock, AlertTriangle, Plus, MessageSquare
} from 'lucide-react';

const EXAMPLE_PROMPTS = [
  "Show me all blocked items across all universities",
  "Which classrooms are pending in Zone 1?",
  "List overdue lab equipment deliveries",
  "Summarize the latest updates for staff areas"
];

export default function AiAssistant() {
  const { authFetch } = useAuth();
  const [question, setQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [response, setResponse] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const conversationLoadRef = useRef(0);

  useEffect(() => {
    const loadConversations = async () => {
      try {
        const res = await authFetch('/assistant/conversations');
        setConversations(Array.isArray(res.conversations) ? res.conversations : []);
      } catch (err) {
        setError(err.message || 'Could not load recent conversations.');
      } finally {
        setIsLoadingHistory(false);
      }
    };
    loadConversations();
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSubmit = async (e, overrideQuestion = null) => {
    if (e) e.preventDefault();
    if (isLoadingHistory) return;
    const q = overrideQuestion || question;
    if (!q.trim()) return;

    setQuestion('');
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await authFetch('/assistant/query', {
        method: 'POST',
        body: JSON.stringify({ question: q, conversationId })
      });
      const nextResponse = {
        answer: res.answer || "No detailed summary provided.",
        records: Array.isArray(res.records) ? res.records : []
      };
      setResponse(nextResponse);
      setConversationId(res.conversationId);
      setMessages(previous => [
        ...previous,
        { id: `user-${Date.now()}`, role: 'user', content: q, records: [] },
        { id: `assistant-${Date.now()}`, role: 'assistant', content: nextResponse.answer, records: nextResponse.records }
      ]);
      authFetch('/assistant/conversations')
        .then(list => setConversations(Array.isArray(list.conversations) ? list.conversations : []))
        .catch(() => {});
    } catch (err) {
      setError(err.message || 'Failed to communicate with AI Command Center.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startNewConversation = () => {
    if (isSubmitting || isLoadingHistory) return;
    conversationLoadRef.current += 1;
    setConversationId(null);
    setMessages([]);
    setResponse(null);
    setQuestion('');
    setError(null);
    inputRef.current?.focus();
  };

  const openConversation = async (id) => {
    if (isSubmitting || isLoadingHistory) return;
    const loadId = conversationLoadRef.current + 1;
    conversationLoadRef.current = loadId;
    setIsLoadingHistory(true);
    setError(null);
    try {
      const res = await authFetch(`/assistant/conversations/${id}`);
      if (conversationLoadRef.current !== loadId) return;
      const conversation = res.conversation;
      const loadedMessages = Array.isArray(conversation?.messages) ? conversation.messages : [];
      setConversationId(conversation.id);
      setMessages(loadedMessages);
      const latestAnswer = [...loadedMessages].reverse().find(message => message.role === 'assistant');
      setResponse(latestAnswer ? { answer: latestAnswer.content, records: latestAnswer.records || [] } : null);
      setQuestion('');
    } catch (err) {
      if (conversationLoadRef.current !== loadId) return;
      setError(err.message || 'Could not open that conversation.');
    } finally {
      if (conversationLoadRef.current === loadId) setIsLoadingHistory(false);
    }
  };

  const handleExampleClick = (prompt) => {
    handleSubmit(null, prompt);
  };

  const escapeCSV = (str) => {
    if (str === null || str === undefined) return '""';
    const escaped = String(str).replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const downloadCSV = () => {
    if (!response?.records?.length) return;
    const headers = ['University', 'Area', 'Category', 'Line Item', 'Status', 'Timeline', 'Remarks', 'Updated At'];
    
    const rows = response.records.map(r => [
      escapeCSV(r.university),
      escapeCSV(r.area),
      escapeCSV(r.category),
      escapeCSV(r.lineItem),
      escapeCSV(r.status),
      escapeCSV(r.timeline),
      escapeCSV(r.remarks),
      escapeCSV(r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '')
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ai-export-${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const saveAsPDF = () => {
    if (!response?.records?.length) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("Please allow popups to generate the report.");
      return;
    }
    
    const rows = response.records.map(r => `
      <tr>
        <td>${escapeHTML(r.university)}</td>
        <td>${escapeHTML(r.area)}</td>
        <td>${escapeHTML(r.category)}</td>
        <td>${escapeHTML(r.lineItem)}</td>
        <td>${escapeHTML(r.status)}</td>
        <td>${escapeHTML(r.timeline)}</td>
        <td>${escapeHTML(r.remarks)}</td>
        <td>${escapeHTML(r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '')}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>AI Assistant Export</title>
          <style>
            body { font-family: 'Outfit', sans-serif; color: #0f172a; padding: 2rem; }
            .header { margin-bottom: 2rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 1rem; }
            .header h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; }
            .query-text { color: #475569; font-size: 1rem; }
            .answer { background: #f8fafc; padding: 1.5rem; border-left: 4px solid #2563eb; margin-bottom: 2rem; border-radius: 0 8px 8px 0; }
            .answer strong { display: block; margin-bottom: 0.5rem; color: #1e40af; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.05em; }
            table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
            th, td { border: 1px solid #e2e8f0; padding: 0.75rem; text-align: left; vertical-align: top; }
            th { background: #f1f5f9; font-weight: 600; color: #475569; }
            tr:nth-child(even) { background-color: #f8fafc; }
            @media print {
              body { padding: 0; }
              .answer { border-left-color: #2563eb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Infrastructure Tracker AI Report</h1>
            <div class="query-text"><strong>Conversation:</strong> ${escapeHTML(conversations.find(item => item.id === conversationId)?.title || 'AI Assistant')}</div>
          </div>
          <div class="answer">
            <strong>Analyst Summary</strong>
            <div>${escapeHTML(response.answer).replace(/\n/g, '<br/>')}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>University</th>
                <th>Area</th>
                <th>Category</th>
                <th>Line Item</th>
                <th>Status</th>
                <th>Timeline</th>
                <th>Remarks</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <script>
            window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 250); };
          </script>
        </body>
      </html>
    `;
    
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const getStatusClass = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('pending')) return 'badge badge-warning';
    if (s.includes('completed') || s.includes('done')) return 'badge badge-success';
    if (s.includes('blocked') || s.includes('issue')) return 'badge badge-danger';
    return 'badge badge-neutral';
  };
  
  const getStatusIcon = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('pending')) return <Clock size={12} />;
    if (s.includes('completed') || s.includes('done')) return <CheckCircle2 size={12} />;
    if (s.includes('blocked') || s.includes('issue')) return <AlertTriangle size={12} />;
    return null;
  };

  const hasSearched = messages.length > 0 || isSubmitting || error !== null;

  return (
    <div className="ai-assistant-shell">
      <aside className="ai-assistant-sidebar">
        <button type="button" className="ai-assistant-new-btn" onClick={startNewConversation} disabled={isSubmitting || isLoadingHistory}>
          <Plus size={16} /> New conversation
        </button>
        <div className="ai-assistant-history-label">Recent conversations</div>
        {isLoadingHistory && conversations.length === 0 ? (
          <Loader2 size={18} className="spin ai-assistant-history-loader" />
        ) : conversations.length === 0 ? (
          <p className="ai-assistant-history-empty">Your conversations will appear here.</p>
        ) : conversations.map(item => (
          <button
            type="button"
            key={item.id}
            className={`ai-assistant-history-item ${conversationId === item.id ? 'active' : ''}`}
            onClick={() => openConversation(item.id)}
            disabled={isSubmitting || isLoadingHistory}
          >
            <MessageSquare size={15} />
            <span>{item.title}</span>
          </button>
        ))}
      </aside>
      <div className="ai-assistant-wrapper">
      <div className={`ai-assistant-header-box ${hasSearched ? 'compact' : ''}`}>
        <h1 className="ai-assistant-title">
          {!hasSearched && <Bot size={40} className="text-accent-primary" />}
          Command Center AI
        </h1>
        <p className="ai-assistant-subtitle">
          Ask questions about university checklist data, timelines, and statuses.
        </p>

        <form onSubmit={(e) => handleSubmit(e)} className="ai-assistant-search-form mt-4">
          <div className="ai-assistant-input-wrapper">
            <Search className="ai-assistant-icon-bot" size={24} />
            <input
              ref={inputRef}
              type="text"
              className="ai-assistant-input"
               placeholder={messages.length ? "Ask a follow-up question..." : "e.g. Which classrooms are pending in Zone 1?"}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={isSubmitting || isLoadingHistory}
            />
            <button 
              type="submit" 
              className="ai-assistant-submit-btn"
              disabled={isSubmitting || isLoadingHistory || !question.trim()}
              title="Send query"
            >
              {isSubmitting ? <Loader2 size={20} className="spin" /> : <Send size={20} />}
            </button>
          </div>

          {!hasSearched && (
            <div className="ai-assistant-suggestions">
              {EXAMPLE_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleExampleClick(prompt)}
                  className="ai-assistant-suggestion-chip"
                  disabled={isSubmitting || isLoadingHistory}
                >
                  <Sparkles size={14} />
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </form>
      </div>

      {error && (
        <div className="ai-assistant-error-banner">
          <AlertCircle size={24} />
          <div>
            <strong>Query Failed</strong>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {isSubmitting && !response && !error && (
        <div className="ai-assistant-empty-state">
          <Loader2 size={48} className="spin text-accent-primary mb-4" />
          <p className="text-lg font-medium text-text-primary">Analyzing Infrastructure Data...</p>
          <p className="text-sm text-text-secondary mt-2">Searching across regions and checklist items</p>
        </div>
      )}

      {response && (
        <div className="ai-assistant-results-area">
          <div className="ai-assistant-transcript">
            {messages.map(message => (
              <div key={message.id} className={`ai-assistant-message ${message.role}`}>
                <span>{message.role === 'user' ? 'You' : 'AI Assistant'}</span>
                <p>{message.content}</p>
                {message.role === 'assistant' && Array.isArray(message.records) && message.records.length > 0 && (
                  <button
                    type="button"
                    className="ai-assistant-sources-link"
                    onClick={() => setResponse({ answer: message.content, records: message.records })}
                  >
                    <Database size={13} />
                    View {message.records.length} grounded {message.records.length === 1 ? 'record' : 'records'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="ai-assistant-answer-card">
            <div className="ai-assistant-answer-icon">
              <Sparkles size={28} />
            </div>
            <div className="ai-assistant-answer-content">
              <span className="ai-assistant-answer-label">Analyst Summary</span>
              <div className="ai-assistant-answer-text">
                {response.answer}
              </div>
            </div>
          </div>

          {response.records && response.records.length > 0 ? (
            <div className="ai-assistant-records-section">
              <div className="ai-assistant-records-header">
                <div className="ai-assistant-records-title">
                  <Database size={20} className="text-accent-primary" />
                  Grounded Records
                  <span className="ai-assistant-records-count">{response.records.length} items</span>
                </div>
                <div className="ai-assistant-toolbar">
                  <button onClick={downloadCSV} className="ai-assistant-btn-outline">
                    <Download size={16} />
                    Download CSV
                  </button>
                  <button onClick={saveAsPDF} className="ai-assistant-btn-outline">
                    <FileText size={16} />
                    Save as PDF
                  </button>
                </div>
              </div>

              <div className="ai-assistant-table-container">
                <div className="ai-assistant-table-scroll">
                  <table className="ai-assistant-table">
                    <thead>
                      <tr>
                        <th>University</th>
                        <th>Area</th>
                        <th>Category</th>
                        <th>Line Item</th>
                        <th>Status</th>
                        <th>Timeline</th>
                        <th>Remarks</th>
                        <th>Updated At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {response.records.map((record, i) => (
                        <tr key={i}>
                          <td className="font-medium ai-assistant-td-nowrap">{record.university || '-'}</td>
                          <td className="ai-assistant-td-nowrap">{record.area || '-'}</td>
                          <td className="ai-assistant-td-nowrap">{record.category || '-'}</td>
                          <td>{record.lineItem || '-'}</td>
                          <td className="ai-assistant-td-nowrap">
                            <span className={getStatusClass(record.status)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              {getStatusIcon(record.status)}
                              {record.status || 'Unknown'}
                            </span>
                          </td>
                          <td className="ai-assistant-td-nowrap">{record.timeline || '-'}</td>
                          <td className="ai-assistant-td-truncate" title={record.remarks}>
                            {record.remarks || '-'}
                          </td>
                          <td className="ai-assistant-td-nowrap text-text-secondary">
                            {record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="ai-assistant-empty-state" style={{ padding: '2rem', marginTop: 0 }}>
              <Database size={32} className="ai-assistant-empty-icon" />
              <p className="font-medium text-text-primary">No records found matching this query.</p>
              <p className="text-sm mt-1">The AI answered based on general knowledge or summary, but returned zero specific lines.</p>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
