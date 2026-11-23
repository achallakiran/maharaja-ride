import { runGame } from './game/game-main.ts';
import { runSpike } from './spike/spike-main.ts';

if (new URLSearchParams(location.search).has('spike')) {
  document.body.classList.add('spike');
  runSpike();
} else {
  runGame();
}
