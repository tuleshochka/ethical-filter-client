import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Input, Button, List, Avatar, Space, Typography, Badge, ConfigProvider, Tooltip, Tag } from 'antd';
import { 
  SendOutlined, 
  UserOutlined, 
  RobotOutlined, 
  PlusOutlined, 
  DeleteOutlined,
  MessageOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import type { ThemeConfig } from 'antd';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

// ────────────────────────── Types ──────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  strategy?: string;
  isStreaming?: boolean;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
}

interface WSStrategyMessage {
  type: 'strategy';
  strategy: string;
  pii_detected: boolean;
}

interface WSTokenMessage {
  type: 'token';
  content: string;
}

interface WSMetadataMessage {
  type: 'metadata';
  strategy: string;
  scores: Record<string, number>;
  latency_ms: number;
  is_mock: boolean;
  bypassed: boolean;
}

interface WSErrorMessage {
  type: 'error';
  content: string;
}

type WSMessage = WSStrategyMessage | WSTokenMessage | WSMetadataMessage | WSErrorMessage;

// ──────────────────── Strategy Visuals ────────────────────

const STRATEGY_META: Record<string, { color: string; label: string }> = {
  ALLOW:    { color: 'success',    label: 'Разрешено' },
  SOFTEN:   { color: 'processing', label: 'Смягчение' },
  CAUTION:  { color: 'warning',    label: 'Предупреждение' },
  CLARIFY:  { color: 'blue',       label: 'Уточнение' },
  REDIRECT: { color: 'purple',     label: 'Перенаправление' },
  REFUSE:   { color: 'error',      label: 'Отказ' },
};

// ────────────────────── Theme ──────────────────────────────

const clientTheme: ThemeConfig = {
  token: {
    colorPrimary: '#4f46e5',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    colorInfo: '#3b82f6',
    borderRadius: 8,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    colorBgLayout: '#f8fafc',
    colorBgContainer: '#ffffff',
    colorText: '#0f172a',
    colorTextSecondary: '#475569',
  },
  components: {
    Layout: {
      bodyBg: '#f8fafc',
      headerBg: '#ffffff',
      siderBg: '#ffffff',
    }
  }
};

// ────────────────────── Constants ─────────────────────────

const INITIAL_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'Привет! Я ваш корпоративный ИИ-ассистент. Моя работа защищена адаптивным контекстным шлюзом безопасности. Напишите ваш запрос, и я постараюсь помочь вам в рамках правил безопасности организации.'
};

function createDefaultSession(): ChatSession {
  return {
    id: Date.now().toString(),
    title: 'Новый диалог',
    messages: [INITIAL_MESSAGE]
  };
}

// ────────────────────── Component ─────────────────────────

function App(): React.ReactElement {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('chat_sessions');
      if (saved) {
        const parsed = JSON.parse(saved) as ChatSession[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [createDefaultSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id ?? '1');
  const [inputVal, setInputVal] = useState('');
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [currentStrategy, setCurrentStrategy] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Refs for stable WebSocket access
  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? sessions[0];

  // Keep ref in sync
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Save sessions to localStorage
  useEffect(() => {
    localStorage.setItem('chat_sessions', JSON.stringify(sessions));
  }, [sessions]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, streamingMessage]);

  // ─── WebSocket lifecycle (single connection, no dependency on sessionId) ───
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let isMounted = true;

    const connectWs = () => {
      if (!isMounted) return;

      const socket = new WebSocket('ws://127.0.0.1:8000/api/v1/chat/ws');

      socket.onopen = () => {
        console.log('WebSocket connected');
      };

      socket.onmessage = (event: MessageEvent) => {
        const data = JSON.parse(event.data) as WSMessage;

        if (data.type === 'strategy') {
          setCurrentStrategy((data as WSStrategyMessage).strategy);
        }
        else if (data.type === 'token') {
          setStreamingMessage(prev =>
            prev === null ? (data as WSTokenMessage).content : prev + (data as WSTokenMessage).content
          );
        }
        else if (data.type === 'metadata') {
          const meta = data as WSMetadataMessage;
          setStreamingMessage(currentStream => {
            if (currentStream !== null) {
              setSessions(prevSessions => prevSessions.map(session => {
                if (session.id === activeSessionIdRef.current) {
                  return {
                    ...session,
                    messages: [...session.messages, {
                      role: 'assistant' as const,
                      content: currentStream,
                      strategy: meta.strategy,
                    }]
                  };
                }
                return session;
              }));
            }
            return null;
          });
          setIsSending(false);
          setCurrentStrategy(null);
        }
        else if (data.type === 'error') {
          const errMsg = (data as WSErrorMessage).content;
          console.error('WS Error:', errMsg);
          setSessions(prevSessions => prevSessions.map(session => {
            if (session.id === activeSessionIdRef.current) {
              return {
                ...session,
                messages: [...session.messages, { role: 'assistant' as const, content: `[Ошибка: ${errMsg}]` }]
              };
            }
            return session;
          }));
          setIsSending(false);
          setStreamingMessage(null);
          setCurrentStrategy(null);
        }
      };

      socket.onclose = () => {
        console.log('WebSocket disconnected, retrying in 3s...');
        if (isMounted) {
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      };

      wsRef.current = socket;
    };

    connectWs();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []); // ← Empty deps: single WS for entire app lifecycle

  // ─── Handlers ───

  const handleSend = useCallback(() => {
    if (!inputVal.trim() || isSending) return;

    const userText = inputVal.trim();
    setInputVal('');
    setIsSending(true);
    setStreamingMessage('');

    // Add user message to session
    setSessions(prev => prev.map(session => {
      if (session.id === activeSessionId) {
        const updatedMsgs: ChatMessage[] = [...session.messages, { role: 'user', content: userText }];
        let title = session.title;
        if (session.title === 'Новый диалог' && session.messages.length === 1) {
          title = userText.slice(0, 24) + (userText.length > 24 ? '...' : '');
        }
        return { ...session, title, messages: updatedMsgs };
      }
      return session;
    }));

    // Prepare history payload (exclude error messages)
    const history = (activeSession?.messages ?? [])
      .filter(msg => !msg.content.startsWith('[Ошибка:'))
      .map(msg => ({ role: msg.role, content: msg.content }));

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ message: userText, history }));
    } else {
      console.error('WS not connected');
      setSessions(prev => prev.map(session => {
        if (session.id === activeSessionId) {
          return {
            ...session,
            messages: [...session.messages, {
              role: 'assistant' as const,
              content: '[Ошибка соединения: Веб-сокет не активен. Подключаюсь к серверу...]'
            }]
          };
        }
        return session;
      }));
      setIsSending(false);
      setStreamingMessage(null);
    }
  }, [inputVal, isSending, activeSessionId, activeSession]);

  const createNewSession = useCallback(() => {
    const newSession = createDefaultSession();
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  }, []);

  const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length === 1) {
      const fresh = createDefaultSession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      return;
    }
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    if (activeSessionId === id) {
      setActiveSessionId(updated[0].id);
    }
  }, [sessions, activeSessionId]);

  // ─── Render ───

  const renderStrategyBadge = (strategy?: string) => {
    if (!strategy || strategy === 'ALLOW') return null;
    const meta = STRATEGY_META[strategy];
    if (!meta) return null;
    return (
      <Tag
        color={meta.color}
        style={{ fontSize: '11px', marginTop: '6px', borderRadius: '4px' }}
        icon={<SafetyCertificateOutlined />}
      >
        Стратегия: {meta.label}
      </Tag>
    );
  };

  return (
    <ConfigProvider theme={clientTheme}>
      <Layout style={{ minHeight: '100vh', flexDirection: 'row' }}>
        {/* Sidebar for Sessions */}
        <Sider
          width={280}
          theme="light"
          style={{
            borderRight: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            position: 'sticky',
            top: 0,
            left: 0,
            boxShadow: '2px 0 8px 0 rgba(29,35,41,.02)',
            zIndex: 10
          }}
        >
          <div style={{ padding: '20px 16px', borderBottom: '1px solid #f1f5f9' }}>
            <Button 
              type="primary" 
              icon={<PlusOutlined />} 
              block 
              onClick={createNewSession}
              style={{
                height: '40px',
                fontWeight: 500,
                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.15)'
              }}
            >
              Новый чат
            </Button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
            <List
              dataSource={sessions}
              renderItem={(item: ChatSession) => (
                <div 
                  onClick={() => setActiveSessionId(item.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: item.id === activeSessionId ? '#e0e7ff' : 'transparent',
                    color: item.id === activeSessionId ? '#4f46e5' : '#475569',
                    marginBottom: '4px',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <Space style={{ minWidth: 0, overflow: 'hidden' }}>
                    <MessageOutlined style={{ flexShrink: 0 }} />
                    <Text 
                      strong={item.id === activeSessionId} 
                      style={{ 
                        color: item.id === activeSessionId ? '#4f46e5' : '#475569',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'block',
                        width: '170px'
                      }}
                    >
                      {item.title}
                    </Text>
                  </Space>
                  <Tooltip title="Удалить диалог">
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<DeleteOutlined />} 
                      onClick={(e) => deleteSession(item.id, e)}
                      style={{
                        color: item.id === activeSessionId ? '#4f46e5' : '#94a3b8',
                      }}
                    />
                  </Tooltip>
                </div>
              )}
            />
          </div>

          <div style={{ 
            padding: '16px', 
            borderTop: '1px solid #f1f5f9', 
            backgroundColor: '#fafafa',
            margin: '8px',
            borderRadius: '8px'
          }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Безопасность
              </Text>
              <Space size={6} align="center">
                <Badge status="processing" color="#10b981" />
                <Text strong style={{ fontSize: '12px', color: '#1e293b' }}>
                  Шлюз Guardrails активен
                </Text>
              </Space>
              <Text type="secondary" style={{ fontSize: '11px', lineHeight: '1.2', display: 'block', marginTop: '4px' }}>
                Контекст запросов фильтруется на сервере в режиме реального времени.
              </Text>
            </Space>
          </div>
        </Sider>

        <Layout style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <Header 
            style={{ 
              padding: '0 24px', 
              borderBottom: '1px solid #e2e8f0', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)'
            }}
          >
            <Space size="middle">
              <LockOutlined style={{ fontSize: '20px', color: '#4f46e5' }} />
              <div>
                <Title level={4} style={{ margin: 0, color: '#0f172a', fontWeight: 700, fontSize: '15px' }}>
                  Безопасный корпоративный ассистент
                </Title>
              </div>
            </Space>
            
            <Space size="small">
              <Badge status="success" />
              <Text style={{ fontSize: '13px', color: '#64748b' }}>
                Защищенный VPN контур
              </Text>
            </Space>
          </Header>

          {/* Chat Content Area */}
          <Content style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
            <div style={{ 
              flex: 1, 
              overflowY: 'auto', 
              padding: '24px 24px 12px 24px',
              maxWidth: '850px',
              width: '100%',
              margin: '0 auto',
              boxSizing: 'border-box'
            }}>
              <List
                dataSource={[
                  ...(activeSession?.messages ?? []),
                  ...(streamingMessage !== null
                    ? [{ role: 'assistant' as const, content: streamingMessage, isStreaming: true, strategy: currentStrategy ?? undefined }]
                    : [])
                ]}
                renderItem={(item: ChatMessage) => (
                  <div 
                    style={{ 
                      display: 'flex',
                      justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start',
                      marginBottom: '20px',
                      animation: 'fadeIn 0.25s ease-out forwards'
                    }}
                  >
                    <Space 
                      align="start" 
                      size="middle"
                      style={{ 
                        maxWidth: '80%', 
                        flexDirection: item.role === 'user' ? 'row-reverse' : 'row' 
                      }}
                    >
                      <Avatar 
                        icon={item.role === 'user' ? <UserOutlined /> : <RobotOutlined />} 
                        style={{ 
                          backgroundColor: item.role === 'user' ? '#e0e7ff' : '#4f46e5',
                          color: item.role === 'user' ? '#4f46e5' : '#ffffff',
                          flexShrink: 0
                        }} 
                      />
                      <div>
                        <div style={{
                          padding: '12px 16px',
                          borderRadius: '12px',
                          backgroundColor: item.role === 'user' ? '#4f46e5' : '#ffffff',
                          color: item.role === 'user' ? '#ffffff' : '#1e293b',
                          boxShadow: item.role === 'user' 
                            ? '0 4px 6px -1px rgba(79, 70, 229, 0.15)' 
                            : '0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 2px 4px -2px rgba(0, 0, 0, 0.03)',
                          border: item.role === 'user' ? 'none' : '1px solid #f1f5f9',
                          whiteSpace: 'pre-wrap',
                          fontSize: '14px',
                          lineHeight: '1.6'
                        }}>
                          {item.content}
                          {item.isStreaming && (
                            <LoadingOutlined style={{ marginLeft: '6px', color: '#94a3b8' }} />
                          )}
                        </div>
                        {item.role === 'assistant' && renderStrategyBadge(item.strategy)}
                      </div>
                    </Space>
                  </div>
                )}
              />
              <div ref={chatEndRef} />
            </div>

            {/* Input Bar */}
            <div style={{ 
              padding: '12px 24px 24px 24px', 
              maxWidth: '850px',
              width: '100%',
              margin: '0 auto',
              boxSizing: 'border-box'
            }}>
              <div style={{ 
                display: 'flex', 
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '8px',
                boxShadow: '0 4px 12px -2px rgba(0,0,0,0.05)',
                alignItems: 'flex-end'
              }}>
                <TextArea
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Задайте ваш вопрос..."
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  variant="borderless"
                  style={{ 
                    flex: 1, 
                    resize: 'none', 
                    padding: '8px',
                    fontSize: '14px',
                    lineHeight: '1.5'
                  }}
                  disabled={isSending}
                />
                <Button
                  type="primary"
                  shape="circle"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  disabled={!inputVal.trim() || isSending}
                  style={{
                    height: '36px',
                    width: '36px',
                    minWidth: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)',
                    margin: '2px'
                  }}
                />
              </div>
              <div style={{ textAlign: 'center', marginTop: '8px' }}>
                <Text type="secondary" style={{ fontSize: '11px' }}>
                  Этот сервис защищен автоматической системой фильтрации. Логирование ведется в целях аудита ИБ.
                </Text>
              </div>
            </div>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
