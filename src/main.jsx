import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameProvider } from './state/GameContext.jsx';
import { ConfigProvider } from './state/ConfigContext.jsx';
import { UIProvider } from './state/UIContext.jsx';
import { NetSessionProvider } from './state/NetSessionContext.jsx';
import { parseSessionParams } from './logic/netSession.js';
import App from './App.jsx';
import './styles/index.css';

// `?session=<id>&role=gm|party` joins a networked session; without it the
// app is the offline single-player app (docs/spec/multiplayer.md).
const netSession = parseSessionParams(window.location.search);

const app = (
  <ConfigProvider>
    <UIProvider>
      <App />
    </UIProvider>
  </ConfigProvider>
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {netSession
      ? <NetSessionProvider sessionId={netSession.sessionId} role={netSession.role}>{app}</NetSessionProvider>
      : <GameProvider>{app}</GameProvider>}
  </StrictMode>,
);
