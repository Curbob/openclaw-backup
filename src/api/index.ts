#!/usr/bin/env node
import { startServer } from './server.js';

const port = parseInt(process.env.PORT || '11480', 10);
startServer(port);
