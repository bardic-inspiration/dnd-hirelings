import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameProvider } from './state/GameContext.jsx';
import { ConfigProvider } from './state/ConfigContext.jsx';
import { UIProvider } from './state/UIContext.jsx';
import { NetSessionProvider } from './state/NetSessionContext.jsx';
import { readSessionParams } from './logic/netSession.js';
import App from './App.jsx';
import './styles/index.css';

// Offline is the default: no `?session=` param → today's ungated app, with no
// NetSessionProvider mounted (`useNetSession()` returns null everywhere).
const { enabled, sessionId, role } = readSessionParams();

const tree = (
  <GameProvider>
    <ConfigProvider>
      <UIProvider>
        <App />
      </UIProvider>
    </ConfigProvider>
  </GameProvider>
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {enabled
      ? <NetSessionProvider role={role} sessionId={sessionId}>{tree}</NetSessionProvider>
      : tree}
  </StrictMode>,
);
