import React from 'react';
import { AppShell } from './components/AppShell.js';
import { SessionGate } from './components/SessionGate.js';
import { devIdentityEnabled } from './services/api-client.js';
export const App: React.FC = () => (devIdentityEnabled() ? <AppShell /> : <SessionGate />);
export default App;
