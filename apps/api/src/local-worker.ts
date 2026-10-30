import { createApp } from './infrastructure/http/app.js';

export default createApp({ nodeEnv: 'development', persistenceFromEnvironment: true });
