import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AssetProvider } from './state/AssetContext.jsx';
import { GameProvider } from './state/GameContext.jsx';
import { UIProvider } from './state/UIContext.jsx';
import App from './App.jsx';
import './styles/index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AssetProvider>
      <GameProvider>
        <UIProvider>
          <App />
        </UIProvider>
      </GameProvider>
    </AssetProvider>
  </StrictMode>,
);
