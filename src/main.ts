import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/latin-900.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/lora/latin-600.css';
import './ui/styles.css';
import type { GameState } from './engine/game';
import { App } from './ui/app';

type Snapshot = { s?: GameState; log?: { cls: string; text: string }[] };
type Hot = { ready?: (fn: (data: Snapshot) => void) => void; data?: Snapshot };

const app = new App(document.getElementById('app')!);
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

// Quando hospedado como artifact, preserva a partida em atualizações da página.
if (hot?.ready) hot.ready((data) => app.start(data));
else app.start(hot?.data);
