import React, { useState, useEffect, useRef } from 'react';
import { Layout, Input, Button, List, Avatar, Space, Typography, Badge, ConfigProvider, Tooltip } from 'antd';
import { 
  SendOutlined, 
  UserOutlined, 
  RobotOutlined, 
  PlusOutlined, 
  DeleteOutlined,
  MessageOutlined,
  LockOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// Premium light mode styling tokens (matching the admin panel for cohesion)
const clientTheme = {
  token: {
    colorPrimary: '#4f46e5', // Beautiful Indigo
    colorSuccess: '#10b981', // Emerald green
    colorWarning: '#f59e0b', // Amber yellow
    colorError: '#ef4444',   // Rose red
    colorInfo: '#3b82f6',    // Sky blue
    borderRadius: 8,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    colorBgLayout: '#f8fafc', // Very light grey bg
    colorBgContainer: '#ffffff', // Pure white card bg
    colorText: '#0f172a',    // Dark slate text
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

function App() {
  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('chat_sessions');
    return saved ? JSON.parse(saved) : [
      { id: '1', title: 'Новый диалог', messages: [
        { role: 'assistant', content: 'Привет! Я ваш корпоративный ИИ-ассистент. Моя работа защищена адаптивным контекстным шлюзом безопасности. Напишите ваш запрос, и я постараюсь помочь вам в рамках правил безопасности организации.' }
      ]}
    ];
  });
  
  const [activeSessionId, setActiveSessionId] = useState(() => {
    return sessions[0]?.id || '1';
  });

  const [inputVal, setInputVal] = useState('');
  const [streamingMessage, setStreamingMessage] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [ws, setWs] = useState(null);

  const chatEndRef = useRef(null);
  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  // Save sessions to localStorage
  useEffect(() => {
    localStorage.setItem('chat_sessions', JSON.stringify(sessions));
  }, [sessions]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, streamingMessage]);

  // Setup WebSocket connection
  useEffect(() => {
    const connectWs = () => {
      const socket = new WebSocket('ws://localhost:8000/api/v1/chat/ws');
      
      socket.onopen = () => {
        console.log('WebSocket connected');
      };
      
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'token') {
          setStreamingMessage(prev => (prev === null ? data.content : prev + data.content));
        } 
        else if (data.type === 'metadata') {
          setStreamingMessage(currentStream => {
            if (currentStream !== null) {
              setSessions(prevSessions => prevSessions.map(session => {
                if (session.id === activeSessionId) {
                  return {
                    ...session,
                    messages: [...session.messages, { role: 'assistant', content: currentStream }]
                  };
                }
                return session;
              }));
            }
            return null;
          });
          setIsSending(false);
        } 
        else if (data.type === 'error') {
          console.error('WS Error:', data.content);
          setSessions(prevSessions => prevSessions.map(session => {
            if (session.id === activeSessionId) {
              return {
                ...session,
                messages: [...session.messages, { role: 'assistant', content: `[Ошибка: ${data.content}]` }]
              };
            }
            return session;
          }));
          setIsSending(false);
        }
      };
      
      socket.onclose = () => {
        console.log('WebSocket disconnected, retrying in 3s...');
        setTimeout(connectWs, 3000);
      };

      setWs(socket);
    };

    connectWs();

    return () => {
      if (ws) ws.close();
    };
  }, [activeSessionId]);

  const handleSend = () => {
    if (!inputVal.trim() || isSending) return;
    
    const userText = inputVal.trim();
    setInputVal('');
    setIsSending(true);
    setStreamingMessage(''); // Init stream
    
    // Add user message to session
    setSessions(prev => prev.map(session => {
      if (session.id === activeSessionId) {
        const updatedMsgs = [...session.messages, { role: 'user', content: userText }];
        // Automatically set title based on first user query
        let title = session.title;
        if (session.title === 'Новый диалог' && session.messages.length === 1) {
          title = userText.slice(0, 24) + (userText.length > 24 ? '...' : '');
        }
        return {
          ...session,
          title,
          messages: updatedMsgs
        };
      }
      return session;
    }));

    // Prepare history payload for backend (exclude system error labels)
    const history = activeSession.messages
      .filter(msg => !msg.content.startsWith('[Ошибка:'))
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        message: userText,
        history: history
      }));
    } else {
      console.error('WS not connected');
      setSessions(prev => prev.map(session => {
        if (session.id === activeSessionId) {
          return {
            ...session,
            messages: [...session.messages, { role: 'assistant', content: '[Ошибка соединения: Веб-сокет не активен. Подключаюсь к серверу...]' }]
          };
        }
        return session;
      }));
      setIsSending(false);
      setStreamingMessage(null);
    }
  };

  const createNewSession = () => {
    const newId = Date.now().toString();
    const newSession = {
      id: newId,
      title: 'Новый диалог',
      messages: [
        { role: 'assistant', content: 'Привет! Я готов помочь вам в рамках правил безопасности организации. Задайте ваш вопрос.' }
      ]
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
  };

  const deleteSession = (id, e) => {
    e.stopPropagation();
    if (sessions.length === 1) {
      // Don't delete last, just clear it
      setSessions([
        { id: '1', title: 'Новый диалог', messages: [
          { role: 'assistant', content: 'Привет! Я готов помочь вам в рамках правил безопасности организации. Задайте ваш вопрос.' }
        ]}
      ]);
      setActiveSessionId('1');
      return;
    }
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    if (activeSessionId === id) {
      setActiveSessionId(updated[0].id);
    }
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
              renderItem={item => (
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
                  className="session-item"
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
                  ...(activeSession?.messages || []),
                  ...(streamingMessage !== null ? [{ role: 'assistant', content: streamingMessage, isStreaming: true }] : [])
                ]}
                renderItem={(item) => (
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
                  bordered={false}
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
